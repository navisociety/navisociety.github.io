# CLAUDE.md — NAVI

This file documents NAVI for any future Claude session or developer working in this repo.

## What NAVI is

NAVI is Prophet Dian's personal AI companion site, served as a static
single-page app at **https://navisociety.github.io** (bare org root).
Access is gated to a single user: `prophetdian@gmail.com`.

- Stack: Vite + React 18 + TypeScript + Tailwind, Supabase as the data/auth layer.
- Deploy: GitHub Actions on every push to `main` (see `.github/workflows`).
- Brand: black background; cyan / magenta / lime accents; Fredoka font; NAVI avatar at `public/navi.png`.

## How it works (architecture)

NAVI is a static client plus a Supabase backend plus a local "brain" loop.
There is **no server in this repo** and **no edge function** — replies are
produced out-of-band and delivered over Supabase Realtime.

1. **Auth — email magic link.** Login is `supabase.auth.signInWithOtp` with
   `emailRedirectTo = SITE_URL`. No passwords, no OAuth. After auth the email
   must equal `prophetdian@gmail.com` (`ALLOWED_EMAIL` in `src/lib/supabase.ts`),
   otherwise the UI shows Access Denied and signs out. Enforced at the UI layer
   and the database RLS layer.

2. **Chat write path.** Sending a message inserts a row into the public
   `messages` table: `{ user_id, role: 'user', content, status: 'pending' }`.

3. **Realtime read path.** The client subscribes to Supabase Realtime
   (`postgres_changes`, INSERT, filtered `user_id=eq.<id>`) and renders assistant
   rows as they arrive. "NAVI is thinking..." shows until the reply lands.

4. **NAVI brain — `navi-brain/poll.js`.** Run locally (NOT in CI, NOT bundled).
   `listPending()` returns pending user messages oldest-first, each with the
   last-10-message context. NAVI generates the reply text at runtime, then
   `postReply()` inserts the assistant row (`status: 'answered'`) and marks the
   user message answered.

### `messages` table (public schema)

| column     | type        | notes                                           |
|------------|-------------|-------------------------------------------------|
| id         | uuid        | PK, `gen_random_uuid()`                          |
| user_id    | uuid        | FK -> `auth.users`                               |
| role       | text        | `'user'` or `'assistant'`                        |
| content    | text        | message body                                     |
| status     | text        | `'pending'` / `'answered'`, default `'pending'`  |
| created_at | timestamptz | default `now()`                                  |

- **RLS:** enabled. Policies: `Users own messages` (public role, ALL) and
  `Service role full access` (service_role, ALL).
- **Realtime:** `messages` is in the `supabase_realtime` publication.
- **Auth config:** email enabled; Google + anonymous disabled; site URL and
  redirect allow-list set to `https://navisociety.github.io`.

## Credentials (NEVER hardcoded)

No secret ever enters this repo, the git history, the static bundle, or any
`VITE_` variable. After any change, scan `dist` for `sb_secret`, `sbp_`, and
`sk-ant` — there must be zero hits.

- **Client-safe (anon/publishable key only):** `sb_publishable_...` — the only
  Supabase key allowed in the bundle. Configured via `.env` (see `.env.example`).
- **Service role key (`sb_secret_...`):** used ONLY by `navi-brain/poll.js`,
  read from `process.env.SUPABASE_SERVICE_ROLE_KEY`. Stored locally in
  `navi-brain/.env` (gitignored). Also held as a Supabase project secret.
- **Management token (`sbp_...`):** used out-of-band for backend admin
  (DDL/RLS/realtime/auth config) via the Supabase Management API. Never in repo.
- **Anthropic API key (`sk-ant-...`):** when wired for instant automated
  replies, stored as a Supabase secret / local env var only — never in repo.

## Running the poll script manually

The script runs once and exits (it does not loop):

```bash
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> node navi-brain/poll.js
```

It prints the pending queue as JSON plus a count. Reply generation and posting
are driven by NAVI at runtime, not by the script itself.

## Deploy / verify checklist

- Push to `main` -> GitHub Actions builds and deploys to the org root.
- Live login screen must show the magic-link email form (not a Google button)
  plus `public/navi.png`; the site must return 200.
- The Actions run must conclude `success`.
