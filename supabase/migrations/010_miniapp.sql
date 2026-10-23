-- SPEC §6.0 Mini App «Архив»: preview frame in Storage, "в блог" flag (§5.3), feed/search/facets for the Edge Function.
alter table items
  add column if not exists preview_path text,                    -- previews/<user_id>/<item_id>.jpg
  add column if not exists for_blog boolean not null default false;
create index if not exists items_blog_idx on items (user_id) where for_blog;

-- Private bucket: the Edge Function hands out signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- Feed with filters; with q — words first (title, summary, transcript, caption, author, tags), then by meaning (qvec).
create or replace function archive_feed(uid bigint, f jsonb default '{}', q text default null, qvec vector(1536) default null,
                                        lim int default 30, off int default 0)
returns table (id bigint, created_at timestamptz, title text, author text, summary text, theme text, project text[],
               content_type text, input_kind text, origin text, stance text, value_in text[], for_blog boolean,
               preview_path text, status text, published_at text, word_hit boolean, similarity float)
language sql stable as $$
  with base as (
    select i.*,
      coalesce(q, '') <> '' and (
        i.title ilike '%' || q || '%' or i.summary ilike '%' || q || '%' or i.raw_text ilike '%' || q || '%'
        or i.caption ilike '%' || q || '%' or i.author ilike '%' || q || '%' or i.why_me ilike '%' || q || '%'
        or array_to_string(i.tags, ' ') ilike '%' || q || '%') as hit,
      case when qvec is not null and i.embedding is not null then 1 - (i.embedding <=> qvec) end as sim
    from items i
    where i.user_id = uid and i.status in ('ok', 'pending_media')
      and (f->>'project' is null or i.project @> array[f->>'project'])
      and (f->>'theme' is null or i.theme = f->>'theme')
      and (f->>'type' is null or i.content_type = f->>'type')
      and (f->>'value_in' is null or i.value_in @> array[f->>'value_in'])
      and (f->>'stance' is null or i.stance = f->>'stance')
      and (f->>'source' is null or (case when i.input_kind = 'link' and i.origin is not null and i.origin <> 'other' then i.origin else i.input_kind end) = f->>'source')
      and (coalesce((f->>'blog')::boolean, false) = false or i.for_blog)
  )
  select b.id, b.created_at, b.title, b.author, b.summary, b.theme, b.project, b.content_type, b.input_kind, b.origin, b.stance,
         b.value_in, b.for_blog, b.preview_path, b.status, b.raw_meta->>'published_at', b.hit, b.sim
  from base b
  where coalesce(q, '') = '' or b.hit or b.sim is not null
  order by case when coalesce(q, '') = '' then 0 else (case when b.hit then 2 else 0 end) + coalesce(b.sim, 0) end desc, b.created_at desc
  limit lim offset off;
$$;

-- Counts for the filter sheets and the Topics screen.
create or replace function archive_facets(uid bigint)
returns jsonb language sql stable as $$
  with i as (
    select *, case when input_kind = 'link' and origin is not null and origin <> 'other' then origin else input_kind end as source
    from items where user_id = uid and status in ('ok', 'pending_media')
  ),
  c as (
    select 'project' as k, p as v, count(*) as n from i, unnest(project) p group by p
    union all select 'theme', theme, count(*) from i where theme is not null group by theme
    union all select 'type', content_type, count(*) from i where content_type is not null group by content_type
    union all select 'value_in', v, count(*) from i, unnest(value_in) v group by v
    union all select 'stance', stance, count(*) from i where stance is not null group by stance
    union all select 'source', source, count(*) from i group by source
  )
  select jsonb_build_object(
    'total', (select count(*) from i),
    'blog', (select count(*) from i where for_blog),
    'counts', coalesce((select jsonb_object_agg(k, vals) from (select k, jsonb_object_agg(v, n) as vals from c group by k) x), '{}'::jsonb));
$$;

revoke execute on function archive_feed(bigint, jsonb, text, vector, int, int) from public, anon, authenticated;
revoke execute on function archive_facets(bigint) from public, anon, authenticated;
