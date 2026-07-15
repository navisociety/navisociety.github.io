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

// v30 — Reminder ESCALATION (the cross-platform round): a reminder that has
// waited 3+ days is probably not a one-off — it's a habit or a mission step
// wearing a reminder's clothes. reminderEscalation() offers the promotion once
// per reminder (session-start, nudge-style); tryEscalate() executes it:
// "make that reminder a habit" converts it into a tracked habit (habit.ts
// shape, same cap), "make that reminder a mission step" appends it to the
// active mission's plan. Either way the reminder leaves the list — promoted,
// not abandoned.

// v44 — RECURRING reminders + snooze (the cadence round): "remind me every
// day to pray" / "remind me every monday to call mom" / "remind me to pay
// rent on the 1st of every month" hold ONE reminder whose `due` rolls to the
// next occurrence each time it surfaces — the surfacing IS the reminder, no
// tick-off owed (the daily-workflow lastRun idea, worn by a reminder).
// The cadence laws mirror the workflow schedule: weekly demands "every"/
// "each" (so "on friday" stays a one-off date), monthly is 1-28 ONLY so the
// day exists in every month, and "every month" bare defaults to the 1st.
// "done with reminder N" on a recurring one rolls it and says so — only
// "delete reminder N" stops it. "snooze reminder 2 until friday / for 3
// days" pushes any reminder's date (a recurring one resumes its rhythm
// after). And v44 closes a v22 gap: the add path now carries CRISIS_RX and
// steps aside, so crisis phrasing is never stored as a reminder.

import { type Habit, isCrisisReply, type Profile, type Reminder } from './memory.ts';
import { todayInTZ } from './skills.ts';

// Same guard as agent.ts/habit.ts/memory.ts: crisis language is a human
// emergency, never a note to hold. Returning null lets the pipeline fall
// through to the crisis nodes, which own the message.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

const NAVI_TZ = 'Africa/Johannesburg';
const MAX_REMINDERS = 12;
// Mirrors habit.ts / agent.ts — every list keeps its own cap.
const MAX_HABITS = 6;
const MAX_MISSION_STEPS = 10;
const ESCALATE_AFTER_DAYS = 3;

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

// ── v44: recurring cadence ────────────────────────────────────────────────────

// 'day', a weekday name, or a day-of-month number (1-28).
export type Every = string | number;

/**
 * Parse a recurring phrase off a reminder and strip it: "every day",
 * "every monday" (each/plural forms too), "on the 1st of every month",
 * "every month [on the 15th]" (bare defaults to the 1st). Weekly demands
 * "every"/"each" — "on friday" stays a one-off date for parseWhen. Monthly
 * days 29-31 come back as `badDay` so the caller can refuse honestly.
 * No bare "daily": "the daily standup" is a topic, not a cadence.
 */
export function parseEvery(text: string): { text: string; every?: Every; badDay?: number } {
  let t = text.trim().replace(/[.!?]+\s*$/, '');
  const strip = (rx: RegExp) => {
    const m = t.match(rx);
    if (m) t = t.replace(rx, ' ').replace(/\s+/g, ' ').trim();
    return m;
  };
  let m: RegExpMatchArray | null;
  if ((m = strip(/\s*\bon (?:the )?(\d{1,2})(?:st|nd|rd|th)? of (?:every|each) month\b/i)) ||
      (m = strip(/\s*\b(?:every|each) month(?:\s+on (?:the )?(\d{1,2})(?:st|nd|rd|th)?)?\b/i))) {
    const day = m[1] ? parseInt(m[1], 10) : 1;
    if (day < 1 || day > 28) return { text: t, badDay: day };
    return { text: t, every: day };
  }
  if (strip(/\s*\b(?:every|each) day\b/i)) return { text: t, every: 'day' };
  if ((m = strip(new RegExp(String.raw`\s*\b(?:every|each) (${WEEKDAYS.join('|')})s?\b`, 'i')))) {
    return { text: t, every: m[1].toLowerCase() };
  }
  return { text: t };
}

/**
 * The next date (ISO, SA time) a cadence falls on. `after` excludes today —
 * creation includes it ("every wednesday" said on a Wednesday surfaces this
 * very day), rolling forward after a surface excludes it.
 */
export function nextOccurrence(every: Every, today: { y: number; m: number; d: number }, after = false): string {
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  if (every === 'day') return after ? addDays(today, 1) : todayISO;
  if (typeof every === 'number') {
    const thisMonth = isoFromYMD(today.y, today.m, every);
    if (after ? thisMonth > todayISO : thisMonth >= todayISO) return thisMonth;
    return today.m === 12 ? isoFromYMD(today.y + 1, 1, every) : isoFromYMD(today.y, today.m + 1, every);
  }
  const target = WEEKDAYS.indexOf(String(every).toLowerCase());
  if (target < 0) return todayISO; // unknown cadence never lands here; stay honest anyway
  const now = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
  let ahead = ((target - now) % 7 + 7) % 7;
  if (ahead === 0 && after) ahead = 7;
  return addDays(today, ahead);
}

function ymdOf(iso: string): { y: number; m: number; d: number } {
  return { y: parseInt(iso.slice(0, 4), 10), m: parseInt(iso.slice(5, 7), 10), d: parseInt(iso.slice(8, 10), 10) };
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** "every day" / "every monday" / "monthly on the 1st" — how a cadence reads back. */
export function cadenceLabel(every: Every): string {
  if (every === 'day') return 'every day';
  if (typeof every === 'number') return `monthly on the ${ordinal(every)}`;
  return `every ${every}`;
}

// ── Ask detection ─────────────────────────────────────────────────────────────

const ADD_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?remind me\s+(?:to\s+|about\s+|that\s+)?(.+)$/i;
const LIST_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:what are my|show (?:me )?my|list my|do i have any)\s+reminders?[?!.]*$/i;
const CLEAR_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:clear|delete|remove|forget)\s+(?:all\s+)?(?:of\s+)?my\s+reminders[?!.]*$/i;
// v44: the verb is captured — on a RECURRING reminder "done with"/"i did"
// rolls it to its next date, while remove/delete/clear stops it for good.
const DONE_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(done with|i did|remove|delete|clear)\s+(?:the\s+)?reminder\s*(?:#|number\s*)?(\d{1,2})[?!.]*$/i;

// v44: snooze — push a reminder's date out. The phrase reuses parseWhen's
// closed vocabulary ("until tomorrow", "until friday", "until 25 december");
// "for 3 days" / "for a week" normalize to the "in N days/weeks" form. No
// phrase means tomorrow.
const SNOOZE_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+)?(?:snooze|postpone|push|delay)\s+(?:the\s+)?reminder\s*(?:#|number\s*)?(\d{1,2})(?:\s+(?:until|till|to|for)\s+(.+?))?[?!.]*$/i;

// v30: escalation commands. Anchored like everything else; "reminder 2" picks
// by list position, bare "that reminder" picks the one NAVI last offered on
// (else the longest-waiting one).
const ESC_HABIT_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+)?(?:make|turn) (?:that |this |the last |the )?reminder(?: #?(\d{1,2}))?(?: into)? a (?:daily )?habit$/i;
const ESC_MISSION_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+)?(?:(?:make|turn) (?:that |this |the last |the )?reminder(?: #?(\d{1,2}))?(?: into)? a mission step|add (?:that |this |the last |the )?reminder(?: #?(\d{1,2}))? to (?:my |the )?mission)$/i;

/** True when the message is any reminder-flavoured ask (used to nudge anonymous users to sign in). */
export function isReminderAsk(message: string): boolean {
  const m = message.trim().replace(/[.!?]+\s*$/, '');
  return ADD_RX.test(m) || LIST_RX.test(m) || CLEAR_RX.test(m) || DONE_RX.test(m) ||
    SNOOZE_RX.test(m) || ESC_HABIT_RX.test(m) || ESC_MISSION_RX.test(m);
}

function describe(r: Reminder, todayISO: string): string {
  // v44: a recurring reminder names its rhythm wherever it renders.
  const tag = r.every !== undefined ? `${cadenceLabel(r.every)} — ` : '';
  if (!r.due) return r.every !== undefined ? `${r.text} (${cadenceLabel(r.every)})` : r.text;
  if (r.due < todayISO) return `${r.text} (${tag}was due ${r.due})`;
  if (r.due === todayISO) return `${r.text} (${tag}today)`;
  return `${r.text} (${tag}${r.every !== undefined ? 'next ' : ''}${r.due})`;
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
    const idx = parseInt(done[2], 10) - 1;
    if (idx < 0 || idx >= list.length) {
      return { reply: list.length ? `I only have ${list.length} reminder${list.length > 1 ? 's' : ''} — say "what are my reminders" to see them.` : 'You have no reminders saved.' };
    }
    const target = list[idx];
    // v44: a recurring reminder survives "done" — it rolls to its next date.
    // Only the delete verbs stop it.
    if (target.every !== undefined && /^(?:done with|i did)$/i.test(done[1])) {
      const base = target.due && target.due > todayISO ? ymdOf(target.due) : today;
      const due = nextOccurrence(target.every, base, true);
      return {
        reply: `Ticked off for now — "${target.text}" repeats ${cadenceLabel(target.every)}, so it'll be back on ${due}. Say "delete reminder ${idx + 1}" to stop it for good.`,
        profile: { ...stored, reminders: list.map((r, i) => (i === idx ? { ...r, due } : r)) },
      };
    }
    const rest = list.filter((_, i) => i !== idx);
    const tail = rest.length ? `${rest.length} still on the list.` : 'That was the last one.';
    if (target.every !== undefined) {
      return {
        reply: `Stopped — no more ${cadenceLabel(target.every)} reminders about "${target.text}". ${tail}`,
        profile: { ...stored, reminders: rest },
      };
    }
    return {
      reply: `Ticked off — "${target.text}" is done. ${tail}`,
      profile: { ...stored, reminders: rest },
    };
  }

  // v44: snooze — push a reminder's date out; a recurring one resumes its
  // rhythm after the snoozed date passes.
  const snooze = m.replace(/[.!?]+\s*$/, '').match(SNOOZE_RX);
  if (snooze) {
    const idx = parseInt(snooze[1], 10) - 1;
    if (idx < 0 || idx >= list.length) {
      return { reply: list.length ? `I only have ${list.length} reminder${list.length > 1 ? 's' : ''} — say "what are my reminders" to see them.` : 'You have no reminders saved.' };
    }
    let phrase = (snooze[2] ?? 'tomorrow').trim()
      .replace(/^(?:a|one)\s+(day|week)$/i, '1 $1')
      .replace(/^(\d{1,2})\s+(day|week)s?$/i, 'in $1 $2s');
    const { due } = parseWhen(phrase, today);
    if (!due) {
      return { reply: 'I can snooze "until tomorrow", "until friday", "for 3 days", or "until 25 december" — that phrasing I don\'t know yet.' };
    }
    if (due <= todayISO) {
      return { reply: "That wouldn't move it anywhere — pick a day after today, like \"snooze reminder 1 until tomorrow\"." };
    }
    const target = list[idx];
    const rhythm = target.every !== undefined ? ` (its ${cadenceLabel(target.every)} rhythm carries on after that)` : '';
    return {
      reply: `Snoozed — "${target.text}" will come back on ${due}${rhythm}.`,
      profile: { ...stored, reminders: list.map((r, i) => (i === idx ? { ...r, due } : r)) },
    };
  }

  const add = m.replace(/[.!?]+\s*$/, '').match(ADD_RX);
  if (add) {
    // v44: crisis phrasing is never stored as a reminder — step aside and let
    // the crisis nodes own the whole message.
    if (CRISIS_RX.test(add[1])) return null;
    // v44: recurring? Parse the cadence BEFORE parseWhen — parseWhen would
    // eat the weekday out of "every monday" and leave a one-off behind.
    const ev = parseEvery(add[1]);
    if (ev.badDay !== undefined) {
      return { reply: `Not every month has a ${ordinal(ev.badDay)} — pick a day from 1 to 28 and the reminder will exist in every month.` };
    }
    if (ev.every !== undefined) {
      // "remind me every monday to call mom" — the cadence came before the
      // "to", so ADD_RX couldn't strip it; take it off the remainder here.
      const text = ev.text.replace(/^(?:to|about|that)\s+/i, '').trim();
      if (!text || text.length > 200) return { reply: "Tell me what to remind you about — like \"remind me every monday to call mom\"." };
      if (list.length >= MAX_REMINDERS) {
        return { reply: `Your list is full (${MAX_REMINDERS}). Say "what are my reminders" and tick a few off first.` };
      }
      const due = nextOccurrence(ev.every, today);
      const first = due === todayISO ? 'today' : due === addDays(today, 1) ? 'tomorrow' : `on ${due}`;
      return {
        reply: `Held. I'll remind you to ${text} ${cadenceLabel(ev.every)}, starting ${first} — it repeats until you say "delete reminder ${list.length + 1}".`,
        profile: { ...stored, reminders: [...list, { text, created: todayISO, due, every: ev.every }] },
      };
    }
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
 * due when it has no date or its date has arrived; a one-off stays on the
 * list until the user ticks it off, so nothing silently disappears. v44: a
 * RECURRING reminder rolls to its next occurrence the moment it surfaces —
 * the surfacing IS the reminder — and the rolled list comes back on
 * `reminders` for the caller to carry into the save. Never wraps a crisis
 * reply (invariant #1); the untouched list surfaces next session instead.
 */
export function addDueReminders(
  response: string,
  stored: Profile,
  today = todayInTZ(NAVI_TZ),
): { response: string; reminders?: Reminder[] } {
  const list = stored.reminders ?? [];
  if (!list.length || isCrisisReply(response)) return { response };
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  const due = list.filter(r => !r.due || r.due <= todayISO);
  if (!due.length) return { response };
  const lines = due.map(r => `• ${describe(r, todayISO)}`).join('\n');
  const lead = due.length === 1 ? 'One thing you asked me to hold:' : `${due.length} things you asked me to hold:`;
  let rolled = false;
  const reminders = list.map(r => {
    if (r.every === undefined || !r.due || r.due > todayISO) return r;
    rolled = true;
    return { ...r, due: nextOccurrence(r.every, today, true) };
  });
  return {
    response: `${lead}\n${lines}\n(Say "done with reminder 1" to tick one off.)\n\n${response}`,
    ...(rolled ? { reminders } : {}),
  };
}

// ── v30: escalation — a reminder that keeps waiting gets promoted ────────────

function daysBetween(fromISO: string, toISO: string): number {
  const d = Math.round((Date.parse(toISO) - Date.parse(fromISO.slice(0, 10))) / 86400000);
  return Number.isFinite(d) ? d : 0;
}

/**
 * One session-start note (nudge-style) when a reminder has waited 3+ days
 * without being ticked off: offer to make it a habit or a mission step. One
 * offer per reminder EVER (the `offered` stamp persists), oldest first, and
 * at most one offer per session — gentle, never a nag wall. Returns null when
 * there's nothing to offer.
 */
export function reminderEscalation(
  profile: Profile,
  todayISO: string,
): { note: string; profile: Profile } | null {
  const list = profile.reminders ?? [];
  // v44: recurring reminders never escalate — a cadence IS the promotion.
  const idx = list.findIndex(
    (r) => r.every === undefined && !r.offered && daysBetween(r.created, todayISO) >= ESCALATE_AFTER_DAYS,
  );
  if (idx < 0) return null;
  const r = list[idx];
  const days = daysBetween(r.created, todayISO);
  const note =
    `Your reminder "${r.text}" has been waiting ${days} days now. Things that keep waiting usually aren't one-offs — want me to promote it? Say "make that reminder a habit" and I'll track the streak, or "make that reminder a mission step" and it joins the plan. (Or "done with reminder ${idx + 1}" if it's already handled.)`;
  const reminders = list.map((x, i) => (i === idx ? { ...x, offered: todayISO } : x));
  return { note, profile: { ...profile, reminders } };
}

// The reminder an escalation command points at: an explicit number wins, then
// the one NAVI most recently offered on, then the longest-waiting.
function pickReminder(list: Reminder[], numbered?: string): number {
  if (numbered) {
    const i = parseInt(numbered, 10) - 1;
    return i >= 0 && i < list.length ? i : -1;
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.offered && (best < 0 || !list[best].offered || r.offered > list[best].offered!)) best = i;
  }
  if (best >= 0) return best;
  let oldest = 0;
  for (let i = 1; i < list.length; i++) if (list[i].created < list[oldest].created) oldest = i;
  return list.length ? oldest : -1;
}

/**
 * Execute an escalation: "make that reminder a habit" / "make reminder 2 a
 * mission step". The reminder converts and leaves the list. Returns null when
 * the message isn't an escalation ask. Same contract as tryReminder.
 */
export function tryEscalate(
  message: string,
  profile: Profile,
  today = todayInTZ(NAVI_TZ),
): ReminderTurn | null {
  const m = message.trim().replace(/[.!?]+\s*$/, '');
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  const list = profile.reminders ?? [];

  const habitAsk = m.match(ESC_HABIT_RX);
  const missionAsk = habitAsk ? null : m.match(ESC_MISSION_RX);
  if (!habitAsk && !missionAsk) return null;

  if (!list.length) {
    return { reply: 'There are no reminders on your list to promote. Say "remind me to…" first, and if it keeps waiting I\'ll offer this myself.' };
  }
  const numbered = habitAsk ? habitAsk[1] : (missionAsk![1] ?? missionAsk![2]);
  const idx = pickReminder(list, numbered);
  if (idx < 0) {
    return { reply: `I only have ${list.length} reminder${list.length > 1 ? 's' : ''} — say "what are my reminders" to see them, then "make reminder 1 a habit".` };
  }
  const r = list[idx];
  const rest = list.filter((_, i) => i !== idx);

  if (habitAsk) {
    const habits = profile.habits ?? [];
    const name = r.text.toLowerCase().trim().slice(0, 50);
    const existing = habits.find(
      (h) => h.name === name || h.name.includes(name) || name.includes(h.name),
    );
    if (existing) {
      return {
        reply: `You're already tracking "${existing.name}" — so the reminder's job is done. I've taken it off the list; log the habit with "i did my ${existing.name} habit".`,
        profile: { ...profile, reminders: rest },
      };
    }
    if (habits.length >= MAX_HABITS) {
      return { reply: `You're tracking ${MAX_HABITS} habits already — that's the honest maximum anyone keeps. Drop one first ("drop my … habit") and I'll promote this reminder.` };
    }
    const habit: Habit = { name, created: todayISO, streak: 0, best: 0, total: 0 };
    return {
      reply: `Promoted: "${r.text}" is a tracked habit now, off the reminder list and onto the streak board. Every day you keep it, say "i did my ${name} habit" — day one starts the moment you do it.`,
      profile: { ...profile, reminders: rest, habits: [...habits, habit] },
    };
  }

  // Mission step.
  const mission = profile.mission;
  if (!mission) {
    return { reply: `There's no active mission to attach "${r.text}" to. Start one ("start a mission to…") and ask me again — or say "make that reminder a habit" instead.` };
  }
  if (mission.steps.length >= MAX_MISSION_STEPS) {
    return { reply: `The mission already has ${MAX_MISSION_STEPS} steps — that's a plan, not a backlog. Finish or skip a few, then I'll promote the reminder.` };
  }
  const steps = [...mission.steps, r.text];
  return {
    reply: `Promoted: "${r.text}" is now step ${steps.length} of your mission "${mission.goal}" — off the reminder list and into the plan. You're still on step ${mission.done + 1}:\n${steps[mission.done]}`,
    profile: {
      ...profile,
      reminders: rest,
      mission: { ...mission, steps, touched: new Date().toISOString() },
    },
  };
}
