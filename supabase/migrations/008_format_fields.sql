-- SPEC §5.3a: what's in the frame separate from the transcript; why it was saved and how the owner relates to it.
alter table items
  add column visual_description text,          -- what is seen in the frame (raw_text = speech + on-screen text)
  add column value_in text[] not null default '{}', -- info | visual | audio | format | meta
  add column stance text,                      -- like | dislike | anti_example | replicate | format_idea | seen_before | example
  add column comments_note text;               -- "В комментах: …" — useful bits from top comments
create index items_value_in_idx on items using gin (value_in);
