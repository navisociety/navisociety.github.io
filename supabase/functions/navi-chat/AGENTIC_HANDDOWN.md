# NAVI Agentic & Execution Capabilities — Hand-Down File

**For any future Claude session (or developer) continuing this work.**
Last updated: 2026-07-16, at **v48** (the anthology round).

Read this before touching the agentic layer. It tells you what exists, how it's
wired, the rules that must never break, how to ship safely, and where to go next.

---

## 1. What NAVI is (in one paragraph)

NAVI is Prophet Dian's own LLM — a fully deterministic, zero-external-LLM brain
living in the `navi-chat` Supabase edge function (this directory). The free tier
NEVER calls Anthropic/OpenAI/anything (hard rule: Anthropic key is allowed ONLY
in `navi-mini`/`navi-max`). Everything NAVI does — understanding, memory,
skills, agency — is TypeScript: regex-anchored command parsing, fuzzy retrieval
over ~329 knowledge nodes, deterministic engines, and a permanent per-user
memory row (`navi_memory` table, keyed by email). The site is
https://navisociety.github.io; the function is
`https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-chat` (public,
`verify_jwt:false`, email comes in the request body).

## 2. The execution stack — how a message flows (index.ts order matters!)

```
rawMessage
  → normalizeMessage()        v24  typo fix (normalize.ts)
  → expandFollowUp()          v24  "and of 500?" → full question (followup.ts)
  → loadStoredProfile(email)  v18  permanent memory row (store.ts)
  → tryAgent()                v25-27  workflows/missions — MUST run before the
                                   multi-intent split (creation asks contain
                                   "then" and would be torn apart) (agent.ts)
  → tryBriefing()             v27  "brief me" status report — AFTER tryAgent so
                                   "mission status" keeps its answer (brief.ts)
  → tryReview()               v28  "review my week" — deltas vs. the snapshot,
                                   then re-stamps it; saves immediately (review.ts)
  → splitIntents()            v24  multi-intent execution (execute.ts)
  → reminders/habits/memory/engines/nodes/web fallback ...
  → session-start appends     (first message of a session, signed-in, never on
                               a crisis reply): event follow-ups → due
                               reminders → returning greeting → daily
                               workflows (runDailyWorkflows) → due booked
                               sends (runDueSends, v33 — the emptied
                               schedule is mirrored onto `stored` by hand;
                               Object.assign can't unset a key) → mission
                               nudge (missionNudge) → reminder escalation
                               offer (reminderEscalation, v30) →
                               weekly-review offer (reviewOffer)  ← v27-v33
  → end-of-request save       mergeProfiles + mood journal + topics → upsert
```

v30 additions to the single-ask path (and answerIntent, so workflow steps get
them too): tryEscalate right after tryReminder; tryVision right after the
habit block (main path) / after the signed-in memory block (answerIntent);
tryGapsReport before detectTeach (main path only, owner-gated inside).

v31 additions: tryChats right after tryVision in BOTH the main path and
answerIntent (the pending-cleanup stamp rides the returned profile, saved
immediately on the main path); tryGapsManage BEFORE detectForget on the main
path — "clear my learning list" / "forget gap 2" are gaps commands and the
forget layer would otherwise swallow them (a local smoke run caught exactly
this). Workflow show/step-edit live inside tryAgent, parsed BEFORE workflow
creation/deletion — CREATE_NAMED_FIRST_RX would read "add a step to my study
workflow: x" as a workflow named "step to my study", and DELETE_RX would read
"remove step 2 from my study workflow" as one named "step 2 from my study".

v32 additions: tryMail right after tryChats in BOTH the main path and
answerIntent — AFTER tryChats on purpose, so a bare "yes" with two pending
offers is always consumed by the chat cleanup first (deterministic order).
Its send stamp (Profile.mailSend) rides the returned profile, saved
immediately on the main path. Step-move and rename live inside tryAgent in
the same before-creation/deletion cluster as the v31 editing commands.

v33 additions: everything rides the EXISTING tryMail wiring (no new pipeline
position) — inbox reads, replies, booking offers, schedule list/cancel are all
new branches inside mail.ts, still AFTER tryChats so a pending chat cleanup
outranks any mail stamp on a bare "yes". The one new wiring point is
runDueSends in the session-start block, right after runDailyWorkflows.

v34 additions: the /email shorthand and inbox digests are new branches inside
mail.ts (no new pipeline position). ONE guard was added at splitIntents:
`isMailSlashAsk(message)` skips the multi-intent split entirely for messages
opening "/email/" — the slash body is free text, so an "and"/"then" inside it
is body, never a second ask (the golden rule applied). parseMailSlash is the
ONE mail parser that reads the RAW message (never tidy()) so the body keeps
its case; the recipient alone is lowercased. A malformed slash ask
("/email/me/hi" — body missing) is TAUGHT, never dropped into conversation.
The locked client (App.tsx) got its sanctioned /email update the same round:
the slash form is parsed client-side for literal addresses (Dian asked for
this format explicitly — the one UI exception since the lock), and the
edge-side parser covers "me" + workflow steps.

v35 additions: THE ASYNC CONDITION SEAM. evalCondition (agent.ts) is now
async: `evalCondition(cond, profile, todayISO, email?, sources?)` returning
`ConditionVerdict = boolean | null | 'unreachable' | 'not-connected'`.
Sources (`ConditionSources`: visionCount from vision.ts, inboxUnread from
mail.ts) are injected — tests stub them, production defaults to the real
board/Gmail — and fetched LAZILY, only when a world phrase matched, so
profile conditions cost nothing new. runWorkflow/tryAgent/runDailyWorkflows
all grew optional trailing `email`/`sources` params (index.ts's
runDailyWorkflows call now passes email). The two can't-check verdicts skip
the step with an honest note (unreachable → "played it safe";
not-connected → points at the Email tool's Connect button) — never a guess,
and never mistaken for the teach-the-vocabulary null.

v36 additions: all inside agent.ts, no new wiring. parseWorkflowPreview +
previewWorkflow live in the v31 inspection cluster of tryAgent (parsed AFTER
show, BEFORE step-edit — the verbs never collide with run/show/delete).
The dry-run returns reply-only (never a profile — it must not change
anything); slotted workflows demand a topic exactly like a real run;
isAgentAsk includes preview so anonymous asks get the sign-in prompt. The
booked-send condition pair reads Profile.mailScheduled synchronously — no
source, no network.

v37 additions: no new wiring at all. MISSION_PREVIEW_RX + missionPreview
(agent.ts) sit inside the existing mission cluster of tryAgent — parsed right
after MISSION_STATUS/NEXT in the active branch, answered honestly in the
no-mission branch, covered by isAgentAsk for the anonymous sign-in prompt.
The workflow preview verbs demand the word "workflow"/"routine", so
"preview my mission" can never collide with them (and "preview my mission
workflow" is still a WORKFLOW ask — the mission regex is $-anchored).
The chats-age condition pair rides the v35 seam: ConditionSources grew a
THIRD source, `chatsOlderThan(email, days)` (chats.ts chatsIdleCount — a
pure count over listSessions; a condition can never delete). Any test that
stubs ConditionSources must stub all three sources (stubSources in _test.ts
took a third optional param).

v39 additions: ONE new pipeline position — tryTasks (tasks.ts) sits right
after tryAgent and BEFORE tryBriefing/splitIntents on the main path (a task
body may carry "and"/"then" — the golden rule), and right after tryMail in
answerIntent (workflow steps can queue device tasks; the topic slot fills the
text). tryBriefing is now ASYNC (the #24 world line) — its index.ts call
gained an await. runWorkflow gained a trailing `via` param and now ALWAYS
returns a profile (the workflowLog receipt) — anything asserting "no profile
change" after a run must assert on the mission/steps instead. navi-runner/
is local plumbing like navi-brain/ (never bundled, never CI).

v40 additions: no new pipeline position — the /write slash command and the
new creative kinds are all branches inside compose.ts, and tryCompose was
ALREADY wired in both paths (main path engine block + answerIntent), so
workflow steps get "/write a poem about *" for free. ONE guard was added at
splitIntents: `isWriteSlashAsk(message)` joins isMailSlashAsk — a writing
prompt is free text, an "and"/"then" inside it is prompt, never a second ask
(the v34 golden rule again). A malformed "/write" is TAUGHT (WRITE_USAGE),
never dropped into conversation; a crisis prompt steps aside (compose.ts now
carries its own CRISIS_RX) so the crisis nodes own the message. The /write
help node lives in index.ts NODES with its navi-model.ts mirror (the
sanctioned v34 pattern — the mirror is the offline fallback, not UI).

v48 additions: NO new wiring at all — everything lives inside compose.ts
(plus the /write help-node text refresh in index.ts NODES and its
navi-model.ts mirror, the sanctioned v34 pattern). tryCompose was already in
both paths and isWriteSlashAsk already guards splitIntents, so the new kinds,
counts, and assembled songs ride everywhere (workflow steps included) for
free. ONE invariant fix while in the file: parseCompose (the CONVERSATIONAL
path) now carries the same CRISIS_RX step-aside the v40 slash path had —
"write me a story about how i want to die" spoken plainly used to compose;
it now falls through to the crisis nodes (the v44 remind.ts lesson applied).

v42 additions: no new pipeline position — the run-time send confirm lives
entirely inside tryAgent/runWorkflow (agent.ts) plus ONE mail.ts export
(isSendStep). THE PRECEDENCE LAW GREW A LEVEL: tryAgent is the pipeline's
first try*, so a pending Profile.runSend consumes a bare "yes"/"no" before
tryChats' cleanup, which still outranks tryMail's send — one offer per bare
yes, deterministic, three levels deep. The confirmed re-run enters
runWorkflow with allowSend=true (a trailing param, default false); each
send step drafts through answerIntent, then its mailSend stamp is consumed
by calling tryMail('yes', …) programmatically — the same yes-machinery a
spoken confirm uses — and ANY stamp still standing afterwards is cleared
(an unreachable shelf keeps mail.ts's retry stamp; left dangling, a later
unrelated bare "yes" would fire it). runWorkflow also now returns optional
`counts` — runDailyWorkflows' #27 headline reads it, nobody else needs to.

v43 additions: no new pipeline position — everything rides the existing
tryMail wiring plus understand.ts. #21: parseMailSlash consumes a TRAILING
/send segment (4+ parts only, so a 3-part body that IS the word "send" stays
a draft) and sets wantSend — the existing draftAsk branch stamps the v32
offer; isSendStep covers the slash form so the v42 run-time confirm gates it
in workflows; the splitIntents guard needed nothing (it keys on the opening).
#22: parseMailDigestOne → one searchInbox hit → getMailBody (format=full,
first text/plain part, base64url-decoded) → understand.ts cleanEmailText →
summarize; HTML-only or unreachable bodies fall back to the snippet with an
honest note. THE SECOND SANCTIONED App.tsx TOUCH: the v34 email intercept now
STEPS ASIDE when a slash ask ends /send (only the server can stamp the
confirm offer) — same rule mirrored client-side, 4+ parts + final "send".
Brain: trySummarize checks the SHAPED commands (one-sentence / key-points)
BEFORE the plain one, both reusing applyRewrite; cleanEmailText is v43's one
new understand.ts export.

v44 additions: no new pipeline position — everything lives inside remind.ts
plus two agent.ts touches. ONE call-site change in index.ts: addDueReminders
now returns `{ response, reminders? }` — a recurring reminder that just
surfaced rolls its `due` to the next occurrence, and the rolled list is set
onto `stored.reminders` so it rides the end-of-request save (a direct
assignment, no Object.assign ambiguity: the list is always an array).
addDueReminders also now refuses to wrap a crisis reply (invariant #1 —
it sat OUTSIDE the session-start crisis guard since v22; the check moved
inside the function). And remind.ts finally carries CRISIS_RX on its add
path — a v22 gap: crisis phrasing was storable as a reminder text. The
recurring cadence mirrors the workflow schedule laws EXACTLY (weekly needs
"every"/"each", monthly is 1-28 with an honest refusal, bare "every month"
means the 1st and says so); no bare "daily" ("the daily standup" is a topic).

v47 additions: NO new wiring at all — everything lives in agent.ts (plus two
memory.ts type touches: WorkflowRun += topic/steps with the new StepOutcome
type, Mission += deadline/deadlineNudged). runWorkflow collects a StepOutcome
per step (ran/skipped/held/failed + the short why) and stamps it on the
receipt with the topic; "what did my last run do" (and the named form) is a
new read branch beside RAN_TODAY inside tryAgent; the re-run handler sits
immediately BEFORE parseWorkflowRun (its "again"/"rerun" verbs can't collide
with the plain run regexes, which end at "workflow"); the mission deadline
commands sit in the active-mission cluster right after MISSION_PREVIEW and
before MISSION_DONE (whose forms are all past-tense whole matches, so
"finish this mission by friday" never was its ask). The deadline nudge is a
new FIRST branch inside missionNudge itself — index.ts's existing call
carries it, no session-start change; its own deadlineNudged stamp means a
mission that moved yesterday still hears its deadline. VIA_LABEL was hoisted
from the RAN_TODAY branch to module scope (the read-back shares it).

v46 additions: no new pipeline position — everything lives in agent.ts (plus
two memory.ts type touches: Workflow.paused, WorkflowRun.via += 'nested').
THE STEP LAW CHANGED: the creation meta rule now ALLOWS the exact form
"run my <name> workflow [on <topic>]" as a step (stepProblem/bodyOf), so one
workflow can chain another — depth 1, enforced at run time (a nested run may
not nest again), self-reference refused at creation AND at run. THE SEND LAW
GREW EYES: sendStepsOf(wf, all) expands nested references one level, so a
workflow that chains into a sending workflow is offered/held exactly like one
that sends itself — every call site passes the live workflows list. A nested
run stamps its own receipt (via 'nested') and threads profile changes back.
"otherwise: <step>" is the else-branch of the conditional step immediately
before it — fires ONLY on a clean false (can't-check verdicts quiet BOTH
branches: an else on a guess is a guess), orphans teach; runWorkflow and
previewWorkflow both carry the same prevCond state machine. Pause/resume:
Workflow.paused (true | wake-date ISO string, isPaused() computes — expired
pauses just stop holding, no cleanup pass); ALL FOUR doors respect it
(manual runs, both trigger forms, the v42 confirmed re-run, and the
runDailyWorkflows due filter — schedules skip silently, spoken asks answer
honestly pointing at resume). agent.ts now imports remind.ts parseWhen for
"pause … until friday" (no cycle: remind.ts only imports memory/skills).

v45 additions: ONE new pipeline position + ONE new session-start position.
tryDates (dates.ts, NEW — the special-dates book) sits right after tryEscalate
in BOTH the main path and answerIntent — BEFORE the forget layer on purpose,
so "forget my mom's birthday" is a dates command; the bare own-birthday forms
("my birthday is…", "when is my birthday", "forget my birthday") return null
inside tryDates and stay memory.ts's field. addDateHeadsUps sits right after
addEventFollowUps in the session-start block (it checks crisis INTERNALLY,
like addDueReminders — both run before the !isCrisisReply guard); the `noted`
stamps ride `stored.dates` into the end-of-request save. Yearly reminders are
pure remind.ts: `Every` grew a {month, day} object form (parseEvery consumes
the date AND "every year" in either order — parseWhen would otherwise eat the
date and leave a one-off), nextOccurrence rolls a whole year, 29 february and
31 april are refused honestly, bare "every year" teaches (needsDate). The
event-proximity + special-day conditions are sync agent.ts reads over
Profile.events / Profile.dates — no new source on the seam.

v41 additions: ONE new session-start position — deviceReceipts (tasks.ts)
sits right after runDueSends inside the crisis guard. It is profile-only and
FREE (the runner already wrote its results onto the deviceTasks row the
request loaded — no new network read); surfacing the receipts clears them,
the same read-once contract as "any results from my pc", and the emptied
list is an array (never an unset key), so Object.assign carries it into the
final save with no mirroring needed. Everything else is agent.ts branches:
monthly workflows ride the existing runDailyWorkflows call (the due filter
now also admits `Workflow.monthDay === today's day-of-month`), and the
device-task conditions are sync evalCondition reads over Profile.deviceTasks
(no new source on the seam).

v38 additions: no new wiring at all, and (unlike v35-v37) not even a new
source — everything is sync and free. Weekly workflows ride the EXISTING
runDailyWorkflows call (the due filter now also admits `Workflow.day ===
today's weekday`); the WEEKLY_ON/OFF regexes live beside DAILY_ON/OFF and
parseDailySet grew an optional `day` field (so isAgentAsk covers the anonymous
sign-in prompt for free). The calendar conditions answer from todayISO alone;
the clock conditions read skills.ts `hourInTZ('Africa/Johannesburg')` through
an optional trailing `hourNow` param on evalCondition (tests pin it, callers
omit it). ONE parsing rule mattered: weekly-ON demands "every"/"each" — never
"on <day>", because "run my study workflow on friday" must stay a topic run.

**Golden rule of wiring:** anything agentic that consumes multi-part phrasing
goes BEFORE `splitIntents`; anything that appends passive reports goes in the
session-start block inside the `!isCrisisReply(response)` guard; anything that
mutates the profile must either return it from its `try*` (early-return paths
save immediately) or mutate `stored` via `Object.assign` (session-start paths
ride the final save — `mergeProfiles` spreads the base, so mission/workflow
changes survive).

## 3. The agentic layer today (what exists, where)

### agent.ts — workflows & missions (v25→v47) · mail.ts (v32→v43) · tasks.ts (v39→v41) · compose.ts (v21→v48) · understand.ts (v21→v43) · remind.ts (v22→v45) · dates.ts (v45, NEW)

**v48 — the anthology round** (all compose.ts + the help-node refresh — built
under Dian's explicit "enhance NAVI creative writing / the /write feature"
direction, 2026-07-16; deterministic, zero-I/O, zero external LLM as always):
- **Assembled songs**: songs now build like v40's stories — verse-1 / chorus /
  verse-2 / bridge banks (4 × 4 × 4 × 4 = 256 songs), the chorus reprised at
  the end ("(Chorus — one more time)") so the sheet reads complete. All parts
  first-person; the topic lives in verse 1 and the chorus so any assembly
  reads as one song. BANKS.song is now [] like story — never looked up.
- **New kinds**: congrats (congratulations messages), comfort (sympathy /
  condolence notes — one variant faith-forward, recipient-shaped), and rap
  (topic-woven verses). KIND_RX ORDER MATTERS: rap sits BEFORE song so a
  "rap song" is a rap. Condolence asks that carry actual crisis words
  (die/dying/death) still step aside to the crisis nodes — by design;
  "who lost her husband" phrasings compose fine.
- **Multi-piece asks**: "write me 3 captions about the gym" / "/write 4
  quotes about discipline" — a leading count (digits or two…six, closed
  vocabulary, ≥2) on the SHORT kinds (caption, quote, affirmation — the
  MULTI_KINDS set) returns numbered DISTINCT variants, clamped honestly to
  the bank size with a "whole shelf" note. Long kinds with a count compose
  one and say so ("I do stories one at a time"). Deepened for this: captions
  3→6, affirmations 3→6, quotes 5→6.
- **Letters sign with the stored name**: the {sender} slot (profile.name,
  'me' when anonymous) replaced the hardcoded "me" closings; fill() grew a
  sender param.
- **The conversational crisis guard** (invariant #1): parseCompose now tests
  CRISIS_RX on the whole message and returns null — verified live: the SADAG
  line answers instead of a composed story.

**v47 — the chronicle round** (all agent.ts + two memory.ts types — the three
post-v46 rungs the hand-down named, none needing Dian; the agentic layer
learns to remember what it did and to commit to WHEN; all sync and free):
- **Per-step run receipts**: every real run's WorkflowRun receipt now carries
  `topic` and `steps` (StepOutcome: clipped step text ≤60 chars + 'ran' |
  'skipped' | 'held' | 'failed' + the short honest why). "what did my last
  run do" / "how did my last run go" / "show my last run" reads the newest
  receipt back numbered; the NAMED form ("what did my last study run do")
  finds that workflow's newest. Pre-v47 receipts (no steps) answer honestly
  ("predates per-step receipts"); an empty log too. Pure read, never a
  profile change. The v36 dry-run still never stamps anything.
- **The re-run form**: "run my study workflow again" / "rerun my study
  workflow" / bare "run that again" replays the newest matching receipt —
  same workflow, same topic (the receipt's `topic`, echoed out loud). ALL the
  fresh-run gates hold: pause answers honestly, a * slot without a recorded
  topic refuses and teaches the topic form, and the v42 send confirm offers
  instead of running (the replayed topic rides the runSend stamp). A named
  re-run with no receipt and no slot just runs fresh — that's the honest
  "again". A vanished workflow answers honestly.
- **Mission deadlines**: "finish this mission by friday" / "set my mission
  deadline to …" / "my mission is due on …" commits the ACTIVE mission to a
  date (remind.ts parseWhen vocabulary — unknown phrasing teaches, the past
  refuses, today is allowed). "mission status" adds a countdown line
  (deadlineCountdown: due TODAY / due tomorrow / N days left / N days past);
  "when is my mission due" answers alone; "clear my mission deadline" lets
  go; completing the mission names a beaten, met, or missed deadline on the
  way out. The session-start nudge (missionNudge, same index.ts wiring)
  speaks at 2 days out / due / overdue — once per SA day via the separate
  deadlineNudged stamp, OUTRANKING the 3-day idle rule. Conditions: "when my
  mission is due soon:" (within 3 days incl. today) / "when my mission is
  overdue:" + negations — sync, free, honest on no-mission/no-deadline
  (nothing is due; "isn't overdue" is true).

**v46 — the orchestration round** (all agent.ts + two memory.ts types — the
workflow line learns flow control, self-control, and composition; built under
Dian's explicit "focus on agentic features" direction, all sync and free):
- **Nested workflows** (composition): a step may be exactly "run my <name>
  workflow [on <topic>]" — the whole saved routine runs in place, ONE level
  deep. "run my study workflow on *" passes the outer topic through. Depth,
  self-reference, a vanished inner, a paused inner, and an unfilled slot are
  all skipped honestly mid-run; creation refuses self-reference up front.
  Both runs leave receipts (the inner's via is 'nested'). THE SEND LAW HOLDS:
  the v42 gate expands nested references, so chaining into a sender is
  offered/held exactly like sending yourself.
- **"otherwise:" steps** (flow control): the else-branch of the conditional
  step right before it — fires only on a CLEAN false; unreachable /
  not-connected / unknown-vocabulary verdicts quiet both branches (never act
  on a guess); an orphaned otherwise teaches. Previews walk the same state
  machine and show which branch fires right now.
- **Pause/resume** (self-control): "pause my morning workflow" (indefinite) /
  "… until friday" / "… for a week" (parseWhen vocabulary, unknown phrasing
  teaches, today/past refused) — schedule, triggers, manual runs, and the
  confirmed re-run all sleep; a dated pause wakes on the day by itself;
  "resume/unpause" wakes it early. List and show name the pause.

**v45 — the almanac round** (dates.ts NEW + remind.ts + agent.ts conditions —
the YEARLY cadence, the one rhythm v44 left out; built under Dian's standing
"keep developing NAVI" direction, all sync and free, no new sources, no DDL):
- **The special-dates book** (dates.ts): "my mom's birthday is on 3 august" /
  "our wedding anniversary is 20 june" held YEARLY on `Profile.dates` (cap 8,
  `SpecialDate = { what, month, day, noted? }`). The user's OWN birthday stays
  memory.ts's field — the book is for everyone else's; life.ts still bans
  birthdays, so nothing collides. "when is my mom's birthday" answers with a
  live countdown; "what special dates do i have" lists soonest-first; "forget
  my mom's birthday" drops one; "clear my special dates" wipes. Impossible
  dates (29 february, 31 april) are refused honestly. Session-start opens with
  a heads-up on the day itself AND the day before — one note per day per date
  (the `noted` stamp), and a yearly date is never released: next year it
  speaks again. Crisis-guarded add, sign-in prompt via isDatesAsk, "my mom's
  birthday is always chaotic" stays conversation (no clean date → null).
- **Yearly reminders** (remind.ts): "remind me every year on 3 august to wish
  mom happy birthday" — `Reminder.every` grew a {month, day} form; the v44
  roll-on-surface contract holds (done rolls a whole year, only delete stops
  it); cadenceLabel reads "every year on 3 august". Bare "every year" teaches.
- **Event-proximity + special-day conditions** (agent.ts): "when i have an
  event today / this week:" (+ negations) over Profile.events, and "when it's
  a special day:" (+ negation) over Profile.dates — sync, free, they light up
  in v36 dry-run previews automatically. KNOWN_CONDITIONS + HELP_TEXT updated.

**v44 — the cadence round** (remind.ts + two agent.ts touches — the reminder
line learns the schedule laws the workflow line proved across v26/v38/v41;
built under Dian's standing "keep developing NAVI" direction, all sync and
free, no new sources, nothing gated):
- **Recurring reminders**: "remind me every day to pray" / "remind me every
  monday to call mom" / "remind me to pay rent on the 1st of every month"
  (also "every month on the 15th"; bare "every month" = the 1st, said out
  loud). ONE reminder row whose `due` holds the NEXT occurrence
  (`Reminder.every`: 'day' | weekday | 1-28) — surfacing at session-start
  ROLLS it forward (the surfacing IS the reminder, the daily-workflow lastRun
  idea), "done with reminder N" rolls it past the pending occurrence and
  points at delete, only delete/remove/clear stops it ("Stopped — no more
  every-monday reminders about …"). The workflow cadence laws hold: weekly
  demands "every"/"each" (so "on friday" stays a one-off date), monthly is
  1-28 ONLY ("Not every month has a 31st"), and bare "daily" is NOT a
  cadence ("join the daily standup" is a topic). Recurring rows are excluded
  from the v30 escalation offer — a cadence IS the promotion. List/surface
  lines name the rhythm ("every monday — next 2026-07-20").
- **Snooze**: "snooze reminder 2 until friday" / "push reminder 1 for 3
  days" / "postpone reminder 1 for a week" / bare snooze = tomorrow — the
  phrase reuses parseWhen's closed vocabulary; unknown phrasing teaches,
  today-or-past refuses honestly, out-of-range numbers answer with the
  count. A snoozed recurring reminder resumes its rhythm after the date.
- **Day-of-month conditions** (agent.ts): "when it's the 15th:" / "when it
  isn't the 1st:" (optional "of the month") — sync, free, from todayISO
  alone; the calendar sibling v41's monthly workflows were missing. Days
  1-31 literally, "the 32nd" falls through to the honest teach.
- **Two safety fixes while in the file**: remind.ts's add path now carries
  CRISIS_RX (a v22 gap — crisis phrasing was storable as reminder text;
  now it steps aside so the crisis nodes own the message), and
  addDueReminders never wraps a crisis reply (it sat outside the
  session-start crisis guard since v22 — the check now lives inside).

**v43 — the reader round** (mail.ts + understand.ts + the second sanctioned
App.tsx touch — roadmap #21 and #22, built at Dian's EXPLICIT direction:
"do steps 2, 3 and 4" reopened the email extras, hardened the runner, and
deepened the reading brain):
- **/email/…/send** (#21): a trailing /send segment on the v34 slash form
  stamps the v32 send offer in the same turn as the draft — the yes-law never
  bends. Rules: 4+ parts after the opening, final part exactly "send"
  (case-blind, trimmed); a 3-part ask whose body is the word "send" stays a
  plain draft; the body keeps its own slashes. isSendStep now knows the form,
  so a workflow step carrying it hits the v42 run-time confirm. The locked
  client's email intercept STEPS ASIDE for these asks (the sanctioned touch —
  only the server can stamp the offer); the malformed teach and all four help
  surfaces name the tail.
- **The single-mail digest** (#22): "summarise the last email from sam" /
  "what does the last email from sam say" / "give me the gist of …" reads
  that ONE mail in FULL — format=full, first text/plain part, base64url
  decoded — cleans it with cleanEmailText, and presses it through summarize
  (3 sentences, 400 chars). HTML-only and unreachable bodies fall back to the
  snippet with an honest "(That's from the preview …)" note. Read-only,
  crisis-guarded sender, whole-message anchored (a trailing "… say about the
  gig" stays conversation).
- **The reading brain** (understand.ts): cleanEmailText strips quoted history
  ("> …", "On … wrote:"), RFC signature blocks ("-- " onward), device
  signatures, and collapses URLs to "(link)" — deterministic, zero-I/O.
  trySummarize learned SHAPED summaries: "summarize in one sentence: <text>"
  and "key points: <text>" (also "bullet points of:") reuse the applyRewrite
  machinery, checked BEFORE the plain command, same 160-char pasted-text
  floor so topic asks stay on the knowledge path.
- **Runner hardening** (local, this PC): run-runner.cmd now logs every poll
  to navi-runner\runner.log (gitignored); a Task Scheduler entry
  ("NAVI Runner", every 15 minutes) polls hands-free; the allowlist grew
  "node version" and "site status". The no-server-push rule stands — the
  OWNER scheduled the device.

**v42 — the trust round** (agent.ts + mail.ts isSendStep — roadmap #17 and
#27, built at Dian's EXPLICIT "implement all those steps" direction, which
also covered the runner setup on this PC and the help refresh):
- **The run-time send confirm** (#17): a workflow whose steps SEND email
  ("send an email to me about *", "send draft 2", "send draft 2 tomorrow
  morning" — the closed isSendStep vocabulary; plain drafts stay harmless)
  never runs unconfirmed. Manual runs AND live trigger runs are gated
  BEFORE runWorkflow: the run itself is offered ("one of its steps sends
  real email — yes?"), stamped on Profile.runSend (name/topic/asked,
  10-minute window), nothing executes. A fresh "yes" re-runs with sends
  enabled: the send step drafts normally, then its offer stamp is consumed
  through mail.ts's own yes-machinery (draft re-read, honest failures, the
  user's own Gmail), and any stamp still standing is cleared with a note —
  no dangling send ever waits behind a later bare "yes". "No" parks it;
  stale offers refuse honestly; a vanished workflow answers honestly.
  SCHEDULED runs never send: daily/weekly/monthly runs hold send steps
  back ("held back: … a scheduled run never sends without you"), counted
  separately from condition skips. Previews tag send steps; creation warns
  ("Heads up: this workflow sends real email …").
- **The report headline** (#27, reshaped): every scheduled report header
  now reads "— Your daily "X" workflow (2 of 4 steps ran) —", counted FROM
  the run via runWorkflow's new `counts` return — zero extra condition
  fetches, unlike the pre-run preview the roadmap weighed and feared.
- **Help refresh** (the discovery debt): HELP_TEXT now teaches the v38-v42
  surface — weekly/monthly schedules, world conditions (all five sources +
  calendar/clock/device), the send law, run receipts, email commands,
  device tasks + runner, and the ICS export.
- **Runner setup**: this PC (device "pc") carries navi-runner/.env
  (key pending), tasks.config.json (hello / pull the site / disk space),
  and run-runner.cmd (`node --env-file` launcher, committed — it's generic).

**v41 — the rhythm round** (agent.ts + one export in tasks.ts + one
session-start wiring — the three natural rungs the v39/v40 hand-downs named,
none needing a decision from Dian):
- **Monthly workflows**: "run my budget workflow every month [on the 15th]" /
  "run my budget workflow on the 1st of every month" / "make my budget
  routine monthly" schedules the v26 machinery onto ONE day of the month
  (`Workflow.monthDay`). 1-28 ONLY, so the schedule exists in every month —
  29-31 are refused honestly ("not every month has a 30th"), and a bare
  "every month" defaults to the 1st (the reply says so). Same session-start
  channel, same lastRun stamp, same slotted refusal; the schedule stays
  exclusive (daily OR weekly OR monthly — setting one clears the others,
  any off form clears all). Receipts say `via: 'monthly'`; list/show/rename
  all read the day back as an ordinal ("runs monthly on the 15th").
- **Device-task conditions**: "when my pc has tasks waiting:" (+ "has no
  tasks waiting") and "when my pc has results waiting:" (+ negation) —
  sync, free evalCondition reads over Profile.deviceTasks, NO new source on
  the v35 seam. "Tasks waiting" is anything not yet done (manual + unanswered
  auto tasks); "results waiting" is the runner's unread receipts; an unknown
  device honestly has nothing waiting (the untracked-habit rule). They light
  up in v36 dry-run previews automatically.
- **Runner receipts at session-start** (tasks.ts deviceReceipts): unread
  runner results open the first reply of a session, grouped by device,
  appended right after due sends inside the crisis guard. Profile-only and
  free — the runner already wrote the results onto the row NAVI loaded.
  Read-once stands: surfacing clears them, and "any results from my pc"
  remains the explicit read for mid-session checks.

**v40 — the muse round** (all compose.ts + one splitIntents guard — built under
Dian's "/write feature + improve creative writing" direction):
- **The /write slash command**: "/write <prompt>" ("/write/<prompt>" also
  works) turns any writing prompt into a piece. A named kind is honoured
  ("/write a poem about hope"); no kind defaults to a STORY ("/write about
  the ocean at night" — the classic writing-prompt answer); "to <someone>"
  with no kind is a LETTER ("/write to my future self"). Topic/recipient ride
  the same about/on + for/to slots as the conversational parser, but the
  prompt allows longer topics (80 chars vs. 6 words). Bare "/write" is taught
  WRITE_USAGE; crisis prompts return '' so the crisis nodes answer;
  isWriteSlashAsk keeps prompts out of splitIntents.
- **New creative kinds** (conversational asks get them too — "write me a
  short story about a lion" now composes): story, song (verse/chorus lyrics),
  letter, speech, quote. Compound kinds keep their old owners (KIND_RX order:
  "thank-you letter" is thanks, "motivational quote" is motivation), and
  "give me a quote from the bible" stays on the Bible path (explicit guard).
- **Generative stories**: assembled from opening/middle/closing banks
  (4 × 4 × 4 = 64 stories), each part pronoun-free outside the opening so
  any combination reads as one piece. Poem bank deepened 3 → 6.
- **Better variety**: the variant seed is now a char-code sum (seedOf), not
  the message length — same-length asks about different topics rotate the
  banks. Still fully deterministic: same ask, same piece, zero external LLM.

**v39 — the hands round** (tasks.ts NEW, navi-runner/ NEW, agent.ts, brief.ts —
built under Dian's "task execution on devices" direction, all three
interpretations plus both v38 follow-ups):
- **Device task queue** (tasks.ts): "add a task for my laptop: push the repo"
  queues work for a named device on `Profile.deviceTasks` (cap 12 total,
  refused honestly, never evicted); "show my laptop tasks" / "what's waiting
  on my phone" / "show my device tasks" read it back; "done with task 2 on my
  laptop" ticks off; "clear my laptop tasks" / "clear my device tasks" wipe.
  Crisis-guarded, anonymous asks get the sign-in prompt (isTasksAsk).
- **Auto tasks + the runner** (tasks.ts + navi-runner/poll.js): "run backup
  on my pc" queues a NAME-only auto task. THE SAFETY CONTRACT: chat never
  carries a command — the device's own tasks.config.json (gitignored, local)
  maps names to commands, unknown names are refused with a receipt, and the
  runner POLLS (run/schedule it yourself) so the no-server-push anti-goal
  stands. Receipts ("ok — …" / "failed — …" / "refused — …") are read once
  and cleared by "any results from my pc". Conservative parsing: names can't
  open with a preposition, figure-of-speech devices (street/way/life…) are
  stopworded — "run for your life on my street" stays conversation.
- **Calendar export** (tasks.ts buildIcs): "export my reminders as a
  calendar" / "export my calendar" returns an RFC-5545 VCALENDAR block —
  dated reminders + life events as all-day VEVENTs, booked sends at their
  exact moment — for the device's calendar app to import. Read-only, pure
  text, honest when nothing is dated.
- **Execution receipts** (agent.ts): every real workflow run stamps
  `Profile.workflowLog` (cap 10, oldest out) with name/date/via
  (manual/trigger/daily/weekly) — so runWorkflow now ALWAYS returns a
  profile. "which workflows ran today" / "what ran today" reads today's
  slice back, honestly empty when nothing fired. The v36 dry-run never
  stamps (it never enters runWorkflow).
- **Briefing world line** (brief.ts — roadmap #24 CLOSED): "brief me" now
  ends with ONE live line ("OUT IN THE WORLD: vision board: 3 items ·
  inbox: 2 unread.") through injected BriefSources (v35 seam pattern —
  vision.ts visionItemCount + mail.ts inboxUnreadCount, fetched in
  parallel, only on a real signed-in briefing ask). Honest at every stage:
  not-connected and unreachable are named, never guessed. This is the
  briefing's only network cost — accepted by Dian.

**v38 — the tempo round** (agent.ts + one helper in skills.ts):
- **Weekly workflows**: "run my sabbath workflow every sunday" schedules the
  v26 daily machinery onto ONE weekday (`Workflow.day`, SA time) — same
  session-start channel, same `lastRun` stamp, same slotted-workflow refusal.
  A workflow is daily OR weekly, never both (setting one clears the other);
  "stop running my X workflow every sunday" (or the daily off form) clears
  the whole schedule. The list/show/rename replies all name the day.
- **Calendar & clock conditions**: "when it's monday:" (any weekday),
  "when it isn't friday:", "when it's the weekend:", "when it's a weekday:",
  "when it's morning/afternoon/evening/night:" (+ negations, "today is"
  forms, and an optional " time" suffix on the clock words). The day answers
  from todayISO, the hour from the SA clock (skills.ts `hourInTZ`) — sync,
  free, no source, no network; they light up in v36 dry-run previews
  automatically. Segments: morning 5-11, afternoon 12-16, evening 17-21,
  night 22-4 — closed and exhaustive, so the verdict is never a guess.

**v37 — the horizon round** (agent.ts + one helper in chats.ts):
- **Mission dry-run** (roadmap #26): "what would finish my mission?" /
  "preview my mission" / "show my remaining mission steps" / "what's left of
  my mission" — reads the WHOLE remaining tail of the active mission back,
  numbered exactly as the mission numbers them (finished steps stay hidden).
  Pure read: nothing advances, the profile never changes, and the reply says
  so ("Nothing moved — you're still on step N"). With no active mission the
  ask gets the honest no-mission line; anonymous asks get the sign-in prompt.
- **Chats-age conditions** (the #23 remainder — the seam's third source):
  "when i have chats older than 30 days:" / "when i have no chats older than
  30 days:" (also "conversations", "idle than") — counted live through
  chats.ts `chatsIdleCount(email, days)`, a pure read over the same
  navi_chat_sessions listing the cleanup uses. COUNTING ONLY — a condition
  can never delete; the two-step v31 cleanup stays the only deleting path.
  Unreachable history → honest 'unreachable' skip, like board and inbox.

**v36 — the foresight round** (all agent.ts):
- **Workflow dry-run** (roadmap #25): "preview my aware workflow" /
  "dry run my study workflow on grace" / "what would my aware workflow do
  right now?" — walks the steps like a real run but only REPORTS: each step
  comes back "would run" / "would skip (+ the reason)" / "can't tell (+ the
  honest why: unreachable source or no Gmail link)". Conditions are evaluated
  against the live world through the v35 sources; topic slots fill for the
  preview; NOTHING executes and the profile never changes. The footer counts
  what would run and hands back the exact "run my …" command.
- **Booked-send conditions** (a slice of roadmap #23): "when a booked send is
  waiting:" / "when no booked sends are waiting:" — sync, profile-only reads
  of mailScheduled. No source, no network, free.

**v35 — the awareness round** (agent.ts + one helper each in vision.ts/mail.ts):
- **World conditions** (roadmap #12 + #18 — the async evalCondition seam):
  workflow steps can now open with "when my vision board is empty:",
  "when my vision board isn't empty:", "when i have new email:" (also
  "unread"), or "when i have no new email:" / "when my inbox is clear:".
  The board answers via vision.ts `visionItemCount`; the inbox via mail.ts
  `inboxUnreadCount` (one messages.list `is:unread` call, resultSizeEstimate,
  through the user's OWN Gmail token). Both are checked live mid-run, per
  step, profile changes threaded as before.
- **Honest can't-check verdicts**: 'unreachable' (source down → step skipped,
  "played it safe") and 'not-connected' (no Gmail link → step skipped, points
  at the Connect button). Distinct from null, which still teaches the closed
  vocabulary (KNOWN_CONDITIONS now lists the four new phrases).
- **The seam itself**: `ConditionSources` injected through tryAgent /
  runDailyWorkflows (optional trailing params — production omits them, tests
  stub the world). Lazy evaluation: a source is only fetched when its phrase
  matched, so v29/v30 profile conditions are exactly as cheap as before.

**v34 — the slash-command round** (mail.ts + the one sanctioned App.tsx touch):
- **The /email shorthand**: `/email/recipient/subject/body` — three parts cut
  by the first three slashes; the body keeps any further slashes, its case,
  and its "and"/"then"s (isMailSlashAsk keeps the message out of splitIntents).
  Client side (App.tsx — Dian explicitly requested this format, the one UI
  change since the lock): a message opening "/email/" is ONLY ever the slash
  form; parsed with parseSlashEmailDraft, drafted via the navi-email function,
  malformed asks get the usage line. Legacy "/email addr message" still parses
  when there's no slash after the command word. Server side (mail.ts
  parseMailSlash): same syntax for "me"/"myself" and workflow steps; drafts
  only, wantSend:false — sending still takes the v32 two-step yes. Malformed
  is 'malformed' (taught); crisis subject/body returns null (steps aside).
- **Inbox digests** (roadmap #20): "summarise my inbox" / "inbox digest" —
  the 5 newest inbox mails with their Gmail `snippet`s (which ride
  format=metadata for free, HTML entities decoded) pressed through the
  deterministic `summarize` engine from understand.ts. Read-only, no confirm,
  honest not-connected/unreachable replies. Still zero external LLM.

**v33 — the correspondence round** (all in mail.ts — NAVI reads, replies, books):
- **Inbox read**: "check my inbox" / "any new emails?" reads the 5 newest
  inbox mails over the Gmail API (metadata only — From/Subject; NAVI reads,
  it never deletes). Uses the same navi_gmail_tokens row + refresh as the
  send path; honest not-connected / unreachable replies (roadmap #15's read
  half — the `gmail.modify` scope the Email tool requests already covers it).
- **Reply from context**: "reply to the last email from sam [saying …]"
  searches the inbox (`in:inbox from:(sam)`), drafts a real `Re:` row to the
  actual sender address, and stamps the v32 send offer in the same turn —
  still never sends without the yes. BY NAME ON PURPOSE: the locked client
  (App.tsx) intercepts any chat message carrying a literal address + an
  email verb before it reaches the function, so the address form only works
  server-side (workflow steps via answerIntent). No "saying …" gets a
  deterministic acknowledgement body, crisis-guarded like everything else.
- **Booked sends** (roadmap #16, respecting the no-cron anti-goal): "send
  draft 2 tomorrow morning" parses a CLOSED time vocabulary (parseSendWhen:
  now / in N hours / in N minutes / tonight / tomorrow [morning|afternoon|
  evening] / tomorrow at 9am / [on|next] weekday [morning…]; SA time,
  deterministic; unknown phrasing teaches the vocabulary, a past moment is
  refused, "now" collapses into the immediate path). The offer is the same
  two-step confirm (`MailSend.sendAt` marks it); the yes BOOKS onto
  `Profile.mailScheduled` (cap 3, dupe-guarded, cap-checked at offer AND
  confirm) instead of firing. `runDueSends()` fires due bookings at
  session-start (after daily workflows, inside the crisis guard): each
  re-reads its draft (gone → nothing sent, booking off), sends through the
  user's own Gmail, and reports honestly; bookings that can't fire
  (unreachable / not connected / send refused) stay booked and say so.
  "show my scheduled sends" / "cancel [the] scheduled send [N]" /
  "unschedule draft N" manage the book (profile-only). NOTE the
  session-start wiring mirrors the delete onto `stored` explicitly —
  `Object.assign` can't unset a consumed schedule.

**v32 — the real-tasks round** (NAVI's first action that leaves the platform):
- **Email bridge** (mail.ts, NEW — the third vision.ts/chats.ts sibling, and
  the first whose action can't be undone): "draft an email to me about …"
  (optional "saying …" body; a subject-only ask gets a simple deterministic
  body signed with the profile name), "list my email drafts" (numbered,
  newest first — the Email tool's order), "delete email draft N", and
  "send draft N" — a TWO-STEP move exactly like the v31 chat cleanup: the
  offer (recipient + subject read back) is stamped on `Profile.mailSend`,
  a bare "yes" only counts fresh (10 min), the draft row is RE-READ at
  execute time (edited/deleted drafts are never mis-sent), and the send goes
  through the user's OWN Gmail (navi_gmail_tokens row + refresh, same OAuth
  shape as the navi-email function; GOOGLE_CLIENT_ID/SECRET are project
  secrets all functions see). Honest failure replies at every stage:
  unreachable keeps the stamp for a retry, "Gmail isn't connected" points at
  the Email tool's Connect button, a vanished draft sends NOTHING and says
  so. Drafts shelf capped at 20 from chat. The verb "send an email to …"
  drafts AND stamps the offer in one turn — still never sends without the
  yes. IMPORTANT ORDER: tryMail is wired right after tryChats in BOTH paths,
  so on a bare "yes" a pending chat cleanup always outranks a pending send —
  deterministic, never a race. ALSO KNOW: App.tsx (locked) intercepts
  signed-in messages carrying a literal address + intent verb and creates
  the draft client-side — the bridge is the address-free + server-side half
  ("send draft 2", "email me about …", and every workflow step, since
  answerIntent never passes through the client).
- **Step reordering + workflow renaming** (agent.ts — roadmap #14 done):
  "move step N up/down / to the top / to the end in my X workflow" and
  "rename my X workflow to Y" (trigger + daily survive; dedupe against
  existing names; already-at-the-top/bottom answered honestly). Parsed in
  the same before-creation/deletion cluster as the v31 editing commands.

**v31 — the stewardship round** (NAVI curates its own surfaces):
- **Chat-sessions bridge** (chats.ts, NEW — vision.ts's sibling): "how many
  chats do i have" / "list my chats" read `navi_chat_sessions` (count + 5 most
  recent, over PostgREST with the service key); "clean up my old chats" /
  "delete chats older than N days" is a TWO-STEP destructive move — NAVI
  counts what's idle past the horizon, stamps the offer on the profile
  (`Profile.chatCleanup`: cutoff/count/asked), and only deletes on an explicit
  yes. A bare "yes" works only while the offer is fresh (10 min); a stale one
  is refused and cleared; "no"/"cancel the chat cleanup" keeps everything.
  The horizon has a 7-DAY FLOOR so the live conversation can never delete
  itself; deletes CASCADE the messages; the count is re-taken at execute time.
  Bare "yes"/"no" with no pending offer return null — conversation untouched.
- **Gaps curation** (learn.ts tryGapsManage): "dismiss gap 2" (numbered as the
  report numbers them — same query, same order), "clear my learning list".
  Owner-only like the report; PATCHes `resolved=true` on navi_gaps.
- **Workflow step editing** (agent.ts): "show my X workflow" reads the steps
  back numbered (+ trigger/daily info); "add a step to my X workflow: …",
  "replace step 2 of my X workflow with …", "remove step 2 from my X
  workflow" edit in place. Guards: MAX_STEPS cap, never empty a workflow
  (points at delete instead), stepProblem() re-applies the meta rule (no
  workflow/mission phrasing, conditions read through, the mission-step
  literal allowed), crisis-guarded new text, out-of-range numbers answered
  with the numbered list.

**v30 — the cross-platform round** (NAVI executes beyond the chat):
- **Vision Board bridge** (vision.ts, NEW): "add … to my vision board" /
  "what's on my vision board" / "remove … from my vision board" act directly
  on `navi_vision_items` — the same table the Vision Board tool renders —
  via PostgREST with the service key (store.ts pattern). "put my mission on
  my vision board" pins the active mission's goal. Wired into BOTH the main
  pipeline (after habits) and answerIntent, so a workflow step like
  "add * to my vision board" pins the topic of the day. Chat only removes
  TEXT items (photos carry storage files the tool cleans up); the tool's
  60-item cap is respected; unreachable DB gets an HONEST "couldn't reach"
  reply, never a silent shrug. tryVision handles the anonymous sign-in
  prompt itself.
- **Condition vocabulary 2.0** (agent.ts evalCondition): negations
  ("no reminders are due", "my mood isn't low", "i have no mission") and
  habit-streak thresholds ("my prayer streak is under 3" / "at least 7" /
  "over 7"; an untracked habit honestly has streak 0). Unknown conditions
  still skip and teach.
- **Queue editing** (agent.ts): "move X to the front of the queue" reorders;
  "start the queued mission X now" (or bare "start the queued mission")
  pulls it forward — the active mission's goal steps back to the FRONT of
  the queue with an explicit note that its finished steps won't be
  re-counted. findQueued is the shared fuzzy lookup (exact → contains).
- **Reminder escalation** (remind.ts): a reminder 3+ days old earns ONE
  session-start offer ever (`Reminder.offered` stamp, memory.ts) — appended
  after missionNudge. "make that reminder a habit" converts it into a
  habit.ts-shaped habit (cap 6, dedupe clears the redundant reminder);
  "make that reminder a mission step" / "add reminder 2 to my mission"
  appends to the active mission (cap 10). Numbered picks win, then the
  last-offered, then the longest-waiting. Wired next to tryReminder in both
  the main path and answerIntent; escalation asks count as isReminderAsk
  for the anonymous sign-in prompt.
- **Self-improvement loop** (learn.ts): "what should you learn?" /
  "what are your blind spots" (tryGapsReport) — OWNER-ONLY
  (prophetdian@gmail.com) read of the top 5 unresolved `navi_gaps` rows,
  most-asked first, with the `learn: <question> :: <answer>` teach syntax.
  Everyone else gets a friendly deterministic line. Wired before
  detectTeach in the main path.

**v29 — the executive round** (all in agent.ts unless noted):
- **Conditional steps**: a step may open `when <condition>: <step>`; the
  condition is evaluated (`evalCondition`) against the live profile mid-run.
  CLOSED vocabulary: habit logged / not logged today, a reminder is due,
  my mood is <x> (aliases map to the journal's canonical labels), my mission
  is idle (3+ days), i have a mission. Unknown conditions SKIP the step and
  teach the vocabulary — never guess. Skipped steps are excluded from the
  "N of M executed" summary (reported as "skipped by its condition").
- **Open triggers**: a trigger stored ending in ` *` ("study *", set via
  "when i say study *, run my study workflow on it"; `<topic>` normalizes to
  `*`) fires on any message starting with the prefix — the remainder becomes
  the topic that fills every * slot. Exact triggers are checked first; the
  remainder is length-capped and crisis-guarded.
- **Mission-aware step**: the literal step "my next mission step" surfaces
  the active mission's current step READ-ONLY (never through the engines,
  never advancing). The only mission phrase allowed inside workflow steps —
  the creation guard reads through `when …:` conditions for this check.
- **Mission queue**: `missionQueue?: string[]` on the profile (cap 3).
  "queue a mission to X" (crisis-guarded); with nothing active it starts
  immediately instead. Deduped against the active goal + queue. Completing
  OR skip-wrapping the mission auto-promotes queue[0] into a full new
  mission (promoteQueued); ABANDONING does not — the queue is named but
  waits. "show my mission queue" / "clear my mission queue" / "remove the
  queued mission: X"; mission status shows the queue.
- **Sparklines** (habit.ts): `sparkline(h, today)` = the last 7 days as
  `···✓✓✓✓` from the current streak window plus `Habit.recent` (last 14
  logged dates, stamped on every log — pre-break days stay visible).
  Appended to `streakLine`, so the briefing, habit status, and weekly review
  all carry it automatically.

- **Workflows**: named saved routines, ≤8 workflows × ≤5 steps. Each step is an
  ordinary ask executed through `answerIntent` (the injected `AgentRunner`), so
  a step runs EXACTLY what the same message would run on its own, with profile
  changes threaded step to step.
  - trigger phrases (`when i say X, run my Y workflow`) — exact tidy match.
  - daily auto-run (`run my X workflow every day`) — first session of a new SA
    day, `lastRun` stamp prevents repeats (`runDailyWorkflows`).
  - **v27 topic slots**: steps may carry `*`; `run my study workflow on grace`
    fills every slot (`parseWorkflowRun` returns `{name, topic?}`). Slotted
    workflows refuse daily mode, prompt on bare runs and bare triggers.
- **Missions**: ONE active goal decomposed via `stepsForGoal` (plan.ts domain
  step banks), advanced with "done", finished into the wins list.
  - **v27**: `skip`/`skip this step` drops the current step (skipping the last
    one wraps the mission into wins); `add a step to my mission: …` appends
    (cap 10); `touched` stamped on every movement; `missionNudge` fires one
    session-start note per day when idle ≥3 days (`nudged` date stamp).
- Bare "done"/"what's next"/"skip" are ONLY intercepted while a mission is
  active — otherwise they fall through as normal conversation.

### brief.ts — the daily briefing (v27)
`brief me` / `what's my status` / `catch me up` → one read-only report over the
profile: mission + current step, habit streaks (reuses habit.ts `streakLine`),
reminders due now, life events within 7 days, mood trend, last 3 wins.
Signed-in only; anonymous asks get a sign-in prompt.

### review.ts — the weekly review (v28)
`review my week` / `weekly review` / `how was my week` → week-over-week deltas
against the `ReviewSnapshot` stored on the profile (`review` field, memory.ts):
habits kept (lifetime totals vs. snapshot, new/dropped habits named), mission
velocity (steps moved; a finished mission is the headline), mood shift (this
week's dated journal vs. last week's — needs no snapshot), wins earned (exact —
the snapshot keeps the wins list), reminders cleared (count vs. snapshot).
The FIRST review sets the baseline and says so; every review re-stamps the
snapshot (saved immediately at the call site). `reviewOffer` appends one
session-start note per day (`offered` stamp, missionNudge-style) once the last
review — or, before any review, the oldest tracked history (habit/mission
created, first mood) — is 7+ days old, and only when there's data to review.

### The supporting organs the agent layer composes
- `execute.ts` (v24) multi-intent split · `plan.ts` (v21) goal step banks ·
  `remind.ts` (v22) reminders · `habit.ts` (v26) streaks · `life.ts` (v23)
  dated events · `memory.ts` profile schema + moods + wins · `store.ts`
  persistence · `skills.ts` math/dates/etc · `bible.ts` KJV · `learn.ts` web
  knowledge cache.

## 4. Contracts and invariants — DO NOT BREAK

1. **Crisis first, always.** Every parser that stores or executes user language
   carries `CRISIS_RX` and steps aside — crisis phrasing is never a goal,
   mission, workflow step, trigger, habit, or topic. Session-start appends
   never wrap a crisis reply. (v23 shipped a CRITICAL fix because "i want to
   die" was once stored as a goal. Never regress this.)
2. **Anchored, conservative parsing.** Every command regex is anchored to the
   whole tidied message (`tidy()` strips the "hey navi" address + trailing
   punctuation). When in doubt, return null and let the pipeline run — a false
   negative is a missed feature; a false positive corrupts a conversation.
3. **Signed-in only for persistence.** Workflows, missions, habits, reminders,
   briefing all live in the `navi_memory` row. Anonymous users get a friendly
   sign-in prompt (`isAgentAsk`/`isBriefingAsk` detect the ask).
4. **The `try*` contract**: `(message, profile, …) → { reply, profile? } | null`.
   Return null when it's not your business. Return `profile` ONLY when it
   changed.
5. **Free tier = zero external LLM.** No Anthropic key outside navi-mini/max.
   Web lookups (DDG/Wikipedia) are the only network reads, silent, cached.
6. **UI is LOCKED** (App.tsx and UI files) until Dian says otherwise. The
   agentic layer is server-side only — you never need the frontend.
   (Two sanctioned exceptions so far, BOTH inside the same email intercept:
   v34's /email slash form, and v43's step-aside for slash asks ending
   /send — Dian explicitly reopened #21, which cannot work from the chat box
   without it. The lock stands for everything else.)
7. **One mission at a time** — focus is the feature, not a limitation.
8. Caps everywhere (workflows 8, steps 5, mission steps 10, wins 10, habits 6).
   Every new list needs a cap and an eviction rule.

## 5. How to ship a new version safely (the proven loop)

1. Work in `C:\Users\Alett\navisociety-work` (local clone; remote
   `navisociety/navisociety.github.io`, branch `main`).
2. Write the feature as a new module or extend agent.ts; wire in index.ts at
   the right pipeline position (see §2).
3. Tests in `_test.ts` (Deno, `eq` = JSON compare, `stubRunner()` fakes the
   AgentRunner). Run: `deno test --allow-env --allow-net _test.ts`
   (bible.ts reads env at module top; `--allow-none` is not a flag).
   Then `deno check index.ts`.
4. Local smoke: check port 8000 is free (stale-server gotcha!), then
   `deno run --allow-net --allow-env index.ts`, POST JSON
   `{"message":"…","email":"test@example.com"}` to localhost:8000. No env vars
   needed — store.ts is best-effort (stateless locally).
5. Commit with `git commit -F <msgfile>` (multi-line messages on PowerShell),
   push to `main`. CI deploys BOTH the site (Pages) and ALL edge functions
   (`supabase-deploy.yml`, `SUPABASE_ACCESS_TOKEN` secret). Watch:
   `gh run watch <run-id> --exit-status`.
6. **Live-verify** against the production URL with a scratch email
   (e.g. `vNNtest@example.com`) — walk the full stateful scenario (create →
   run → edit → report → cleanup with abandon/delete). Persistence only exists
   live, not locally.
7. **Record in memory** (standing instruction): a `project_navi_vNN_<date>.md`
   memory file with commit SHA, changes, verification results + update
   `MEMORY.md` and the `project_navi_llm.md` version line. Unprompted.

### Known gotchas (each cost a session real time)
- Em-dashes in hand-built curl payloads get mangled on PowerShell — use a
  bash heredoc/Deno round-trip script for payloads with special characters.
- Stale local deno server on :8000 makes curl test OLD code — always check.
- CI deploys functions sequentially and a workflow-file change lags one push.
- Edge runtime: Supabase write RPCs don't persist — use direct table writes.
- Concurrent pushes cancel each other's Pages runs ("cancelled" ≠ failure).
- The repo's root CLAUDE.md is STALE (describes a pre-edge-function
  architecture). Trust this file and the memory index over it.
- The live function occasionally returns WORKER_RESOURCE_LIMIT (edge isolate
  cold-start resource cap — index.ts is big). It's TRANSIENT: the same ask
  succeeds on retry. Seen 3× during v39 live-verify; don't chase it as a
  code bug, but if it grows more frequent the bundle may need a diet.

## 6. The roadmap — where to take agency & execution next

The trajectory so far: v24 execute every ask → v25 execute saved routines and
tracked goals → v26 execute on a schedule (daily) → v27 execute with
parameters, edit plans mid-flight, self-report (briefing), self-nudge.
The theme: **NAVI moves from answering to running things, without ever losing
determinism or safety.** Next natural rungs, roughly in order of value:

1. ~~**Weekly review**~~ — SHIPPED in v28 (review.ts). Week-over-week habit
   deltas, mood shift, wins earned, mission velocity, reminders cleared, plus
   the 7-day session-start offer.
2. ~~**Conditional workflow steps**~~ — SHIPPED in v29 (`when <condition>:`
   prefix, closed vocabulary, evalCondition in agent.ts).
3. ~~**Trigger phrases with topics**~~ — SHIPPED in v29 (open triggers ending
   in ` *`; remainder fills the slots).
4. ~~**Mission-aware workflow steps**~~ — SHIPPED in v29 (the read-only
   "my next mission step" literal).
5. ~~**Multiple queued missions**~~ — SHIPPED in v29 (missionQueue, cap 3,
   auto-promote on completion/skip-wrap; abandon leaves the queue waiting).
6. ~~**Reminder → workflow escalation**~~ — SHIPPED in v30 (reminderEscalation
   offer + tryEscalate in remind.ts; `Reminder.offered` stamp).
7. ~~**Self-improvement loop on gaps**~~ — SHIPPED in v30 (tryGapsReport in
   learn.ts, owner-only).
8. ~~**Progress analytics in the briefing**~~ — SHIPPED in v29 (habit
   sparklines via streakLine, everywhere habits render).
9. ~~**Conditional NEGATIONS & richer vocabulary**~~ — SHIPPED in v30
   (negations + streak thresholds in evalCondition).
10. ~~**Queue editing**~~ — SHIPPED in v30 (move-to-front, start-queued-now
    with the honest swap).

With the v29/v30 backlog cleared, the next rungs for the execution line:

11. **More cross-platform bridges** — the Email bridge (mail.ts) SHIPPED in
    v32 — NAVI's first real-world action (drafts + Gmail sends behind the
    two-step confirm). Still open: Create-tool creations, Share drafts (both
    are localStorage stand-ins today — no tables to bridge until they get a
    backend). Each new bridge is a vision.ts/chats.ts/mail.ts sibling; keep
    photos/files tool-managed. The reusable pattern for anything
    destructive/irreversible: TWO-STEP CONFIRM (offer stamp on the profile +
    fresh-bare-yes window + re-read at execute), and each new stamp must slot
    into the pipeline order so only ONE offer can consume a bare "yes".
12. ~~**Board-aware conditions**~~ — SHIPPED in v35 (the async evalCondition
    seam; "when my vision board is empty / isn't empty: …").
13. ~~**Owner analytics on gaps**~~ — SHIPPED in v31 (tryGapsManage: dismiss
    gap N / clear my learning list, owner-only).
14. ~~**Workflow reordering / renaming**~~ — SHIPPED in v32 (move step N
    up/down/top/end; rename with trigger/daily surviving).

With v32 the execution line has its first real-world actuator. Next rungs:

15. ~~**Email replies from context**~~ — SHIPPED in v33 (inbox read +
    "reply to the last email from X", by sender NAME from chat — the locked
    client intercepts literal addresses; reuses the v32 send confirm).
16. ~~**Scheduled sends**~~ — SHIPPED in v33 (booked sends: closed time
    vocabulary, two-step confirm at booking time, runDueSends fires at
    session-start — no cron, no server push, honest failure notes).
17. **Workflow steps that send** — today a workflow step can DRAFT
    ("draft an email to me about *"); letting a step send would bypass the
    confirm — don't. If Dian wants it, the confirm must move to run time
    ("this run wants to send 1 email — yes?").

Post-v33 candidates, in rough order of value:

18. ~~**Inbox-aware conditions**~~ — SHIPPED in v35 ("when i have new email /
    no new email: …" over the user's own Gmail; not-connected skips honestly).
19. **Reply chains** — the v33 reply drafts a fresh `Re:` mail; real
    In-Reply-To/References threading needs the source Message-ID header
    (one more metadataHeader in searchInbox), a threaded buildMime, AND
    somewhere to keep the Message-ID between draft and send — `navi_emails`
    has no headers column, so this needs DDL via the Management API
    (management token held out-of-band; a v34 session skipped this rung for
    exactly that reason).
20. ~~**Digest reads**~~ — SHIPPED in v34 ("summarise my inbox": snippets
    through understand.ts summarize; snippet rides format=metadata free).

Post-v34 candidates:

21. ~~**Slash-form sends from chat**~~ — SHIPPED in v43 (Dian explicitly
    reopened it: the trailing /send segment stamps the v32 offer in the same
    turn, still confirm-gated, isSendStep-covered, client steps aside).
22. ~~**Digest depth**~~ — SHIPPED in v43 (the single-mail digest: one mail
    format=full through cleanEmailText + summarize, snippet fallback,
    read-only).

Post-v35 candidates (the execution line beyond email):

23. ~~**More world conditions on the seam**~~ — DONE across v36/v37: the
    booked-send pair (v36, sync) and the chats-age pair (v37, chats.ts
    chatsIdleCount as the third source). The seam now has three sources —
    keep adding them sparingly; every one is a live network call inside a
    workflow run.
24. **Condition-aware briefing line** — "brief me" could append one line of
    world state (board count, unread count) — read-only, but it makes the
    briefing a network call; weigh against the instant-reply feel.
25. ~~**Workflow dry-run**~~ — SHIPPED in v36 (preview/dry run/what-would,
    reply-only, live conditions, slotted topics, nothing executes).

Post-v36 candidates:

26. ~~**Mission dry-run**~~ — SHIPPED in v37 ("what would finish my mission?"
    reads the whole remaining tail back, read-only, in the mission cluster).
27. **Preview-before-daily** — the session-start daily report could open with
    a one-line preview summary ("2 of 4 steps will run") — but it doubles the
    condition fetches per run; probably not worth it. Decide with Dian.

Post-v37 candidates:

28. ~~**Weekly workflows + calendar/clock conditions**~~ — SHIPPED in v38
    (the tempo round, under Dian's standing "keep developing agent.ts /
    agentic features" direction): the v26 daily channel learned weekdays,
    and the condition vocabulary learned the calendar and the clock — all
    sync and free, no new sources on the seam.

Post-v38 candidates:

29. ~~**"Which workflows ran today"**~~ — SHIPPED in v39 (workflowLog
    receipts + the read-back command).
30. ~~**#24 briefing world-state line**~~ — SHIPPED in v39 (Dian accepted
    the network cost when asked directly).
31. ~~**Task execution on devices**~~ — SHIPPED in v39 as three pieces
    (Dian chose "implement all 3" when offered the interpretations):
    the device task queue, the name-only runner contract (navi-runner/),
    and the ICS calendar export.

Post-v39 status: still open are #17 (workflow steps that send — run-time
confirm, only if Dian asks), #19 (reply threading — blocked on DDL),
#21/#22 (email tool declared COMPLETE), #27 (preview-before-daily — ask).
~~Natural next rungs on the v39 seams~~ — ALL THREE SHIPPED in v41 (the
rhythm round): monthly workflow cadence, device-task conditions, and runner
receipts at session-start (which turned out to be FREE, not a new read — the
receipts live on the profile row the request already loads). The runner
itself still needs Dian's device setup (service key + tasks.config.json +
NAVI_DEVICE) before its first real run — the chat half is live and tested.

Post-v41 status: the deterministic execution line has now consumed every
rung that doesn't need Dian or DDL. What remains, all gated:
- ~~#17 workflow steps that send~~ — SHIPPED in v42 (Dian asked: "implement
  all those steps"). The run-time confirm, exactly as sketched.
- #19 reply threading — blocked on a navi_emails DDL (management token
  out-of-band).
- #21/#22 — email tool declared COMPLETE; don't touch unasked.
- ~~#27 preview-before-daily~~ — SHIPPED in v42, reshaped: a headline counted
  FROM the run (zero extra fetches), not a doubled-fetch pre-run preview.
- The runner's first real run — v42 set up this PC (config + launcher);
  waiting ONLY on the service key landing in navi-runner/.env.

Post-v42 status: #19 (DDL) and #21/#22 (declared complete) are the only
named rungs left, both gated. A genuinely new rung needs a new bridge table
(Create/Share tools are still localStorage stand-ins) or a fresh direction
from Dian — ask, don't invent.

Post-v43 status: Dian's "do steps 2, 3 and 4" (2026-07-15) reopened and
CLOSED #21/#22, hardened the runner (scheduled polling is live on this PC),
and deepened the reading brain. The ONLY named rung left is #19 (reply
threading — still blocked on the navi_emails DDL via the out-of-band
management token). Everything else needs a new bridge table or fresh
direction from Dian — ask, don't invent. The email tool is COMPLETE again:
#21/#22 were one-time reopenings, not a standing license.

Post-v44 status: under Dian's "keep developing NAVI" direction the cadence
round taught the REMINDER line the workflow schedule laws (recurring +
snooze) and completed the calendar condition vocabulary (day-of-month).
A v43 follow-up commit also gave navi-runner phone legs (--loop mode,
run-runner.sh, Termux config example — local plumbing, found staged but
uncommitted from a prior session). Still gated: #19 (DDL), new bridges
(no backend tables). The reminder line now matches the workflow line
rung for rung; the next ungated seams are thin — weigh brain/compose
deepening or ask Dian for a new direction before inventing.

Post-v45 status: the almanac round added the YEARLY rhythm everywhere it was
missing — the special-dates book (dates.ts, the seam life.ts explicitly left
open by banning birthdays), yearly reminders, and event/special-day
conditions. The cadence family is now complete: daily/weekly/monthly
workflows, day/weekday/monthly/yearly reminders, and a yearly dates book.
Still gated: #19 (DDL), new bridges (no backend tables). The genuinely
ungated seams left are brain/compose deepening (understand.ts shapes,
compose.ts banks) — or ask Dian for a new direction before inventing.

Post-v46 status: Dian's "focus on agentic features" (2026-07-16) opened the
workflow ENGINE itself as the seam — the orchestration round gave it
composition (nested runs, depth 1), flow control (otherwise), and
self-control (pause/resume). Natural continuations on these seams, none
needing Dian: deeper receipts (per-step outcomes on the workflowLog so
"what did my last run do" answers), a "run my X workflow again" re-run
form, mission deadlines ("finish this mission by friday" + nudges). Still
gated: #19 (DDL), new bridges. The step law is now: ordinary asks + the
mission literal + the chain form — anything else that smells of
workflow/mission management stays refused.

Post-v47 status: the chronicle round consumed all three rungs the v46
hand-down named (per-step receipts, the re-run form, mission deadlines) —
the workflow line now remembers what it did, and the mission line knows
when it's due. Still gated: #19 (DDL), new bridges (no backend tables).
Genuinely ungated seams left are thin: brain/compose deepening, or small
sibling polish (e.g. deadline-aware briefing line — the briefing already
reads the mission). Ask Dian for a new direction before inventing.

Post-v48 status: Dian's "enhance NAVI creative writing / the /write feature"
(2026-07-16) opened compose.ts as the seam — the anthology round shipped
assembled songs, three new kinds (congrats/comfort/rap), multi-piece asks on
the short kinds, {sender}-signed letters, and closed the conversational
crisis gap. Compose seams left if Dian asks again: tone/style modifiers
(funny/formal — needs per-tone banks, weigh the size), poem assembly (the
stanzas rhyme as wholes — don't split them naively), remembering recent
variants per user (needs a profile stamp — tryCompose would have to return
a profile, a try* contract change). Still gated: #19 (DDL), new bridges.
Otherwise: ask Dian for the next direction before inventing.

**Anti-goals** (decided, don't revisit without Dian): no external LLM on free
tier, no cron/server-push (NAVI only speaks when spoken to — "session-start
append" is the only proactive channel), no unbounded lists, no UI work.

## 7. Version history of the agentic line (memory files hold full detail)

| v | commit | What it added |
|---|--------|----------------|
| v24 | `7208bd7` | multi-intent execution, typo tolerance, follow-up frames |
| v25 | `371f930` | workflows (create/run/list/delete/triggers), missions |
| v26 | `b3ee78f` | habit streaks, daily auto-run workflows, mood journal |
| v27 | `7df4bd8` | topic * slots, mission skip/add + idle nudge, daily briefing |
| v28 | `9568807` | weekly review: deltas vs. snapshot + 7-day session-start offer |
| v29 | `d9e159a` | executive round: conditional steps, open topic triggers, read-only mission step, mission queue, habit sparklines |
| v30 | `d17c68d` | cross-platform round: Vision Board bridge (vision.ts), condition negations + streak thresholds, queue editing, reminder escalation, self-improvement gaps report |
| v31 | `9f2ba3b` | stewardship round: chat-sessions bridge with two-step confirm (chats.ts), gaps curation (dismiss/clear), workflow show + step editing |
| v32 | `c58829b` | real-tasks round: email bridge (mail.ts — draft/list/delete + REAL Gmail send behind the two-step confirm), workflow step reordering + renaming |
| v33 | `2dfbdf8` | correspondence round: inbox read, reply-from-context (by sender name), booked sends (closed time vocabulary + session-start runDueSends) |
| v34 | `3271dfa` | slash-command round: /email/to/subject/body shorthand (client + server, splitIntents-guarded), inbox digests through the summarise engine |
| v35 | `f76074c` | awareness round: async evalCondition seam — board-aware and inbox-aware workflow conditions with honest unreachable/not-connected skips |
| v36 | `3d30ad9` | foresight round: workflow dry-run (preview / what-would, reply-only, live conditions) + sync booked-send conditions |
| v37 | `4124524` | horizon round: mission dry-run (the whole remaining tail, read-only) + chats-age conditions (the seam's third source) |
| v38 | `00445c4` | tempo round: weekly workflows (run every <weekday>, the v26 channel) + calendar/clock conditions (weekday/weekend/time-of-day, sync and free) |
| v39 | `c92d992` | hands round: device task queue + name-only runner contract (tasks.ts, navi-runner/), ICS calendar export, workflow run receipts, briefing world line (#24) |
| v40 | `5bfbfed`+`d906065` | muse round: /write slash command (free-text writing prompts, splitIntents-guarded) + new creative kinds (story/song/letter/speech/quote), generative story assembly, char-code variant seed |
| v41 | `0538da0` | rhythm round: monthly workflows (every month on the Nth, 1-28 only), device-task conditions (tasks/results waiting, sync), runner receipts at session-start (free, read-once) |
| v42 | `526e147`+`fa0c6fb` | trust round: run-time send confirm (#17 — Profile.runSend, three-level yes precedence, scheduled runs never send), report headline (#27 reshaped, zero-cost), help refresh, runner set up on Dian's PC |
| v43 | `89fef8d` | reader round: /email/…/send (#21, confirm-gated, client steps aside), single-mail digest (#22, format=full + cleanEmailText), shaped summaries (one-sentence / key-points), runner scheduled polling + log on Dian's PC |
| v44 | `559ecd5` | cadence round: recurring reminders (every day / weekday / 1-28 monthly, roll-on-surface, done rolls, delete stops), snooze, day-of-month conditions, remind.ts crisis guard (v22 gap closed) |
| v45 | `6fc45b7` | almanac round: special-dates book (dates.ts — others' birthdays/anniversaries, yearly, day-of + day-before heads-ups), yearly reminders (every year on {month, day}), event-proximity + special-day conditions |
| v46 | `f574f04` | orchestration round: nested workflow steps (run my X workflow, depth 1, send-law-safe), "otherwise:" else-steps (clean-false only), pause/resume with optional wake date |
| v47 | `073a288` | chronicle round: per-step run receipts (WorkflowRun.topic/steps + "what did my last run do"), the re-run form ("run my X workflow again" replays the receipt topic), mission deadlines (set/show/clear + status countdown + session-start nudge + due-soon/overdue conditions) |
| v48 | (see git) | anthology round: assembled songs (verse/chorus/verse-2/bridge banks, 256 songs), new kinds congrats/comfort/rap, multi-piece asks on caption/quote/affirmation (numbered, clamped honestly), {sender}-signed letters, conversational CRISIS_RX guard on parseCompose |

Test counts: 121 → 132 → 139 → 147 → 153 → 161 → 170 → 178 → 185 → 193 → 196 → 198 → 201 → 204 → 208 → 213 → 217 → 221 → 226 → 233 → 240 → 247 → 256 → 268 → **273**. Keep the number climbing — every
feature lands with parser tests, lifecycle tests, and a negative test proving
ordinary conversation stays untouched.
