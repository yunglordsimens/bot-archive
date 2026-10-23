-- /notify: after saving, send one line with a link to the archive post into the chat (off = only reactions and errors).
alter table users add column notify boolean not null default false;
