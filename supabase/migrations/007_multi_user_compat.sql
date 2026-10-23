-- Until the multi-user bot code ships, rows inserted without user_id belong to the owner (users.id = 1).
alter table items alter column user_id set default 1;

-- Old 2-argument signature used by the single-user bot.
create function nearest_item(query vector(1536), exclude bigint)
returns table (id bigint, title text, summary text, created_at timestamptz, similarity float)
language sql stable as $$ select * from nearest_item(query, exclude, (select user_id from items where id = exclude)) $$;
revoke execute on function nearest_item(vector, bigint) from public, anon, authenticated;
