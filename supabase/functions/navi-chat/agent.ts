// supabase/functions/navi-chat/agent.ts
//
// NAVI v25 — Agentic workflow execution. (+v26 daily runs, +v27/v29/v30/v35-v42 below)
//
// v47 additions (the chronicle round — the named post-v46 rungs, none gated):
//   - PER-STEP RUN RECEIPTS — every real run's receipt (WorkflowRun) now
//     carries the topic and each step's fate (StepOutcome: ran / skipped /
//     held / failed + the short honest why). "what did my last run do"
//     (bare or named: "what did my last study run do") reads the newest
//     matching receipt back step by step; pre-v47 receipts answer honestly.
//   - THE RE-RUN FORM — "run my study workflow again" / "rerun my study
//     workflow" / bare "run that again" replays the newest receipt: same
//     workflow, same topic. All the fresh-run gates hold (pause, * slot —
//     which needs a recorded topic — and the v42 send confirm).
//   - MISSION DEADLINES — "finish this mission by friday" (parseWhen
//     vocabulary; unknown phrasing teaches, the past is refused) commits the
//     active mission to Mission.deadline. "mission status" counts it down;
//     "when is my mission due" answers; "clear my mission deadline" lets go;
//     completion names a beaten (or missed) deadline. missionNudge speaks at
//     2 days out / due / overdue — once per SA day (deadlineNudged stamp),
//     outranking the idle rule, on the SAME session-start wiring. Conditions:
//     "when my mission is due soon:" (3 days) / "when my mission is
//     overdue:" (+ negations) — sync, free, profile-only.
//
// v42 additions (the trust round — roadmap #17, built at Dian's explicit ask):
//   - RUN-TIME SEND CONFIRM — a workflow whose steps SEND email ("send an
//     email to me about *", "send draft 2") never runs unconfirmed. The RUN
//     itself is offered ("one of its steps sends real email — yes?"), stamped
//     on Profile.runSend (10-minute window), and a fresh "yes" re-runs it
//     with sends enabled: each send step drafts through the normal engines,
//     then its offer stamp is consumed through mail.ts's own yes-machinery
//     (draft re-read, honest failures, the user's own Gmail) — the exact path
//     a spoken yes takes. Scheduled runs NEVER send: daily/weekly/monthly
//     runs hold send steps back with an honest note. tryAgent runs first in
//     the pipeline, so this stamp outranks chat cleanup, which outranks the
//     plain mail send — one offer per bare "yes", always deterministic.
//   - RUN-REPORT HEADLINE (#27 reshaped) — every scheduled report header now
//     carries "(N of M steps ran)", computed FROM the run itself — zero extra
//     condition fetches, unlike the pre-run preview the roadmap feared.
//
// v41 additions (the rhythm round):
//   - MONTHLY WORKFLOWS — "run my budget workflow every month [on the 15th]"
//     / "run my budget workflow on the 1st of every month" schedules the v26
//     machinery onto ONE day of the month (Workflow.monthDay, 1-28 only so
//     every month has it; 29-31 are refused honestly, no day defaults to the
//     1st). Same session-start channel, same lastRun stamp, same slot
//     refusal; a workflow is daily OR weekly OR monthly, never two at once.
//   - DEVICE-TASK CONDITIONS — "when my pc has tasks waiting:", "when my pc
//     has no tasks waiting:", "when my pc has results waiting:" (+ negation)
//     read Profile.deviceTasks — sync, free, no source, and they light up in
//     dry-run previews automatically. Results = the runner's receipts.
//
// v38 additions (the tempo round):
//   - WEEKLY WORKFLOWS — "run my sabbath workflow every sunday" schedules the
//     v26 daily machinery onto ONE weekday (Workflow.day, SA time). Same
//     session-start channel, same lastRun stamp, same slot refusal; "stop
//     running my X workflow every sunday" (or the daily off form) clears the
//     whole schedule. A workflow is daily OR weekly, never both.
//   - CALENDAR & CLOCK CONDITIONS — "when it's monday:", "when it isn't
//     friday:", "when it's the weekend:", "when it's a weekday:", "when it's
//     morning/afternoon/evening/night:" (+ negations). The day answers from
//     todayISO, the hour from the SA clock (skills.ts hourInTZ) — sync, free,
//     no source, and they light up in dry-run previews automatically.
//     Segments: morning 5-11, afternoon 12-16, evening 17-21, night 22-4.
//
// v37 additions (the horizon round):
//   - MISSION DRY-RUN — "what would finish my mission?" / "preview my mission"
//     / "show my remaining mission steps" reads the WHOLE remaining tail of
//     the active mission back, numbered as the mission numbers them.
//     READ-ONLY like the v29 mission-step literal: nothing advances, the
//     profile never changes, and advancing still takes a real "done".
//   - CHATS-AGE CONDITIONS — "when i have chats older than <n> days:" /
//     "when i have no chats older than <n> days:" count idle chats through
//     the third ConditionSources source (chats.ts chatsIdleCount). Counting
//     only — a condition can never delete; cleanup stays the two-step confirm.
//
// v36 additions (the foresight round):
//   - WORKFLOW DRY-RUN — "preview my aware workflow" / "dry run my study
//     workflow on grace" / "what would my aware workflow do right now?"
//     walks the steps like runWorkflow but REPORTS instead of executing:
//     conditions are evaluated against the live world (same async sources),
//     each step comes back "would run" / "would skip (+why)" / "can't tell",
//     nothing runs, nothing changes. Slotted workflows need a topic, same as
//     a real run.
//   - BOOKED-SEND CONDITIONS — "when a booked send is waiting:" /
//     "when no booked sends are waiting:" read Profile.mailScheduled — sync,
//     free, no source needed.
//
// v35 additions (the awareness round):
//   - CONDITION VOCABULARY 3.0 — the async seam. evalCondition is now async
//     and takes injected ConditionSources; conditions can look OUTSIDE the
//     profile: "my vision board is empty" / "isn't empty" (vision.ts
//     visionItemCount) and "i have new email" / "i have no new email"
//     (mail.ts inboxUnreadCount, the user's own Gmail). Sources are fetched
//     LAZILY — only when their phrase matched. A source that can't answer
//     yields an honest skip note ('unreachable' / 'not-connected'), never a
//     guess. Profile conditions are untouched.
//
// v30 additions (the cross-platform round):
//   - CONDITION VOCABULARY 2.0 — negations ("no reminders are due", "my mood
//     isn't low", "i have no mission") and habit-streak thresholds ("my prayer
//     streak is under 3" / "at least 7" / "over 7"), all in evalCondition.
//   - QUEUE EDITING — "move X to the front of the queue" reorders;
//     "start the queued mission X now" (or bare "start the queued mission")
//     pulls it forward, swapping the active mission back to the front of the
//     queue with an honest note that its steps restart on return.
//   (The Vision Board bridge and reminder escalation live in vision.ts and
//    remind.ts — see those headers.)
//
// v29 additions (the executive round):
//   - CONDITIONAL STEPS — a step may open with "when <condition>:" and only
//     runs when the condition holds against the profile. Closed vocabulary
//     (evalCondition): habit logged / not logged today, a reminder is due,
//     my mood is <x>, my mission is idle, i have a mission. Unknown
//     conditions skip safely and teach the vocabulary — never guess.
//   - TOPIC TRIGGERS — a trigger ending in * ("when i say study *, run my
//     study workflow on it") fires on any message starting with the prefix,
//     and the remainder fills every * slot ("study grace" → topic "grace").
//   - MISSION-AWARE STEPS — the literal step "my next mission step" inside a
//     workflow surfaces the active mission's current step, READ-ONLY, so a
//     morning routine can include the mission without ever advancing it.
//   - MISSION QUEUE — "queue a mission to X" holds up to 3 goals behind the
//     active mission; completing (or skip-wrapping) the mission auto-promotes
//     the first queued goal into a full new mission. One ACTIVE mission at a
//     time stays the law — the queue captures ambition without breaking focus.
//
// v27 additions:
//   - PARAMETERIZED WORKFLOWS — a step may carry a * slot ("create a workflow
//     called study: a verse about *, then define *"); "run my study workflow
//     on grace" fills every slot, so one routine serves any topic. Slotted
//     workflows can't run daily or on a bare trigger (nothing to fill the
//     slot) — NAVI explains instead of running a literal "*".
//   - MISSION EDITING — "skip this step" drops the step in front of you,
//     "add a step to my mission: …" extends the plan mid-flight.
//   - MISSION NUDGE — a mission idle 3+ days gets one gentle session-start
//     reminder per day (missionNudge, appended by index.ts like reminders).
//
// NAVI graduates from answering asks to EXECUTING work. Two capabilities:
//
//   1. WORKFLOWS — named, saved routines of up to 5 steps. "create a workflow
//      called morning: a verse about strength, then list my reminders, then
//      encourage me" saves it permanently; "run my morning workflow" executes
//      every step through the full engine pipeline — Bible, reminders, math,
//      dictionary, composer, web — and reports step by step. A workflow can
//      carry a TRIGGER PHRASE ("when i say good morning, run my morning
//      workflow"), so speaking the phrase runs the whole routine.
//
//   2. MISSIONS — a goal NAVI decomposes into tracked steps ("start a mission
//      to launch my EP" borrows plan.ts's domain step banks). NAVI holds the
//      plan across sessions, hands out one step at a time ("what's next?"),
//      advances on "done", and moves the finished goal to the wins list.
//      ONE active mission at a time — focus is the feature, not a limit.
//
// The step executor is injected by index.ts (answerIntent), so a workflow step
// runs exactly what the same message would have run on its own, with profile
// changes threaded through step by step. Signed-in only, like reminders:
// workflows and missions live in the permanent memory row.
//
// Conservative by design, like execute.ts: every command regex is anchored to
// the whole message, bare "done"/"what's next" are only intercepted while a
// mission is actually active, and crisis language is never treated as a goal.

import type { Mission, Profile, RunSend, StepOutcome, Workflow, WorkflowRun } from './memory.ts';
import { stepsForGoal } from './plan.ts';
import { hourInTZ, todayInTZ } from './skills.ts';
import { visionItemCount } from './vision.ts';
import { inboxUnreadCount, isSendStep, tryMail } from './mail.ts';
import { chatsIdleCount } from './chats.ts';
import { parseWhen } from './remind.ts'; // v46: "pause my X workflow until friday"

export type AgentRunner = (
  part: string,
  profile: Profile,
) => Promise<{ reply: string; profile?: Profile }>;

// v35: the async condition seam — conditions that look OUTSIDE the profile
// (the vision board, the inbox). Injected so tests can stub the world; the
// defaults read the real board and the real Gmail. A source that can't answer
// returns null ('unreachable' to the caller) — a skipped step, never a guess.
export type ConditionSources = {
  visionCount: (email: string) => Promise<number | null>;
  inboxUnread: (email: string) => Promise<number | 'not-connected' | null>;
  // v37: idle chats past a horizon — a pure count, never a delete.
  chatsOlderThan: (email: string, days: number) => Promise<number | null>;
};

const REAL_SOURCES: ConditionSources = {
  visionCount: visionItemCount,
  inboxUnread: inboxUnreadCount,
  chatsOlderThan: chatsIdleCount,
};

/**
 * v35: what a condition evaluation can say. true/false run or skip the step;
 * null is "not in the vocabulary" (teach); 'unreachable' and 'not-connected'
 * are honest can't-check verdicts — the step is skipped and the note says why.
 */
export type ConditionVerdict = boolean | null | 'unreachable' | 'not-connected';

const MAX_WORKFLOWS = 8;
const MAX_STEPS = 5;
const MAX_WINS = 10;

// Same guard as memory.ts/execute.ts: crisis language is a human emergency,
// never a goal to decompose or a phrase to bind a routine to.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

// Lowercase, drop the "hey navi" address and trailing punctuation, collapse
// whitespace — the same tidy plan.ts and compose.ts parse from.
function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_CHARS = "[a-z][a-z0-9 _'-]{0,23}";

// ── Workflow command parsing ────────────────────────────────────────────────

const CREATE_RX = new RegExp(
  `^(?:please )?(?:create|make|build|save|set up|add|new)(?: me)?(?: a| the)?(?: new)? (?:workflow|routine)(?: (?:called|named) (${NAME_CHARS}?))? ?[:—-] ?(.+)$`,
);
const CREATE_NAMED_FIRST_RX = new RegExp(
  `^(?:please )?(?:create|make|build|save|set up|add|new)(?: me)?(?: a| the)? (${NAME_CHARS}?) (?:workflow|routine) ?[:—-] ?(.+)$`,
);

const RUN_RX = new RegExp(
  `^(?:please )?(?:run|start|do|execute|launch|play)(?: my| the)? (?:workflow|routine) (?:called |named )?(${NAME_CHARS})$`,
);
const RUN_NAMED_FIRST_RX = new RegExp(
  `^(?:please )?(?:run|start|do|execute|launch|play)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)$`,
);

// v27: the same run asks with a topic tail — "run my study workflow on grace".
// The lazy name group means a topic word is never swallowed into the name.
const RUN_TOPIC_RX = new RegExp(
  `^(?:please )?(?:run|start|do|execute|launch|play)(?: my| the)? (?:workflow|routine) (?:called |named )?(${NAME_CHARS}?) (?:on|about|for|with) (.+)$`,
);
const RUN_NAMED_FIRST_TOPIC_RX = new RegExp(
  `^(?:please )?(?:run|start|do|execute|launch|play)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:on|about|for|with) (.+)$`,
);

const DELETE_RX = new RegExp(
  `^(?:please )?(?:delete|remove|drop|forget)(?: my| the)? (?:(?:workflow|routine) (?:called |named )?(${NAME_CHARS})|(${NAME_CHARS}?) (?:workflow|routine))$`,
);

const LIST_RX = /^(?:please )?(?:list|show|show me|what are)(?: all)?(?: my| the)? (?:workflows|routines)$/;

// v39: execution receipts — "which workflows ran today" reads the run log.
const RAN_TODAY_RX =
  /^(?:which|what) workflows? (?:ran|has run|have run)(?: so far)? today$|^what ran today$|^did any(?:thing| workflows?) run today$|^show(?: me)? today'?s (?:workflow )?runs$/;

// v47: the deep receipt — "what did my last run do" reads the newest receipt
// back step by step (per-step outcomes ride WorkflowRun.steps since v47).
// The bare form takes the newest run of anything; the named form the newest
// run of that workflow. Checked bare-first, so "my last workflow run" is
// never read as a workflow named "workflow".
const LAST_RUN_RX =
  /^(?:what did (?:my|the) last (?:workflow )?run do|how did (?:my|the) last (?:workflow )?run go|show(?: me)? (?:my|the) last (?:workflow )?run)$/;
const LAST_RUN_NAMED_RX = new RegExp(
  `^(?:what did (?:my|the) last (${NAME_CHARS}?) (?:workflow |routine )?run do|how did (?:my|the) last (${NAME_CHARS}?) (?:workflow |routine )?run go|show(?: me)? (?:my|the) last (${NAME_CHARS}?) (?:workflow |routine )?run)$`,
);

/** v47: { name? } from a last-run receipt ask, or null. */
export function parseLastRun(message: string): { name?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  if (LAST_RUN_RX.test(t)) return {};
  const m = t.match(LAST_RUN_NAMED_RX);
  if (!m) return null;
  const name = (m[1] ?? m[2] ?? m[3])?.trim();
  if (!name || /^(?:a|the|my|me|workflow|routine)$/.test(name)) return null;
  return { name };
}

// v47: the re-run form — "run my study workflow again" / "rerun my study
// workflow" replays the workflow's newest receipt (same topic); the bare
// "run that again" replays the newest receipt of anything. "again"/"rerun"
// keep these clear of the plain run parsers, which end at "workflow".
const RUN_AGAIN_NAMED_RX = new RegExp(
  `^(?:please )?(?:run|re-?run)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) again$`,
);
const RERUN_NAMED_RX = new RegExp(
  `^(?:please )?re-?run(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)$`,
);
const RUN_AGAIN_BARE_RX =
  /^(?:please )?(?:run (?:that|it|that workflow|the last (?:workflow|run)|my last workflow) again|re-?run (?:that|it|that workflow|the last (?:workflow|run)|my last workflow))$/;

/** v47: { name? } from a re-run ask, or null. Bare form = the newest receipt. */
export function parseWorkflowRunAgain(message: string): { name?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  if (RUN_AGAIN_BARE_RX.test(t)) return {};
  const m = t.match(RUN_AGAIN_NAMED_RX) ?? t.match(RERUN_NAMED_RX);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || /^(?:a|the|my|me|last)$/.test(name)) return null;
  return { name };
}

// v26: "run my morning workflow every day" / "make my morning workflow daily"
const DAILY_ON_RX = new RegExp(
  `^(?:please )?(?:run|make|set)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: run)? (?:every ?day|daily|every morning|each day)$`,
);
const DAILY_OFF_RX = new RegExp(
  `^(?:please )?(?:stop|don'?t) (?:running|run)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:every ?day|daily|every morning|each day)$`,
);

// v38: "run my sabbath workflow every sunday" — the weekly cousin of daily.
// ON demands "every"/"each" (never "on <day>", which reads as a run topic);
// OFF is looser because stop-verbs can't collide with a run ask.
const DAY_NAMES = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const WEEKLY_ON_RX = new RegExp(
  `^(?:please )?(?:run|make|set)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: run)? (?:every|each) (${DAY_NAMES})s?$`,
);
const WEEKLY_OFF_RX = new RegExp(
  `^(?:please )?(?:stop|don'?t) (?:running|run)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:(?:every|each|on) )?(?:${DAY_NAMES})s?$`,
);

// v41: "run my budget workflow every month [on the 15th]" — the monthly
// cousin. Like weekly-ON it demands "every"/"each" (or the word "monthly");
// "run my budget workflow on the 1st of every month" also carries "every
// month", so a plain topic run can never reach here. The day group is
// validated in tryAgent (1-28 only) so the refusal can answer honestly.
const MONTHLY_ON_RX = new RegExp(
  `^(?:please )?(?:run|make|set)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: run)? (?:(?:every|each) month|monthly)(?: on the (\\d{1,2})(?:st|nd|rd|th)?)?$`,
);
const MONTHLY_ON_DAY_FIRST_RX = new RegExp(
  `^(?:please )?(?:run|make|set)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: run)? on the (\\d{1,2})(?:st|nd|rd|th)? of (?:every|each) month$`,
);
const MONTHLY_OFF_RX = new RegExp(
  `^(?:please )?(?:stop|don'?t) (?:running|run)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:(?:every|each) month|monthly)$`,
);

// ── v42: the run-time send confirm ──────────────────────────────────────────
// A workflow whose steps SEND real email never runs unconfirmed. Same bare
// yes/no shapes as mail.ts and chats.ts; "run it" is the run-flavoured yes.
const RUN_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
const RUN_YES_RX = /^(?:yes|yes please|yep|yeah|do it|go ahead|run it|confirm)$/;
const RUN_NO_RX = /^(?:no|nope|don'?t|never ?mind|cancel(?: the run)?)$/;

// v46: an "otherwise:" step — the else-branch of the conditional step right
// before it. Same body bounds as a condition's.
const OTHERWISE_RX = /^otherwise ?[:—-] ?(.{3,120})$/;

/** v46: the body of an "otherwise: <step>" step, or null for an ordinary one. */
export function parseOtherwiseStep(step: string): string | null {
  const m = step.match(OTHERWISE_RX);
  return m ? m[1].trim() : null;
}

// v46: what a step would actually EXECUTE — condition and otherwise prefixes
// read through. The meta rule and the send gate both judge this body.
function bodyOf(step: string): string {
  const other = parseOtherwiseStep(step);
  const inner = other ?? step;
  const cond = parseConditionStep(inner);
  return cond ? cond.body : inner;
}

/**
 * The send steps of a workflow (condition/otherwise prefixes read through).
 * v46: a nested "run my X workflow" step is expanded ONE level through `all`,
 * so a workflow that chains into a sending workflow is gated exactly like one
 * that sends itself — the confirm law never has a blind spot.
 */
function sendStepsOf(wf: Workflow, all: Workflow[] = []): string[] {
  const out: string[] = [];
  for (const s of wf.steps) {
    const body = bodyOf(s);
    const nestedRef = parseWorkflowRun(body);
    if (nestedRef) {
      if (nestedRef.name === wf.name) continue; // self-reference never runs
      const inner = all.find((w) => w.name === nestedRef.name);
      if (inner) {
        for (const is of inner.steps) {
          const ib = bodyOf(is);
          if (!parseWorkflowRun(ib) && isSendStep(ib)) out.push(ib);
        }
      }
      continue;
    }
    if (isSendStep(body)) out.push(body);
  }
  return out;
}

/**
 * v46: is this workflow asleep today? `paused: true` sleeps until resumed;
 * a date sleeps UNTIL that date (it wakes on the day itself) — computed, so
 * an expired pause simply stops holding, no cleanup pass needed.
 */
export function isPaused(wf: Workflow, todayISO: string): boolean {
  if (wf.paused === true) return true;
  if (typeof wf.paused === 'string') return todayISO < wf.paused;
  return false;
}

// "paused" / "paused until 2026-07-20" — how a pause reads back.
function pauseLabel(wf: Workflow): string {
  return typeof wf.paused === 'string' ? `paused until ${wf.paused}` : 'paused';
}

const PAUSE_RX = new RegExp(
  `^(?:please )?(?:pause|suspend) (?:my |the )?(${NAME_CHARS}?) (?:workflow|routine)(?: (?:until|till) (.+?)| for (.+?))?$`,
);
const RESUME_RX = new RegExp(
  `^(?:please )?(?:resume|unpause|reactivate|wake(?: up)?) (?:my |the )?(${NAME_CHARS}?) (?:workflow|routine)$`,
);

/** v46: { name, until? } from a pause ask ('' until = indefinite), or null. */
export function parseWorkflowPause(message: string): { name: string; until?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 100) return null;
  const m = t.match(PAUSE_RX);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || /^(?:a|the|my|me)$/.test(name)) return null;
  const phrase = (m[2] ?? m[3])?.trim();
  return phrase ? { name, until: phrase } : { name };
}

/** v46: the workflow name from a resume ask, or null. */
export function parseWorkflowResume(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  const m = t.match(RESUME_RX);
  if (!m) return null;
  const name = m[1].trim();
  return !name || /^(?:a|the|my|me)$/.test(name) ? null : name;
}

// The offer: nothing runs, the stamp rides the profile, a fresh yes re-runs.
function offerRunWithSends(
  wf: Workflow,
  topic: string | undefined,
  profile: Profile,
  sends: string[],
): { reply: string; profile: Profile } {
  const stamp: RunSend = topic
    ? { name: wf.name, topic, asked: new Date().toISOString() }
    : { name: wf.name, asked: new Date().toISOString() };
  const what = sends.length === 1
    ? `one of its steps sends real email ("${sends[0]}")`
    : `${sends.length} of its steps send real email`;
  return {
    reply: `Hold on — ${what}, and a send can't be unsent, so nothing ran yet. Say "yes" within 10 minutes and I'll run "${wf.name}" sends and all; "no" parks it. (Scheduled auto-runs never send — only a live run with your yes does.)`,
    profile: { ...profile, runSend: stamp },
  };
}

// v41: "the 1st of every month" reads back the way people say it.
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

// "when i say good morning, run my morning workflow"
// v29: the trigger may end in * (or <topic>) and the ask may carry an
// "on it/that/*" tail — "when i say study *, run my study workflow on it".
const TRIGGER_RX = new RegExp(
  `^when(?:ever)? i say ["']?(.{3,40}?)["']? ?,? (?:run|start|do|execute)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: (?:on|about|for|with) (?:it|that|this|\\*|<topic>|the topic))?$`,
);

/**
 * Parse a workflow creation ask. Returns the workflow pieces, a name of ''
 * when the ask forgot to name it (the caller teaches the syntax), or null
 * when this isn't a creation ask at all.
 */
export function parseWorkflowCreate(
  message: string,
): { name: string; steps: string[] } | null {
  const t = tidy(message);
  if (!t || t.length > 400) return null;
  let m = t.match(CREATE_NAMED_FIRST_RX);
  // "create a new workflow: …" must not read "new" as the name.
  if (m && /^(?:new|a|the|me)$/.test(m[1].trim())) m = null;
  if (!m) m = t.match(CREATE_RX);
  if (!m) return null;
  const name = (m[1] ?? '').trim();
  const steps = splitSteps(m[2]);
  if (!steps.length) return null;
  return { name, steps };
}

// Steps separate on "then", semicolons, and commas — "a verse about hope and
// love" stays whole because "and" alone never splits.
function splitSteps(body: string): string[] {
  return body
    .split(/\s*(?:,\s*(?:and\s+)?then\s+|;\s*|,\s*|\s+and\s+then\s+|\s+then\s+)/)
    .map((s) => s.trim().replace(/^(?:and|then)\s+/, ''))
    .filter((s) => s.length >= 3 && s.length <= 120)
    .slice(0, MAX_STEPS);
}

/**
 * The workflow name (and v27: optional topic) from a "run my X workflow" /
 * "run my X workflow on Y" ask, or null. The topic fills any * slot in the
 * workflow's steps.
 */
export function parseWorkflowRun(
  message: string,
): { name: string; topic?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 120) return null;
  const withTopic = t.match(RUN_NAMED_FIRST_TOPIC_RX) ?? t.match(RUN_TOPIC_RX);
  if (withTopic) {
    const topic = withTopic[2].trim();
    if (topic && topic.length <= 60 && !CRISIS_RX.test(topic)) {
      return { name: withTopic[1].trim(), topic };
    }
  }
  const m = t.match(RUN_RX) ?? t.match(RUN_NAMED_FIRST_RX);
  return m ? { name: m[1].trim() } : null;
}

// v27: does any step carry a * slot waiting for a topic?
function hasSlot(wf: Workflow): boolean {
  return wf.steps.some((s) => s.includes('*'));
}

// v36: the dry-run — "preview my aware workflow [on grace]" / "what would my
// aware workflow do right now?". Same name/topic shape as the run parsers,
// different verbs, so the two can never collide.
const PREVIEW_RX = new RegExp(
  `^(?:please )?(?:preview|dry.?run)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: (?:on|about|for|with) (.+))?$`,
);
const PREVIEW_WHATWOULD_RX = new RegExp(
  `^what would(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) do(?: right now| today| now)?(?: (?:on|about|for|with) (.+))?$`,
);

/** v36: { name, topic? } from a dry-run ask, or null. Topic crisis-guarded. */
export function parseWorkflowPreview(
  message: string,
): { name: string; topic?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 120) return null;
  const m = t.match(PREVIEW_RX) ?? t.match(PREVIEW_WHATWOULD_RX);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || /^(?:a|the|my|me)$/.test(name)) return null;
  const topic = m[2]?.trim();
  if (topic && (topic.length > 60 || CRISIS_RX.test(topic))) return null;
  return topic ? { name, topic } : { name };
}

// ── v29: conditional steps ──────────────────────────────────────────────────

// "when i haven't logged my prayer habit: remind me to pray" — the condition
// sits before the first colon (or dash), the step after it.
const COND_STEP_RX = /^when (.{3,80}?) ?[:—-] ?(.{3,120})$/;

/** Split a "when <condition>: <step>" step, or null for an ordinary step. */
export function parseConditionStep(step: string): { cond: string; body: string } | null {
  const m = step.match(COND_STEP_RX);
  return m ? { cond: m[1].trim(), body: m[2].trim() } : null;
}

const KNOWN_CONDITIONS =
  `"i haven't logged my <habit> habit", "i logged my <habit> habit", "a reminder is due", "no reminders are due", "my mood is low/stressed/good", "my mood isn't <x>", "my mission is idle", "i have a mission", "i have no mission", "my mission is due soon", "my mission isn't due soon", "my mission is overdue", "my mission isn't overdue", "my <habit> streak is under <n>", "my <habit> streak is at least <n>", "my vision board is empty", "my vision board isn't empty", "i have new email", "i have no new email", "a booked send is waiting", "no booked sends are waiting", "i have chats older than <n> days", "i have no chats older than <n> days", "it's <weekday>", "it isn't <weekday>", "it's the weekend", "it's a weekday", "it's morning/afternoon/evening/night", "it isn't <time of day>", "it's the <nth> (of the month)", "it isn't the <nth>", "i have an event today", "i have no events today", "i have an event this week", "i have no events this week", "it's a special day", "it isn't a special day", "my <device> has tasks waiting", "my <device> has no tasks waiting", "my <device> has results waiting", "my <device> has no results waiting"`;

// Canonical mood labels the journal uses, keyed by the words people say.
const MOOD_ALIASES: Record<string, string> = {
  low: 'low', down: 'low', sad: 'low',
  stressed: 'stressed', anxious: 'stressed', worried: 'stressed',
  good: 'good', happy: 'good', great: 'good',
};

function habitLoggedToday(profile: Profile, spoken: string, today: string): boolean {
  const s = spoken.toLowerCase().trim();
  const h = (profile.habits ?? []).find(
    (x) => x.name === s || x.name.includes(s) || s.includes(x.name),
  );
  return !!h && h.lastDone === today;
}

// v38: the SA weekday for a yyyy-mm-dd date — calendar conditions and weekly
// workflows both read it. todayISO is already SA time, so UTC parsing is safe.
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function weekdayOf(todayISO: string): string {
  const d = new Date(`${todayISO}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAY_NAMES[d.getUTCDay()];
}

// v38: the closed clock vocabulary — morning 5-11, afternoon 12-16,
// evening 17-21, night 22-4. Every hour belongs to exactly one segment.
function segmentOf(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

// v30: a habit's current streak for threshold conditions. A habit that isn't
// tracked has, honestly, a streak of 0 — "under 3" holds, "at least 3" doesn't.
function streakOf(profile: Profile, spoken: string): number {
  const s = spoken.toLowerCase().trim();
  const h = (profile.habits ?? []).find(
    (x) => x.name === s || x.name.includes(s) || s.includes(x.name),
  );
  return h?.streak ?? 0;
}

/**
 * Evaluate a closed-vocabulary condition. Profile conditions answer from the
 * profile alone; v35 world conditions (vision board, inbox) go through the
 * injected sources — lazily, only when their phrase actually matched. Returns
 * true/false, null for a condition NAVI doesn't understand (the caller skips
 * the step and teaches the vocabulary), or an honest can't-check verdict.
 */
export async function evalCondition(
  cond: string,
  profile: Profile,
  todayISO: string,
  email = '',
  sources: ConditionSources = REAL_SOURCES,
  hourNow?: number, // v38: tests pin the clock; production reads SA time
): Promise<ConditionVerdict> {
  let m = cond.match(/^i haven'?t (?:logged|done|kept) my (.+?) habit(?: today)?$/);
  if (m) return !habitLoggedToday(profile, m[1], todayISO);
  m = cond.match(/^i(?:'ve| have)? (?:logged|did|done|kept) my (.+?) habit(?: today)?$/);
  if (m) return habitLoggedToday(profile, m[1], todayISO);
  if (/^(?:a reminder is due|reminders are due|i have (?:a )?reminders? due)$/.test(cond)) {
    return (profile.reminders ?? []).some((r) => !r.due || r.due <= todayISO);
  }
  // v30: the negation — "when no reminders are due: …" for the clear-desk days.
  if (/^(?:no reminders? (?:is|are) due|nothing(?:'s| is) due|i have no reminders? due)$/.test(cond)) {
    return !(profile.reminders ?? []).some((r) => !r.due || r.due <= todayISO);
  }
  m = cond.match(/^(?:my mood is|i'?m feeling|i feel) (\w+)$/);
  if (m && MOOD_ALIASES[m[1]]) return (profile.lastMood ?? '') === MOOD_ALIASES[m[1]];
  // v30: mood negation — "when my mood isn't low: …". Unknown moods still
  // return null (skip and teach), never a guess.
  m = cond.match(/^(?:my mood (?:isn'?t|is not)|i'?m not feeling|i don'?t feel) (\w+)$/);
  if (m && MOOD_ALIASES[m[1]]) return (profile.lastMood ?? '') !== MOOD_ALIASES[m[1]];
  // v30: habit streak thresholds — "my prayer streak is under 3" / "at least 7".
  m = cond.match(/^my (.+?) streak is (?:under|below|less than) (\d{1,3})$/);
  if (m) return streakOf(profile, m[1]) < parseInt(m[2], 10);
  m = cond.match(/^my (.+?) streak is at least (\d{1,3})$/) ??
    cond.match(/^my (.+?) streak is (\d{1,3}) or more$/);
  if (m) return streakOf(profile, m[1]) >= parseInt(m[2], 10);
  m = cond.match(/^my (.+?) streak is (?:over|above|more than) (\d{1,3})$/);
  if (m) return streakOf(profile, m[1]) > parseInt(m[2], 10);
  if (/^my mission (?:is idle|hasn'?t moved)$/.test(cond)) {
    const mi = profile.mission;
    if (!mi) return false;
    const idle = Math.round(
      (Date.parse(todayISO) - Date.parse((mi.touched ?? mi.created).slice(0, 10))) / 86400000,
    );
    return Number.isFinite(idle) && idle >= 3;
  }
  if (/^i have (?:a|an)(?: active)? mission$/.test(cond)) return !!profile.mission;
  // v30: the mission negation — "when i have no mission: …" nudges the restart.
  if (/^i (?:don'?t have a|have no)(?: active)? mission$/.test(cond)) return !profile.mission;
  // v47: deadline awareness — sync, free reads over Mission.deadline. "Due
  // soon" is within 3 days including today; no mission or no deadline is a
  // clean false (nothing is due), and "isn't overdue" is honestly true then.
  if (/^my mission (?:is due soon|deadline is (?:close|near))$/.test(cond)) {
    const d = profile.mission?.deadline;
    if (!d) return false;
    const diff = Math.round((Date.parse(d) - Date.parse(todayISO)) / 86400000);
    return Number.isFinite(diff) && diff >= 0 && diff <= 3;
  }
  if (/^my mission (?:isn'?t|is not) due soon$/.test(cond)) {
    const d = profile.mission?.deadline;
    if (!d) return true;
    const diff = Math.round((Date.parse(d) - Date.parse(todayISO)) / 86400000);
    return !(Number.isFinite(diff) && diff >= 0 && diff <= 3);
  }
  if (/^my mission is (?:overdue|late|past its deadline)$/.test(cond)) {
    const d = profile.mission?.deadline;
    return !!d && d < todayISO;
  }
  if (/^my mission (?:isn'?t|is not) (?:overdue|late|past its deadline)$/.test(cond)) {
    const d = profile.mission?.deadline;
    return !d || d >= todayISO;
  }

  // v36: booked-send awareness — the schedule lives ON the profile, so this
  // pair is sync and free (no network, no source).
  if (/^(?:a|any) booked send is waiting$|^i have (?:a )?booked sends?(?: waiting)?$/.test(cond)) {
    return (profile.mailScheduled ?? []).length > 0;
  }
  if (/^no booked sends? (?:is|are) waiting$|^i have no booked sends?(?: waiting)?$/.test(cond)) {
    return (profile.mailScheduled ?? []).length === 0;
  }

  // v38: calendar conditions — the day answers from todayISO alone (already
  // SA time when the runners compute it). Sync, free, no source.
  m = cond.match(new RegExp(`^(?:it'?s|it is|today is) (${DAY_NAMES})$`));
  if (m) return weekdayOf(todayISO) === m[1];
  m = cond.match(new RegExp(`^(?:it (?:isn'?t|is not)|it'?s not|today (?:isn'?t|is not)) (${DAY_NAMES})$`));
  if (m) return weekdayOf(todayISO) !== m[1];
  if (/^(?:it'?s|it is|today is) (?:the )?weekend$|^(?:it (?:isn'?t|is not)|it'?s not|today (?:isn'?t|is not)) a weekday$/.test(cond)) {
    const dow = weekdayOf(todayISO);
    return dow === 'saturday' || dow === 'sunday';
  }
  if (/^(?:it'?s|it is|today is) a weekday$|^(?:it (?:isn'?t|is not)|it'?s not|today (?:isn'?t|is not)) (?:the )?weekend$/.test(cond)) {
    const dow = weekdayOf(todayISO);
    return dow !== '' && dow !== 'saturday' && dow !== 'sunday';
  }
  // v44: day-of-month — "when it's the 15th:" / "when it isn't the 1st:",
  // optional "of the month". Answers from todayISO alone (sync, free), the
  // calendar sibling the v41 monthly workflows were missing. Days 1-31
  // literally; "the 32nd" falls through to the honest teach.
  m = cond.match(/^(?:it'?s|it is|today is) the (\d{1,2})(?:st|nd|rd|th)(?: of the month)?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    if (day >= 1 && day <= 31) return parseInt(todayISO.slice(8, 10), 10) === day;
  }
  m = cond.match(/^(?:it (?:isn'?t|is not)|it'?s not|today (?:isn'?t|is not)) the (\d{1,2})(?:st|nd|rd|th)(?: of the month)?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    if (day >= 1 && day <= 31) return parseInt(todayISO.slice(8, 10), 10) !== day;
  }
  // v45: event-proximity — the life-events calendar (life.ts) lives ON the
  // profile, so this pair is sync and free. "today" is the day itself;
  // "this week" is the next 7 days including today.
  m = cond.match(/^i have (no )?(?:an? )?events? (today|this week)$/);
  if (m) {
    const horizon = m[2] === 'today' ? 0 : 7;
    const n = (profile.events ?? []).filter((e) => {
      const diff = Math.round((Date.parse(e.date) - Date.parse(todayISO)) / 86400000);
      return Number.isFinite(diff) && diff >= 0 && diff <= horizon;
    }).length;
    return m[1] ? n === 0 : n > 0;
  }
  // v45: the special-dates book (dates.ts) — "when it's a special day:" is
  // true when any held birthday/anniversary lands today. Sync and free.
  if (/^(?:it'?s|it is|today is) a special (?:day|date)$/.test(cond)) {
    return (profile.dates ?? []).some((d) => d.month === parseInt(todayISO.slice(5, 7), 10) && d.day === parseInt(todayISO.slice(8, 10), 10));
  }
  if (/^(?:it (?:isn'?t|is not)|it'?s not|today (?:isn'?t|is not)) a special (?:day|date)$/.test(cond)) {
    return !(profile.dates ?? []).some((d) => d.month === parseInt(todayISO.slice(5, 7), 10) && d.day === parseInt(todayISO.slice(8, 10), 10));
  }
  // v38: clock conditions — the hour comes from the SA clock (or the pinned
  // test hour). Segments are closed and exhaustive, so this never guesses.
  m = cond.match(/^(?:it'?s|it is) (morning|afternoon|evening|night)(?: ?time)?$/);
  if (m) return segmentOf(hourNow ?? hourInTZ('Africa/Johannesburg')) === m[1];
  m = cond.match(/^(?:it (?:isn'?t|is not)|it'?s not) (morning|afternoon|evening|night)(?: ?time)?$/);
  if (m) return segmentOf(hourNow ?? hourInTZ('Africa/Johannesburg')) !== m[1];

  // v41: device-task conditions — the queue lives ON the profile, so this
  // pair of pairs is sync and free. "tasks waiting" is anything not yet done
  // (queued manual tasks + auto tasks the runner hasn't answered); "results
  // waiting" is the runner's unread receipts. An unknown device honestly has
  // nothing waiting — same rule as an untracked habit's streak of 0.
  m = cond.match(/^my ([a-z][a-z0-9 _'-]{0,19}?) has (no )?tasks? waiting$/);
  if (m) {
    const n = (profile.deviceTasks ?? []).filter((x) => x.device === m![1] && !x.result).length;
    return m[2] ? n === 0 : n > 0;
  }
  m = cond.match(/^my ([a-z][a-z0-9 _'-]{0,19}?) has (no )?results? waiting$/);
  if (m) {
    const n = (profile.deviceTasks ?? []).filter((x) => x.device === m![1] && x.auto && x.result).length;
    return m[2] ? n === 0 : n > 0;
  }

  // v35: board-aware conditions — the board lives outside the profile, so
  // these are the first conditions that LOOK at the world. Unreachable board
  // → honest skip, never a guess.
  if (/^my vision board is empty$/.test(cond)) {
    const n = await sources.visionCount(email);
    return n === null ? 'unreachable' : n === 0;
  }
  if (/^my vision board (?:isn'?t|is not) empty$|^(?:something|there) is on my vision board$/.test(cond)) {
    const n = await sources.visionCount(email);
    return n === null ? 'unreachable' : n > 0;
  }
  // v35: inbox-aware conditions — unread mail through the user's own Gmail.
  if (/^i have (?:new|unread) e?mails?$|^there(?:'s| is| are) (?:new|unread) e?mails?(?: in my inbox)?$/.test(cond)) {
    const n = await sources.inboxUnread(email);
    if (n === null) return 'unreachable';
    if (n === 'not-connected') return 'not-connected';
    return n > 0;
  }
  if (/^i have no (?:new|unread) e?mails?$|^no (?:new|unread) e?mails?$|^my inbox is clear$/.test(cond)) {
    const n = await sources.inboxUnread(email);
    if (n === null) return 'unreachable';
    if (n === 'not-connected') return 'not-connected';
    return n === 0;
  }
  // v37: chats-age conditions — how long has the history sat still? A pure
  // count through chats.ts (the condition can never delete anything); an
  // unreachable history skips honestly, same as the board and the inbox.
  m = cond.match(/^i have (?:chats|conversations) (?:older|idle) than (\d{1,3}) days?$/);
  if (m) {
    const n = await sources.chatsOlderThan(email, parseInt(m[1], 10));
    return n === null ? 'unreachable' : n > 0;
  }
  m = cond.match(/^i have no (?:chats|conversations) (?:older|idle) than (\d{1,3}) days?$/);
  if (m) {
    const n = await sources.chatsOlderThan(email, parseInt(m[1], 10));
    return n === null ? 'unreachable' : n === 0;
  }
  return null;
}

// v29: the read-only mission step a workflow may carry.
const MISSION_STEP_LITERAL_RX =
  /^(?:read |show |give )?(?:me )?(?:my )?(?:next |current )?mission step$/;

// ── v31: workflow step editing — reshape a routine without rebuilding it ────
// "show my morning workflow" reads the steps back numbered, so editing by
// number is usable; add/replace/remove then operate on those numbers. These
// MUST be parsed before creation and deletion in tryAgent: CREATE_NAMED_FIRST_RX
// would read "add a step to my study workflow: x" as a workflow named
// "step to my study", and DELETE_RX would read "remove step 2 from my study
// workflow" as one named "step 2 from my study".

const WF_SHOW_RX = new RegExp(
  `^(?:please )?(?:show|view|inspect)(?: me)?(?: the)?(?: steps (?:of|in|for))?(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?:'?s steps| steps)?$`,
);

const WF_STEP_ADD_RX = new RegExp(
  `^(?:please )?add (?:a |another |one more )?step to(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) ?[:—-] ?(.+)$`,
);

const WF_STEP_REPLACE_RX = new RegExp(
  `^(?:please )?(?:replace|change|edit|update|rewrite|swap) step (\\d{1,2}) (?:of|in|on)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:with|to) ?[:]? ?(.+)$`,
);

const WF_STEP_REMOVE_RX = new RegExp(
  `^(?:please )?(?:remove|delete|drop|cut|take) step (\\d{1,2}) (?:from|of|out of|in)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)$`,
);

// v32: the editing line completed — reorder steps and rename the routine.
const WF_STEP_MOVE_RX = new RegExp(
  `^(?:please )?move step (\\d{1,2}) (up|down|to the top|to the front|to the bottom|to the end) (?:in|of|on)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)$`,
);

const WF_RENAME_RX = new RegExp(
  `^(?:please )?rename(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:to|as) ["']?(${NAME_CHARS}?)["']?$`,
);

/** The workflow name from a "show my X workflow" ask, or null. */
export function parseWorkflowShow(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  const m = t.match(WF_SHOW_RX);
  if (!m) return null;
  const name = m[1].trim();
  // "show my workflows"/"show my mission" style asks belong elsewhere.
  return name && !/^(?:a|the|my|me)$/.test(name) ? name : null;
}

export type WorkflowStepEdit =
  | { kind: 'add'; name: string; text: string }
  | { kind: 'replace'; name: string; n: number; text: string }
  | { kind: 'remove'; name: string; n: number };

/** One of the three step-edit commands, or null. Crisis-guarded on new text. */
export function parseWorkflowStepEdit(message: string): WorkflowStepEdit | null {
  const t = tidy(message);
  if (!t || t.length > 200) return null;
  let m = t.match(WF_STEP_ADD_RX);
  if (m) {
    const text = m[2].trim();
    if (!text || CRISIS_RX.test(text)) return null;
    return { kind: 'add', name: m[1].trim(), text };
  }
  m = t.match(WF_STEP_REPLACE_RX);
  if (m) {
    const text = m[3].trim();
    if (!text || CRISIS_RX.test(text)) return null;
    return { kind: 'replace', name: m[2].trim(), n: parseInt(m[1], 10), text };
  }
  m = t.match(WF_STEP_REMOVE_RX);
  if (m) return { kind: 'remove', name: m[2].trim(), n: parseInt(m[1], 10) };
  return null;
}

export type WorkflowStepMove = { name: string; n: number; dir: 'up' | 'down' | 'top' | 'bottom' };

/** A "move step N up/down/to the top in my X workflow" ask, or null. */
export function parseWorkflowStepMove(message: string): WorkflowStepMove | null {
  const t = tidy(message);
  if (!t || t.length > 100) return null;
  const m = t.match(WF_STEP_MOVE_RX);
  if (!m) return null;
  const word = m[2];
  const dir = word === 'up' ? 'up'
    : word === 'down' ? 'down'
    : word === 'to the top' || word === 'to the front' ? 'top'
    : 'bottom';
  return { name: m[3].trim(), n: parseInt(m[1], 10), dir };
}

/** { from, to } from a "rename my X workflow to Y" ask, or null. */
export function parseWorkflowRename(message: string): { from: string; to: string } | null {
  const t = tidy(message);
  if (!t || t.length > 100) return null;
  const m = t.match(WF_RENAME_RX);
  if (!m) return null;
  const from = m[1].trim();
  const to = m[2].trim();
  if (!from || !to || /^(?:new|a|the|me|my)$/.test(to)) return null;
  return { from, to };
}

// The one gate every step entering a workflow passes (creation uses it too):
// sane length, and no workflow/mission phrasing except the read-only
// "my next mission step" literal and — v46 — the "run my <name> workflow"
// chaining form. Condition and otherwise prefixes are read through.
function stepProblem(step: string): string | null {
  if (step.length < 3 || step.length > 120) {
    return 'A step needs to be an ordinary ask — between 3 and 120 characters.';
  }
  const body = bodyOf(step);
  if (MISSION_STEP_LITERAL_RX.test(body)) return null;
  if (parseWorkflowRun(body)) return null; // v46: one workflow may chain another
  if (/\b(workflow|routine|mission)\b/.test(body)) {
    return 'Workflow steps have to be ordinary asks — a workflow can\'t manage other workflows or missions. (Two exceptions: the read-only step "my next mission step", and "run my <name> workflow" to chain a saved workflow in.)';
  }
  return null;
}

function stepLines(wf: Workflow): string {
  return wf.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/** The workflow name from a delete ask, or null. */
export function parseWorkflowDelete(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  const m = t.match(DELETE_RX);
  return m ? (m[1] ?? m[2]).trim() : null;
}

/**
 * The workflow name from a "run my X workflow every day" ask, or null.
 * v38: `daily: true` means a schedule was asked FOR — with `day` set it's a
 * weekly schedule ("every sunday"), without it the classic every-day one.
 * v41: with `monthDay` set it's a monthly schedule ("every month on the
 * 15th"); a bare "every month" defaults to the 1st. The day is NOT range-
 * checked here — tryAgent refuses 29-31 honestly (not every month has them).
 * `daily: false` is any off ask; off clears whichever schedule is set.
 */
export function parseDailySet(message: string): { name: string; daily: boolean; day?: string; monthDay?: number } | null {
  const t = tidy(message);
  if (!t || t.length > 100) return null;
  const monthly = t.match(MONTHLY_ON_RX) ?? t.match(MONTHLY_ON_DAY_FIRST_RX);
  if (monthly) return { name: monthly[1].trim(), daily: true, monthDay: monthly[2] ? parseInt(monthly[2], 10) : 1 };
  const weekly = t.match(WEEKLY_ON_RX);
  if (weekly) return { name: weekly[1].trim(), daily: true, day: weekly[2] };
  const on = t.match(DAILY_ON_RX);
  if (on) return { name: on[1].trim(), daily: true };
  const off = t.match(DAILY_OFF_RX) ?? t.match(WEEKLY_OFF_RX) ?? t.match(MONTHLY_OFF_RX);
  if (off) return { name: off[1].trim(), daily: false };
  return null;
}

/**
 * { trigger, name } from "when i say X, run my Y workflow", or null.
 * v29: a trigger ending in * (or <topic>) is stored normalized as "… *" — an
 * OPEN trigger that fires on any message starting with the prefix.
 */
export function parseTriggerSet(
  message: string,
): { trigger: string; name: string } | null {
  const t = tidy(message);
  if (!t || t.length > 120) return null;
  const m = t.match(TRIGGER_RX);
  if (!m) return null;
  const trigger = m[1].trim().replace(/\s*(?:<\s*topic\s*>|\*)$/, ' *').trim();
  if (trigger === '*' || CRISIS_RX.test(trigger)) return null;
  return { trigger, name: m[2].trim() };
}

// ── Mission command parsing ─────────────────────────────────────────────────

const MISSION_START_RX =
  /^(?:please )?(?:start|begin|launch|create|give me|new)(?: a| the)? mission(?: ?[:—-] ?| to | for )(.+)$/;

const MISSION_STATUS_RX =
  /^(?:mission(?: status)?|(?:show|check)(?: me)?(?: my| the)? mission(?: status| progress)?|how(?:'s| is) (?:my|the) mission(?: going)?|where am i (?:on|with|in) (?:my|the) mission)$/;

// v37: the mission dry-run — read the WHOLE remaining tail back, read-only.
// "what's next" (MISSION_NEXT_RX) shows one step; this shows the horizon.
// The workflow preview verbs demand the word "workflow"/"routine", so
// "preview my mission" can never collide with them.
const MISSION_PREVIEW_RX =
  /^(?:what would (?:finish|complete|close)(?: out)? (?:my|the) mission|what(?:'s| is) left (?:of|on|in) (?:my|the) mission|(?:preview|dry.?run)(?: my| the)? mission|(?:show|list)(?: me)?(?: my| the)? remaining mission steps|what (?:mission )?steps (?:are left|remain)(?: (?:of|on|in) (?:my|the) mission)?)$/;

const MISSION_NEXT_RX =
  /^(?:what'?s next|whats next|next step|what(?: do| should) i do next|give me (?:the |my )?next step|what'?s (?:the |my )?next step)$/;

const MISSION_DONE_RX =
  /^(?:done|step done|that'?s done|it'?s done|i did (?:it|that|this)|i(?:'ve| have)? (?:finished|completed) (?:it|that|this|the step|that step)|finished(?: (?:it|that|this|the step|that step))?|completed(?: (?:it|that|the) step)?|mark (?:it|that|step|the step) (?:as )?done)$/;

const MISSION_ABANDON_RX =
  /^(?:abandon|cancel|quit|stop|end|drop)(?: my| the)? mission$/;

// v27: mission editing. Bare "skip" is only ever read while a mission is
// active (same rule as bare "done"), so conversation stays untouched.
const MISSION_SKIP_RX =
  /^(?:skip(?: (?:this|that|the|the current)? ?step)?|skip it|skip that|pass on (?:this|that) step)$/;

const MISSION_ADD_RX =
  /^(?:please )?add (?:a |another |one more )?(?:mission )?step(?: to (?:my |the )?mission)? ?[:—-] ?(.+)$/;

// v47: mission deadlines — "finish this mission by friday" commits the active
// mission to a date (remind.ts parseWhen vocabulary; unknown phrasing teaches,
// the past is refused). MISSION_DONE_RX only knows the past-tense whole-match
// forms ("finished", "completed"), so these imperatives can never collide.
const MISSION_DEADLINE_RX =
  /^(?:please )?(?:finish|complete|wrap up|land) (?:this|my|the) mission by (.+)$/;
const MISSION_DEADLINE_SET_RX =
  /^(?:please )?(?:set|give) (?:my|the|this) mission(?:'s)? (?:a )?deadline(?: ?[:—-] ?| to | of | for )(.+)$/;
const MISSION_DUE_RX = /^(?:my|the|this) mission is due(?: by| on)? (.+)$/;
const MISSION_DEADLINE_CLEAR_RX =
  /^(?:please )?(?:clear|remove|drop|forget) (?:my|the|this) mission(?:'s)? deadline$/;
const MISSION_DEADLINE_SHOW_RX =
  /^(?:when(?:'s| is) (?:my|the|this) mission due|what(?:'s| is) (?:my|the|this) mission(?:'s)? deadline)$/;

/** v47: the deadline phrase from a set-deadline ask, or null. */
export function parseMissionDeadline(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 120) return null;
  const m = t.match(MISSION_DEADLINE_RX) ?? t.match(MISSION_DEADLINE_SET_RX) ?? t.match(MISSION_DUE_RX);
  if (!m) return null;
  const phrase = m[1].trim();
  return phrase && phrase.length <= 40 ? phrase : null;
}

// v47: "due tomorrow" / "due 2026-07-20 — 4 days left" / "2 days past its
// deadline" — one honest countdown everywhere a deadline is spoken.
// Exported for brief.ts (v49) — the briefing's mission line reuses the exact
// countdown wording "mission status" speaks.
export function deadlineCountdown(deadline: string, todayISO: string): string {
  const diff = Math.round((Date.parse(deadline) - Date.parse(todayISO)) / 86400000);
  if (!Number.isFinite(diff)) return `due ${deadline}`;
  if (diff === 0) return 'due TODAY';
  if (diff === 1) return 'due tomorrow';
  if (diff > 1) return `due ${deadline} — ${diff} days left`;
  return diff === -1
    ? `1 day past its ${deadline} deadline`
    : `${-diff} days past its ${deadline} deadline`;
}

const MAX_MISSION_STEPS = 10;

/** The goal from a "start a mission to X" ask, or null. Crisis-guarded. */
export function parseMissionStart(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 160) return null;
  const m = t.match(MISSION_START_RX);
  if (!m) return null;
  const goal = m[1].trim();
  if (!goal || goal.length > 80 || CRISIS_RX.test(goal)) return null;
  return goal;
}

// ── v29: the mission queue ──────────────────────────────────────────────────

const MAX_QUEUE = 3;

const QUEUE_RX =
  /^(?:please )?queue (?:up )?(?:a |another |the )?mission(?: ?[:—-] ?| to | for )(.+)$/;

const QUEUE_SHOW_RX =
  /^(?:(?:show|list|check)(?: me)?(?: my| the)? (?:mission queue|queued missions)|(?:my|the) mission queue|what(?:'s| is) (?:in )?(?:my|the) mission queue|what missions are queued)$/;

const QUEUE_CLEAR_RX = /^(?:please )?clear (?:my |the )?mission queue$/;

const QUEUE_REMOVE_RX =
  /^(?:please )?(?:remove|unqueue|drop|delete) (?:the )?queued mission(?: ?[:—-] ?| to | for )(.+)$/;

// v30: queue editing — reorder, and pull a queued mission forward NOW.
const QUEUE_FRONT_RX =
  /^(?:please )?move (?:the )?(?:queued mission )?["']?(.{1,80}?)["']? to the (?:front|top) of (?:my |the )?(?:mission )?queue$/;

const QUEUE_START_RX =
  /^(?:please )?(?:start|promote|activate|begin) (?:the )?queued mission(?: ?[:—-] ?| to | for | )["']?(.{1,80}?)["']?(?: now)?$/;
const QUEUE_START_BARE_RX =
  /^(?:please )?(?:start|promote|activate|begin) (?:the |my )?(?:next |first )?queued mission(?: now)?$/;

// Fuzzy goal lookup shared by remove / move / start-now: exact, then contains.
function findQueued(queue: string[], spoken: string): number {
  const s = spoken.toLowerCase().trim();
  return queue.findIndex(
    (g) => g.toLowerCase() === s || g.toLowerCase().includes(s) || s.includes(g.toLowerCase()),
  );
}

/** The goal from a "queue a mission to X" ask, or null. Crisis-guarded. */
export function parseMissionQueue(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 160) return null;
  const m = t.match(QUEUE_RX);
  if (!m) return null;
  const goal = m[1].trim();
  if (!goal || goal.length > 80 || CRISIS_RX.test(goal)) return null;
  return goal;
}

function queueLines(queue: string[]): string {
  return queue.map((g, i) => `${i + 1}. ${g}`).join('\n');
}

// The active mission just closed with room in the queue — promote the first
// queued goal into a full new mission and report it.
function promoteQueued(profile: Profile): { note: string; profile: Profile } | null {
  const queue = profile.missionQueue ?? [];
  if (!queue.length) return null;
  const [goal, ...rest] = queue;
  const started = startMission(goal, profile);
  const next: Profile = { ...started.profile };
  if (rest.length) next.missionQueue = rest;
  else delete next.missionQueue;
  const mission = next.mission!;
  return {
    note: `Your queue had "${goal}" waiting — it's the active mission now, broken into ${mission.steps.length} steps.\n\nStep 1 of ${mission.steps.length}:\n${mission.steps[0]}`,
    profile: next,
  };
}

// ── Help ────────────────────────────────────────────────────────────────────

const HELP_RX =
  /^(?:what (?:are|is) (?:a )?(?:workflows?|missions?)|how do (?:workflows|missions) work|how does (?:a )?(?:workflow|mission) work|(?:tell me about|explain) (?:workflows|missions))$/;

const HELP_TEXT = `I can execute multi-step work for you, not just answer one ask at a time.

WORKFLOWS — saved routines I run on command:
- create a workflow called morning: a verse about strength, then list my reminders, then encourage me
- run my morning workflow
- put a * in a step (create a workflow called study: a verse about *, then define *) and run it on any topic: run my study workflow on grace
- when I say good morning, run my morning workflow (sets a trigger phrase)
- end the trigger with * (when I say study *, run my study workflow on it) and whatever follows the phrase becomes the topic
- start a step with a condition and it only runs when it's true: when i haven't logged my prayer habit: remind me to pray — negations work too (when no reminders are due / when my mood isn't low / when my prayer streak is under 3)
- follow a conditional step with "otherwise: …" and that step runs exactly when the one before it was skipped — a real either/or in one routine
- a step can be "run my study workflow" (or "run my study workflow on *" to pass the topic through) — one workflow chains another, one level deep
- pause my morning workflow / pause my morning workflow until friday (schedule, trigger, and manual runs all sleep; a dated pause wakes itself) / resume my morning workflow
- include the step "my next mission step" and the routine shows your mission's current step, read-only
- steps can act on your Vision Board too — "add * to my vision board" pins the topic of the day onto the board itself
- conditions can look at the world, not just your profile: when my vision board is empty / when i have new email / when a booked send is waiting / when i have chats older than 30 days / when it's monday / when it's morning / when it's the 1st (of the month) / when i have an event this week / when it's a special day / when my pc has results waiting / when my mission is due soon / when my mission is overdue
- run my morning workflow every day (auto-runs on your first chat of the day) — or every sunday, or every month on the 15th (weekly and monthly schedules, one per workflow)
- a step that SENDS email ("send an email to me about *") makes the run pause and ask for your yes first — and scheduled auto-runs hold send steps back entirely
- list my workflows / delete my morning workflow / which workflows ran today (every run leaves a receipt)
- what did my last run do (the newest receipt, step by step — what ran, what skipped and why) / run my study workflow again (repeats the last run, same topic and all)
- show my morning workflow (reads the steps back numbered), then edit in place: replace step 2 of my morning workflow with … / remove step 2 from my morning workflow / add a step to my morning workflow: …
- preview my morning workflow (or "what would my morning workflow do right now?") — I check every condition against the live world and report what would run and what would skip, without executing anything

MISSIONS — a goal I break into steps and walk you through:
- start a mission to launch my EP
- what's next? / done / mission status / abandon mission
- what would finish my mission? (reads every remaining step back, read-only — nothing advances)
- skip (drops the step in front of you) / add a step to my mission: …
- finish this mission by friday (sets a deadline — mission status counts it down, and I speak up as it closes in) / when is my mission due / clear my mission deadline
- queue a mission to X (up to 3 wait behind the active one and auto-start when it completes) / show my mission queue
- move X to the front of the queue / start the queued mission X now (the active one steps back into the queue)
- if a mission sits still for 3+ days, I'll bring it up when you come back

BEYOND THE CHAT — I execute on your other tools too:
- add … to my vision board / what's on my vision board / remove … from my vision board (put my mission on my vision board pins the active goal)
- a reminder that's waited 3+ days gets offered a promotion: "make that reminder a habit" or "make that reminder a mission step"
- reminders can repeat: remind me every day to pray / remind me every monday to call mom / remind me to pay rent on the 1st of every month / remind me every year on 3 august to wish mom happy birthday — each comes back on its day until you delete it; snooze reminder 2 until friday pushes any reminder off
- special dates: my mom's birthday is on 3 august / our wedding anniversary is 20 june — held every year; when is my mom's birthday answers with a countdown, what special dates do i have lists the book, and I open the chat with a heads-up the day before and on the day
- how many chats do i have / clean up my old chats — I count what's been idle 30+ days and ALWAYS ask before deleting anything
- email: draft an email to me about … / /email/sam@x.com/Subject/Body (end it /send to be offered the send in the same turn) / check my inbox / summarise my inbox / summarise the last email from sam (that one mail, read in full) / reply to the last email from sam / send draft 2 tomorrow morning — real sends ALWAYS take a spoken yes
- devices: add a task for my laptop: push the repo / what's waiting on my laptop / run backup on my pc (the runner on that device executes only names it already knows) / any results from my pc
- export my reminders as a calendar — an .ics block your calendar app imports

And anytime you want the full picture — mission, habits, reminders, mood — just say "brief me".

Both live in your permanent memory, so they're here every time you come back.`;

// ── Anonymous detection ─────────────────────────────────────────────────────

/** True when a signed-out message is clearly asking for workflow/mission features. */
export function isAgentAsk(message: string): boolean {
  const t = tidy(message);
  if (!t) return false;
  return (
    parseWorkflowCreate(message) !== null ||
    parseWorkflowRun(message) !== null ||
    parseWorkflowDelete(message) !== null ||
    parseWorkflowShow(message) !== null ||
    parseWorkflowPreview(message) !== null ||
    parseWorkflowStepEdit(message) !== null ||
    parseWorkflowStepMove(message) !== null ||
    parseWorkflowRename(message) !== null ||
    parseTriggerSet(message) !== null ||
    parseDailySet(message) !== null ||
    parseWorkflowPause(message) !== null ||
    parseWorkflowResume(message) !== null ||
    parseMissionStart(message) !== null ||
    parseMissionQueue(message) !== null ||
    parseMissionDeadline(message) !== null ||
    parseLastRun(message) !== null ||
    parseWorkflowRunAgain(message) !== null ||
    LIST_RX.test(t) ||
    RAN_TODAY_RX.test(t) ||
    MISSION_DEADLINE_CLEAR_RX.test(t) ||
    MISSION_DEADLINE_SHOW_RX.test(t) ||
    MISSION_STATUS_RX.test(t) ||
    MISSION_PREVIEW_RX.test(t) ||
    MISSION_ABANDON_RX.test(t) ||
    QUEUE_SHOW_RX.test(t) ||
    QUEUE_CLEAR_RX.test(t) ||
    QUEUE_REMOVE_RX.test(t) ||
    QUEUE_FRONT_RX.test(t) ||
    QUEUE_START_BARE_RX.test(t) ||
    QUEUE_START_RX.test(t)
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

function nameList(workflows: Workflow[]): string {
  const t = todayInTZ('Africa/Johannesburg');
  const todayISO = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  return workflows
    .map((w) => {
      const trig = w.trigger ? ` — trigger: "${w.trigger}"` : '';
      const daily = w.daily ? ' — runs daily' : w.day ? ` — runs every ${w.day}` : w.monthDay ? ` — runs monthly on the ${ordinal(w.monthDay)}` : '';
      // v46: a sleeping workflow says so wherever it's listed.
      const nap = isPaused(w, todayISO) ? ` — ${pauseLabel(w)}` : '';
      return `- ${w.name} (${w.steps.length} step${w.steps.length === 1 ? '' : 's'})${trig}${daily}${nap}`;
    })
    .join('\n');
}

function missionStatus(mission: Mission, queue: string[] = []): string {
  const total = mission.steps.length;
  const current = mission.done + 1;
  const done = mission.done
    ? `${mission.done} of ${total} steps done.`
    : `${total} steps ahead, none done yet.`;
  // v29: the queue rides along in the status report.
  const queued = queue.length ? `\n\nQueued next:\n${queueLines(queue)}` : '';
  // v47: a committed deadline rides along too, counted down honestly.
  const t = todayInTZ('Africa/Johannesburg');
  const todayISO = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const due = mission.deadline ? `\nDeadline: ${deadlineCountdown(mission.deadline, todayISO)}.` : '';
  return `Mission: ${mission.goal}\n${done}${due}\n\nCurrent step (${current} of ${total}):\n${mission.steps[mission.done]}${queued}\n\nSay "done" when it's finished, "what's next" to hear it again, or "abandon mission" to drop it.`;
}

// v37: the mission dry-run — the whole remaining tail, numbered as the
// mission numbers them. Pure read: nothing advances, nothing changes.
function missionPreview(mission: Mission): string {
  const total = mission.steps.length;
  const remaining = mission.steps.slice(mission.done);
  const lines = remaining
    .map((s, i) => `${mission.done + i + 1}. ${s}`)
    .join('\n');
  const count = remaining.length === 1
    ? 'One step stands'
    : `${remaining.length} steps stand`;
  return `Here's what would finish "${mission.goal}" — ${count} between you and done (of ${total} total):\n${lines}\n\nNothing moved — you're still on step ${mission.done + 1}, and each one still takes a real "done". That's the whole mountain; climb it one step at a time.`;
}

// ── Execution ───────────────────────────────────────────────────────────────

// v39: one run receipt on the profile log (cap 10, oldest out) — "which
// workflows ran today" reads these back. Stamped by every real run; the
// v36 dry-run never stamps because it never comes through runWorkflow.
const MAX_RUN_LOG = 10;
function stampRun(
  log: WorkflowRun[] | undefined,
  name: string,
  date: string,
  via: WorkflowRun['via'],
  topic?: string, // v47: replayed by "run my X workflow again"
  steps?: StepOutcome[], // v47: read back by "what did my last run do"
): WorkflowRun[] {
  const entry: WorkflowRun = { name, date, via };
  if (topic) entry.topic = topic;
  if (steps?.length) entry.steps = steps;
  const next = [...(log ?? []), entry];
  while (next.length > MAX_RUN_LOG) next.shift();
  return next;
}

// v47: step text inside a receipt is clipped so ten runs of five steps stay a
// small profile field, never an unbounded transcript.
function clipStep(s: string): string {
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

// v47: how the read-back and the today-list name each way a run can start.
const VIA_LABEL: Record<WorkflowRun['via'], string> = {
  manual: 'you ran it',
  trigger: 'fired by its trigger phrase',
  daily: 'daily auto-run',
  weekly: 'weekly auto-run',
  monthly: 'monthly auto-run',
  nested: 'ran as a step inside another workflow',
};

async function runWorkflow(
  wf: Workflow,
  profile: Profile,
  run: AgentRunner,
  topic?: string,
  email = '',
  sources?: ConditionSources,
  via: WorkflowRun['via'] = 'manual', // v39: who started this run
  allowSend = false, // v42: true ONLY on the yes-confirmed re-run
  depth = 0, // v46: 0 = top-level; a nested run is 1 and may not nest again
): Promise<{ reply: string; profile?: Profile; counts?: { executed: number; total: number } }> {
  let prof = profile;
  let changed = false;
  let executed = 0;
  let skipped = 0;
  let held = 0; // v42: send steps a scheduled run held back
  // v46: how the previous step's condition resolved — the "otherwise:" step
  // right after it reads this. 'skipped' fires the otherwise; 'ran' quiets it;
  // 'unknown' (can't-check) quiets it too — an else on a guess is a guess.
  let prevCond: 'ran' | 'skipped' | 'unknown' | null = null;
  // v47: every step's fate, kept on the receipt so "what did my last run do"
  // answers with the whole story, not just the name.
  const outcomes: StepOutcome[] = [];
  const note = (o: StepOutcome['o'], s: string, w?: string) => {
    outcomes.push(w ? { s: clipStep(s), o, w } : { s: clipStep(s), o });
  };
  const t = todayInTZ('Africa/Johannesburg');
  const todayISO = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const onTopic = topic ? ` on "${topic}"` : '';
  const blocks: string[] = [
    `Running "${wf.name}"${onTopic} — ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}.`,
  ];
  for (let i = 0; i < wf.steps.length; i++) {
    // v27: a topic fills every * slot, so one saved routine serves any subject.
    let step = topic ? wf.steps[i].replaceAll('*', topic) : wf.steps[i];
    const wasCond = prevCond;
    prevCond = null;

    // v46: "otherwise: <step>" — the else-branch of the conditional step
    // immediately before it. Fires only on a clean false; a can't-check
    // verdict quiets both branches (never guess), and an orphaned otherwise
    // teaches instead of running.
    const other = parseOtherwiseStep(step);
    if (other) {
      if (wasCond === 'ran') {
        skipped++;
        note('skipped', step, 'the "when …" step before it ran, so the otherwise stayed quiet');
        blocks.push(`Step ${i + 1} — skipped (the "when …" step before it ran, so the otherwise stays quiet).`);
        continue;
      }
      if (wasCond === 'unknown') {
        skipped++;
        note('skipped', step, "couldn't check the condition before it, so its otherwise stayed quiet");
        blocks.push(`Step ${i + 1} — skipped (I couldn't check the condition before it, so its otherwise stays quiet too).`);
        continue;
      }
      if (wasCond === null) {
        skipped++;
        note('skipped', step, 'an "otherwise:" step needs a condition step right before it');
        blocks.push(`Step ${i + 1} — skipped: an "otherwise:" step needs a "when <condition>: …" step right before it.`);
        continue;
      }
      step = other; // the when-step was skipped — the otherwise runs
    } else {
      // v29: conditional steps — evaluate "when <condition>:" against the
      // profile as it stands NOW (earlier steps' changes included).
      const cond = parseConditionStep(step);
      if (cond) {
        const holds = await evalCondition(cond.cond, prof, todayISO, email, sources);
        if (holds === null) {
          skipped++;
          prevCond = 'unknown';
          note('skipped', step, `I don't know the condition "${cond.cond}"`);
          blocks.push(`Step ${i + 1} — skipped: I don't know the condition "${cond.cond}". I understand: ${KNOWN_CONDITIONS}.`);
          continue;
        }
        // v35: world conditions can honestly fail to answer — skip, say why,
        // never guess.
        if (holds === 'unreachable') {
          skipped++;
          prevCond = 'unknown';
          note('skipped', step, `couldn't check "${cond.cond}" — the source wasn't reachable`);
          blocks.push(`Step ${i + 1} — skipped: I couldn't check "${cond.cond}" just now (the source wasn't reachable), so I played it safe.`);
          continue;
        }
        if (holds === 'not-connected') {
          skipped++;
          prevCond = 'unknown';
          note('skipped', step, `"${cond.cond}" needs Gmail, which wasn't connected`);
          blocks.push(`Step ${i + 1} — skipped: "${cond.cond}" needs your Gmail, and it isn't connected. Open Email in the Tools menu and tap Connect Gmail.`);
          continue;
        }
        if (!holds) {
          skipped++;
          prevCond = 'skipped';
          note('skipped', step, `"when ${cond.cond}" wasn't the case`);
          blocks.push(`Step ${i + 1} — skipped ("when ${cond.cond}" isn't the case right now).`);
          continue;
        }
        prevCond = 'ran';
        step = cond.body;
      }
    }

    // v29: the mission-aware step — read the current mission step directly,
    // never through the engines, never advancing anything.
    if (MISSION_STEP_LITERAL_RX.test(step)) {
      executed++;
      note('ran', step);
      blocks.push(`Step ${i + 1} — ${step}:\n` + (prof.mission
        ? `Mission "${prof.mission.goal}" — step ${prof.mission.done + 1} of ${prof.mission.steps.length}:\n${prof.mission.steps[prof.mission.done]}\n(Say "done" outside the workflow when it's finished.)`
        : 'No active mission right now — nothing waiting here.'));
      continue;
    }

    // v46: nested workflows — "run my <name> workflow [on <topic>]" as a step
    // runs the whole saved routine in place, ONE level deep. Self-reference,
    // missing names, pauses, and unfilled slots are skipped honestly; sends
    // inside the nested run obey the same allowSend this run obeys (the outer
    // gate expanded nested send steps before anything ran).
    const nestedRef = parseWorkflowRun(step);
    if (nestedRef) {
      if (depth >= 1) {
        skipped++;
        note('skipped', step, 'nested workflows go one level deep');
        blocks.push(`Step ${i + 1} — skipped: nested workflows go one level deep, so "${nestedRef.name}" doesn't run from inside a run that's already nested.`);
        continue;
      }
      if (nestedRef.name === wf.name) {
        skipped++;
        note('skipped', step, `"${wf.name}" can't run itself`);
        blocks.push(`Step ${i + 1} — skipped: "${wf.name}" can't run itself.`);
        continue;
      }
      const inner = (prof.workflows ?? []).find((w) => w.name === nestedRef.name);
      if (!inner) {
        skipped++;
        note('skipped', step, `"${nestedRef.name}" wasn't on the shelf`);
        blocks.push(`Step ${i + 1} — skipped: there's no workflow called "${nestedRef.name}" on the shelf anymore.`);
        continue;
      }
      if (isPaused(inner, todayISO)) {
        skipped++;
        note('skipped', step, `"${inner.name}" was paused`);
        blocks.push(`Step ${i + 1} — skipped: "${inner.name}" is ${pauseLabel(inner)}. Say "resume my ${inner.name} workflow" to wake it.`);
        continue;
      }
      if (hasSlot(inner) && !nestedRef.topic) {
        skipped++;
        note('skipped', step, `"${inner.name}" has a * slot and the step named no topic`);
        blocks.push(`Step ${i + 1} — skipped: "${inner.name}" has a * slot and this step names no topic. Write the step as "run my ${inner.name} workflow on <topic>" (or on * to pass this run's topic through).`);
        continue;
      }
      const out = await runWorkflow(inner, prof, run, nestedRef.topic, email, sources, 'nested', allowSend, depth + 1);
      if (out.profile) {
        prof = out.profile;
        changed = true;
      }
      executed++;
      note('ran', step);
      blocks.push(`Step ${i + 1} — ${step}:\n${out.reply}`);
      continue;
    }

    // v42: send steps. The manual and trigger paths are gated BEFORE
    // runWorkflow (the run itself is offered), so an unconfirmed send step
    // reaching here means a SCHEDULED run — and a scheduled run never sends.
    if (isSendStep(step)) {
      if (!allowSend) {
        held++;
        note('held', step, 'sends real email — a scheduled run never sends');
        blocks.push(`Step ${i + 1} — held back: this step sends real email, and a scheduled run never sends without you. Say "run my ${wf.name} workflow" yourself and I'll ask first.`);
        continue;
      }
      const drafted = await run(step, prof);
      if (drafted.profile) {
        prof = drafted.profile;
        changed = true;
      }
      if (!drafted.reply) {
        note('failed', step);
        blocks.push(`Step ${i + 1} — ${step}:\nI couldn't execute this one.`);
        continue;
      }
      let block = `Step ${i + 1} — ${step}:\n${drafted.reply}`;
      // The step stamped the usual send offer — your yes to THIS RUN is the
      // confirm, so consume it through the same machinery a spoken yes uses
      // (draft re-read at execute, honest failures, the user's own Gmail).
      if (prof.mailSend) {
        const fired = await tryMail('yes', email, prof);
        if (fired) {
          block += `\n${fired.reply}`;
          if (fired.profile) {
            prof = fired.profile;
            changed = true;
          }
        }
        // mail.ts keeps its stamp on a retryable failure — but a stamp left
        // dangling after the run would make some LATER bare "yes" send mail
        // the user wasn't looking at. Clear it; the retry is by hand.
        if (prof.mailSend) {
          const c: Profile = { ...prof };
          delete c.mailSend;
          prof = c;
          changed = true;
          block += '\n(I cleared that pending send — say "send draft N" to retry it by hand.)';
        }
      }
      executed++;
      note('ran', step);
      blocks.push(block);
      continue;
    }

    const out = await run(step, prof);
    if (out.profile) {
      prof = out.profile;
      changed = true;
    }
    if (out.reply) {
      executed++;
      note('ran', step);
      blocks.push(`Step ${i + 1} — ${step}:\n${out.reply}`);
    } else {
      note('failed', step);
      blocks.push(`Step ${i + 1} — ${step}:\nI couldn't execute this one.`);
    }
  }
  const attempted = wf.steps.length - skipped - held;
  const skipNote = skipped
    ? ` (${skipped} skipped by ${skipped === 1 ? 'its condition' : 'their conditions'})`
    : '';
  const holdNote = held
    ? ` (${held} send step${held === 1 ? '' : 's'} held for your yes)`
    : '';
  blocks.push(
    attempted === 0
      ? held
        ? `Workflow "${wf.name}" finished — nothing ran${skipNote}${holdNote}.`
        : `Workflow "${wf.name}" finished — every step was skipped by its condition today.`
      : executed === attempted
        ? `Workflow "${wf.name}" complete — all ${executed} step${executed === 1 ? '' : 's'} executed${skipNote}${holdNote}.`
        : `Workflow "${wf.name}" finished — ${executed} of ${attempted} steps executed${skipNote}${holdNote}.`,
  );
  // v39: every real run leaves a receipt — the profile now always changes.
  // v47: the receipt carries the topic and every step's fate.
  prof = { ...prof, workflowLog: stampRun(prof.workflowLog, wf.name, todayISO, via, topic, outcomes) };
  changed = true;
  return {
    reply: blocks.join('\n\n'),
    profile: changed ? prof : undefined,
    // v42 (#27): the caller's headline — counted FROM the run, never guessed.
    counts: { executed, total: wf.steps.length },
  };
}

/**
 * v36: the dry-run — the same walk as runWorkflow, but every step is REPORTED
 * instead of executed. Conditions are evaluated against the live world;
 * nothing runs, nothing changes, so there's no profile to return.
 */
async function previewWorkflow(
  wf: Workflow,
  profile: Profile,
  topic?: string,
  email = '',
  sources?: ConditionSources,
): Promise<string> {
  const t = todayInTZ('Africa/Johannesburg');
  const todayISO = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const lines: string[] = [];
  let wouldRun = 0;
  // v46: the same else-tracking the real run does, so "otherwise:" previews true.
  let prevCond: 'ran' | 'skipped' | 'unknown' | null = null;
  for (let i = 0; i < wf.steps.length; i++) {
    let step = topic ? wf.steps[i].replaceAll('*', topic) : wf.steps[i];
    const wasCond = prevCond;
    prevCond = null;

    const other = parseOtherwiseStep(step);
    let otherNote = '';
    if (other) {
      if (wasCond === 'ran') {
        lines.push(`${i + 1}. would skip — the "when …" step before it would run, so the otherwise stays quiet`);
        continue;
      }
      if (wasCond === 'unknown') {
        lines.push(`${i + 1}. can't tell — it depends on the step before it, which I couldn't check`);
        continue;
      }
      if (wasCond === null) {
        lines.push(`${i + 1}. would skip — an "otherwise:" step needs a "when <condition>: …" step right before it`);
        continue;
      }
      step = other;
      otherNote = ' (the step before it would skip, so this otherwise fires)';
    }

    const cond = other ? null : parseConditionStep(step);
    const body = cond ? cond.body : step;
    // v42: send steps are named in the preview — the real run pauses for a yes.
    const sendTag = isSendStep(body)
      ? ' [sends real email — the run itself will ask for your yes first]'
      : '';
    // v46: nested steps are named, one level, without walking their insides —
    // a preview stays one workflow's preview.
    const nestedRef = parseWorkflowRun(body);
    const nestedTag = (() => {
      if (!nestedRef) return '';
      if (nestedRef.name === wf.name) return ' [chains a workflow — but a workflow can\'t run itself, so this would skip]';
      const inner = (profile.workflows ?? []).find((w) => w.name === nestedRef.name);
      if (!inner) return ` [chains "${nestedRef.name}" — which isn't on the shelf, so this would skip]`;
      if (isPaused(inner, todayISO)) return ` [chains "${inner.name}" — currently ${pauseLabel(inner)}, so this would skip]`;
      return ` [runs your "${inner.name}" workflow — ${inner.steps.length} step${inner.steps.length === 1 ? '' : 's'} of its own, conditions checked when it runs]`;
    })();
    if (!cond) {
      wouldRun++;
      lines.push(`${i + 1}. would run — ${step}${otherNote}${sendTag}${nestedTag}`);
      continue;
    }
    const holds = await evalCondition(cond.cond, profile, todayISO, email, sources);
    if (holds === true) {
      prevCond = 'ran';
      wouldRun++;
      lines.push(`${i + 1}. would run — ${cond.body} ("when ${cond.cond}" holds right now)${sendTag}${nestedTag}`);
    } else if (holds === false) {
      prevCond = 'skipped';
      lines.push(`${i + 1}. would skip — "when ${cond.cond}" isn't the case right now`);
    } else if (holds === 'unreachable') {
      prevCond = 'unknown';
      lines.push(`${i + 1}. can't tell — I couldn't check "${cond.cond}" just now; on a real run I'd skip it to be safe`);
    } else if (holds === 'not-connected') {
      prevCond = 'unknown';
      lines.push(`${i + 1}. can't tell — "${cond.cond}" needs your Gmail, and it isn't connected; on a real run I'd skip it`);
    } else {
      prevCond = 'unknown';
      lines.push(`${i + 1}. would skip — I don't know the condition "${cond.cond}". I understand: ${KNOWN_CONDITIONS}.`);
    }
  }
  const onTopic = topic ? ` on "${topic}"` : '';
  const runIt = `run my ${wf.name} workflow${topic ? ` on ${topic}` : ''}`;
  const foot = wouldRun
    ? `Right now that's ${wouldRun} of ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}. Say "${runIt}" to do it for real.`
    : `Right now every step would skip. Conditions change — preview again later, or "${runIt}" runs it anyway.`;
  return `Dry run of "${wf.name}"${onTopic} — nothing was executed:\n${lines.join('\n')}\n\n${foot}`;
}

function startMission(goal: string, profile: Profile): { reply: string; profile: Profile } {
  const steps = stepsForGoal(goal);
  const now = new Date().toISOString();
  const mission: Mission = {
    goal,
    steps,
    done: 0,
    created: now,
    touched: now,
  };
  const reply = `Mission accepted: ${goal}.\n\nI've broken it into ${steps.length} steps and I'm holding the plan — you only ever need the one in front of you.\n\nStep 1 of ${steps.length}:\n${steps[0]}\n\nGo do that, then tell me "done" and I'll hand you step 2. Say "mission status" anytime.`;
  return { reply, profile: { ...profile, mission } };
}

function advanceMission(profile: Profile): { reply: string; profile: Profile } {
  const mission = profile.mission!;
  const done = mission.done + 1;
  const total = mission.steps.length;

  if (done >= total) {
    // Mission complete — the goal graduates to the wins list, like tryGoalDone.
    const wins = [...(profile.wins ?? [])];
    if (!wins.some((w) => w.toLowerCase() === mission.goal.toLowerCase())) {
      wins.push(mission.goal);
    }
    while (wins.length > MAX_WINS) wins.shift();
    const next: Profile = { ...profile, wins };
    delete next.mission;
    // v47: a deadline that was met (or missed) deserves a word on the way out.
    const dl = (() => {
      if (!mission.deadline) return '';
      const td = todayInTZ('Africa/Johannesburg');
      const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
      const diff = Math.round((Date.parse(mission.deadline) - Date.parse(todayISO)) / 86400000);
      if (!Number.isFinite(diff)) return '';
      if (diff > 0) return ` And you landed it ${diff} day${diff === 1 ? '' : 's'} ahead of your ${mission.deadline} deadline.`;
      if (diff === 0) return ' And you landed it right on your deadline — cutting it fine still counts.';
      return ' It came in past its deadline — but DONE beats on-time-someday, every time.';
    })();
    const base = `MISSION COMPLETE. All ${total} steps of "${mission.goal}" — done. You didn't just plan it, you EXECUTED it, and that's the difference that separates dreamers from builders. It's on your wins list now, permanently.${dl}`;
    // v29: the queue keeps the momentum — the next goal steps up immediately.
    const promoted = promoteQueued(next);
    if (promoted) {
      return { reply: `${base}\n\n${promoted.note}`, profile: promoted.profile };
    }
    return { reply: `${base} What's the next mission?`, profile: next };
  }

  const nextProfile: Profile = {
    ...profile,
    mission: { ...mission, done, touched: new Date().toISOString() },
  };
  return {
    reply: `Step ${done} down — ${total - done} to go. Here's step ${done + 1} of ${total}:\n${mission.steps[done]}\n\nSay "done" when it's finished.`,
    profile: nextProfile,
  };
}

// v27: drop the step currently in front of the user. Skipping the last
// remaining step wraps the mission — the rest of the work was real.
function skipStep(profile: Profile): { reply: string; profile: Profile } {
  const mission = profile.mission!;
  const steps = mission.steps.filter((_, i) => i !== mission.done);
  if (mission.done >= steps.length) {
    const wins = [...(profile.wins ?? [])];
    if (!wins.some((w) => w.toLowerCase() === mission.goal.toLowerCase())) {
      wins.push(mission.goal);
    }
    while (wins.length > MAX_WINS) wins.shift();
    const next: Profile = { ...profile, wins };
    delete next.mission;
    const base = `That was the last step — skipped, and the mission "${mission.goal}" is wrapped. Everything before it you actually DID, so it's on your wins list.`;
    // v29: a wrap counts as completion — the queue steps up here too.
    const promoted = promoteQueued(next);
    if (promoted) {
      return { reply: `${base}\n\n${promoted.note}`, profile: promoted.profile };
    }
    return { reply: `${base} What's the next mission?`, profile: next };
  }
  const next: Profile = {
    ...profile,
    mission: { ...mission, steps, touched: new Date().toISOString() },
  };
  return {
    reply: `Skipped — that step's off the plan, no debate. Here's step ${mission.done + 1} of ${steps.length} now:\n${steps[mission.done]}\n\nSay "done" when it's finished, or "skip" again if it doesn't serve the goal.`,
    profile: next,
  };
}

// v27: extend the active mission's plan mid-flight.
function addStep(text: string, profile: Profile): { reply: string; profile: Profile } {
  const mission = profile.mission!;
  if (mission.steps.length >= MAX_MISSION_STEPS) {
    return {
      reply: `The mission already has ${MAX_MISSION_STEPS} steps — that's a plan, not a backlog. Finish or skip a few first, then add more.`,
      profile,
    };
  }
  const steps = [...mission.steps, text];
  const next: Profile = {
    ...profile,
    mission: { ...mission, steps, touched: new Date().toISOString() },
  };
  return {
    reply: `Added as step ${steps.length} of ${steps.length}: ${text}\n\nYou're still on step ${mission.done + 1}:\n${steps[mission.done]}`,
    profile: next,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

const SIGN_IN_REPLY =
  "Workflows and missions live in your permanent memory, so I can only hold them once you're signed in. Sign in and tell me again — then I'll run them for you anytime.";

/**
 * The agentic layer. Handles workflow and mission commands, fires trigger
 * phrases, and executes workflow steps through the injected runner. Returns
 * null when the message is none of its business, so the normal pipeline runs.
 */
export async function tryAgent(
  message: string,
  email: string,
  profile: Profile,
  run: AgentRunner,
  sources?: ConditionSources, // v35: tests stub the world; production omits it
): Promise<{ reply: string; profile?: Profile } | null> {
  const t = tidy(message);
  if (!t) return null;

  // Help works for everyone — it's how people discover the feature.
  if (HELP_RX.test(t)) return { reply: HELP_TEXT };

  if (!email) return isAgentAsk(message) ? { reply: SIGN_IN_REPLY } : null;

  const workflows = profile.workflows ?? [];
  const queue = profile.missionQueue ?? [];

  // ── v42: a pending run-with-sends offer consumes its yes/no FIRST ─────────
  // tryAgent is the pipeline's first try*, so this stamp outranks a pending
  // chat cleanup (tryChats) and a pending mail send (tryMail) on a bare yes —
  // deterministic, never a race. Bare yes/no with no stamp falls through.
  const pendingRun = profile.runSend;
  if (pendingRun && (RUN_YES_RX.test(t) || RUN_NO_RX.test(t))) {
    const cleared: Profile = { ...profile };
    delete cleared.runSend;
    if (RUN_NO_RX.test(t)) {
      return { reply: `Parked — "${pendingRun.name}" didn't run and nothing was sent. It's still saved whenever you want it.`, profile: cleared };
    }
    const fresh = Date.now() - Date.parse(pendingRun.asked) <= RUN_CONFIRM_WINDOW_MS;
    if (!fresh) {
      return {
        reply: `That run offer went stale — I won't put real email in the world on a bare "yes" this long after asking. Say "run my ${pendingRun.name} workflow" again and I'll ask fresh.`,
        profile: cleared,
      };
    }
    const wf = workflows.find((w) => w.name === pendingRun.name);
    if (!wf) {
      return { reply: `The "${pendingRun.name}" workflow isn't on the shelf anymore — nothing ran, nothing was sent.`, profile: cleared };
    }
    // v46: a pause landing between the offer and the yes still holds.
    {
      const td = todayInTZ('Africa/Johannesburg');
      const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
      if (isPaused(wf, todayISO)) {
        return { reply: `"${wf.name}" is ${pauseLabel(wf)} — nothing ran, nothing was sent. Say "resume my ${wf.name} workflow" first.`, profile: cleared };
      }
    }
    return await runWorkflow(wf, cleared, run, pendingRun.topic, email, sources, 'manual', true);
  }

  // ── v29: mission queue commands — valid with or without an active mission ─
  const toQueue = parseMissionQueue(message);
  if (toQueue) {
    if (!profile.mission) {
      // Nothing active — the executive move is to start it right now.
      const started = startMission(toQueue, profile);
      return {
        reply: `Nothing's active, so no queue needed — starting it now.\n\n${started.reply}`,
        profile: started.profile,
      };
    }
    if (
      profile.mission.goal.toLowerCase() === toQueue.toLowerCase() ||
      queue.some((g) => g.toLowerCase() === toQueue.toLowerCase())
    ) {
      return { reply: `"${toQueue}" is already on the board — ${profile.mission.goal.toLowerCase() === toQueue.toLowerCase() ? "it's your ACTIVE mission" : "it's waiting in the queue"}. One entry is enough; the follow-through is the hard part.` };
    }
    if (queue.length >= MAX_QUEUE) {
      return { reply: `The queue holds ${MAX_QUEUE} missions and it's full:\n${queueLines(queue)}\n\nFinish the active one or say "remove the queued mission: …" to make room.` };
    }
    return {
      reply: `Queued: "${toQueue}" — position ${queue.length + 1}. The moment "${profile.mission.goal}" completes, I'll bring it out with a full plan. Focus stays on the mission in front of you.`,
      profile: { ...profile, missionQueue: [...queue, toQueue] },
    };
  }
  if (QUEUE_SHOW_RX.test(t)) {
    if (!queue.length) {
      return { reply: profile.mission
        ? `The queue is empty — everything rides on "${profile.mission.goal}" right now. Stack the next one with "queue a mission to …".`
        : 'The queue is empty and nothing\'s active. Say "start a mission to…" and I\'ll break it down.' };
    }
    return { reply: `Your mission queue:\n${queueLines(queue)}\n\n${profile.mission ? `Active first: "${profile.mission.goal}" — the queue moves the moment it lands.` : 'Nothing active — say "start a mission to…" and the queue will follow it.'}` };
  }
  if (QUEUE_CLEAR_RX.test(t)) {
    if (!queue.length) return { reply: 'The mission queue is already empty.' };
    const next: Profile = { ...profile };
    delete next.missionQueue;
    return { reply: `Queue cleared — ${queue.length} mission${queue.length === 1 ? '' : 's'} dropped. ${profile.mission ? `"${profile.mission.goal}" stays active.` : ''}`.trim(), profile: next };
  }
  // v30: queue editing — "move X to the front of the queue" reorders, and
  // "start the queued mission X now" pulls it forward immediately (the active
  // mission, if any, steps back to the FRONT of the queue — its steps restart
  // when it returns, and NAVI says so; no silent loss of progress).
  const fronted = t.match(QUEUE_FRONT_RX);
  if (fronted) {
    const idx = findQueued(queue, fronted[1]);
    if (idx < 0) {
      return { reply: queue.length
        ? `Nothing queued matches "${fronted[1].trim()}". The queue holds:\n${queueLines(queue)}`
        : 'The mission queue is empty — nothing to move.' };
    }
    if (idx === 0) {
      return { reply: `"${queue[0]}" is already at the front of the queue — it's next the moment ${profile.mission ? `"${profile.mission.goal}" completes` : 'you start it'}.` };
    }
    const next = [queue[idx], ...queue.filter((_, i) => i !== idx)];
    return {
      reply: `Moved up — "${queue[idx]}" is now first in the queue:\n${queueLines(next)}`,
      profile: { ...profile, missionQueue: next },
    };
  }
  const startBare = QUEUE_START_BARE_RX.test(t);
  const startNow = startBare ? null : t.match(QUEUE_START_RX);
  if (startBare || startNow) {
    const idx = startBare ? (queue.length ? 0 : -1) : findQueued(queue, startNow![1]);
    if (idx < 0) {
      return { reply: !startBare && queue.length
        ? `Nothing queued matches "${startNow![1].trim()}". The queue holds:\n${queueLines(queue)}`
        : 'The mission queue is empty — say "start a mission to…" and I\'ll break it down fresh.' };
    }
    const goal = queue[idx];
    const rest = queue.filter((_, i) => i !== idx);
    if (!profile.mission) {
      const base: Profile = { ...profile };
      if (rest.length) base.missionQueue = rest;
      else delete base.missionQueue;
      const started = startMission(goal, base);
      return { reply: `Pulling "${goal}" out of the queue.\n\n${started.reply}`, profile: started.profile };
    }
    // Swap: the active goal steps back to the front of the queue — honestly.
    const swappedOut = profile.mission.goal;
    const progress = profile.mission.done;
    const base: Profile = { ...profile, missionQueue: [swappedOut, ...rest] };
    delete base.mission;
    const started = startMission(goal, base);
    const note = progress
      ? ` Heads up: its ${progress} finished step${progress === 1 ? '' : 's'} won't be re-counted — it starts with a fresh plan when it comes back.`
      : '';
    return {
      reply: `Swap made — "${swappedOut}" steps back to the front of the queue and "${goal}" takes the floor.${note}\n\n${started.reply}`,
      profile: started.profile,
    };
  }
  const unqueued = t.match(QUEUE_REMOVE_RX);
  if (unqueued) {
    const idx = findQueued(queue, unqueued[1]);
    if (idx < 0) {
      return { reply: queue.length
        ? `Nothing queued matches "${unqueued[1].trim()}". The queue holds:\n${queueLines(queue)}`
        : 'The mission queue is empty — nothing to remove.' };
    }
    const rest = queue.filter((_, i) => i !== idx);
    const next: Profile = { ...profile };
    if (rest.length) next.missionQueue = rest;
    else delete next.missionQueue;
    return { reply: `Removed "${queue[idx]}" from the queue.${rest.length ? ` Still waiting:\n${queueLines(rest)}` : ' The queue is empty now.'}`, profile: next };
  }

  // ── Missions ──────────────────────────────────────────────────────────────
  if (profile.mission) {
    if (MISSION_STATUS_RX.test(t) || MISSION_NEXT_RX.test(t)) {
      return { reply: missionStatus(profile.mission, queue) };
    }
    // v37: the dry-run — the whole remaining tail, read-only.
    if (MISSION_PREVIEW_RX.test(t)) {
      return { reply: missionPreview(profile.mission) };
    }
    // v47: mission deadlines — commit the active mission to a date, count it
    // down, and let it go. Parsed before DONE (whose forms are all past-tense
    // whole matches, so "finish this mission by friday" was never its ask).
    const dlPhrase = parseMissionDeadline(message);
    if (dlPhrase) {
      const td = todayInTZ('Africa/Johannesburg');
      const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
      const { due } = parseWhen(dlPhrase, td);
      if (!due) {
        return { reply: 'I can hold a deadline like "by friday", "by 25 december", or "by tomorrow" — that phrasing I don\'t know yet.' };
      }
      if (due < todayISO) {
        return { reply: `That day is already behind us — a deadline needs to be today or later. Try "finish this mission by friday".` };
      }
      const mission: Mission = { ...profile.mission, deadline: due };
      delete mission.deadlineNudged; // a fresh deadline speaks fresh
      const remaining = mission.steps.length - mission.done;
      return {
        reply: `Deadline set — "${mission.goal}" is ${deadlineCountdown(due, todayISO)}, with ${remaining} step${remaining === 1 ? '' : 's'} between you and done. I'll count it down in "mission status" and speak up as it closes in. Say "clear my mission deadline" if plans change.`,
        profile: { ...profile, mission },
      };
    }
    if (MISSION_DEADLINE_CLEAR_RX.test(t)) {
      if (!profile.mission.deadline) {
        return { reply: `"${profile.mission.goal}" has no deadline to clear — it moves at your pace. Give it one with "finish this mission by friday".` };
      }
      const mission: Mission = { ...profile.mission };
      delete mission.deadline;
      delete mission.deadlineNudged;
      return {
        reply: `Deadline cleared — "${mission.goal}" is back on your own clock. The steps still stand; only the date is gone.`,
        profile: { ...profile, mission },
      };
    }
    if (MISSION_DEADLINE_SHOW_RX.test(t)) {
      const td = todayInTZ('Africa/Johannesburg');
      const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
      const remaining = profile.mission.steps.length - profile.mission.done;
      return {
        reply: profile.mission.deadline
          ? `"${profile.mission.goal}" is ${deadlineCountdown(profile.mission.deadline, todayISO)} — ${remaining} step${remaining === 1 ? '' : 's'} to go.`
          : `"${profile.mission.goal}" has no deadline — it moves at your pace. Commit to one with "finish this mission by friday".`,
      };
    }
    if (MISSION_DONE_RX.test(t)) return advanceMission(profile);
    // v27: mission editing — bare "skip" only means anything mid-mission.
    if (MISSION_SKIP_RX.test(t)) return skipStep(profile);
    const added = t.match(MISSION_ADD_RX);
    if (added) {
      const text = added[1].trim();
      if (text.length >= 3 && text.length <= 120 && !CRISIS_RX.test(text)) {
        return addStep(text, profile);
      }
    }
    if (MISSION_ABANDON_RX.test(t)) {
      const next: Profile = { ...profile };
      delete next.mission;
      // v29: abandoning is a choice, not a completion — the queue waits
      // rather than auto-starting, but it gets named so nothing is forgotten.
      const held = queue.length
        ? `\n\nYour queue still holds:\n${queueLines(queue)}\nSay "start a mission to ${queue[0]}" whenever you're ready — abandoning doesn't auto-start it.`
        : '';
      return {
        reply: `Mission "${profile.mission.goal}" dropped — no guilt, priorities change. When you're ready for the next one, say "start a mission to…" and I'll break it down.${held}`,
        profile: next,
      };
    }
    const attempted = parseMissionStart(message);
    if (attempted) {
      return {
        reply: `You already have an active mission — ${profile.mission.goal}, step ${profile.mission.done + 1} of ${profile.mission.steps.length}. One mission at a time; that's how things actually get finished. Complete it, say "abandon mission", or say "queue a mission to ${attempted}" and I'll start it the moment this one lands.`,
      };
    }
  } else {
    if (
      MISSION_STATUS_RX.test(t) || MISSION_ABANDON_RX.test(t) || MISSION_PREVIEW_RX.test(t) ||
      // v47: deadline talk with nothing active gets the same honest line.
      parseMissionDeadline(message) !== null || MISSION_DEADLINE_CLEAR_RX.test(t) || MISSION_DEADLINE_SHOW_RX.test(t)
    ) {
      return {
        reply: 'No active mission right now. Start one with "start a mission to…" and I\'ll break it into steps and walk you through them, one at a time.',
      };
    }
    // Bare "done" / "what's next" without a mission is normal conversation —
    // fall through untouched.
    const goal = parseMissionStart(message);
    if (goal) return startMission(goal, profile);
  }

  // ── v31: workflow inspection & step editing ───────────────────────────────
  // Before creation/deletion parsing — their regexes would misread these asks
  // (see the parser comments above).
  const shown = parseWorkflowShow(message);
  if (shown) {
    const wf = workflows.find((w) => w.name === shown);
    if (!wf) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${shown}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${shown}" to show. Create one:\ncreate a workflow called ${shown}: a verse about strength, then list my reminders` };
    }
    const trig = wf.trigger ? `\nTrigger: "${wf.trigger}"` : '';
    const daily = wf.daily
      ? '\nRuns daily on your first chat of the day.'
      : wf.day
      ? `\nRuns every ${wf.day}, on your first chat that day.`
      : wf.monthDay ? `\nRuns on the ${ordinal(wf.monthDay)} of every month, on your first chat that day.` : '';
    // v46: a sleeping workflow says so when shown.
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    const nap = isPaused(wf, todayISO)
      ? `\nCurrently ${pauseLabel(wf)} — "resume my ${wf.name} workflow" wakes it.`
      : '';
    return {
      reply: `"${wf.name}" — ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}:\n${stepLines(wf)}${trig}${daily}${nap}\n\nEdit it in place: "replace step 2 of my ${wf.name} workflow with …", "remove step 2 from my ${wf.name} workflow", or "add a step to my ${wf.name} workflow: …".`,
    };
  }

  // v36: the dry-run — report what a run would do, execute nothing. Sits with
  // the inspection commands; the run/show parsers can't see these verbs.
  const previewAsk = parseWorkflowPreview(message);
  if (previewAsk) {
    const wf = workflows.find((w) => w.name === previewAsk.name);
    if (!wf) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${previewAsk.name}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${previewAsk.name}" to preview. Create it first:\ncreate a workflow called ${previewAsk.name}: a verse about strength, then list my reminders` };
    }
    if (hasSlot(wf) && !previewAsk.topic) {
      return {
        reply: `"${wf.name}" has a * slot in its steps, so a preview needs a topic too. Say it like:\npreview my ${wf.name} workflow on grace`,
      };
    }
    return { reply: await previewWorkflow(wf, profile, previewAsk.topic, email, sources) };
  }

  const edit = parseWorkflowStepEdit(message);
  if (edit) {
    const idx = workflows.findIndex((w) => w.name === edit.name);
    if (idx < 0) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${edit.name}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${edit.name}" to edit. Create it first:\ncreate a workflow called ${edit.name}: …` };
    }
    const wf = workflows[idx];

    if (edit.kind === 'add') {
      if (wf.steps.length >= MAX_STEPS) {
        return { reply: `"${wf.name}" already has ${MAX_STEPS} steps — that's the ceiling. Replace or remove one first, then add.` };
      }
      const problem = stepProblem(edit.text);
      if (problem) return { reply: problem };
      const next = { ...wf, steps: [...wf.steps, edit.text] };
      return {
        reply: `Added — "${wf.name}" is now ${next.steps.length} step${next.steps.length === 1 ? '' : 's'}:\n${stepLines(next)}`,
        profile: { ...profile, workflows: workflows.map((w, i) => (i === idx ? next : w)) },
      };
    }

    if (edit.n < 1 || edit.n > wf.steps.length) {
      return { reply: `"${wf.name}" only has ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}:\n${stepLines(wf)}\n\nPick a number on that list.` };
    }

    if (edit.kind === 'replace') {
      const problem = stepProblem(edit.text);
      if (problem) return { reply: problem };
      const steps = wf.steps.map((s, i) => (i === edit.n - 1 ? edit.text : s));
      const next = { ...wf, steps };
      return {
        reply: `Step ${edit.n} of "${wf.name}" replaced:\n${stepLines(next)}`,
        profile: { ...profile, workflows: workflows.map((w, i) => (i === idx ? next : w)) },
      };
    }

    // remove
    if (wf.steps.length === 1) {
      return { reply: `That's the only step "${wf.name}" has — removing it leaves an empty shell. If the routine's done its job, say "delete my ${wf.name} workflow" instead.` };
    }
    const steps = wf.steps.filter((_, i) => i !== edit.n - 1);
    const next = { ...wf, steps };
    return {
      reply: `Step ${edit.n} removed — "${wf.name}" is now ${steps.length} step${steps.length === 1 ? '' : 's'}:\n${stepLines(next)}`,
      profile: { ...profile, workflows: workflows.map((w, i) => (i === idx ? next : w)) },
    };
  }

  // ── v32: step reordering & workflow renaming — the editing line complete ──
  const moved = parseWorkflowStepMove(message);
  if (moved) {
    const idx = workflows.findIndex((w) => w.name === moved.name);
    if (idx < 0) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${moved.name}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${moved.name}" to reorder. Create it first:\ncreate a workflow called ${moved.name}: …` };
    }
    const wf = workflows[idx];
    if (moved.n < 1 || moved.n > wf.steps.length) {
      return { reply: `"${wf.name}" only has ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}:\n${stepLines(wf)}\n\nPick a number on that list.` };
    }
    const from = moved.n - 1;
    const to = moved.dir === 'up' ? from - 1
      : moved.dir === 'down' ? from + 1
      : moved.dir === 'top' ? 0
      : wf.steps.length - 1;
    if (to === from || to < 0 || to > wf.steps.length - 1) {
      const where = moved.dir === 'up' || moved.dir === 'top' ? 'already at the top' : 'already at the bottom';
      return { reply: `Step ${moved.n} of "${wf.name}" is ${where}:\n${stepLines(wf)}` };
    }
    const steps = [...wf.steps];
    const [s] = steps.splice(from, 1);
    steps.splice(to, 0, s);
    const next = { ...wf, steps };
    return {
      reply: `Moved — "${wf.name}" now runs:\n${stepLines(next)}`,
      profile: { ...profile, workflows: workflows.map((w, i) => (i === idx ? next : w)) },
    };
  }

  const renamed = parseWorkflowRename(message);
  if (renamed) {
    const idx = workflows.findIndex((w) => w.name === renamed.from);
    if (idx < 0) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${renamed.from}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${renamed.from}" to rename.` };
    }
    if (renamed.to === renamed.from) {
      return { reply: `"${renamed.from}" is already its name — nothing to change.` };
    }
    if (workflows.some((w) => w.name === renamed.to)) {
      return { reply: `You already have a workflow called "${renamed.to}" — two routines can't share a name. Pick another, or delete that one first.` };
    }
    const wf = workflows[idx];
    const next = { ...wf, name: renamed.to };
    const trig = wf.trigger ? ` Its trigger ("${wf.trigger}") still works.` : '';
    const daily = wf.daily ? ' It still runs daily.' : wf.day ? ` It still runs every ${wf.day}.` : wf.monthDay ? ` It still runs monthly on the ${ordinal(wf.monthDay)}.` : '';
    return {
      reply: `Done — "${renamed.from}" is now "${renamed.to}".${trig}${daily} Say "run my ${renamed.to} workflow" to use it.`,
      profile: { ...profile, workflows: workflows.map((w, i) => (i === idx ? next : w)) },
    };
  }

  // ── Workflow commands ─────────────────────────────────────────────────────
  const created = parseWorkflowCreate(message);
  if (created) {
    if (!created.name) {
      return {
        reply: 'Give the workflow a name so you can run it later — like this:\ncreate a workflow called morning: a verse about strength, then list my reminders, then encourage me',
      };
    }
    // v29: the guard reads THROUGH a "when …:" condition (conditions may
    // legitimately mention the mission) and allows the one safe, read-only
    // mission phrase — "my next mission step".
    const badStep = created.steps.map(stepProblem).find((p) => p !== null);
    if (badStep) {
      return { reply: badStep };
    }
    // v46: a workflow may chain OTHER workflows, never itself — the depth
    // guard would refuse it at run time anyway, but honesty starts at creation.
    const selfRef = created.steps.some((s) => parseWorkflowRun(bodyOf(s))?.name === created.name);
    if (selfRef) {
      return {
        reply: `A workflow can't run itself — "${created.name}" chaining into "${created.name}" would never end. Chain a DIFFERENT saved workflow, or make the step an ordinary ask.`,
      };
    }
    const existing = workflows.findIndex((w) => w.name === created.name);
    const wf: Workflow = {
      name: created.name,
      steps: created.steps,
      created: new Date().toISOString(),
    };
    let nextList: Workflow[];
    if (existing >= 0) {
      wf.trigger = workflows[existing].trigger;
      nextList = workflows.map((w, i) => (i === existing ? wf : w));
    } else {
      if (workflows.length >= MAX_WORKFLOWS) {
        return {
          reply: `You've got ${MAX_WORKFLOWS} workflows saved — that's the shelf full. Delete one first ("delete my … workflow") and I'll save this one.`,
        };
      }
      nextList = [...workflows, wf];
    }
    const stepLines = wf.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const replaced = existing >= 0 ? ` (replaced the old "${created.name}")` : '';
    // v42: name the send steps up front, so the run-time confirm never surprises.
    // v46: nested references expanded, so a chained sender is named here too.
    const sendsNote = sendStepsOf(wf, nextList).length
      ? '\n\nHeads up: this workflow sends real email, so every run will pause and ask for your yes first — and scheduled auto-runs will hold those steps back entirely.'
      : '';
    return {
      reply: `Saved "${created.name}"${replaced} — ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}:\n${stepLines}\n\nSay "run my ${created.name} workflow" and I'll execute every step. Want it on a trigger? Say: when I say good morning, run my ${created.name} workflow.${sendsNote}`,
      profile: { ...profile, workflows: nextList },
    };
  }

  if (LIST_RX.test(t)) {
    if (!workflows.length) {
      return {
        reply: 'No workflows saved yet. Build your first one:\ncreate a workflow called morning: a verse about strength, then list my reminders, then encourage me',
      };
    }
    return {
      reply: `Your workflows:\n${nameList(workflows)}\n\nSay "run my <name> workflow" to execute one.`,
    };
  }

  // v39: execution receipts — read the run log back, today's slice only.
  // Pure read; the log itself is stamped inside runWorkflow.
  if (RAN_TODAY_RX.test(t)) {
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    const today = (profile.workflowLog ?? []).filter((r) => r.date === todayISO);
    if (!today.length) {
      return { reply: 'Nothing has run today — no workflow has fired yet, manual or scheduled.' };
    }
    return {
      reply: `Ran today (${today.length}):\n${today.map((r) => `- "${r.name}" — ${VIA_LABEL[r.via]}`).join('\n')}\n\nSay "what did my last run do" for the step-by-step of the newest one.`,
    };
  }

  // v47: the deep receipt — "what did my last run do" / "what did my last
  // study run do" reads the newest matching receipt back step by step.
  // Pure read; the outcomes were stamped by runWorkflow itself.
  const lastAsk = parseLastRun(message);
  if (lastAsk) {
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    const log = profile.workflowLog ?? [];
    const hit = [...log].reverse().find((r) => !lastAsk.name || r.name === lastAsk.name);
    if (!hit) {
      return {
        reply: lastAsk.name
          ? `No "${lastAsk.name}" run on the receipts — I keep the last ${MAX_RUN_LOG}. Say "run my ${lastAsk.name} workflow" and the next one will be on record.`
          : 'No runs on the receipts yet — I keep the last 10. Run a workflow ("run my <name> workflow") and I\'ll hold the step-by-step.',
      };
    }
    const when = hit.date === todayISO ? 'today' : `on ${hit.date}`;
    const onTopic = hit.topic ? ` on "${hit.topic}"` : '';
    const head = `Your last${lastAsk.name ? ` "${hit.name}"` : ''} run — "${hit.name}"${onTopic}, ${when} (${VIA_LABEL[hit.via]}):`;
    if (!hit.steps?.length) {
      return { reply: `${head}\nThat run predates per-step receipts, so the receipt only says it happened. From now on every run keeps the full step-by-step.` };
    }
    const word: Record<StepOutcome['o'], string> = {
      ran: '✓ ran',
      skipped: '– skipped',
      held: '✋ held back',
      failed: "✗ couldn't execute",
    };
    const lines = hit.steps
      .map((s, i) => `${i + 1}. ${word[s.o]} — ${s.s}${s.w ? ` (${s.w})` : ''}`)
      .join('\n');
    const ranCount = hit.steps.filter((s) => s.o === 'ran').length;
    return {
      reply: `${head}\n${lines}\n\n${ranCount} of ${hit.steps.length} step${hit.steps.length === 1 ? '' : 's'} ran. Say "run my ${hit.name} workflow again" to repeat it${hit.topic ? ' — same topic and all' : ''}.`,
    };
  }

  const toDelete = parseWorkflowDelete(message);
  if (toDelete) {
    const idx = workflows.findIndex((w) => w.name === toDelete);
    if (idx < 0) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${toDelete}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `I don't have any workflows saved for you yet, so there's nothing called "${toDelete}" to delete.` };
    }
    return {
      reply: `Deleted "${toDelete}". ${workflows.length - 1 ? `You still have: ${workflows.filter((_, i) => i !== idx).map((w) => w.name).join(', ')}.` : 'That was the last one — clean slate.'}`,
      profile: { ...profile, workflows: workflows.filter((_, i) => i !== idx) },
    };
  }

  const triggerSet = parseTriggerSet(message);
  if (triggerSet) {
    const idx = workflows.findIndex((w) => w.name === triggerSet.name);
    if (idx < 0) {
      return {
        reply: `I don't have a workflow called "${triggerSet.name}" to put on that trigger. ${workflows.length ? `You have: ${workflows.map((w) => w.name).join(', ')}.` : 'Create it first: create a workflow called ' + triggerSet.name + ': …'}`,
      };
    }
    const nextList = workflows.map((w, i) =>
      i === idx ? { ...w, trigger: triggerSet.trigger } : w,
    );
    // v29: an open trigger ("study *") fires on the prefix and carries the
    // rest as the topic — explain exactly how it will behave.
    const open = triggerSet.trigger.endsWith(' *');
    const how = open
      ? `whenever you say "${triggerSet.trigger.slice(0, -2)} <anything>", I'll run your "${triggerSet.name}" workflow with that as the topic${hasSlot(workflows[idx]) ? ', filling every * slot' : ''}`
      : `whenever you say "${triggerSet.trigger}", I'll run your "${triggerSet.name}" workflow, all ${workflows[idx].steps.length} steps`;
    return {
      reply: `Locked in — ${how}.`,
      profile: { ...profile, workflows: nextList },
    };
  }

  const dailySet = parseDailySet(message);
  if (dailySet) {
    const idx = workflows.findIndex((w) => w.name === dailySet.name);
    if (idx < 0) {
      return {
        reply: `I don't have a workflow called "${dailySet.name}". ${workflows.length ? `You have: ${workflows.map((w) => w.name).join(', ')}.` : 'Create it first: create a workflow called ' + dailySet.name + ': …'}`,
      };
    }
    // v27: a scheduled auto-run has no topic to fill a * slot with.
    if (dailySet.daily && hasSlot(workflows[idx])) {
      return {
        reply: `"${dailySet.name}" has a * slot, so it needs a topic each time — a scheduled auto-run wouldn't know what to fill in. Run it whenever you like with "run my ${dailySet.name} workflow on <topic>".`,
      };
    }
    // v41: 1-28 only, so the schedule exists in EVERY month — a 30th that
    // February silently skips would be a broken promise, not a feature.
    if (dailySet.monthDay && (dailySet.monthDay < 1 || dailySet.monthDay > 28)) {
      return {
        reply: `Not every month has a ${ordinal(dailySet.monthDay)}, so I only book monthly runs on the 1st through the 28th — that way it never silently skips a month. Pick a day in that range.`,
      };
    }
    // v38: one schedule per workflow — weekly replaces daily and vice versa
    // (v41: monthly joins the swap); off clears whichever is set (and the
    // lastRun stamp with it).
    const nextList = workflows.map((w, i) => {
      if (i !== idx) return w;
      const next = { ...w };
      if (!dailySet.daily) { delete next.daily; delete next.day; delete next.monthDay; delete next.lastRun; }
      else if (dailySet.monthDay) { next.monthDay = dailySet.monthDay; delete next.daily; delete next.day; }
      else if (dailySet.day) { next.day = dailySet.day; delete next.daily; delete next.monthDay; }
      else { next.daily = true; delete next.day; delete next.monthDay; }
      return next;
    });
    return {
      reply: dailySet.daily
        ? dailySet.monthDay
          ? `Done — "${dailySet.name}" now runs itself on the ${ordinal(dailySet.monthDay)} of every month, on your first chat that day. You show up, I handle the routine.`
          : dailySet.day
          ? `Done — "${dailySet.name}" now runs itself every ${dailySet.day}, on your first chat that day. You show up, I handle the routine.`
          : `Done — "${dailySet.name}" now runs itself every day, on your first chat of the day. You show up, I handle the routine.`
        : `Okay — "${dailySet.name}" is off the schedule. It's still saved; run it anytime with "run my ${dailySet.name} workflow".`,
      profile: { ...profile, workflows: nextList },
    };
  }

  // ── v46: pause / resume — a workflow can sleep without being deleted ──────
  const pauseAsk = parseWorkflowPause(message);
  if (pauseAsk) {
    const idx = workflows.findIndex((w) => w.name === pauseAsk.name);
    if (idx < 0) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${pauseAsk.name}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${pauseAsk.name}" to pause.` };
    }
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    let until: string | undefined;
    if (pauseAsk.until) {
      const phrase = pauseAsk.until
        .replace(/^(?:a|one)\s+(day|week)$/i, '1 $1')
        .replace(/^(\d{1,2})\s+(day|week)s?$/i, 'in $1 $2s');
      const { due } = parseWhen(phrase, td);
      if (!due) {
        return { reply: 'I can pause "until friday", "until 25 december", or "for a week" — that phrasing I don\'t know yet. (A bare "pause my … workflow" pauses it until you resume it.)' };
      }
      if (due <= todayISO) {
        return { reply: `That wouldn't pause anything — pick a day after today, like "pause my ${pauseAsk.name} workflow until friday".` };
      }
      until = due;
    }
    const wf = workflows[idx];
    const nextList = workflows.map((w, i) => (i === idx ? { ...w, paused: until ?? true } : w));
    const sleeps: string[] = [];
    if (wf.daily || wf.day || wf.monthDay) sleeps.push('its schedule');
    if (wf.trigger) sleeps.push(`its trigger ("${wf.trigger}")`);
    const what = sleeps.length ? ` ${sleeps.join(' and ')} sleep${sleeps.length === 1 ? 's' : ''} too;` : '';
    return {
      reply: until
        ? `Paused — "${wf.name}" sleeps until ${until} and wakes that day by itself.${what} manual runs will wait too. "resume my ${wf.name} workflow" wakes it early.`
        : `Paused — "${wf.name}" is asleep until you say "resume my ${wf.name} workflow".${what} nothing about it runs while it sleeps.`,
      profile: { ...profile, workflows: nextList },
    };
  }
  const resumeAsk = parseWorkflowResume(message);
  if (resumeAsk) {
    const idx = workflows.findIndex((w) => w.name === resumeAsk);
    if (idx < 0) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${resumeAsk}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so there's nothing called "${resumeAsk}" to resume.` };
    }
    const wf = workflows[idx];
    if (wf.paused === undefined) {
      return { reply: `"${wf.name}" isn't paused — it's already on duty. Run it anytime: "run my ${wf.name} workflow".` };
    }
    const nextList = workflows.map((w, i) => {
      if (i !== idx) return w;
      const { paused: _paused, ...rest } = w;
      return rest as Workflow;
    });
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    const early = isPaused(wf, todayISO) ? '' : ' (its pause had already run out — now the shelf says so too)';
    return {
      reply: `Awake — "${wf.name}" is back on duty${early}. Schedule, trigger, and manual runs all work again.`,
      profile: { ...profile, workflows: nextList },
    };
  }

  // ── v47: the re-run form — replay the newest receipt, same topic ──────────
  const again = parseWorkflowRunAgain(message);
  if (again) {
    const log = profile.workflowLog ?? [];
    const hit = [...log].reverse().find((r) => !again.name || r.name === again.name);
    if (!again.name && !hit) {
      return { reply: 'No runs on the receipts yet — I keep the last 10, and the shelf is fresh. Say "run my <name> workflow" and "again" will mean something.' };
    }
    const name = again.name ?? hit!.name;
    const wf = workflows.find((w) => w.name === name);
    if (!wf) {
      return again.name
        ? workflows.length
          ? { reply: `I don't have a workflow called "${name}". Here's what I'm holding:\n${nameList(workflows)}` }
          : { reply: `No workflows saved yet, so there's nothing called "${name}" to run again.` }
        : { reply: `The last run was "${name}", but that workflow isn't on the shelf anymore — nothing to run again.` };
    }
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    if (isPaused(wf, todayISO)) {
      return { reply: `"${wf.name}" is ${pauseLabel(wf)} — nothing ran. Say "resume my ${wf.name} workflow" and it's back on duty.` };
    }
    const topic = hit?.topic;
    if (hasSlot(wf) && !topic) {
      return {
        reply: `"${wf.name}" has a * slot and ${hit ? "its last receipt didn't record a topic" : "I have no receipt of it running"}, so "again" has nothing to replay. Say it with the topic:\nrun my ${wf.name} workflow on grace`,
      };
    }
    // The same gates as a fresh run — the send law never sleeps.
    const sends = sendStepsOf(wf, workflows);
    if (sends.length) return offerRunWithSends(wf, topic, profile, sends);
    const echo = topic ? `Same again — replaying the last run's topic, "${topic}".\n\n` : '';
    const out = await runWorkflow(wf, profile, run, topic, email, sources);
    return { ...out, reply: `${echo}${out.reply}` };
  }

  const toRun = parseWorkflowRun(message);
  if (toRun) {
    const wf = workflows.find((w) => w.name === toRun.name);
    if (!wf) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${toRun.name}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so I can't run "${toRun.name}". Create it first:\ncreate a workflow called ${toRun.name}: a verse about strength, then list my reminders` };
    }
    // v46: a paused workflow doesn't run — it says so and points at resume.
    {
      const td = todayInTZ('Africa/Johannesburg');
      const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
      if (isPaused(wf, todayISO)) {
        return { reply: `"${wf.name}" is ${pauseLabel(wf)} — nothing ran. Say "resume my ${wf.name} workflow" and it's back on duty.` };
      }
    }
    // v27: a slotted workflow needs its topic before it can run.
    if (hasSlot(wf) && !toRun.topic) {
      return {
        reply: `"${wf.name}" has a * slot in its steps, so it needs a topic each run. Say it like:\nrun my ${wf.name} workflow on grace`,
      };
    }
    // v42: send steps gate the run itself — offer first, run on the yes.
    // v46: nested references are expanded, so a chained sender is gated too.
    const sends = sendStepsOf(wf, workflows);
    if (sends.length) return offerRunWithSends(wf, toRun.topic, profile, sends);
    return await runWorkflow(wf, profile, run, toRun.topic, email, sources);
  }

  // ── Trigger phrases — an exact match runs the whole routine ───────────────
  if (!CRISIS_RX.test(t)) {
    const td = todayInTZ('Africa/Johannesburg');
    const todayISO = `${td.y}-${String(td.m).padStart(2, '0')}-${String(td.d).padStart(2, '0')}`;
    const fired = workflows.find((w) => w.trigger && w.trigger === t);
    if (fired) {
      // v46: a paused workflow's trigger sleeps with it — honestly.
      if (isPaused(fired, todayISO)) {
        return { reply: `That trigger belongs to "${fired.name}", which is ${pauseLabel(fired)} — nothing ran. Say "resume my ${fired.name} workflow" to wake it.` };
      }
      // v27: a bare trigger phrase carries no topic to fill a * slot with.
      if (hasSlot(fired)) {
        return {
          reply: `That's the trigger for "${fired.name}", but it has a * slot, so it needs a topic. Run it like:\nrun my ${fired.name} workflow on grace`,
        };
      }
      // v42: a trigger is spoken live, so the send confirm works here too.
      const sends = sendStepsOf(fired, workflows);
      if (sends.length) return offerRunWithSends(fired, undefined, profile, sends);
      return await runWorkflow(fired, profile, run, undefined, email, sources, 'trigger');
    }

    // v29: open triggers — "study *" fires on "study <anything>", and the
    // remainder becomes the topic that fills every * slot.
    for (const w of workflows) {
      if (!w.trigger?.endsWith(' *')) continue;
      const prefix = w.trigger.slice(0, -1); // keeps the trailing space
      if (!t.startsWith(prefix)) continue;
      const topic = t.slice(prefix.length).trim();
      if (!topic || topic.length > 60 || CRISIS_RX.test(topic)) continue;
      if (isPaused(w, todayISO)) {
        return { reply: `That trigger belongs to "${w.name}", which is ${pauseLabel(w)} — nothing ran. Say "resume my ${w.name} workflow" to wake it.` };
      }
      const sends = sendStepsOf(w, workflows);
      if (sends.length) return offerRunWithSends(w, topic, profile, sends);
      return await runWorkflow(w, profile, run, topic, email, sources, 'trigger');
    }
  }

  return null;
}

/**
 * v26: run every daily workflow that hasn't run today (SA time) and return a
 * combined report plus the updated profile (lastRun stamped, step side-effects
 * threaded), or null when nothing is due. index.ts appends the report to the
 * first reply of the day's first session — reminders-style surfacing, scaled up.
 * v38: weekly workflows (Workflow.day) ride the same channel — due only when
 * todayISO falls on their weekday, stamped with the same lastRun.
 * v41: monthly workflows (Workflow.monthDay) too — due only when todayISO
 * falls on their day of the month (1-28, so every month has one).
 */
export async function runDailyWorkflows(
  profile: Profile,
  run: AgentRunner,
  todayISO: string,
  email = '', // v35: world conditions inside daily workflows need the account
  sources?: ConditionSources,
): Promise<{ report: string; profile: Profile } | null> {
  // v27: slotted workflows never auto-run — there's no topic to fill the * with.
  const dow = weekdayOf(todayISO);
  const dom = parseInt(todayISO.slice(8, 10), 10);
  // v46: a paused workflow sleeps through its schedule — silently, that's the
  // point of a pause; a dated pause simply stops holding on its wake day.
  const due = (profile.workflows ?? []).filter((w) =>
    (w.daily || (w.day && w.day === dow) || (w.monthDay && w.monthDay === dom)) &&
    w.lastRun !== todayISO && !hasSlot(w) && !isPaused(w, todayISO));
  if (!due.length) return null;

  let prof = profile;
  const reports: string[] = [];
  for (const wf of due) {
    const via = wf.daily ? 'daily' : wf.day ? 'weekly' : 'monthly';
    const out = await runWorkflow(wf, prof, run, undefined, email, sources, via);
    if (out.profile) prof = out.profile;
    // v42 (#27): a glanceable headline, counted from the run itself — the
    // zero-cost cousin of the pre-run preview the roadmap weighed and feared.
    const head = out.counts ? ` (${out.counts.executed} of ${out.counts.total} step${out.counts.total === 1 ? '' : 's'} ran)` : '';
    reports.push(`— Your ${wf.daily ? 'daily' : wf.day ?? 'monthly'} "${wf.name}" workflow${head} —\n\n${out.reply}`);
    prof = {
      ...prof,
      workflows: (prof.workflows ?? []).map((w) =>
        w.name === wf.name ? { ...w, lastRun: todayISO } : w,
      ),
    };
  }
  return { report: reports.join('\n\n'), profile: prof };
}

/**
 * v27: one gentle session-start line when the active mission has sat idle for
 * 3+ days — appended by index.ts under the greeting, reminders-style. At most
 * once per SA day (`nudged` stamp), and never invents urgency: it names the
 * exact step waiting. Returns null when there's nothing to say.
 */
export function missionNudge(
  profile: Profile,
  todayISO: string,
): { note: string; profile: Profile } | null {
  const mission = profile.mission;
  if (!mission) return null;
  // v47: a closing deadline outranks the idle rule — due within 2 days or
  // overdue speaks once per SA day (its own stamp, so a mission that moved
  // yesterday still hears its deadline).
  if (mission.deadline && mission.deadlineNudged !== todayISO) {
    const diff = Math.round((Date.parse(mission.deadline) - Date.parse(todayISO)) / 86400000);
    if (Number.isFinite(diff) && diff <= 2) {
      const remaining = mission.steps.length - mission.done;
      const clock = diff < 0
        ? `is ${deadlineCountdown(mission.deadline, todayISO)} — the date passed, the goal didn't. Finish it late or let it go, but decide`
        : diff === 0
          ? 'is due TODAY'
          : diff === 1
            ? 'is due TOMORROW'
            : `is due in ${diff} days (${mission.deadline})`;
      const note =
        `Deadline check: "${mission.goal}" ${clock}. ${remaining} step${remaining === 1 ? '' : 's'} left, and you're on step ${mission.done + 1}:\n${mission.steps[mission.done]}\n\nSay "done" as you land them — or "clear my mission deadline" if the date no longer serves.`;
      return {
        note,
        profile: { ...profile, mission: { ...mission, deadlineNudged: todayISO } },
      };
    }
  }
  if (mission.nudged === todayISO) return null;
  const last = Date.parse((mission.touched ?? mission.created).slice(0, 10));
  const idleDays = Math.round((Date.parse(todayISO) - last) / 86400000);
  if (!Number.isFinite(idleDays) || idleDays < 3) return null;
  const note =
    `Your mission is still open — "${mission.goal}", step ${mission.done + 1} of ${mission.steps.length}:\n${mission.steps[mission.done]}\n\nIt's been ${idleDays} days since it last moved. One step today puts it back in motion — say "done" when it's finished, "skip" if it doesn't serve, or "abandon mission" if priorities changed.`;
  return {
    note,
    profile: { ...profile, mission: { ...mission, nudged: todayISO } },
  };
}
