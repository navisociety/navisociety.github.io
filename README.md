# navisociety.github.io

NAVI — the AI companion for NAVISOCIETY. A static Vite + React + Supabase SPA
deployed to GitHub Pages at **https://navisociety.github.io**.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS (brand: black bg, cyan `#00F7FF`, magenta `#FF00E5`, lime `#B6FF00`, Fredoka font)
- Supabase JS client (`@supabase/supabase-js`) — `src/lib/supabase.ts`

No backend server. Pure static bundle (`vite build` → `dist/`).

## Environment

Build-time env vars (publishable / anon — safe to ship):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

These are injected by the GitHub Actions workflow. The Supabase **secret /
service_role** key must never appear in this repo or any `VITE_` var.

## Local dev

```bash
pnpm install   # or npm install
cp .env.example .env
pnpm dev
```

## Deploy

Push to `main`. `.github/workflows/deploy.yml` builds and publishes `dist/` to
GitHub Pages.

## Not wired yet

- NAVI chat replies are **stubbed** — there is no Supabase table or Edge
  Function backing the LLM yet. Connect a Supabase Edge Function to enable live
  responses.
