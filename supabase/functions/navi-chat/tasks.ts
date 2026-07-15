// supabase/functions/navi-chat/tasks.ts
//
// NAVI v39 — Task execution on devices (the hands round).
//
// Three device-facing capabilities, all deterministic, all profile-backed
// (Profile.deviceTasks rides the same navi_memory row as everything else —
// no new table, no DDL):
//
//   1. DEVICE TASK QUEUE — "add a task for my laptop: push the repo" queues
//      work for a named device; "show my laptop tasks" / "what's waiting on
//      my phone" reads it back; "done with task 2 on my laptop" ticks one
//      off; "clear my laptop tasks" wipes a device (count read back).
//      NAVI tracks and reports — the user's hands (or the runner) execute.
//
//   2. AUTO TASKS FOR THE RUNNER — "run backup on my pc" queues a task the
//      navi-runner poll script (navi-runner/poll.js, run ON the device) may
//      execute. THE SAFETY CONTRACT: chat only ever queues a NAME. What a
//      name actually executes is defined in the device's LOCAL allowlist
//      config (tasks.config.json), which chat can never write. A name the
//      device doesn't define is refused by the runner, honestly. The runner
//      POLLS — NAVI never pushes (the no-server-push anti-goal stands).
//      "any results from my pc" reads the runner's receipts and clears them
//      (v41: unread receipts also open the first reply of a session, through
//      deviceReceipts below — same read-once-and-clear contract).
//
//   3. CALENDAR EXPORT — "export my reminders as a calendar" builds an
//      RFC-5545 ICS block from everything dated NAVI holds (dated reminders,
//      life events, booked sends) for the device's own calendar app to
//      import. Read-only, pure text, zero network.
//
// Contracts: crisis language is never a task; every regex is anchored to the
// tidied message; anonymous users get the sign-in prompt (isTasksAsk);
// deviceTasks is capped and the cap is refused honestly, never evicted.

import type { DeviceTask, Profile } from './memory.ts';

const MAX_DEVICE_TASKS = 12; // across all devices — small by design

// Same guard as agent.ts/memory.ts: crisis language is a human emergency.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

// Same address-tidy as agent.ts.
function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A device is a short name the user picks: phone, laptop, pc, work laptop…
const DEV_CHARS = "[a-z][a-z0-9 _'-]{0,19}";

// ── Parsing ─────────────────────────────────────────────────────────────────

const ADD_RX = new RegExp(
  `^(?:please )?(?:add|queue|put|note) (?:a |another )?(?:device )?task (?:for|on) my (${DEV_CHARS}?) ?[:—-] ?(.{3,120})$`,
);

const LIST_ONE_RX = new RegExp(
  `^(?:please )?(?:(?:show|list|check)(?: me)?(?: my| the)? (${DEV_CHARS}?) tasks|what(?:'s| is) (?:waiting|queued) (?:on|for) my (${DEV_CHARS}))$`,
);
const LIST_ALL_RX =
  /^(?:please )?(?:(?:show|list|check)(?: me)?(?: my| the)? device tasks|what(?:'s| is) (?:waiting|queued) on my devices)$/;

const DONE_RX = new RegExp(
  `^(?:please )?(?:done with|tick off|finish|complete|mark) task (\\d{1,2}) on my (${DEV_CHARS})(?: as done)?$|^task (\\d{1,2}) on my (${DEV_CHARS}) is done$`,
);

const CLEAR_RX = new RegExp(
  `^(?:please )?clear my (${DEV_CHARS}?) tasks$`,
);

// Auto tasks — a NAME the runner may execute, never a command. Conservative
// on purpose: "run for your life on my street" must stay conversation, so a
// name can't open with a preposition/article and a figure-of-speech "device"
// is refused (anchored parsing rule: a false negative is a missed feature, a
// false positive corrupts a conversation).
const AUTO_RX = new RegExp(
  `^(?:please )?(?:run|execute) ["']?([a-z][a-z0-9 _-]{1,39}?)["']? on my (${DEV_CHARS})$`,
);
const AUTO_NAME_STOP_RX = /^(?:for|to|a|an|the|in|on|at|with|from|by|up|away|around|off|out|over|into|through)\b/;
const AUTO_DEV_STOP_RX = /^(?:own|way|feet|street|block|behalf|mind|life|watch)$/;

/** The {name, device} of a well-formed auto-task ask, or null. */
function parseAuto(t: string): { name: string; device: string } | null {
  const m = t.match(AUTO_RX);
  if (!m) return null;
  const name = m[1].trim();
  const device = m[2].trim();
  if (CRISIS_RX.test(name) || CRISIS_RX.test(device)) return null;
  if (AUTO_NAME_STOP_RX.test(name) || AUTO_DEV_STOP_RX.test(device)) return null;
  return { name, device };
}

const RESULTS_RX = new RegExp(
  `^(?:please )?(?:any results (?:from|on) my (${DEV_CHARS})|check (?:the )?results (?:from|on) my (${DEV_CHARS}))$`,
);

// Calendar export — the device's native calendar consumes what NAVI holds.
const EXPORT_RX =
  /^(?:please )?(?:export|download|give me|make me|generate)(?: me)?(?: my| the| a)? (?:(?:reminders?|schedule|events) (?:as|to|into) (?:a |an )?(?:calendar|ics)(?: file)?|calendar(?: file)?(?: (?:of|for|with) my (?:reminders?|schedule|events))?|ics(?: file)?)$/;

/** True when the message is a device-tasks or calendar-export ask. */
export function isTasksAsk(message: string): boolean {
  const t = tidy(message);
  if (!t || t.length > 160) return false;
  return ADD_RX.test(t) || LIST_ONE_RX.test(t) || LIST_ALL_RX.test(t) ||
    DONE_RX.test(t) || CLEAR_RX.test(t) || parseAuto(t) !== null ||
    RESULTS_RX.test(t) || EXPORT_RX.test(t);
}

const SIGN_IN_REPLY =
  'Device tasks live in your permanent memory, so I can only hold them once you\'re signed in. Sign in and tell me again.';

// ── Formatting ──────────────────────────────────────────────────────────────

function taskLine(t: DeviceTask, n: number): string {
  const auto = t.auto ? (t.result ? ` — finished: ${t.result}` : ' (auto — waiting for the runner)') : '';
  return `${n}. ${t.text}${auto}`;
}

function deviceList(tasks: DeviceTask[], device: string): string {
  const mine = tasks.filter((t) => t.device === device);
  if (!mine.length) return `Nothing waiting on your ${device}.`;
  return `Waiting on your ${device} (${mine.length}):\n${mine.map((t, i) => taskLine(t, i + 1)).join('\n')}\n\nTick one off with "done with task N on my ${device}".`;
}

// ── The ICS builder ─────────────────────────────────────────────────────────

// RFC 5545 text escaping — commas, semicolons, backslashes, newlines.
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

function icsDate(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, '');
}

function icsStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Everything dated NAVI holds, as one importable VCALENDAR — dated reminders
 * and life events as all-day events, booked sends at their exact moment.
 * Returns null when there's nothing dated to export.
 */
export function buildIcs(profile: Profile, nowISO = new Date().toISOString()): string | null {
  const stamp = icsStamp(nowISO);
  const events: string[] = [];
  let n = 0;
  const push = (uid: string, dt: string, summary: string) => {
    events.push([
      'BEGIN:VEVENT',
      `UID:navi-${uid}-${++n}@navisociety.github.io`,
      `DTSTAMP:${stamp}`,
      dt,
      `SUMMARY:${icsEscape(summary)}`,
      'END:VEVENT',
    ].join('\n'));
  };
  for (const r of profile.reminders ?? []) {
    if (r.due) push('reminder', `DTSTART;VALUE=DATE:${icsDate(r.due)}`, r.text);
  }
  for (const e of profile.events ?? []) {
    push('event', `DTSTART;VALUE=DATE:${icsDate(e.date)}`, e.text);
  }
  for (const s of profile.mailScheduled ?? []) {
    push('send', `DTSTART:${icsStamp(s.sendAt)}`, `NAVI sends "${s.subject}" to ${s.to}`);
  }
  if (!events.length) return null;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NAVI//navisociety.github.io//EN',
    events.join('\n'),
    'END:VCALENDAR',
  ].join('\n');
}

// ── v41: session-start receipts ─────────────────────────────────────────────

/**
 * v41: unread runner receipts, surfaced on the first reply of a session
 * (index.ts appends this after due sends, inside the crisis guard). Profile-
 * only and free: the runner already wrote its results onto the deviceTasks
 * row NAVI just loaded — no new network read. Same read-once contract as
 * "any results from my pc": surfacing the receipts clears them. Returns null
 * when nothing is waiting to be read.
 */
export function deviceReceipts(profile: Profile): { note: string; profile: Profile } | null {
  const tasks = profile.deviceTasks ?? [];
  const finished = tasks.filter((x) => x.auto && x.result);
  if (!finished.length) return null;
  const devices = [...new Set(finished.map((x) => x.device))];
  const blocks = devices.map((d) => {
    const mine = finished.filter((x) => x.device === d);
    return `From the runner on your ${d}:\n${mine.map((x, i) => `${i + 1}. ${x.text} — ${x.result}`).join('\n')}`;
  });
  return {
    note: `${blocks.join('\n\n')}\n\nReceipts read and cleared — queue more anytime with "run <name> on my <device>".`,
    profile: { ...profile, deviceTasks: tasks.filter((x) => !finished.includes(x)) },
  };
}

// ── The layer ───────────────────────────────────────────────────────────────

/**
 * The device-tasks layer: queue/read/tick-off/clear per device, auto tasks
 * for the runner, runner receipts, and the calendar export. Pure profile —
 * no network, so unlike the bridges this try* is synchronous. Returns null
 * when the message isn't its business.
 */
export function tryTasks(
  message: string,
  email: string,
  profile: Profile,
): { reply: string; profile?: Profile } | null {
  const t = tidy(message);
  if (!t || t.length > 160) return null;
  if (!isTasksAsk(message)) return null;
  if (!email) return { reply: SIGN_IN_REPLY };
  const tasks = profile.deviceTasks ?? [];

  let m = t.match(ADD_RX);
  if (m) {
    const device = m[1].trim();
    const text = m[2].trim();
    if (CRISIS_RX.test(text) || CRISIS_RX.test(device)) return null;
    if (tasks.length >= MAX_DEVICE_TASKS) {
      return { reply: `The device queue is full (${MAX_DEVICE_TASKS} tasks) — tick some off or "clear my ${device} tasks" first. Small queues get done; long ones get ignored.` };
    }
    const next = [...tasks, { device, text, created: new Date().toISOString() }];
    const count = next.filter((x) => x.device === device).length;
    return {
      reply: `Queued for your ${device} — "${text}". That's ${count} waiting there; ask "what's waiting on my ${device}" when you're on it.`,
      profile: { ...profile, deviceTasks: next },
    };
  }

  const auto = parseAuto(t);
  if (auto) {
    const { name, device } = auto;
    if (tasks.length >= MAX_DEVICE_TASKS) {
      return { reply: `The device queue is full (${MAX_DEVICE_TASKS} tasks) — clear some receipts or tasks first.` };
    }
    if (tasks.some((x) => x.device === device && x.auto && !x.result && x.text === name)) {
      return { reply: `"${name}" is already queued for the runner on your ${device} — it'll run on the runner's next poll.` };
    }
    const next = [...tasks, { device, text: name, created: new Date().toISOString(), auto: true }];
    return {
      reply: `Queued "${name}" for the runner on your ${device}. It executes on the runner's next poll — and only if "${name}" is defined in that device's own allowlist (tasks.config.json); I only ever send the name, never a command. Ask "any results from my ${device}" later.`,
      profile: { ...profile, deviceTasks: next },
    };
  }

  m = t.match(DONE_RX);
  if (m) {
    const num = parseInt(m[1] ?? m[3], 10);
    const device = (m[2] ?? m[4]).trim();
    const mine = tasks.filter((x) => x.device === device);
    if (!mine.length) return { reply: `Nothing is queued on your ${device}, so there's nothing to tick off.` };
    if (num < 1 || num > mine.length) {
      return { reply: `Your ${device} has ${mine.length} task${mine.length === 1 ? '' : 's'}, so there's no task ${num}. Here's the list:\n${mine.map((x, i) => taskLine(x, i + 1)).join('\n')}` };
    }
    const target = mine[num - 1];
    const next = tasks.filter((x) => x !== target);
    const left = next.filter((x) => x.device === device).length;
    return {
      reply: `Done — "${target.text}" is off your ${device} list. ${left ? `${left} still waiting there.` : `That clears your ${device}.`} Executed, not just planned — that's the difference.`,
      profile: { ...profile, deviceTasks: next },
    };
  }

  m = t.match(RESULTS_RX);
  if (m) {
    const device = (m[1] ?? m[2]).trim();
    const finished = tasks.filter((x) => x.device === device && x.auto && x.result);
    if (!finished.length) {
      const waiting = tasks.filter((x) => x.device === device && x.auto && !x.result).length;
      return { reply: waiting
        ? `No results from your ${device} yet — ${waiting} auto task${waiting === 1 ? ' is' : 's are'} still waiting for the runner's next poll.`
        : `No runner results from your ${device}, and nothing is queued for it.` };
    }
    const next = tasks.filter((x) => !finished.includes(x));
    return {
      reply: `From the runner on your ${device}:\n${finished.map((x, i) => `${i + 1}. ${x.text} — ${x.result}`).join('\n')}\n\nReceipts read and cleared.`,
      profile: { ...profile, deviceTasks: next },
    };
  }

  m = t.match(CLEAR_RX);
  if (m) {
    const device = m[1].trim();
    if (device === 'device') {
      if (!tasks.length) return { reply: 'No device tasks anywhere — the slate is already clean.' };
      return {
        reply: `Cleared all ${tasks.length} device task${tasks.length === 1 ? '' : 's'} across your devices. Clean slate.`,
        profile: { ...profile, deviceTasks: [] },
      };
    }
    const mine = tasks.filter((x) => x.device === device);
    if (!mine.length) return { reply: `Nothing is queued on your ${device} — already clean.` };
    return {
      reply: `Cleared ${mine.length} task${mine.length === 1 ? '' : 's'} off your ${device}.`,
      profile: { ...profile, deviceTasks: tasks.filter((x) => x.device !== device) },
    };
  }

  m = t.match(LIST_ONE_RX);
  if (m) {
    const device = (m[1] ?? m[2]).trim();
    // "show my device tasks" belongs to the all-devices list below.
    if (device !== 'device') return { reply: deviceList(tasks, device) };
  }

  if (LIST_ALL_RX.test(t) || (m && (m[1] ?? m[2]).trim() === 'device')) {
    if (!tasks.length) return { reply: 'No device tasks anywhere. Queue one with "add a task for my laptop: push the repo".' };
    const devices = [...new Set(tasks.map((x) => x.device))];
    return {
      reply: devices.map((d) => deviceList(tasks, d)).join('\n\n'),
    };
  }

  if (EXPORT_RX.test(t)) {
    const ics = buildIcs(profile);
    if (!ics) {
      return { reply: 'Nothing dated to export yet — dated reminders, life events, and booked sends are what fill the calendar. Add one and ask again.' };
    }
    return {
      reply: `Here's your calendar. Copy everything from BEGIN:VCALENDAR to END:VCALENDAR into a file named navi.ics and open it — your calendar app will import the events.\n\n${ics}`,
    };
  }

  return null;
}
