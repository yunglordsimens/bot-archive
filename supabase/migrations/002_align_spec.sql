-- Align with SPEC.md §2 names; future-phase fields (themes, hook, save_reason, my_note…) stay empty in MVP.
-- Deviations kept on purpose (MVP.md wins): status/queue fields, `theme` text from the fixed list,
-- `kind`, `author`, `title`, originals in the Telegram archive channel (archive_file_ids/archive_link) instead of Storage.
create table themes (
  id            uuid primary key default gen_random_uuid(),
  label         text,
  synthesis     text,
  next_step     text,
  item_count    int default 0,
  last_added_at timestamptz,
  momentum      real,
  status        text,          -- recurring | active | dormant
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table themes enable row level security;

alter table items rename column source_type to input_kind;   -- tiktok | link | text | forwarded | screenshot | voice | audio | video | video_note | document
alter table items rename column forward_author to origin_detail;
alter table items rename column original_date to occurred_at;
alter table items rename column file_hash to media_hash;
alter table items rename column hook_analysis to hook;
alter table items drop column forward_date;
alter table items drop column cluster_id;
alter table items
  add column origin         text,        -- telegram | tiktok | youtube | instagram | other
  add column tg_file_id     text,
  add column media_path     text,
  add column text_hash      text,        -- sha256 of normalized url / text
  add column save_reason    text,
  add column hook_embedding vector(1536),
  add column my_note        text,
  add column language       text[],
  add column theme_id       uuid references themes(id),
  add column raw_meta       jsonb;       -- download path + log, model info

alter index items_hash_idx rename to items_media_hash_idx;
drop index items_url_idx;
create index items_text_hash_idx on items (text_hash);
create index items_created_idx on items (created_at desc);
create index items_kind_idx on items (input_kind);
