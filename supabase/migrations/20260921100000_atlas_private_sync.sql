-- Manual Atlas choices are personal even inside a Shared Workspace. Trip/Place
-- visits are derived from already-synced workspace data and are not duplicated.
create table public.atlas_records (like public.trips including all);
alter table public.atlas_records add constraint atlas_records_workspace_fk foreign key (workspace_id) references public.workspaces(id);
alter table public.atlas_records add constraint atlas_records_created_by_fk foreign key (created_by) references public.profiles(id);
alter table public.atlas_records add constraint atlas_records_updated_by_fk foreign key (updated_by) references public.profiles(id);
create index atlas_records_workspace_updated_idx on public.atlas_records (workspace_id, updated_at);
alter table public.atlas_records enable row level security;
create policy atlas_records_owner_access on public.atlas_records for all to authenticated
  using (id = auth.uid()::text and public.is_workspace_member(workspace_id, auth.uid()))
  with check (id = auth.uid()::text and public.is_workspace_member(workspace_id, auth.uid()));
grant select, insert, update on public.atlas_records to authenticated;
create trigger atlas_records_prepare_sync before insert or update on public.atlas_records
  for each row execute function public.prepare_personal_sync_row();
create trigger atlas_records_record_sync after insert or update on public.atlas_records
  for each row execute function public.record_personal_sync_change('atlas');

alter table public.sync_changes drop constraint sync_changes_entity_type_check;
alter table public.sync_changes add constraint sync_changes_entity_type_check check (entity_type in (
  'trip','day','dayNote','place','assignment','accommodation','reservation',
  'budgetItem','todo','packingBag','packingItem','packingConfig','tripFile','vacay','atlas'
));
-- The old workspace-wide policy would disclose a member's personal Atlas marks
-- through the change log, even though atlas_records itself is owner-only.
drop policy sync_changes_member_select on public.sync_changes;
create policy sync_changes_member_select on public.sync_changes for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()) and
         (entity_type <> 'atlas' or entity_id = auth.uid()::text));

create or replace function public.push_offline_workspace_change(
  p_entity_type text, p_id text, p_workspace_id uuid, p_payload jsonb,
  p_deleted_at timestamptz, p_local_updated_at timestamptz
)
returns table(applied boolean, revision bigint)
language plpgsql security invoker set search_path = '' as $$
declare target_table text; saved_revision bigint;
begin
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id, auth.uid()) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  if p_id is null or p_id = '' or p_payload is null or p_local_updated_at is null then
    raise exception 'Invalid offline change' using errcode = '22000';
  end if;
  target_table := case p_entity_type
    when 'trip' then 'trips' when 'day' then 'trip_days' when 'dayNote' then 'day_notes'
    when 'place' then 'places' when 'assignment' then 'assignments'
    when 'accommodation' then 'accommodations' when 'reservation' then 'reservations'
    when 'budgetItem' then 'budget_items' when 'todo' then 'todo_items'
    when 'packingBag' then 'packing_bags' when 'packingItem' then 'packing_items'
    when 'packingConfig' then 'packing_configs' when 'tripFile' then 'trip_files'
    when 'vacay' then 'vacay_records' when 'atlas' then 'atlas_records'
    else null end;
  if target_table is null then raise exception 'Unknown sync entity' using errcode = '22000'; end if;
  execute format(
    'insert into public.%I (id, workspace_id, payload, deleted_at) values ($1,$2,$3,$4)
     on conflict (workspace_id,id) do update set payload=excluded.payload, deleted_at=excluded.deleted_at
     where public.%I.updated_at < $5 returning revision', target_table, target_table
  ) into saved_revision using p_id,p_workspace_id,p_payload,p_deleted_at,p_local_updated_at;
  if saved_revision is null then
    execute format('select t.revision from public.%I t where t.workspace_id=$1 and t.id=$2',target_table)
      into saved_revision using p_workspace_id,p_id;
    return query select false,saved_revision;
  else
    return query select true,saved_revision;
  end if;
end;
$$;
revoke all on function public.push_offline_workspace_change(text,text,uuid,jsonb,timestamptz,timestamptz) from public;
grant execute on function public.push_offline_workspace_change(text,text,uuid,jsonb,timestamptz,timestamptz) to authenticated;
