-- SPEC §8: the Mini App header shows the user's name or nick; they can change it. null = name from Telegram.
alter table users add column if not exists display_name text;
