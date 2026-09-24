-- Text journeys and entries share the existing workspace sync channel.
-- The owner selects existing workspace members; only selected members can read.
create table public.journey_records (like public.trips including all);
create table public.journey_entry_records (like public.trips including all);
alter table public.journey_records drop constraint journey_records_pkey;
alter table public.journey_records add primary key (workspace_id, id);
alter table public.journey_entry_records drop constraint journey_entry_records_pkey;
alter table public.journey_entry_records add primary key (workspace_id, id);

alter table public.journey_records add constraint journey_records_workspace_fk foreign key (workspace_id) references public.workspaces(id);
alter table public.journey_entry_records add constraint journey_entry_records_workspace_fk foreign key (workspace_id) references public.workspaces(id);
alter table public.journey_records add constraint journey_records_created_by_fk foreign key (created_by) references public.profiles(id);
alter table public.journey_records add constraint journey_records_updated_by_fk foreign key (updated_by) references public.profiles(id);
alter table public.journey_entry_records add constraint journey_entry_records_created_by_fk foreign key (created_by) references public.profiles(id);
alter table public.journey_entry_records add constraint journey_entry_records_updated_by_fk foreign key (updated_by) references public.profiles(id);
create index journey_records_workspace_updated_idx on public.journey_records (workspace_id, updated_at);
create index journey_entry_records_workspace_updated_idx on public.journey_entry_records (workspace_id, updated_at);

create or replace function public.can_read_journey(candidate_workspace uuid, candidate_journey text, candidate_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.journey_records j
    where j.workspace_id = candidate_workspace and j.id = candidate_journey
      and public.is_workspace_member(candidate_workspace, candidate_user)
      and (
        j.payload->>'ownerAuthId' = candidate_user::text
        or exists (
          select 1 from jsonb_array_elements(coalesce(j.payload->'members', '[]'::jsonb)) as member(value)
          where member.value->>'authId' = candidate_user::text
        )
      )
  )
$$;

create or replace function public.can_edit_journey(candidate_workspace uuid, candidate_journey text, candidate_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.journey_records j
    where j.workspace_id = candidate_workspace and j.id = candidate_journey
      and public.is_workspace_member(candidate_workspace, candidate_user)
      and (
        j.payload->>'ownerAuthId' = candidate_user::text
        or exists (
          select 1 from jsonb_array_elements(coalesce(j.payload->'members', '[]'::jsonb)) as member(value)
          where member.value->>'authId' = candidate_user::text and member.value->>'role' = 'editor'
        )
      )
  )
$$;

revoke all on function public.can_read_journey(uuid,text,uuid), public.can_edit_journey(uuid,text,uuid) from public;
grant execute on function public.can_read_journey(uuid,text,uuid), public.can_edit_journey(uuid,text,uuid) to authenticated;

alter table public.journey_records enable row level security;
create policy journey_records_select on public.journey_records for select to authenticated
using (public.can_read_journey(workspace_id, id, auth.uid()));
create policy journey_records_insert on public.journey_records for insert to authenticated
with check (
  public.is_workspace_member(workspace_id, auth.uid())
  and payload->>'ownerAuthId' = auth.uid()::text
);
create policy journey_records_update on public.journey_records for update to authenticated
using (public.can_edit_journey(workspace_id, id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));

alter table public.journey_entry_records enable row level security;
create policy journey_entry_records_select on public.journey_entry_records for select to authenticated
using (public.can_read_journey(workspace_id, payload->>'journeyId', auth.uid()));
create policy journey_entry_records_insert on public.journey_entry_records for insert to authenticated
with check (public.can_edit_journey(workspace_id, payload->>'journeyId', auth.uid()));
create policy journey_entry_records_update on public.journey_entry_records for update to authenticated
using (public.can_edit_journey(workspace_id, payload->>'journeyId', auth.uid()))
with check (public.can_edit_journey(workspace_id, payload->>'journeyId', auth.uid()));

grant select, insert, update on public.journey_records, public.journey_entry_records to authenticated;
create or replace function public.validate_journey_record()
returns trigger language plpgsql set search_path = '' as $$
declare member jsonb;
begin
  if new.payload->>'id' is distinct from new.id or new.payload->>'ownerAuthId' is null then
    raise exception 'Invalid journey identity' using errcode = '22000';
  end if;
  if tg_op = 'UPDATE' then
    if new.payload->>'ownerAuthId' is distinct from old.payload->>'ownerAuthId'
      or new.payload->>'ownerUserId' is distinct from old.payload->>'ownerUserId' then
      raise exception 'Journey owner cannot be changed' using errcode = '42501';
    end if;
    if new.payload->'members' is distinct from old.payload->'members'
      and old.payload->>'ownerAuthId' is distinct from auth.uid()::text then
      raise exception 'Only the owner can manage journey members' using errcode = '42501';
    end if;
    if old.deleted_at is null and new.deleted_at is not null
      and old.payload->>'ownerAuthId' is distinct from auth.uid()::text then
      raise exception 'Only the owner can delete a journey' using errcode = '42501';
    end if;
  end if;
  for member in select value from jsonb_array_elements(coalesce(new.payload->'members', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = new.workspace_id and wm.user_id::text = member->>'authId'
    ) or member->>'role' not in ('editor', 'viewer') then
      raise exception 'Journey member must belong to this workspace' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
create trigger journey_records_validate before insert or update on public.journey_records
for each row execute function public.validate_journey_record();
create or replace function public.validate_journey_entry_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payload->>'id' is distinct from new.id or nullif(new.payload->>'journeyId', '') is null then
    raise exception 'Invalid journey entry identity' using errcode = '22000';
  end if;
  if tg_op = 'UPDATE' and new.payload->>'journeyId' is distinct from old.payload->>'journeyId' then
    raise exception 'Journey entry cannot move to another journey' using errcode = '42501';
  end if;
  if new.deleted_at is null and exists (
    select 1 from public.journey_records j
    where j.workspace_id = new.workspace_id and j.id = new.payload->>'journeyId' and j.deleted_at is not null
  ) then
    raise exception 'Cannot write an entry in a deleted journey' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger journey_entry_records_validate before insert or update on public.journey_entry_records
for each row execute function public.validate_journey_entry_record();
create trigger journey_records_prepare before insert or update on public.journey_records
for each row execute function public.prepare_personal_sync_row();
create trigger journey_entry_records_prepare before insert or update on public.journey_entry_records
for each row execute function public.prepare_personal_sync_row();
create or replace function public.record_journey_sync_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare revoked jsonb := '[]'::jsonb; old_member jsonb; change_payload jsonb; existing_entry record;
begin
  if tg_op = 'UPDATE' then
    for old_member in select value from jsonb_array_elements(coalesce(old.payload->'members', '[]'::jsonb)) loop
      if not exists (
        select 1 from jsonb_array_elements(coalesce(new.payload->'members', '[]'::jsonb)) as current_member(value)
        where current_member.value->>'authId' = old_member->>'authId'
      ) then
        revoked := revoked || jsonb_build_array(old_member->>'authId');
      end if;
    end loop;
  end if;
  change_payload := new.payload || jsonb_build_object('_revokedAuthIds', revoked);
  insert into public.sync_changes (workspace_id, entity_type, entity_id, operation, revision, payload)
  values (new.workspace_id, 'journey', new.id,
    case when new.deleted_at is null then 'upsert'::public.trek_sync_operation else 'delete'::public.trek_sync_operation end,
    new.revision, change_payload);
  -- A newly invited member may already have a sync cursor beyond old entries.
  -- Re-announce their current snapshots after the membership change.
  if tg_op = 'UPDATE' and new.payload->'members' is distinct from old.payload->'members'
    and new.deleted_at is null then
    for existing_entry in
      select id, revision, payload, deleted_at from public.journey_entry_records
      where workspace_id = new.workspace_id and payload->>'journeyId' = new.id
    loop
      insert into public.sync_changes (workspace_id, entity_type, entity_id, operation, revision, payload)
      values (new.workspace_id, 'journeyEntry', existing_entry.id,
        case when existing_entry.deleted_at is null then 'upsert'::public.trek_sync_operation else 'delete'::public.trek_sync_operation end,
        existing_entry.revision, existing_entry.payload);
    end loop;
  end if;
  return new;
end;
$$;
create trigger journey_records_record_sync after insert or update on public.journey_records
for each row execute function public.record_journey_sync_change();
create trigger journey_entry_records_record_sync after insert or update on public.journey_entry_records
for each row execute function public.record_personal_sync_change('journeyEntry');

alter table public.sync_changes drop constraint sync_changes_entity_type_check;
alter table public.sync_changes add constraint sync_changes_entity_type_check check (entity_type in (
  'trip','day','dayNote','category','collection','collectionPlace','journey','journeyEntry',
  'place','assignment','accommodation','reservation','budgetItem','todo','packingBag',
  'packingItem','packingConfig','tripFile','vacay','atlas'
));

create policy journey_changes_visibility on public.sync_changes as restrictive for select to authenticated
using (
  case entity_type
    when 'journey' then public.can_read_journey(workspace_id, entity_id, auth.uid())
      or coalesce(payload->'_revokedAuthIds', '[]'::jsonb) ? auth.uid()::text
    when 'journeyEntry' then public.can_read_journey(workspace_id, payload->>'journeyId', auth.uid())
    else true
  end
);

alter publication supabase_realtime add table public.journey_records;
alter publication supabase_realtime add table public.journey_entry_records;

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
    when 'category' then 'category_records' when 'collection' then 'collection_records'
    when 'collectionPlace' then 'collection_place_records'
    when 'journey' then 'journey_records' when 'journeyEntry' then 'journey_entry_records'
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
