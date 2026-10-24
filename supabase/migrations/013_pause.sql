-- SPEC §7 /pause: per-user pause of Gemini processing. Items of a paused user are saved, downloaded and posted
-- to the archive channel as originals, with status 'paused'; /resume puts them back to 'queued'.
alter table users add column if not exists paused boolean not null default false;

alter table items drop constraint items_status_check;
alter table items add constraint items_status_check
  check (status in ('paused', 'queued', 'processing', 'ok', 'pending_media', 'failed', 'duplicate'));
