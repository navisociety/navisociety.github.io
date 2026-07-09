// supabase/functions/navi-chat/habit.ts
//
// NAVI v26 — Habit tracking with streaks.
//
// "track my habit: pray" starts a tracked habit. "i did my prayer habit" (or
// "habit done: pray") logs today — a log the day after the last one extends
// the streak, a later day restarts it at 1, and the best streak plus lifetime
// total are kept forever. "how are my habits?" reads the board; "drop my
// prayer habit" retires one. Milestone days (3, 7, 14, 21, 30…) get called
// out, because a streak someone celebrates is a streak someone keeps.
//
// Signed-in only, like reminders: habits live in the permanent memory row.
// Deterministic, zero-I/O, returns null when the message isn't a habit ask.

import type { Habit, Profile } from './memory.ts';
import { todayInTZ } from './skills.ts';
import { wordsMatch } from './match.ts';

const NAVI_TZ = 'Africa/Johannesburg';
const MAX_HABITS = 6;

// Same guard as memory.ts/agent.ts: crisis language is never a habit.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

function isoFromYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayISO(tz = NAVI_TZ): string {
  const t = todayInTZ(tz);
  return isoFromYMD(t.y, t.m, t.d);
}

function yesterdayOf(iso: string): string {
  const t = new Date(Date.parse(iso) - 86400000);
  return isoFromYMD(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Command parsing ─────────────────────────────────────────────────────────

const CREATE_RX =
  /^(?:please )?(?:track|start|begin|build)(?: a| my)?(?: new)? habit(?: of| called| named)? ?[: ]?(.+)$/;
const CREATE_HELP_RX =
  /^(?:please )?help me (?:build|start|make)(?: a| the)? habit of (.+)$/;

const LOG_RX =
  /^(?:i )?(?:did|done with|kept|completed|finished|logged) (?:my |the )?(.+?) habit(?: today)?$/;
const LOG_KEYWORD_RX = /^habit done ?[: ]? ?(.+)$/;
const LOG_BARE_RX = /^i (?:did|kept|logged) my habit(?: today)?$/;

const STATUS_RX =
  /^(?:how are my (?:habits|streaks)( (?:doing|going))?|(?:show|list|check)(?: me)?(?: my| all)? (?:habits|streaks)|my (?:habits|streaks)|(?:habit|streak) status|what are my (?:habits|streaks)|how(?:'s| is) my streak)$/;

const DELETE_RX =
  /^(?:please )?(?:delete|remove|drop|stop|quit|forget)(?: tracking)?(?: my| the)? (.+?) habit$/;

/** The habit name from a "track my habit: X" ask, or null. Crisis-guarded. */
export function parseHabitCreate(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 120) return null;
  const m = t.match(CREATE_RX) ?? t.match(CREATE_HELP_RX);
  if (!m) return null;
  // "pray every day" and "praying daily" both track as the plain habit name.
  const name = m[1].replace(/\s+(?:every ?day|daily|each day|every morning|every night)$/, '').trim();
  if (!name || name.length > 50 || CRISIS_RX.test(name)) return null;
  return name;
}

/** The habit name (as spoken) from a log ask, or null. */
export function parseHabitLog(message: string): string | 'BARE' | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  if (LOG_BARE_RX.test(t)) return 'BARE';
  const m = t.match(LOG_RX) ?? t.match(LOG_KEYWORD_RX);
  return m ? m[1].trim() : null;
}

/** The habit name from a delete ask, or null. */
export function parseHabitDelete(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  const m = t.match(DELETE_RX);
  return m ? m[1].trim() : null;
}

/** True when a signed-out message is clearly asking for habit features. */
export function isHabitAsk(message: string): boolean {
  const t = tidy(message);
  if (!t) return false;
  return (
    parseHabitCreate(message) !== null ||
    parseHabitLog(message) !== null ||
    parseHabitDelete(message) !== null ||
    STATUS_RX.test(t)
  );
}

// A spoken name matches a habit when either contains the other, or any word
// pair matches under the fuzzy matcher ("prayer" logs the "pray" habit).
function findHabit(habits: Habit[], spoken: string): number {
  const s = spoken.toLowerCase().trim();
  let idx = habits.findIndex(h => h.name === s || h.name.includes(s) || s.includes(h.name));
  if (idx >= 0) return idx;
  const words = s.split(/\s+/);
  idx = habits.findIndex(h =>
    h.name.split(/\s+/).some(hw => words.some(w => wordsMatch(w, hw, true))),
  );
  return idx;
}

// ── Formatting ──────────────────────────────────────────────────────────────

// v27: exported so brief.ts renders habits in the daily briefing identically.
export function streakLine(h: Habit, today: string): string {
  const state =
    h.lastDone === today ? 'done today'
    : h.lastDone === yesterdayOf(today) ? 'on track — not logged today yet'
    : h.lastDone ? `last done ${h.lastDone}`
    : 'not logged yet';
  return `- ${h.name}: ${h.streak}-day streak (best ${h.best}, ${h.total} total) — ${state}`;
}

function milestone(streak: number): string {
  if (streak === 1) return `Day 1 in the books. Every unbreakable streak started exactly here.`;
  if (streak === 3) return `Three days straight — this is where a decision starts becoming a habit.`;
  if (streak === 7) return `A FULL WEEK. Seven days of showing up. That's not luck, that's who you're becoming.`;
  if (streak === 21) return `Twenty-one days. They say that's when a habit takes root — and you just proved it.`;
  if (streak % 30 === 0) return `${streak} days. That's not a streak anymore, that's a lifestyle.`;
  if (streak % 7 === 0) return `${streak / 7} full weeks without missing. Quietly relentless — my favourite kind.`;
  return `${streak} days straight. Keep the chain unbroken.`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handle a habit command against the profile, or return null when the message
 * isn't habit business. Same contract as tryReminder/tryLifeEvent.
 */
export function tryHabit(
  message: string,
  profile: Profile,
  today = todayISO(),
): { reply: string; profile?: Profile } | null {
  const t = tidy(message);
  if (!t) return null;
  const habits = profile.habits ?? [];

  // Create.
  const name = parseHabitCreate(message);
  if (name) {
    if (findHabit(habits, name) >= 0) {
      return { reply: `I'm already tracking ${name} for you. Say "i did my ${name} habit" whenever you keep it, and "how are my habits" for the board.` };
    }
    if (habits.length >= MAX_HABITS) {
      return { reply: `You're tracking ${MAX_HABITS} habits — that's the honest maximum anyone actually keeps. Drop one first ("drop my … habit") and I'll take this one on.` };
    }
    const habit: Habit = { name, created: today, streak: 0, best: 0, total: 0 };
    return {
      reply: `Tracking it: ${name}. Every day you keep it, tell me — "i did my ${name} habit" — and I'll count the streak. Day one starts the moment you do it, not the moment you plan it.`,
      profile: { ...profile, habits: [...habits, habit] },
    };
  }

  // Log.
  const logged = parseHabitLog(message);
  if (logged) {
    if (!habits.length) {
      return { reply: `You're not tracking any habits with me yet. Start one with "track my habit: pray" and I'll count every day you keep it.` };
    }
    let idx: number;
    if (logged === 'BARE') {
      if (habits.length > 1) {
        return { reply: `Which one? You're tracking: ${habits.map(h => h.name).join(', ')}. Tell me like "i did my ${habits[0].name} habit".` };
      }
      idx = 0;
    } else {
      idx = findHabit(habits, logged);
      if (idx < 0) {
        return { reply: `I'm not tracking "${logged}". Your habits: ${habits.map(h => h.name).join(', ')}. (Or start it: "track my habit: ${logged}".)` };
      }
    }
    const h = habits[idx];
    if (h.lastDone === today) {
      return { reply: `Already counted — ${h.name} is done for today (${h.streak}-day streak). See you tomorrow for day ${h.streak + 1}.` };
    }
    const streak = h.lastDone === yesterdayOf(today) ? h.streak + 1 : 1;
    const broke = h.lastDone && streak === 1 && h.streak > 1;
    const next: Habit = {
      ...h, lastDone: today, streak, best: Math.max(h.best, streak), total: h.total + 1,
    };
    const lead = broke
      ? `Back on the horse — that's what matters. The old streak was ${h.streak}, the new one starts today.`
      : milestone(streak);
    return {
      reply: `${h.name} — logged. ${lead}`,
      profile: { ...profile, habits: habits.map((x, i) => (i === idx ? next : x)) },
    };
  }

  // Status.
  if (STATUS_RX.test(t)) {
    if (!habits.length) {
      return { reply: `No habits on the board yet. Give me one to track — "track my habit: pray" — and I'll count every day you keep it.` };
    }
    const lines = habits.map(h => streakLine(h, today)).join('\n');
    return { reply: `Your habits:\n${lines}\n\nLog one with "i did my <name> habit".` };
  }

  // Delete.
  const toDrop = parseHabitDelete(message);
  if (toDrop) {
    const idx = findHabit(habits, toDrop);
    if (idx < 0) {
      return habits.length
        ? { reply: `I'm not tracking "${toDrop}". Your habits: ${habits.map(h => h.name).join(', ')}.` }
        : { reply: `No habits tracked yet, so there's nothing called "${toDrop}" to drop.` };
    }
    const h = habits[idx];
    return {
      reply: `Dropped ${h.name}. For the record: best streak ${h.best}, ${h.total} days total — that effort was real, whatever comes next.`,
      profile: { ...profile, habits: habits.filter((_, i) => i !== idx) },
    };
  }

  return null;
}
