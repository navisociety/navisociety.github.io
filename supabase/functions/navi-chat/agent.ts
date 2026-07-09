// supabase/functions/navi-chat/agent.ts
//
// NAVI v25 — Agentic workflow execution. (+v26 daily runs, +v27/v29 below)
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

import type { Mission, Profile, Workflow } from './memory.ts';
import { stepsForGoal } from './plan.ts';
import { todayInTZ } from './skills.ts';

export type AgentRunner = (
  part: string,
  profile: Profile,
) => Promise<{ reply: string; profile?: Profile }>;

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

// v26: "run my morning workflow every day" / "make my morning workflow daily"
const DAILY_ON_RX = new RegExp(
  `^(?:please )?(?:run|make|set)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine)(?: run)? (?:every ?day|daily|every morning|each day)$`,
);
const DAILY_OFF_RX = new RegExp(
  `^(?:please )?(?:stop|don'?t) (?:running|run)(?: my| the)? (${NAME_CHARS}?) (?:workflow|routine) (?:every ?day|daily|every morning|each day)$`,
);

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
  `"i haven't logged my <habit> habit", "i logged my <habit> habit", "a reminder is due", "my mood is low/stressed/good", "my mission is idle", "i have a mission"`;

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

/**
 * Evaluate a closed-vocabulary condition against the profile. Returns true /
 * false, or null for a condition NAVI doesn't understand — the caller skips
 * the step and teaches the vocabulary instead of guessing.
 */
export function evalCondition(
  cond: string,
  profile: Profile,
  todayISO: string,
): boolean | null {
  let m = cond.match(/^i haven'?t (?:logged|done|kept) my (.+?) habit(?: today)?$/);
  if (m) return !habitLoggedToday(profile, m[1], todayISO);
  m = cond.match(/^i(?:'ve| have)? (?:logged|did|done|kept) my (.+?) habit(?: today)?$/);
  if (m) return habitLoggedToday(profile, m[1], todayISO);
  if (/^(?:a reminder is due|reminders are due|i have (?:a )?reminders? due)$/.test(cond)) {
    return (profile.reminders ?? []).some((r) => !r.due || r.due <= todayISO);
  }
  m = cond.match(/^(?:my mood is|i'?m feeling|i feel) (\w+)$/);
  if (m && MOOD_ALIASES[m[1]]) return (profile.lastMood ?? '') === MOOD_ALIASES[m[1]];
  if (/^my mission (?:is idle|hasn'?t moved)$/.test(cond)) {
    const mi = profile.mission;
    if (!mi) return false;
    const idle = Math.round(
      (Date.parse(todayISO) - Date.parse((mi.touched ?? mi.created).slice(0, 10))) / 86400000,
    );
    return Number.isFinite(idle) && idle >= 3;
  }
  if (/^i have (?:a|an)(?: active)? mission$/.test(cond)) return !!profile.mission;
  return null;
}

// v29: the read-only mission step a workflow may carry.
const MISSION_STEP_LITERAL_RX =
  /^(?:read |show |give )?(?:me )?(?:my )?(?:next |current )?mission step$/;

/** The workflow name from a delete ask, or null. */
export function parseWorkflowDelete(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  const m = t.match(DELETE_RX);
  return m ? (m[1] ?? m[2]).trim() : null;
}

/** The workflow name from a "run my X workflow every day" ask, or null. */
export function parseDailySet(message: string): { name: string; daily: boolean } | null {
  const t = tidy(message);
  if (!t || t.length > 100) return null;
  const on = t.match(DAILY_ON_RX);
  if (on) return { name: on[1].trim(), daily: true };
  const off = t.match(DAILY_OFF_RX);
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
- start a step with a condition and it only runs when it's true: when i haven't logged my prayer habit: remind me to pray
- include the step "my next mission step" and the routine shows your mission's current step, read-only
- run my morning workflow every day (auto-runs on your first chat of the day)
- list my workflows / delete my morning workflow

MISSIONS — a goal I break into steps and walk you through:
- start a mission to launch my EP
- what's next? / done / mission status / abandon mission
- skip (drops the step in front of you) / add a step to my mission: …
- queue a mission to X (up to 3 wait behind the active one and auto-start when it completes) / show my mission queue
- if a mission sits still for 3+ days, I'll bring it up when you come back

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
    parseTriggerSet(message) !== null ||
    parseDailySet(message) !== null ||
    parseMissionStart(message) !== null ||
    parseMissionQueue(message) !== null ||
    LIST_RX.test(t) ||
    MISSION_STATUS_RX.test(t) ||
    MISSION_ABANDON_RX.test(t) ||
    QUEUE_SHOW_RX.test(t) ||
    QUEUE_CLEAR_RX.test(t)
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

function nameList(workflows: Workflow[]): string {
  return workflows
    .map((w) => {
      const trig = w.trigger ? ` — trigger: "${w.trigger}"` : '';
      const daily = w.daily ? ' — runs daily' : '';
      return `- ${w.name} (${w.steps.length} step${w.steps.length === 1 ? '' : 's'})${trig}${daily}`;
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
  return `Mission: ${mission.goal}\n${done}\n\nCurrent step (${current} of ${total}):\n${mission.steps[mission.done]}${queued}\n\nSay "done" when it's finished, "what's next" to hear it again, or "abandon mission" to drop it.`;
}

// ── Execution ───────────────────────────────────────────────────────────────

async function runWorkflow(
  wf: Workflow,
  profile: Profile,
  run: AgentRunner,
  topic?: string,
): Promise<{ reply: string; profile?: Profile }> {
  let prof = profile;
  let changed = false;
  let executed = 0;
  let skipped = 0;
  const t = todayInTZ('Africa/Johannesburg');
  const todayISO = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const onTopic = topic ? ` on "${topic}"` : '';
  const blocks: string[] = [
    `Running "${wf.name}"${onTopic} — ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}.`,
  ];
  for (let i = 0; i < wf.steps.length; i++) {
    // v27: a topic fills every * slot, so one saved routine serves any subject.
    let step = topic ? wf.steps[i].replaceAll('*', topic) : wf.steps[i];

    // v29: conditional steps — evaluate "when <condition>:" against the
    // profile as it stands NOW (earlier steps' changes included).
    const cond = parseConditionStep(step);
    if (cond) {
      const holds = evalCondition(cond.cond, prof, todayISO);
      if (holds === null) {
        skipped++;
        blocks.push(`Step ${i + 1} — skipped: I don't know the condition "${cond.cond}". I understand: ${KNOWN_CONDITIONS}.`);
        continue;
      }
      if (!holds) {
        skipped++;
        blocks.push(`Step ${i + 1} — skipped ("when ${cond.cond}" isn't the case right now).`);
        continue;
      }
      step = cond.body;
    }

    // v29: the mission-aware step — read the current mission step directly,
    // never through the engines, never advancing anything.
    if (MISSION_STEP_LITERAL_RX.test(step)) {
      executed++;
      blocks.push(`Step ${i + 1} — ${step}:\n` + (prof.mission
        ? `Mission "${prof.mission.goal}" — step ${prof.mission.done + 1} of ${prof.mission.steps.length}:\n${prof.mission.steps[prof.mission.done]}\n(Say "done" outside the workflow when it's finished.)`
        : 'No active mission right now — nothing waiting here.'));
      continue;
    }

    const out = await run(step, prof);
    if (out.profile) {
      prof = out.profile;
      changed = true;
    }
    if (out.reply) {
      executed++;
      blocks.push(`Step ${i + 1} — ${step}:\n${out.reply}`);
    } else {
      blocks.push(`Step ${i + 1} — ${step}:\nI couldn't execute this one.`);
    }
  }
  const attempted = wf.steps.length - skipped;
  const skipNote = skipped
    ? ` (${skipped} skipped by ${skipped === 1 ? 'its condition' : 'their conditions'})`
    : '';
  blocks.push(
    attempted === 0
      ? `Workflow "${wf.name}" finished — every step was skipped by its condition today.`
      : executed === attempted
        ? `Workflow "${wf.name}" complete — all ${executed} step${executed === 1 ? '' : 's'} executed${skipNote}.`
        : `Workflow "${wf.name}" finished — ${executed} of ${attempted} steps executed${skipNote}.`,
  );
  return { reply: blocks.join('\n\n'), profile: changed ? prof : undefined };
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
    const base = `MISSION COMPLETE. All ${total} steps of "${mission.goal}" — done. You didn't just plan it, you EXECUTED it, and that's the difference that separates dreamers from builders. It's on your wins list now, permanently.`;
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
): Promise<{ reply: string; profile?: Profile } | null> {
  const t = tidy(message);
  if (!t) return null;

  // Help works for everyone — it's how people discover the feature.
  if (HELP_RX.test(t)) return { reply: HELP_TEXT };

  if (!email) return isAgentAsk(message) ? { reply: SIGN_IN_REPLY } : null;

  const workflows = profile.workflows ?? [];
  const queue = profile.missionQueue ?? [];

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
  const unqueued = t.match(QUEUE_REMOVE_RX);
  if (unqueued) {
    const target = unqueued[1].trim().toLowerCase();
    const idx = queue.findIndex((g) => g.toLowerCase() === target || g.toLowerCase().includes(target) || target.includes(g.toLowerCase()));
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
    if (MISSION_STATUS_RX.test(t) || MISSION_ABANDON_RX.test(t)) {
      return {
        reply: 'No active mission right now. Start one with "start a mission to…" and I\'ll break it into steps and walk you through them, one at a time.',
      };
    }
    // Bare "done" / "what's next" without a mission is normal conversation —
    // fall through untouched.
    const goal = parseMissionStart(message);
    if (goal) return startMission(goal, profile);
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
    const badStep = created.steps.some((s) => {
      const cond = parseConditionStep(s);
      const body = cond ? cond.body : s;
      if (MISSION_STEP_LITERAL_RX.test(body)) return false;
      return /\b(workflow|routine|mission)\b/.test(body);
    });
    if (badStep) {
      return {
        reply: 'Workflow steps have to be ordinary asks — a verse, a reminder, a calculation, a word of encouragement. A workflow can\'t run other workflows or missions. (The one exception: the read-only step "my next mission step".)',
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
    return {
      reply: `Saved "${created.name}"${replaced} — ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}:\n${stepLines}\n\nSay "run my ${created.name} workflow" and I'll execute every step. Want it on a trigger? Say: when I say good morning, run my ${created.name} workflow.`,
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
    // v27: a daily auto-run has no topic to fill a * slot with.
    if (dailySet.daily && hasSlot(workflows[idx])) {
      return {
        reply: `"${dailySet.name}" has a * slot, so it needs a topic each time — a daily auto-run wouldn't know what to fill in. Run it whenever you like with "run my ${dailySet.name} workflow on <topic>".`,
      };
    }
    const nextList = workflows.map((w, i) => {
      if (i !== idx) return w;
      const next = { ...w };
      if (dailySet.daily) next.daily = true;
      else { delete next.daily; delete next.lastRun; }
      return next;
    });
    return {
      reply: dailySet.daily
        ? `Done — "${dailySet.name}" now runs itself every day, on your first chat of the day. You show up, I handle the routine.`
        : `Okay — "${dailySet.name}" is off the daily schedule. It's still saved; run it anytime with "run my ${dailySet.name} workflow".`,
      profile: { ...profile, workflows: nextList },
    };
  }

  const toRun = parseWorkflowRun(message);
  if (toRun) {
    const wf = workflows.find((w) => w.name === toRun.name);
    if (!wf) {
      return workflows.length
        ? { reply: `I don't have a workflow called "${toRun.name}". Here's what I'm holding:\n${nameList(workflows)}` }
        : { reply: `No workflows saved yet, so I can't run "${toRun.name}". Create it first:\ncreate a workflow called ${toRun.name}: a verse about strength, then list my reminders` };
    }
    // v27: a slotted workflow needs its topic before it can run.
    if (hasSlot(wf) && !toRun.topic) {
      return {
        reply: `"${wf.name}" has a * slot in its steps, so it needs a topic each run. Say it like:\nrun my ${wf.name} workflow on grace`,
      };
    }
    return await runWorkflow(wf, profile, run, toRun.topic);
  }

  // ── Trigger phrases — an exact match runs the whole routine ───────────────
  if (!CRISIS_RX.test(t)) {
    const fired = workflows.find((w) => w.trigger && w.trigger === t);
    if (fired) {
      // v27: a bare trigger phrase carries no topic to fill a * slot with.
      if (hasSlot(fired)) {
        return {
          reply: `That's the trigger for "${fired.name}", but it has a * slot, so it needs a topic. Run it like:\nrun my ${fired.name} workflow on grace`,
        };
      }
      return await runWorkflow(fired, profile, run);
    }

    // v29: open triggers — "study *" fires on "study <anything>", and the
    // remainder becomes the topic that fills every * slot.
    for (const w of workflows) {
      if (!w.trigger?.endsWith(' *')) continue;
      const prefix = w.trigger.slice(0, -1); // keeps the trailing space
      if (!t.startsWith(prefix)) continue;
      const topic = t.slice(prefix.length).trim();
      if (!topic || topic.length > 60 || CRISIS_RX.test(topic)) continue;
      return await runWorkflow(w, profile, run, topic);
    }
  }

  return null;
}

/**
 * v26: run every daily workflow that hasn't run today (SA time) and return a
 * combined report plus the updated profile (lastRun stamped, step side-effects
 * threaded), or null when nothing is due. index.ts appends the report to the
 * first reply of the day's first session — reminders-style surfacing, scaled up.
 */
export async function runDailyWorkflows(
  profile: Profile,
  run: AgentRunner,
  todayISO: string,
): Promise<{ report: string; profile: Profile } | null> {
  // v27: slotted workflows never auto-run — there's no topic to fill the * with.
  const due = (profile.workflows ?? []).filter((w) =>
    w.daily && w.lastRun !== todayISO && !hasSlot(w));
  if (!due.length) return null;

  let prof = profile;
  const reports: string[] = [];
  for (const wf of due) {
    const out = await runWorkflow(wf, prof, run);
    if (out.profile) prof = out.profile;
    reports.push(`— Your daily "${wf.name}" workflow —\n\n${out.reply}`);
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
  if (!mission || mission.nudged === todayISO) return null;
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
