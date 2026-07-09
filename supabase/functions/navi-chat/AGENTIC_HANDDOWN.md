# NAVI Agentic & Execution Capabilities — Hand-Down File

**For any future Claude session (or developer) continuing this work.**
Last updated: 2026-07-09, at **v28** (weekly review), live and verified.

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
                               (missionNudge) → weekly-review offer
                               (reviewOffer)                    ← v27/v28
  → end-of-request save       mergeProfiles + mood journal + topics → upsert
```

**Golden rule of wiring:** anything agentic that consumes multi-part phrasing
goes BEFORE `splitIntents`; anything that appends passive reports goes in the
session-start block inside the `!isCrisisReply(response)` guard; anything that
mutates the profile must either return it from its `try*` (early-return paths
save immediately) or mutate `stored` via `Object.assign` (session-start paths
ride the final save — `mergeProfiles` spreads the base, so mission/workflow
changes survive).

## 3. The agentic layer today (what exists, where)

### agent.ts — workflows & missions (v25→v27)
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
2. **Conditional workflow steps** — "if I haven't logged my prayer habit,
   remind me" → a small `when <condition>:` step prefix evaluated against the
   profile before running the step. Keep conditions to a closed vocabulary
   (habit logged / reminder due / mood is X / mission idle).
3. **Trigger phrases with topics** — "when I say study <topic>, run my study
   workflow on <topic>" (trigger prefix match capturing the remainder as the
   slot fill). The v27 slot machinery already does the hard part.
4. **Mission-aware workflow steps** — allow the literal step "my next mission
   step" inside a workflow to surface the current step (read-only), so a
   morning routine can include the mission. Requires relaxing the "workflows
   can't reference missions" guard for this one safe, read-only phrase.
5. **Multiple queued missions** — keep ONE active, but allow "queue a mission
   to X" (a backlog list, cap ~3) that auto-promotes on completion. Preserves
   the focus philosophy while capturing ambition.
6. **Reminder → workflow escalation** — a reminder that survives 3+ sessions
   gets offered: "want me to make this a mission step or a daily habit?"
   (Detection is trivial: reminders carry `created`.)
7. **Self-improvement loop on gaps** — `navi_gaps` already logs what NAVI
   couldn't answer. A "what should I learn?" ask (Dian-only) that reads the
   top gaps is agency applied to NAVI itself.
8. **Progress analytics in the briefing** — tiny sparkline-style text (e.g.
   habit: `✓✓·✓✓✓·`) once weekly review exists. Text only; no UI changes.

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
| v28 | (see git) | weekly review: deltas vs. snapshot + 7-day session-start offer |

Test counts: 121 → 132 → 139 → 147 → **153**. Keep the number climbing — every
feature lands with parser tests, lifecycle tests, and a negative test proving
ordinary conversation stays untouched.
