// supabase/functions/navi-chat/review.ts
//
// NAVI v28 — The weekly review.
//
// "review my week" turns the data NAVI already keeps into an honest
// week-over-week report: habits kept (lifetime totals vs. the last review's
// snapshot), mission velocity (steps moved since then), mood shift (this
// week's dated journal entries against last week's), wins earned, and
// reminders cleared. The first review sets the baseline; every review
// re-stamps the snapshot so the next one has something to measure against.
//
// A session-start offer (`reviewOffer`) surfaces once per day when the last
// review — or the oldest tracked history, before any review exists — is 7+
// days old. Like the mission nudge, it only speaks; it never runs anything.
//
// Signed-in only, read-only over the profile except for the snapshot stamp.
// Deterministic; returns null when the message isn't a review ask.

import type { Habit, Profile, ReviewSnapshot } from './memory.ts';
import { streakLine } from './habit.ts';
import { todayInTZ } from './skills.ts';

const NAVI_TZ = 'Africa/Johannesburg';

function todayISO(tz = NAVI_TZ): string {
  const t = todayInTZ(tz);
  return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}

// Same address-tidy as brief.ts/agent.ts/habit.ts.
function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Anchored to the full message, like every command regex. "review my essay"
// or "how was my day" must fall through to ordinary conversation.
const REVIEW_RX =
  /^(?:please )?(?:(?:run |give me |show me |read me |do )?(?:my |the )?(?:weekly review|week(?:ly)? in review|week review)|review my week|review the week|review this week|how was my week|how did my week go)$/;

/** True when the message is asking for the weekly review. */
export function isReviewAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && t.length <= 40 && REVIEW_RX.test(t);
}

const SIGN_IN_REPLY =
  'The weekly review measures your permanent memory — habits, mission, mood, wins — against last week, so I can only build it once you\'re signed in. Sign in and say "review my week".';

function days(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO.slice(0, 10)) - Date.parse(fromISO.slice(0, 10))) / 86400000);
}

// ── Mood shift — dated journal entries need no snapshot ─────────────────────

// heavy = low/stressed days, light = good days, within the given week window
// (0 = the last 7 days, 1 = the 7 before that).
function weekMoods(profile: Profile, today: string, weeksBack: number) {
  let heavy = 0, light = 0, count = 0;
  for (const e of profile.moods ?? []) {
    const age = days(e.date, today);
    if (!Number.isFinite(age) || age < weeksBack * 7 || age > weeksBack * 7 + 6) continue;
    count++;
    if (e.mood === 'low' || e.mood === 'stressed') heavy++;
    if (e.mood === 'good') light++;
  }
  return { heavy, light, count };
}

function moodShiftLine(profile: Profile, today: string): string | null {
  const thisW = weekMoods(profile, today, 0);
  if (!thisW.count) return null;
  const feel =
    thisW.heavy > thisW.light ? 'a heavier week than I\'d want for you'
    : thisW.light > thisW.heavy ? 'a good week'
    : 'a mixed week';
  const lastW = weekMoods(profile, today, 1);
  if (!lastW.count) {
    return `MOOD: ${thisW.count} read${thisW.count === 1 ? '' : 's'} this week — ${feel}.`;
  }
  const shift = (thisW.light - thisW.heavy) - (lastW.light - lastW.heavy);
  const compare =
    shift > 0 ? 'Lighter than last week — whatever changed, keep it.'
    : shift < 0 ? 'Heavier than last week — be honest with me about what\'s weighing on you.'
    : 'About level with last week.';
  return `MOOD: ${thisW.count} read${thisW.count === 1 ? '' : 's'} this week — ${feel}. ${compare}`;
}

// ── Habit deltas — lifetime totals vs. the snapshot ─────────────────────────

function habitLines(habits: Habit[], snap: ReviewSnapshot | undefined, today: string): string[] {
  const baseline = !!snap?.date;
  const lines = habits.map((h) => {
    const before = snap?.habitTotals?.[h.name];
    if (!baseline) return streakLine(h, today);
    if (before === undefined) {
      return `- ${h.name}: new since last review — ${h.streak}-day streak (${h.total} total)`;
    }
    const kept = Math.max(0, h.total - before);
    return `- ${h.name}: kept ${kept} day${kept === 1 ? '' : 's'} since last review — ${h.streak}-day streak now (best ${h.best})`;
  });
  const current = new Set(habits.map((h) => h.name));
  const dropped = Object.keys(snap?.habitTotals ?? {}).filter((n) => !current.has(n));
  if (dropped.length) lines.push(`(Dropped since last review: ${dropped.join(', ')}.)`);
  return lines;
}

// ── The review itself ────────────────────────────────────────────────────────

/**
 * Build the weekly review and the re-stamped snapshot. Exported for tests.
 * Always returns a profile — the snapshot is the whole point.
 */
export function buildReview(
  profile: Profile,
  today = todayISO(),
): { reply: string; profile: Profile } {
  const snap = profile.review;
  const baseline = snap?.date;
  const lines: string[] = [];
  const name = profile.name ? `, ${profile.name}` : '';

  lines.push(
    baseline
      ? `Your weekly review${name} — everything that moved since ${baseline}.`
      : `Your first weekly review${name} — this one sets the baseline; from next week I'll show you exactly what moved.`,
  );

  // Mission velocity.
  const mission = profile.mission;
  if (mission) {
    const moved =
      baseline && snap?.missionGoal === mission.goal && typeof snap.missionDone === 'number'
        ? mission.done - snap.missionDone
        : null;
    const velocity =
      moved === null ? `${mission.done} of ${mission.steps.length} steps done`
      : moved > 0 ? `moved ${moved} step${moved === 1 ? '' : 's'} — now ${mission.done} of ${mission.steps.length}`
      : `didn't move — still ${mission.done} of ${mission.steps.length}`;
    lines.push(`MISSION — "${mission.goal}": ${velocity}. Next up:\n${mission.steps[mission.done]}`);
  } else if (snap?.missionGoal) {
    const won = (profile.wins ?? []).some((w) => w.toLowerCase() === snap.missionGoal!.toLowerCase());
    lines.push(
      won
        ? `MISSION — you FINISHED "${snap.missionGoal}" since last review. That's the headline of this week.`
        : `MISSION — "${snap.missionGoal}" was closed since last review. Nothing active right now; a new one is one sentence away.`,
    );
  }

  // Habits.
  const habits = profile.habits ?? [];
  if (habits.length || snap?.habitTotals) {
    const hl = habitLines(habits, snap, today);
    if (hl.length) lines.push(`HABITS:\n${hl.join('\n')}`);
  }

  // Mood shift (dated journal — needs no snapshot).
  const mood = moodShiftLine(profile, today);
  if (mood) lines.push(mood);

  // Wins earned since the snapshot (exact — the snapshot keeps the list).
  const wins = profile.wins ?? [];
  if (baseline && snap?.wins) {
    const before = new Set(snap.wins.map((w) => w.toLowerCase()));
    const earned = wins.filter((w) => !before.has(w.toLowerCase()));
    lines.push(
      earned.length
        ? `WINS THIS WEEK: ${earned.join('; ')}.`
        : 'WINS — none logged this week. Not a verdict, just a scoreboard; next week\'s list is waiting.',
    );
  } else if (wins.length) {
    lines.push(`WINS ON THE BOARD: ${wins.slice(-3).join('; ')}.`);
  }

  // Reminders cleared (count against the snapshot).
  const open = (profile.reminders ?? []).length;
  if (baseline && typeof snap?.reminders === 'number') {
    if (open < snap.reminders) lines.push(`REMINDERS: down from ${snap.reminders} to ${open} open — you cleared the decks.`);
    else if (open > snap.reminders) lines.push(`REMINDERS: up from ${snap.reminders} to ${open} open.`);
    else if (open) lines.push(`REMINDERS: ${open} open, same as last review.`);
  } else if (open) {
    lines.push(`REMINDERS: ${open} open.`);
  }

  lines.push(
    baseline
      ? 'That\'s the week, measured honestly. Pick the one number you want different next Sunday and we\'ll move it together.'
      : 'Baseline set. Live the week — say "review my week" in seven days and I\'ll show you what moved.',
  );

  // Re-stamp the snapshot: the next review measures against today.
  const next: ReviewSnapshot = {
    date: today,
    habitTotals: Object.fromEntries(habits.map((h) => [h.name, h.total])),
    wins: [...wins],
    reminders: open,
  };
  if (mission) {
    next.missionGoal = mission.goal;
    next.missionDone = mission.done;
  }
  return { reply: lines.join('\n\n'), profile: { ...profile, review: next } };
}

/**
 * The weekly-review layer. Returns the report (plus the re-stamped snapshot
 * to persist) for a review ask, a sign-in prompt for anonymous asks, or null
 * so the pipeline runs on.
 */
export function tryReview(
  message: string,
  email: string,
  profile: Profile,
): { reply: string; profile?: Profile } | null {
  if (!isReviewAsk(message)) return null;
  if (!email) return { reply: SIGN_IN_REPLY };
  return buildReview(profile);
}

// ── Session-start offer ──────────────────────────────────────────────────────

// The oldest date NAVI has been tracking anything for — the offer anchor
// before any review has ever run.
function oldestTracked(profile: Profile): string | null {
  const dates: string[] = [];
  for (const h of profile.habits ?? []) if (h.created) dates.push(h.created.slice(0, 10));
  if (profile.mission?.created) dates.push(profile.mission.created.slice(0, 10));
  const firstMood = profile.moods?.[0]?.date;
  if (firstMood) dates.push(firstMood);
  const valid = dates.filter((d) => Number.isFinite(Date.parse(d))).sort();
  return valid[0] ?? null;
}

/**
 * One session-start offer per day once the last review (or, before any
 * review, the oldest tracked history) is 7+ days old. Speaks only when there
 * is actually something to review. Same shape as missionNudge.
 */
export function reviewOffer(
  profile: Profile,
  todayISO: string,
): { note: string; profile: Profile } | null {
  const snap = profile.review;
  if (snap?.offered === todayISO) return null;
  if (!(profile.habits?.length || profile.mission || profile.moods?.length || profile.wins?.length)) return null;
  const anchor = snap?.date ?? oldestTracked(profile);
  if (!anchor) return null;
  const idle = days(anchor, todayISO);
  if (!Number.isFinite(idle) || idle < 7) return null;
  const note = snap?.date
    ? `It's been ${idle} days since your last weekly review. Say "review my week" and I'll show you what moved — habits, mission, mood, wins.`
    : `You've got a week of history with me now. Say "review my week" and I'll pull it together — habits, mission, mood, wins — and set your baseline.`;
  return { note, profile: { ...profile, review: { ...(snap ?? {}), offered: todayISO } } };
}
