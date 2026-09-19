-- Realtime is a notification channel only. Clients still pull durable
-- sync_changes by cursor, so missed WebSocket events do not lose data.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_changes'
  ) then
    alter publication supabase_realtime add table public.sync_changes;
  end if;
end $$;

-- Offline edits carry their local updated_at. An offline replay may replace a
-- cloud row only if its edit timestamp is newer; ordinary online upserts keep
-- their existing last-accepted-write semantics and server-stamped updated_at.
create or replace function public.push_offline_workspace_change(
  p_entity_type text,
  p_id text,
  p_workspace_id uuid,
  p_payload jsonb,
  p_deleted_at timestamptz,
  p_local_updated_at timestamptz
)
returns table(applied boolean, revision bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_table text;
  saved_revision bigint;
begin
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id, auth.uid()) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  if p_id is null or p_id = '' or p_payload is null or p_local_updated_at is null then
    raise exception 'Invalid offline change' using errcode = '22000';
  end if;

  target_table := case p_entity_type
    when 'trip' then 'trips'
    when 'day' then 'trip_days'
    when 'dayNote' then 'day_notes'
    when 'place' then 'places'
    when 'assignment' then 'assignments'
    when 'accommodation' then 'accommodations'
    when 'reservation' then 'reservations'
    when 'budgetItem' then 'budget_items'
    when 'todo' then 'todo_items'
    when 'packingBag' then 'packing_bags'
    when 'packingItem' then 'packing_items'
    when 'packingConfig' then 'packing_configs'
    when 'tripFile' then 'trip_files'
    when 'vacay' then 'vacay_records'
    else null
  end;
  if target_table is null then
    raise exception 'Unknown sync entity' using errcode = '22000';
  end if;

  execute format(
    'insert into public.%I (id, workspace_id, payload, deleted_at)
     values ($1, $2, $3, $4)
     on conflict (workspace_id, id) do update
       set payload = excluded.payload, deleted_at = excluded.deleted_at
       where public.%I.updated_at < $5
     returning revision', target_table, target_table
  ) into saved_revision using p_id, p_workspace_id, p_payload, p_deleted_at, p_local_updated_at;

  if saved_revision is null then
    execute format('select t.revision from public.%I t where t.workspace_id = $1 and t.id = $2', target_table)
      into saved_revision using p_workspace_id, p_id;
    return query select false, saved_revision;
  else
    return query select true, saved_revision;
  end if;
end;
$$;

revoke all on function public.push_offline_workspace_change(text,text,uuid,jsonb,timestamptz,timestamptz) from public;
grant execute on function public.push_offline_workspace_change(text,text,uuid,jsonb,timestamptz,timestamptz) to authenticated;
