-- NAVI Bible knowledge: complete KJV (public domain), 31,102 verses / 66 books.
-- Verse data is loaded out-of-band via the Management API SQL endpoint
-- (batch inserts) — this migration only defines the schema and search RPC.
-- RLS enabled with no policies: only edge functions (service role) read it.

create table if not exists public.navi_bible_verses (
  id integer generated always as identity primary key,
  book_num smallint not null,
  book text not null,
  chapter smallint not null,
  verse smallint not null,
  text text not null,
  unique (book_num, chapter, verse)
);

create index if not exists navi_bible_verses_fts
  on public.navi_bible_verses using gin (to_tsvector('english', text));

alter table public.navi_bible_verses enable row level security;

-- Two-pass topic search: strict websearch semantics first (all terms),
-- then an any-term fallback so queries like "strength and courage" still
-- land on "be strong and of a good courage".
create or replace function public.navi_bible_search(q text, max_results int default 3)
returns table (book text, chapter smallint, verse smallint, text text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  tsq tsquery := websearch_to_tsquery('english', q);
  lim int := greatest(1, least(max_results, 10));
begin
  if tsq is not null and tsq::text <> '' then
    return query
      select v.book, v.chapter, v.verse, v.text
      from navi_bible_verses v
      where to_tsvector('english', v.text) @@ tsq
      order by ts_rank(to_tsvector('english', v.text), tsq) desc, v.id
      limit lim;
    if found then return; end if;
  end if;
  tsq := (select to_tsquery('english', string_agg(lexeme, ' | '))
          from (select distinct unnest(tsvector_to_array(to_tsvector('english', q))) as lexeme) t);
  if tsq is null or tsq::text = '' then return; end if;
  return query
    select v.book, v.chapter, v.verse, v.text
    from navi_bible_verses v
    where to_tsvector('english', v.text) @@ tsq
    order by ts_rank(to_tsvector('english', v.text), tsq) desc, v.id
    limit lim;
end;
$fn$;
