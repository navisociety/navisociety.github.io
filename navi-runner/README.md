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

## Hands-free polling (v43)

`run-runner.cmd` (Windows) and `run-runner.sh` (everything else) run the
poll, reading `navi-runner/.env`, and append output to
`navi-runner/runner.log` (gitignored) so runs leave a trail. Both pass
arguments through to `poll.js`.

**Windows** — register with Task Scheduler (the owner scheduling their own
device, so the no-server-push rule stands):

```
schtasks /Create /TN "NAVI Runner" /TR "\"<repo>\navi-runner\run-runner.cmd\"" /SC MINUTE /MO 15
```

Check the trail with `type navi-runner\runner.log`, and pause anytime with
`schtasks /Change /TN "NAVI Runner" /DISABLE` (or `/DELETE` to remove).

**Loop mode** — on any device, `--loop [seconds]` polls forever (minimum
60s, default 900s) without a scheduler; one bad poll never kills the loop,
and the allowlist is re-read every poll so edits apply live:

```bash
sh run-runner.sh --loop 900
```

## The runner on a phone (v43)

Android, via [Termux](https://termux.dev) (install from F-Droid — the Play
Store build is stale):

```bash
pkg install nodejs-lts git
git clone https://github.com/navisociety/navisociety.github.io
cd navisociety.github.io/navi-runner
cp tasks.config.phone.example.json tasks.config.json

cat > .env <<'EOF'
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
NAVI_EMAIL=you@example.com
NAVI_DEVICE=phone
EOF

sh run-runner.sh              # one poll
sh run-runner.sh --loop 900   # keep polling while Termux stays open
```

Then in chat: `run hello on my phone` → next poll → `any results from my
phone`. `NAVI_DEVICE=phone` must match what you call it in chat.

- The `battery` example task needs `pkg install termux-api` **and** the
  Termux:API companion app; drop it from the config if you don't want that.
- For polling that survives reboots, add the Termux:Boot app or
  `pkg install cronie termux-services` — same contract, you schedule it.
- **Security**: `.env` holds the service-role key (it bypasses RLS). Keep it
  inside Termux's private storage (where `git clone` puts it), keep the
  phone locked, and delete `.env` if the phone changes hands.
