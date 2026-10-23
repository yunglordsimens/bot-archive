-- Nearest saved item by embedding — for the "похоже на: …" line after saving.
create function nearest_item(query vector(1536), exclude bigint)
returns table (id bigint, title text, summary text, created_at timestamptz, similarity float)
language sql stable as $$
  select id, title, summary, created_at, 1 - (embedding <=> query) as similarity
  from items
  where id <> exclude and embedding is not null and status in ('ok', 'pending_media')
  order by embedding <=> query
  limit 1;
$$;
revoke execute on function nearest_item(vector, bigint) from public, anon, authenticated;
