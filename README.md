# navisociety.github.io

**NAVI** — the intelligent AI companion for NAVISOCIETY, created by Prophet
Dian. A static Vite + React + TypeScript SPA deployed to GitHub Pages at
**https://navisociety.github.io**, with a Claude-powered backend.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS (brand: black bg, cyan `#00F7FF`, magenta `#FF00E5`, lime
  `#B6FF00`, Fredoka font)
- Auth + data + Edge Function backend (`src/lib/supabase.ts`)
- Claude Haiku 4.5 powers NAVI's replies via an Edge Function

The frontend is a pure static bundle (`vite build` → `dist/`), published by
GitHub Actions. The chat reply and message persistence run on the backend.

## Access control (single account)

NAVI is restricted to **prophetdian@gmail.com** at three layers:

1. **UI** — after Google sign-in, any other email gets a branded *Access
   Denied* screen and is signed out (`src/App.tsx`).
2. **Database RLS** — policies on the `messages` table let a user read/write
   only their own rows (`supabase/migrations/*.sql`).
3. **Edge Function** — the `chat` function rejects any caller whose JWT email
   is not prophetdian@gmail.com before calling Claude
   (`supabase/functions/chat/index.ts`).

## Environment

Build-time env vars (publishable / anon — safe to ship) are injected by the
GitHub Actions workflow:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The **secret / service_role** key and the **Anthropic API key** must never
appear in this repo or any `VITE_` var. The Anthropic key lives only as a
backend secret (`ANTHROPIC_API_KEY`).

## Local dev

```bash
npm install
cp .env.example .env
npm run dev
```

## Frontend deploy

Push to `main`. `.github/workflows/deploy.yml` builds and publishes `dist/` to
GitHub Pages automatically.

---

## Backend setup — manual steps for Dian

These cannot be done by a `git push`. Run them once (requires the
[Supabase CLI](https://supabase.com/docs/guides/cli) and a Supabase access
token: `supabase login`).

### 1. Link the project

```bash
supabase link --project-ref irssegzkvxyewuxgqpwi
```

### 2. Create the messages table + RLS

Either push the migration:

```bash
supabase db push
```

…or open **Supabase Studio → SQL Editor**, paste the contents of
`supabase/migrations/20260623000000_messages.sql`, and run it.

### 3. Set the Anthropic API key as a secret

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

(Replace `sk-ant-...` with the real key. This key is **never** committed or
shipped to the browser.)

### 4. Deploy the chat Edge Function

```bash
supabase functions deploy chat
```

The function uses `SUPABASE_URL` and `SUPABASE_ANON_KEY`, which Supabase injects
automatically — no extra config needed for those.

### 5. Enable Google OAuth

In **Supabase Studio → Authentication → Providers → Google**:

1. Enable the Google provider.
2. Paste your Google OAuth **Client ID** and **Client Secret** (from the
   [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services
   → Credentials → OAuth 2.0 Client ID).
3. In the Google Cloud OAuth client, add this **Authorized redirect URI**:
   ```
   https://irssegzkvxyewuxgqpwi.supabase.co/auth/v1/callback
   ```
4. In **Supabase Studio → Authentication → URL Configuration**, set:
   - **Site URL**: `https://navisociety.github.io`
   - **Redirect URLs**: add `https://navisociety.github.io`

Once these are done, sign in at https://navisociety.github.io with
prophetdian@gmail.com and NAVI will respond with Claude.

> **Email/password fallback:** if Google OAuth isn't set up yet, you can enable
> the Email provider in Supabase and create the single account
> prophetdian@gmail.com. The UI is built around Google sign-in, but the same
> three-layer email gate applies to any provider.
