# NAVI Agentic & Execution Capabilities — Hand-Down File

**For any future Claude session (or developer) continuing this work.**
Last updated: 2026-07-10, at **v31** (the stewardship round), live and verified.

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
                               workflows (runDailyWorkflows) → mission nudge
                               (missionNudge) → reminder escalation offer
                               (reminderEscalation, v30) → weekly-review offer
                               (reviewOffer)                    ← v27/v28/v30
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

**Golden rule of wiring:** anything agentic that consumes multi-part phrasing
goes BEFORE `splitIntents`; anything that appends passive reports goes in the
session-start block inside the `!isCrisisReply(response)` guard; anything that
mutates the profile must either return it from its `try*` (early-return paths
save immediately) or mutate `stored` via `Object.assign` (session-start paths
ride the final save — `mergeProfiles` spreads the base, so mission/workflow
changes survive).

## 3. The agentic layer today (what exists, where)

### agent.ts — workflows & missions (v25→v31)

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

11. **More cross-platform bridges** — PARTLY SHIPPED in v31: the chat-sessions
    bridge (chats.ts) joins the Vision Board. Still open: Create-tool
    creations, Share drafts. Each new bridge is a vision.ts/chats.ts sibling;
    keep photos/files tool-managed. The chats bridge adds a new reusable
    pattern to the family: the TWO-STEP CONFIRM for destructive ops (offer
    stamp on the profile + fresh-bare-yes window + re-count at execute).
12. **Board-aware conditions** — "when my vision board is empty: …" needs an
    async evalCondition seam (today it's sync); only worth it with a second
    async condition source.
13. ~~**Owner analytics on gaps**~~ — SHIPPED in v31 (tryGapsManage: dismiss
    gap N / clear my learning list, owner-only).
14. **Workflow reordering / renaming** — step editing shipped in v31; "move
    step 3 up" and "rename my morning workflow to sunrise" are the natural
    completions if editing sees real use.

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
| v31 | (see git) | stewardship round: chat-sessions bridge with two-step confirm (chats.ts), gaps curation (dismiss/clear), workflow show + step editing |

Test counts: 121 → 132 → 139 → 147 → 153 → 161 → 170 → **178**. Keep the number climbing — every
feature lands with parser tests, lifecycle tests, and a negative test proving
ordinary conversation stays untouched.
