# navi-runner — NAVI's hands on a device

Chat side (v39): `run backup on my pc` queues an **auto task** — a *name*,
never a command. This script, running on the device itself, is the only thing
that can turn that name into execution, and only through its own local
allowlist. `any results from my pc` in chat reads the receipts back.

## The safety contract

- **Chat queues names; this device defines meanings.** `tasks.config.json`
  maps names to commands and lives only on this device (gitignored). A name
  that isn't defined here is refused with an honest receipt.
- **The runner polls; NAVI never pushes.** Nothing runs until you run this
  script (or schedule it yourself with Task Scheduler / cron).
- Only allowlist commands that are safe to run at **any** time, and whose
  output may appear in your NAVI chat.

## Setup

```bash
cp navi-runner/tasks.config.example.json navi-runner/tasks.config.json
# edit tasks.config.json — name: command, one per task you want callable

SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
NAVI_EMAIL=you@example.com \
NAVI_DEVICE=pc \
node navi-runner/poll.js
```

`NAVI_DEVICE` must match what you call the device in chat ("run backup on my
**pc**"). The script runs once and exits: it executes every waiting auto task
for this device (2-minute timeout each), stamps a one-line `ok/failed/refused`
receipt on each, and writes the receipts back to the profile row.

Like `navi-brain/`, this is local plumbing — never bundled, never in CI, and
the service-role key is env-only (`navi-runner/.env` is gitignored).
