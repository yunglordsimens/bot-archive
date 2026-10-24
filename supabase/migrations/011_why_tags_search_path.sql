-- SPEC §3: «Зачем мне» labels — how the item can be used: asset | strategy | ofst | content | interesting.
alter table items add column if not exists why_tags text[] not null default '{}';
create index if not exists items_why_tags_idx on items using gin (why_tags);

-- Supabase linter (function_search_path_mutable): pin search_path on every function. pgvector lives in public.
alter function claim_items(int) set search_path = public, pg_temp;
alter function nearest_item(vector, bigint, bigint) set search_path = public, pg_temp;
alter function nearest_item(vector, bigint) set search_path = public, pg_temp;
alter function archive_feed(bigint, jsonb, text, vector, int, int) set search_path = public, pg_temp;
alter function archive_facets(bigint) set search_path = public, pg_temp;
