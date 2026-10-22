-- Bot-archive schema. Columns for post-MVP features (docs sync, hooks, clusters) are present but unused.
create extension if not exists vector;

create table items (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- intake
  source_type      text not null,          -- tiktok | youtube | instagram | web | text | screenshot | voice | audio | video | video_note
  source_url       text,
  tg_chat_id       bigint not null,
  tg_message_id    bigint not null,
  reply_message_id bigint,                 -- bot's "принято" message, edited with the result
  batch_id         text,                   -- media_group_id for albums
  input            jsonb not null default '{}', -- file_id, mime, text, caption, forward info
  forward_author   text,
  forward_date     timestamptz,

  -- queue
  status           text not null default 'queued'
                   check (status in ('queued','processing','ok','pending_media','failed','duplicate')),
  attempts         int not null default 0,
  error            text,
  next_retry_at    timestamptz,
  duplicate_of     bigint references items(id),

  -- source metadata
  author           text,
  caption          text,
  original_date    timestamptz,

  -- AI result
  title            text,
  summary          text,
  content_type     text,                   -- tip | recipe | idea | funny | reference | other
  kind             text,                   -- free label: meme, tweet, note, receipt...
  theme            text,
  tags             text[] not null default '{}',
  structured       jsonb,
  raw_text         text,
  embedding        vector(1536),

  -- originals (Telegram archive channel)
  archive_file_ids text[] not null default '{}',
  archive_link     text,
  file_hash        text,

  -- future
  doc_synced_at    timestamptz,
  hook_analysis    jsonb,
  cluster_id       int
);

create index items_status_idx on items (status, next_retry_at);
create index items_theme_idx on items (theme, created_at desc);
create index items_type_idx on items (content_type, created_at desc);
create index items_batch_idx on items (batch_id);
create index items_url_idx on items (source_url);
create index items_hash_idx on items (file_hash);
create index items_tags_idx on items using gin (tags);
create index items_embedding_idx on items using hnsw (embedding vector_cosine_ops);

create table settings (
  key   text primary key,
  value text not null
);

-- Atomically take up to n queued items for the worker.
create function claim_items(n int) returns setof items
language sql as $$
  update items set status = 'processing', attempts = attempts + 1, updated_at = now()
  where id in (
    select id from items where status = 'queued'
    order by id limit n for update skip locked
  )
  returning *;
$$;

revoke execute on function claim_items(int) from public, anon, authenticated;

-- Bot uses the service role; no anon access.
alter table items enable row level security;
alter table settings enable row level security;
