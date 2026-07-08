// supabase/functions/navi-chat/remind.ts
//
// NAVI v22 — Cross-session Reminders.
//
// "Remind me to call mom tomorrow" is held in the user's permanent memory row
// (Profile.reminders via store.ts) and surfaces at the start of their next
// session once it's due — across chats, sessions, and devices, exactly like
// the rest of NAVI's v18 memory. Dated reminders ("tomorrow", "on friday",
// "in 3 days", "on 25 december") wait for their day; undated ones surface on
// the very next session. "What are my reminders", "done with reminder 1",
// and "clear my reminders" manage the list. Signed-in users only — there is
// nowhere to keep a reminder for an anonymous visitor.

import type { Profile, Reminder } from './memory.ts';
import { todayInTZ } from './skills.ts';

const NAVI_TZ = 'Africa/Johannesburg';
const MAX_REMINDERS = 12;

export interface ReminderTurn { reply: string; profile?: Profile }

// ── Date-phrase parsing (South Africa time, date-level precision) ────────────

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function isoFromYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(today: { y: number; m: number; d: number }, days: number): string {
  const t = new Date(Date.UTC(today.y, today.m - 1, today.d + days));
  return isoFromYMD(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Parse a trailing time phrase off a reminder. Returns the due date (ISO
 * yyyy-mm-dd) and the text with the phrase removed — or due '' when the
 * reminder has no date (surfaces next session).
 */
export function parseWhen(text: string, today = todayInTZ(NAVI_TZ)): { text: string; due: string } {
  let t = text.trim().replace(/[.!?]+\s*$/, '');
  const strip = (rx: RegExp) => {
    const m = t.match(rx);
    if (m) t = t.replace(rx, '').replace(/\s+/g, ' ').trim();
    return m;
  };

  let due = '';
  let m: RegExpMatchArray | null;
  if (strip(/\s*\btomorrow\b/i)) {
    due = addDays(today, 1);
  } else if (strip(/\s*\b(?:today|tonight|this evening)\b/i)) {
    due = addDays(today, 0);
  } else if ((m = strip(/\s*\bin\s+(\d{1,2})\s+(day|week)s?\b/i))) {
    due = addDays(today, parseInt(m[1], 10) * (m[2].toLowerCase() === 'week' ? 7 : 1));
  } else if (strip(/\s*\bnext\s+week\b/i)) {
    due = addDays(today, 7);
  } else if ((m = strip(new RegExp(String.raw`\s*\b(?:on\s+|next\s+)?(${WEEKDAYS.join('|')})\b`, 'i')))) {
    const target = WEEKDAYS.indexOf(m[1].toLowerCase());
    const now = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    const ahead = ((target - now) % 7 + 7) % 7 || 7; // "friday" said on a Friday means next Friday
    due = addDays(today, ahead);
  } else if ((m = strip(new RegExp(String.raw`\s*\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS.join('|')})\b`, 'i')))
          ?? (m = strip(new RegExp(String.raw`\s*\b(?:on\s+)?(${MONTHS.join('|')})\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i')))) {
    const [a, b] = [m[1].toLowerCase(), m[2]?.toLowerCase() ?? ''];
    const day = /^\d/.test(a) ? parseInt(a, 10) : parseInt(b, 10);
    const month = MONTHS.indexOf(/^\d/.test(a) ? b : a) + 1;
    if (month >= 1 && day >= 1 && day <= 31) {
      const thisYear = isoFromYMD(today.y, month, day);
      due = thisYear >= isoFromYMD(today.y, today.m, today.d) ? thisYear : isoFromYMD(today.y + 1, month, day);
    }
  }
  return { text: t, due };
}

// ── Ask detection ─────────────────────────────────────────────────────────────

const ADD_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?remind me\s+(?:to\s+|about\s+|that\s+)?(.+)$/i;
const LIST_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:what are my|show (?:me )?my|list my|do i have any)\s+reminders?[?!.]*$/i;
const CLEAR_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:clear|delete|remove)\s+(?:all\s+)?(?:of\s+)?my\s+reminders[?!.]*$/i;
const DONE_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:done with|i did|remove|delete|clear)\s+(?:the\s+)?reminder\s*(?:#|number\s*)?(\d{1,2})[?!.]*$/i;

/** True when the message is any reminder-flavoured ask (used to nudge anonymous users to sign in). */
export function isReminderAsk(message: string): boolean {
  const m = message.trim();
  return ADD_RX.test(m) || LIST_RX.test(m) || CLEAR_RX.test(m) || DONE_RX.test(m);
}

function describe(r: Reminder, todayISO: string): string {
  if (!r.due) return r.text;
  if (r.due < todayISO) return `${r.text} (was due ${r.due})`;
  if (r.due === todayISO) return `${r.text} (today)`;
  return `${r.text} (${r.due})`;
}

/**
 * Handle a reminder ask against the stored profile. Returns null when the
 * message isn't about reminders; otherwise the reply, plus the updated
 * profile when the list changed (the caller persists it).
 */
export function tryReminder(message: string, stored: Profile, today = todayInTZ(NAVI_TZ)): ReminderTurn | null {
  const m = message.trim();
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  const list = stored.reminders ?? [];

  if (LIST_RX.test(m)) {
    if (!list.length) return { reply: "You have no reminders saved. Say \"remind me to…\" and I'll hold it for you." };
    const lines = list.map((r, i) => `${i + 1}. ${describe(r, todayISO)}`).join('\n');
    return { reply: `Here's what I'm holding for you:\n${lines}\n\nSay "done with reminder 1" to tick one off.` };
  }

  if (CLEAR_RX.test(m)) {
    if (!list.length) return { reply: 'Your reminder list is already empty.' };
    return {
      reply: `Done — all ${list.length} reminder${list.length > 1 ? 's' : ''} cleared.`,
      profile: { ...stored, reminders: [] },
    };
  }

  const done = m.match(DONE_RX);
  if (done) {
    const idx = parseInt(done[1], 10) - 1;
    if (idx < 0 || idx >= list.length) {
      return { reply: list.length ? `I only have ${list.length} reminder${list.length > 1 ? 's' : ''} — say "what are my reminders" to see them.` : 'You have no reminders saved.' };
    }
    const removed = list[idx];
    return {
      reply: `Ticked off — "${removed.text}" is done. ${list.length - 1 ? `${list.length - 1} still on the list.` : 'That was the last one.'}`,
      profile: { ...stored, reminders: list.filter((_, i) => i !== idx) },
    };
  }

  const add = m.replace(/[.!?]+\s*$/, '').match(ADD_RX);
  if (add) {
    const { text, due } = parseWhen(add[1], today);
    if (!text || text.length > 200) return { reply: "Tell me what to remind you about — like \"remind me to call mom tomorrow\"." };
    if (list.length >= MAX_REMINDERS) {
      return { reply: `Your list is full (${MAX_REMINDERS}). Say "what are my reminders" and tick a few off first.` };
    }
    const reminder: Reminder = { text, created: todayISO, ...(due ? { due } : {}) };
    const when = due
      ? (due === todayISO ? 'today' : due === addDays(today, 1) ? 'tomorrow' : `on ${due}`)
      : "next time you're here";
    return {
      reply: `Held. I'll remind you to ${text} ${when}. Say "what are my reminders" anytime.`,
      profile: { ...stored, reminders: [...list, reminder] },
    };
  }

  return null;
}

/**
 * Prepend due reminders to the first reply of a fresh session. A reminder is
 * due when it has no date or its date has arrived; it stays on the list until
 * the user ticks it off, so nothing silently disappears.
 */
export function addDueReminders(response: string, stored: Profile, today = todayInTZ(NAVI_TZ)): string {
  const list = stored.reminders ?? [];
  if (!list.length) return response;
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  const due = list.filter(r => !r.due || r.due <= todayISO);
  if (!due.length) return response;
  const lines = due.map(r => `• ${describe(r, todayISO)}`).join('\n');
  const lead = due.length === 1 ? 'One thing you asked me to hold:' : `${due.length} things you asked me to hold:`;
  return `${lead}\n${lines}\n(Say "done with reminder 1" to tick one off.)\n\n${response}`;
}
