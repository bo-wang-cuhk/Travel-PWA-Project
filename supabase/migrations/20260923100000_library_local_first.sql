-- Workspace-scoped place categories are first-class local-first records.
create table public.category_records (like public.trips including all);
alter table public.category_records add constraint category_records_workspace_fk foreign key (workspace_id) references public.workspaces(id);
alter table public.category_records add constraint category_records_created_by_fk foreign key (created_by) references public.profiles(id);
alter table public.category_records add constraint category_records_updated_by_fk foreign key (updated_by) references public.profiles(id);

alter table public.category_records enable row level security;
create policy category_records_member_access
on public.category_records for all to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));
grant select, insert, update on public.category_records to authenticated;

create index category_records_workspace_updated_idx
on public.category_records (workspace_id, updated_at);

create trigger category_records_prepare_sync
before insert or update on public.category_records
for each row execute function public.prepare_personal_sync_row();

create trigger category_records_record_sync
after insert or update on public.category_records
for each row execute function public.record_personal_sync_change('category');

create table public.collection_records (like public.trips including all);
create table public.collection_place_records (like public.trips including all);

do $$
declare table_name text;
begin
  foreach table_name in array array['collection_records', 'collection_place_records'] loop
    execute format('alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id)', table_name, table_name || '_workspace_fk');
    execute format('alter table public.%I add constraint %I foreign key (created_by) references public.profiles(id)', table_name, table_name || '_created_by_fk');
    execute format('alter table public.%I add constraint %I foreign key (updated_by) references public.profiles(id)', table_name, table_name || '_updated_by_fk');
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_workspace_member(workspace_id, auth.uid())) with check (public.is_workspace_member(workspace_id, auth.uid()))', table_name || '_member_access', table_name);
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
    execute format('create index %I on public.%I (workspace_id, updated_at)', table_name || '_workspace_updated_idx', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.prepare_personal_sync_row()', table_name || '_prepare_sync', table_name);
  end loop;
end $$;

create trigger collection_records_record_sync after insert or update on public.collection_records
for each row execute function public.record_personal_sync_change('collection');
create trigger collection_place_records_record_sync after insert or update on public.collection_place_records
for each row execute function public.record_personal_sync_change('collectionPlace');

alter table public.sync_changes drop constraint sync_changes_entity_type_check;
alter table public.sync_changes add constraint sync_changes_entity_type_check check (entity_type in (
  'trip','day','dayNote','category','collection','collectionPlace','place','assignment','accommodation','reservation',
  'budgetItem','todo','packingBag','packingItem','packingConfig','tripFile','vacay','atlas'
));

alter publication supabase_realtime add table public.category_records;
alter publication supabase_realtime add table public.collection_records;
alter publication supabase_realtime add table public.collection_place_records;

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
    when 'category' then 'category_records'
    when 'collection' then 'collection_records' when 'collectionPlace' then 'collection_place_records'
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
