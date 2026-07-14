# NAVI Agentic & Execution Capabilities — Hand-Down File

**For any future Claude session (or developer) continuing this work.**
Last updated: 2026-07-14, at **v36** (the foresight round).

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

**Golden rule of wiring:** anything agentic that consumes multi-part phrasing
goes BEFORE `splitIntents`; anything that appends passive reports goes in the
session-start block inside the `!isCrisisReply(response)` guard; anything that
mutates the profile must either return it from its `try*` (early-return paths
save immediately) or mutate `stored` via `Object.assign` (session-start paths
ride the final save — `mergeProfiles` spreads the base, so mission/workflow
changes survive).

## 3. The agentic layer today (what exists, where)

### agent.ts — workflows & missions (v25→v36) · mail.ts (v32→v35)

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
   (One sanctioned exception so far: v34's /email slash form in App.tsx's
   email intercept — Dian requested that format explicitly. The lock stands
   for everything else.)
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

21. **Slash-form sends from chat** — "/email/…" currently only DRAFTS.
    A trailing `/send` segment could stamp the v32 offer in the same turn
    (like the "send an email to …" verb already does) — cheap, symmetrical,
    still confirm-gated. (NOTE: Dian declared the email tool COMPLETE after
    v34 — don't build #21/#22 without being asked.)
22. **Digest depth** — the digest reads 5 snippets; "summarise the last
    email from sam" (one mail, format=full body through summarize) is the
    natural next read — still zero external LLM, still read-only. (Same
    note as #21: email tool declared complete.)

Post-v35 candidates (the execution line beyond email):

23. **More world conditions on the seam** — PARTLY DONE in v36 (the
    booked-send pair, sync). Still open: "when i have chats older than N
    days:" (chats.ts counts — needs a third source). Add sources sparingly;
    every one is a live network call inside a workflow run.
24. **Condition-aware briefing line** — "brief me" could append one line of
    world state (board count, unread count) — read-only, but it makes the
    briefing a network call; weigh against the instant-reply feel.
25. ~~**Workflow dry-run**~~ — SHIPPED in v36 (preview/dry run/what-would,
    reply-only, live conditions, slotted topics, nothing executes).

Post-v36 candidates:

26. **Mission dry-run** — "what would finish my mission?" reads the remaining
    steps back (pure read, missionStatus already shows the current one — this
    shows the whole tail). Small, honest, zero risk.
27. **Preview-before-daily** — the session-start daily report could open with
    a one-line preview summary ("2 of 4 steps will run") — but it doubles the
    condition fetches per run; probably not worth it. Decide with Dian.

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
| v36 | (see git) | foresight round: workflow dry-run (preview / what-would, reply-only, live conditions) + sync booked-send conditions |

Test counts: 121 → 132 → 139 → 147 → 153 → 161 → 170 → 178 → 185 → 193 → 196 → 198 → **201**. Keep the number climbing — every
feature lands with parser tests, lifecycle tests, and a negative test proving
ordinary conversation stays untouched.
