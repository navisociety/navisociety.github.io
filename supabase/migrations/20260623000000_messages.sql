-- NAVI messages table + row-level security.
--
-- Stores every user and assistant message. RLS ensures a user can only read
-- and write their own rows. Combined with the UI gate and the Edge Function
-- email check, this is layer 2 of restricting access to prophetdian@gmail.com.
--
-- Apply with either:
--   supabase db push
-- or paste into the Supabase Studio SQL editor and run.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);

alter table public.messages enable row level security;

-- A user may read only their own messages.
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own"
  on public.messages
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert only rows owned by themselves.
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may delete only their own messages.
drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages
  for delete
  to authenticated
  using (auth.uid() = user_id);
