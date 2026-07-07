-- NAVI LLM v19 — learning layer.
--
-- Gives NAVI the ability to LEARN and keep what it learns, permanently and
-- shared across every user, with zero external model. Three things live here:
--
--   navi_knowledge — a growing Q->A knowledge base. Every successful web answer
--     NAVI produces is saved here (source 'web'), and anything a signed-in user
--     explicitly teaches it is saved here too (source 'taught', higher trust).
--     Future asks — from anyone, phrased any way — are answered from this table
--     first: instant, offline-resilient, and compounding over time.
--
--   navi_gaps — the questions NAVI could NOT answer (its own knowledge missed
--     AND the web found nothing). Logged with a hit counter so NAVI's most-asked
--     blind spots surface as a self-improvement backlog, auto-resolved once the
--     answer is later taught or learned.
--
-- All tables are service-role only (RLS on, no policies), exactly like
-- navi_bible_verses and navi_memory. The browser never touches them.

create table if not exists public.navi_knowledge (
  id          bigint generated always as identity primary key,
  query_key   text not null unique,          -- normalised question, dedupe key
  query_text  text not null,                 -- refined question, for fuzzy recall
  answer      text not null,
  source      text not null default 'web',   -- 'web' | 'taught'
  confidence  real not null default 1.0,     -- taught starts at 3.0; feedback moves it; <=0 retires
  hits        int  not null default 1,       -- how many times this answer was served
  up          int  not null default 0,
  down        int  not null default 0,
  taught_by   text,                           -- email of the teacher, when source='taught'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.navi_knowledge enable row level security;

create index if not exists navi_knowledge_fts
  on public.navi_knowledge using gin (to_tsvector('english', query_text));

create table if not exists public.navi_gaps (
  id          bigint generated always as identity primary key,
  query_key   text not null unique,
  query_text  text not null,
  hits        int  not null default 1,
  resolved    boolean not null default false,
  last_asked  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.navi_gaps enable row level security;

-- Fuzzy recall: OR the query's significant words into a tsquery so re-phrasings
-- still hit ("who founded navi" finds "the founder of navi is Prophet Dian"),
-- then rank by text relevance * confidence so taught + trusted answers win.
create or replace function public.navi_knowledge_search(q text, max_results int default 5)
returns setof public.navi_knowledge
language sql stable security definer set search_path = public as $$
  with terms as (
    select string_agg(t, ' | ') as ors
    from (
      select distinct t
      from regexp_split_to_table(lower(regexp_replace(coalesce(q, ''), '[^a-z0-9 ]', ' ', 'g')), '\s+') as t
      where length(t) > 2
    ) w
  )
  select k.*
  from public.navi_knowledge k, terms
  where k.confidence > 0
    and terms.ors is not null and terms.ors <> ''
    and to_tsvector('english', k.query_text) @@ to_tsquery('english', terms.ors)
  order by ts_rank(to_tsvector('english', k.query_text), to_tsquery('english', terms.ors)) * k.confidence desc
  limit greatest(1, least(coalesce(max_results, 5), 10));
$$;

-- Learn (or update) one answer. Taught answers overwrite weaker web answers and
-- keep the higher confidence; a repeat of the same source just bumps hits.
create or replace function public.navi_learn(
  p_key text, p_text text, p_answer text, p_source text, p_conf real, p_email text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.navi_knowledge (query_key, query_text, answer, source, confidence, taught_by)
  values (p_key, p_text, p_answer, coalesce(p_source, 'web'), coalesce(p_conf, 1.0), p_email)
  on conflict (query_key) do update set
    -- taught always wins; web only refreshes another web answer
    answer     = case when excluded.source = 'taught' or navi_knowledge.source <> 'taught'
                      then excluded.answer else navi_knowledge.answer end,
    query_text = case when excluded.source = 'taught' or navi_knowledge.source <> 'taught'
                      then excluded.query_text else navi_knowledge.query_text end,
    source     = case when excluded.source = 'taught' then 'taught' else navi_knowledge.source end,
    confidence = greatest(navi_knowledge.confidence, excluded.confidence),
    taught_by  = coalesce(excluded.taught_by, navi_knowledge.taught_by),
    hits       = navi_knowledge.hits + 1,
    updated_at = now();
  -- once we can answer it, it's no longer a gap
  update public.navi_gaps set resolved = true where query_key = p_key;
end;
$$;

-- Reinforce from user feedback. Positive nudges confidence up; negative pushes
-- it down and, once it crosses zero, retires the wrong answer so NAVI stops
-- repeating a mistake it was corrected on.
create or replace function public.navi_feedback(p_key text, p_delta real)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.navi_knowledge set
    confidence = confidence + p_delta,
    up   = up   + (case when p_delta > 0 then 1 else 0 end),
    down = down + (case when p_delta < 0 then 1 else 0 end),
    updated_at = now()
  where query_key = p_key;
  delete from public.navi_knowledge where query_key = p_key and confidence <= 0;
end;
$$;

-- Log a blind spot (or bump its counter). Skips anything already learned.
create or replace function public.navi_gap(p_key text, p_text text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.navi_knowledge where query_key = p_key and confidence > 0) then
    return;
  end if;
  insert into public.navi_gaps (query_key, query_text)
  values (p_key, p_text)
  on conflict (query_key) do update set
    hits = navi_gaps.hits + 1,
    last_asked = now();
end;
$$;
