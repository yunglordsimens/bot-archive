-- SPEC §5.4: users instead of a whitelist; every item belongs to a user. The owner (585800070) gets all existing items.
create table users (
  id                 bigint generated always as identity primary key,
  telegram_user_id   bigint not null unique,
  name               text,
  lang               text not null default 'ru' check (lang in ('ru', 'cs', 'en', 'vi')),
  archive_channel_id bigint,
  projects           jsonb,       -- {direction: hint}; null = defaults for the language
  themes             text[],      -- null = defaults for the language
  is_admin           boolean not null default false,
  added_by           bigint,
  created_at         timestamptz not null default now()
);
alter table users enable row level security;

insert into users (telegram_user_id, name, lang, archive_channel_id, is_admin, projects)
values (585800070, 'owner', 'ru',
  (select nullif(value, '')::bigint from settings where key = 'archive_channel_id'),
  true,
  '{"Lock in / деньги": "заработок, продуктивность, дисциплина, финансы", "OFST": "", "обмен": "", "дропшиппинг": "товары, поставщики, магазины, реклама товаров", "сайты на продажу": "сделать сайт и продать его, веб-студия, клиенты на сайты", "UMPRUM": "учёба в UMPRUM (Прага): задания, курсы, преподаватели", "личный бренд": "свой контент, соцсети, как себя показывать", "арт и портфолио": "собственные работы, портфолио, выставки", "другой бизнес": "бизнес-идеи вне перечисленных направлений", "здоровье и быт": "здоровье, спорт, еда, дом", "státnice": "государственные экзамены (státnice): подготовка, вопросы", "разное": "ничего из перечисленного"}'::jsonb);

alter table items add column user_id bigint references users(id);
update items set user_id = (select id from users where telegram_user_id = 585800070);
alter table items alter column user_id set not null;
create index items_user_idx on items (user_id, status, id desc);
create index items_user_hash_idx on items (user_id, text_hash);

alter table themes add column user_id bigint references users(id);

drop function nearest_item(vector, bigint);
create function nearest_item(query vector(1536), exclude bigint, uid bigint)
returns table (id bigint, title text, summary text, created_at timestamptz, similarity float)
language sql stable as $$
  select id, title, summary, created_at, 1 - (embedding <=> query) as similarity
  from items
  where user_id = uid and id <> exclude and embedding is not null and status in ('ok', 'pending_media')
  order by embedding <=> query
  limit 1;
$$;
revoke execute on function nearest_item(vector, bigint, bigint) from public, anon, authenticated;
