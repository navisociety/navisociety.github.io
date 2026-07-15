// supabase/functions/navi-chat/brief.ts
//
// NAVI v27 — The daily briefing.
//
// "brief me" / "my briefing" / "what's my status" compiles ONE agentic status
// report from everything NAVI is already holding: the active mission and the
// exact step in front of the user (v25), habit streaks (v26), reminders due
// now (v22), life events coming up this week (v23), the recent mood read
// (v26), and the latest wins (v23). No execution, no I/O — it reads the
// profile and reports like a chief of staff.
//
// Signed-in only, like everything that reads the permanent memory row.
// Deterministic; returns null when the message isn't a briefing ask.

import type { Profile } from './memory.ts';
import { moodTrend } from './memory.ts';
import { streakLine } from './habit.ts';
import { todayInTZ } from './skills.ts';
import { visionItemCount } from './vision.ts';
import { inboxUnreadCount } from './mail.ts';

// v39 (roadmap #24): the briefing's one look at the world — board count and
// unread count, injected so tests stub them (v35 seam pattern). This is the
// briefing's ONLY network cost, and it's two small parallel reads.
export type BriefSources = {
  visionCount: (email: string) => Promise<number | null>;
  inboxUnread: (email: string) => Promise<number | 'not-connected' | null>;
};

const REAL_SOURCES: BriefSources = {
  visionCount: visionItemCount,
  inboxUnread: inboxUnreadCount,
};

const NAVI_TZ = 'Africa/Johannesburg';

function todayISO(tz = NAVI_TZ): string {
  const t = todayInTZ(tz);
  return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}

// Same address-tidy as agent.ts/habit.ts.
function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "mission status" belongs to agent.ts (which runs first); these are the
// whole-picture asks. Anchored to the full message, like every command regex.
const BRIEF_RX =
  /^(?:please )?(?:(?:give me |show me |run |read me )?(?:my |the )?(?:daily |morning |full )?(?:briefing|brief|status report|status update|debrief)|brief me|catch me up|where do i stand|what'?s my status|how am i doing overall|whats my status)$/;

/** True when the message is asking for the daily briefing. */
export function isBriefingAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && t.length <= 60 && BRIEF_RX.test(t);
}

const SIGN_IN_REPLY =
  'The briefing reads your permanent memory — mission, habits, reminders, mood — so I can only build it once you\'re signed in. Sign in and say "brief me".';

// v39: compose the world line from the two reads — honest at every stage:
// a count is a count, no Gmail link says so, an unreachable source says so.
export async function worldLine(email: string, sources: BriefSources = REAL_SOURCES): Promise<string> {
  const [board, unread] = await Promise.all([
    sources.visionCount(email).catch(() => null),
    sources.inboxUnread(email).catch(() => null),
  ]);
  const parts: string[] = [];
  parts.push(
    board === null
      ? "the vision board didn't answer just now"
      : board === 0
        ? 'vision board: empty'
        : `vision board: ${board} item${board === 1 ? '' : 's'}`,
  );
  parts.push(
    unread === null
      ? "the inbox didn't answer just now"
      : unread === 'not-connected'
        ? 'inbox: Gmail not connected'
        : unread === 0
          ? 'inbox: clear'
          : `inbox: ${unread} unread`,
  );
  return `OUT IN THE WORLD: ${parts.join(' · ')}.`;
}

/** Build the briefing text from the profile. Exported for tests. */
export function buildBriefing(profile: Profile, today = todayISO(), world?: string): string {
  const lines: string[] = [];
  const name = profile.name ? `, ${profile.name}` : '';
  lines.push(`Your briefing${name} — here's where everything stands.`);

  // Mission — the one thing being executed right now leads.
  if (profile.mission) {
    const m = profile.mission;
    lines.push(
      `MISSION — "${m.goal}": ${m.done} of ${m.steps.length} steps done. In front of you now (step ${m.done + 1}):\n${m.steps[m.done]}`,
    );
  } else {
    lines.push('MISSION — none active. When you\'re ready to build something, say "start a mission to…" and I\'ll break it down.');
  }

  // Habits — the daily engine.
  const habits = profile.habits ?? [];
  if (habits.length) {
    lines.push(`HABITS:\n${habits.map((h) => streakLine(h, today)).join('\n')}`);
  }

  // Reminders due now (or undated = "next time I see you", which is now).
  const due = (profile.reminders ?? []).filter((r) => !r.due || r.due <= today);
  const later = (profile.reminders ?? []).length - due.length;
  if (due.length) {
    lines.push(
      `REMINDERS — due now:\n${due.map((r) => `- ${r.text}`).join('\n')}${later ? `\n(${later} more scheduled for later.)` : ''}`,
    );
  } else if (later) {
    lines.push(`REMINDERS — nothing due right now; ${later} scheduled for later.`);
  }

  // Life events within the next 7 days.
  const soon = (profile.events ?? [])
    .map((e) => ({ ...e, days: Math.round((Date.parse(e.date) - Date.parse(today)) / 86400000) }))
    .filter((e) => Number.isFinite(e.days) && e.days >= 0 && e.days <= 7)
    .sort((a, b) => a.days - b.days);
  if (soon.length) {
    lines.push(
      `COMING UP:\n${soon.map((e) => `- ${e.text} — ${e.days === 0 ? 'TODAY' : e.days === 1 ? 'tomorrow' : `in ${e.days} days`}`).join('\n')}`,
    );
  }

  // Mood — the honest two-week read, only when there's real data.
  const mood = moodTrend(profile);
  if (mood) lines.push(`MOOD: ${mood}`);

  // Wins — end on what's already been conquered.
  const wins = profile.wins ?? [];
  if (wins.length) {
    lines.push(`RECENT WINS: ${wins.slice(-3).join('; ')}.`);
  }

  // v39: one line of live world state (roadmap #24), when the caller fetched it.
  if (world) lines.push(world);

  lines.push(
    profile.mission
      ? 'That\'s the picture. The mission step is the needle-mover — start there.'
      : 'That\'s the picture. Pick the one thing that matters most today and I\'ll back you on it.',
  );
  return lines.join('\n\n');
}

/**
 * The briefing layer. Returns the compiled report for a briefing ask, a
 * sign-in prompt for anonymous briefing asks, or null so the pipeline runs on.
 * v39: async — the report now carries one line of live world state (#24),
 * fetched only when the ask is real and the user is signed in.
 */
export async function tryBriefing(
  message: string,
  email: string,
  profile: Profile,
  sources: BriefSources = REAL_SOURCES,
): Promise<{ reply: string } | null> {
  if (!isBriefingAsk(message)) return null;
  if (!email) return { reply: SIGN_IN_REPLY };
  return { reply: buildBriefing(profile, todayISO(), await worldLine(email, sources)) };
}
