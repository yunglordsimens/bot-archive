-- SPEC §5.0: project = life direction(s), separate from content_type (what it is) and theme (what it's about).
alter table items add column project text[] not null default '{}';
create index items_project_idx on items using gin (project);

-- Queue respects next_retry_at, so transient failures (Gemini 503) can be retried a few minutes later.
create or replace function claim_items(n int) returns setof items
language sql as $$
  update items set status = 'processing', attempts = attempts + 1, updated_at = now()
  where id in (
    select id from items
    where status = 'queued' and (next_retry_at is null or next_retry_at <= now())
    order by id limit n for update skip locked
  )
  returning *;
$$;
revoke execute on function claim_items(int) from public, anon, authenticated;
