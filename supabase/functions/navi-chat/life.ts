// supabase/functions/navi-chat/life.ts
//
// NAVI v23 — Life events with follow-through.
//
// "My exam is on Friday" / "I have an interview tomorrow" is held in the
// user's permanent memory (Profile.events via store.ts). NAVI confirms it,
// answers "what's coming up?" and "when is my exam?", gives a heads-up on the
// day itself — and, the part that makes it feel human, ASKS HOW IT WENT at
// the start of the first session after the date has passed. Signed-in users
// only, exactly like reminders: there is nowhere to keep an event for an
// anonymous visitor.
//
// Date parsing is shared with remind.ts (parseWhen): tomorrow, weekday names,
// "in 3 days", "on 25 december" — SA time, date-level precision.

import type { Profile, LifeEvent } from './memory.ts';
import { parseWhen } from './remind.ts';
import { todayInTZ } from './skills.ts';

const NAVI_TZ = 'Africa/Johannesburg';
const MAX_EVENTS = 6;

export interface LifeTurn { reply: string; profile?: Profile }

function isoFromYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

/** "on 2026-07-10 (in 2 days)" / "tomorrow" / "today" — human date labels. */
function friendly(dateISO: string, todayISO: string): string {
  const days = daysBetween(todayISO, dateISO);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `on ${dateISO} (in ${days} days)`;
}

// Things "i have X" can mean that are NOT calendar events. Birthdays belong
// to memory.ts; ailments and vague nouns would make "how did it go?" absurd.
const EVENT_BAN =
  /\b(birthday|remind|reminder|headache|migraine|cold|flu|fever|pain|problem|question|feeling|crush)\b/i;

const QUESTION_RX =
  /^(?:what|when|where|who|how|why|do|does|did|is|are|am|can|could|will|would|should|have i)\b|\?\s*$/i;

/**
 * Parse a dated life event out of a statement: "i have an exam on friday",
 * "my interview is tomorrow", "i'm seeing the doctor on monday". Returns
 * null when the message isn't a clean event statement with a real date.
 */
export function parseLifeEvent(message: string, today = todayInTZ(NAVI_TZ)): LifeEvent | null {
  const raw = message.trim();
  if (QUESTION_RX.test(raw)) return null;
  if (EVENT_BAN.test(raw)) return null;
  if (raw.split(/\s+/).length > 14) return null;

  const { text, due } = parseWhen(raw, today);
  if (!due) return null;

  const t = text
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[,.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const m =
    t.match(/^i(?:'ve| have)\s+(?:got\s+)?(?:an?\s+|my\s+|a big\s+)?(.{2,40})$/) ??
    t.match(/^my\s+(.{2,40}?)\s+(?:is|starts|happens|begins)$/) ??
    t.match(/^i(?:'m| am)\s+((?:seeing|meeting|visiting|starting|writing|taking|playing|performing|travelling|traveling|flying|moving|launching|presenting)\b.{0,40})$/);
  if (!m) return null;

  const what = m[1].trim();
  if (what.length < 3 || /^(?:to|it|that|this|you)\b/.test(what)) return null;
  return { text: what, date: due };
}

const UPCOMING_RX =
  /\b(?:what(?:'s| is)? coming up|anything coming up|what do i have (?:coming(?: up)?|this week|on(?: this week)?)|what(?:'s| is) (?:on )?my (?:week|calendar|schedule))\b/i;

const WHEN_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?when(?:'s| is)\s+(?:my|the)\s+(.{2,30}?)(?:\s+again)?[?!.]*$/i;

/**
 * Handle a life-event turn against the stored profile: capture a new dated
 * event, list what's coming up, or answer "when is my exam?". Returns null
 * when the message isn't about life events; otherwise the reply, plus the
 * updated profile when the list changed (the caller persists it).
 */
export function tryLifeEvent(message: string, stored: Profile, today = todayInTZ(NAVI_TZ)): LifeTurn | null {
  const m = message.trim();
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  const list = stored.events ?? [];

  // "when is my exam?" — only answers when a matching event is actually held;
  // otherwise fall through (birthdays etc. belong to other layers).
  const when = m.match(WHEN_RX);
  if (when) {
    const asked = when[1].trim().toLowerCase();
    const hit = list.find(e => e.text.includes(asked) || asked.includes(e.text));
    if (hit) {
      return { reply: `Your ${hit.text} is ${friendly(hit.date, todayISO)}. I'm tracking it — and I'll ask you how it went.` };
    }
    return null;
  }

  if (UPCOMING_RX.test(m)) {
    const upcoming = list.filter(e => e.date >= todayISO).sort((a, b) => a.date.localeCompare(b.date));
    if (!upcoming.length) {
      return { reply: "Nothing on your radar that you've told me about. Got something coming up? Say it — \"my exam is on friday\" — and I'll hold the date." };
    }
    const lines = upcoming.map(e => `• ${e.text} — ${friendly(e.date, todayISO)}`).join('\n');
    return { reply: `Here's what you've got coming up:\n${lines}\n\nI'll check in on each one after it lands.` };
  }

  const event = parseLifeEvent(m, today);
  if (event) {
    const rest = list.filter(e => e.text !== event.text);
    const events = [...rest, event].slice(-MAX_EVENTS);
    return {
      reply: `Locked in — your ${event.text} is ${friendly(event.date, todayISO)}. I'll remember it, and afterwards I'm going to ask you how it went. Go make it count.`,
      profile: { ...stored, events },
    };
  }

  return null;
}

/**
 * Open the first reply of a fresh session with life-event follow-through:
 * events whose date has passed get a genuine "how did it go?" (and are then
 * released), and anything happening today gets a heads-up. Returns the new
 * response plus the trimmed event list when it changed.
 */
export function addEventFollowUps(
  response: string,
  stored: Profile,
  today = todayInTZ(NAVI_TZ),
): { response: string; events?: LifeEvent[] } {
  const list = stored.events ?? [];
  if (!list.length) return { response };
  const todayISO = isoFromYMD(today.y, today.m, today.d);

  const past = list.filter(e => e.date < todayISO);
  const dayOf = list.filter(e => e.date === todayISO);
  const parts: string[] = [];
  if (past.length === 1) {
    parts.push(`First things first — how did your ${past[0].text} go? You told me about it, and I didn't forget.`);
  } else if (past.length > 1) {
    parts.push(`First things first — how did things go? You had ${past.map(e => `your ${e.text}`).join(' and ')}, and I've been wondering.`);
  }
  for (const e of dayOf) {
    parts.push(`And heads up: your ${e.text} is TODAY. You've prepared for this — go get it.`);
  }
  if (!parts.length) return { response };

  const kept = list.filter(e => e.date >= todayISO);
  return {
    response: `${parts.join(' ')}\n\n${response}`,
    events: kept.length !== list.length ? kept : undefined,
  };
}
