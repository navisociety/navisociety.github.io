-- NAVI permanent memory (v18, 2026-07-07).
--
-- Until now NAVI's personal memory was rebuilt from the conversation history on
-- every request (see supabase/functions/navi-chat/memory.ts) — so anything the
-- user asked NAVI to remember vanished the moment a chat session ended and never
-- crossed into other chats or devices. This table gives NAVI ONE durable memory
-- per user (keyed by email), loaded and updated by the navi-chat edge function
-- on every message. The whole extracted profile (name, age, place, birthday,
-- favourites, goals, work, people, freeform "remember that…" facts) lives in the
-- `profile` jsonb; last_seen and last_mood are kept as columns so returning-user
-- greetings and mood check-ins can query them cheaply.
--
-- Like navi_bible_verses, this is written ONLY by the edge function via the
-- service role, which bypasses RLS. RLS is enabled with no policies so the
-- anon/publishable key (and therefore the browser bundle) can never read or
-- write another person's memory.

create table if not exists public.navi_memory (
  email      text primary key,
  profile    jsonb       not null default '{}'::jsonb,
  last_seen  timestamptz,
  last_mood  text,
  updated_at timestamptz not null default now()
);

alter table public.navi_memory enable row level security;
-- No policies on purpose: only the service role (edge function) touches this.
