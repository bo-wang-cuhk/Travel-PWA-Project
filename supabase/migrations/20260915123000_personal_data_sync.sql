-- Personal multi-device sync. Supabase is authoritative; IndexedDB remains a
-- per-device working copy. Business payloads stay provider-neutral while the
-- relational columns enforce tenancy, auditing, revisions and soft deletion.

create type public.trek_sync_operation as enum ('upsert', 'delete');

create or replace function public.current_personal_workspace()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id
  where wm.user_id = auth.uid() and w.kind = 'personal'
  order by w.created_at
  limit 1
$$;

revoke all on function public.current_personal_workspace() from public;
grant execute on function public.current_personal_workspace() to authenticated;

-- A separate table per business aggregate keeps the cloud model replaceable
-- and queryable. The JSON payload is the stable domain document already shared
-- by IndexedDB providers; GitHub-specific concepts never enter these tables.
create table public.trips (
  id text primary key, workspace_id uuid not null references public.workspaces(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  revision bigint not null default 1, deleted_at timestamptz, payload jsonb not null
);
create table public.trip_days (like public.trips including all);
create table public.places (like public.trips including all);
create table public.assignments (like public.trips including all);
create table public.accommodations (like public.trips including all);
create table public.reservations (like public.trips including all);
create table public.budget_items (like public.trips including all);
create table public.todo_items (like public.trips including all);
create table public.packing_bags (like public.trips including all);
create table public.packing_items (like public.trips including all);
create table public.packing_configs (like public.trips including all);
create table public.vacay_records (like public.trips including all);

create table public.sync_changes (
  cursor bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'trip','day','place','assignment','accommodation','reservation',
    'budgetItem','todo','packingBag','packingItem','packingConfig','vacay'
  )),
  entity_id text not null,
  operation public.trek_sync_operation not null,
  revision bigint not null,
  changed_at timestamptz not null default clock_timestamp(),
  payload jsonb not null
);
create index sync_changes_workspace_cursor_idx on public.sync_changes (workspace_id, cursor);

create or replace function public.prepare_personal_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_workspace_member(new.workspace_id, auth.uid()) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
    new.revision := 1;
  else
    if new.workspace_id <> old.workspace_id then
      raise exception 'workspace_id cannot be changed' using errcode = '22000';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.record_personal_sync_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text := tg_argv[0];
begin
  insert into public.sync_changes (workspace_id, entity_type, entity_id, operation, revision, payload)
  values (
    new.workspace_id, kind, new.id,
    case when new.deleted_at is null then 'upsert'::public.trek_sync_operation else 'delete'::public.trek_sync_operation end,
    new.revision, new.payload
  );
  return new;
end;
$$;

do $$
declare
  item record;
begin
  for item in select * from (values
    ('trips','trip'), ('trip_days','day'), ('places','place'), ('assignments','assignment'),
    ('accommodations','accommodation'), ('reservations','reservation'), ('budget_items','budgetItem'),
    ('todo_items','todo'), ('packing_bags','packingBag'), ('packing_items','packingItem'),
    ('packing_configs','packingConfig'), ('vacay_records','vacay')
  ) as entries(table_name, entity_type)
  loop
    if item.table_name <> 'trips' then
      execute format('alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id)', item.table_name, item.table_name || '_workspace_fk');
      execute format('alter table public.%I add constraint %I foreign key (created_by) references public.profiles(id)', item.table_name, item.table_name || '_created_by_fk');
      execute format('alter table public.%I add constraint %I foreign key (updated_by) references public.profiles(id)', item.table_name, item.table_name || '_updated_by_fk');
    end if;
    execute format('create index %I on public.%I (workspace_id, updated_at)', item.table_name || '_workspace_updated_idx', item.table_name);
    execute format('alter table public.%I enable row level security', item.table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_workspace_member(workspace_id, auth.uid())) with check (public.is_workspace_member(workspace_id, auth.uid()))',
      item.table_name || '_member_access', item.table_name
    );
    execute format('grant select, insert, update on public.%I to authenticated', item.table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.prepare_personal_sync_row()', item.table_name || '_prepare_sync', item.table_name);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.record_personal_sync_change(%L)', item.table_name || '_record_sync', item.table_name, item.entity_type);
  end loop;
end $$;

alter table public.sync_changes enable row level security;
create policy sync_changes_member_select
on public.sync_changes for select to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));
grant select on public.sync_changes to authenticated;

-- Clients only need the generated revision and cloud timestamp after an upsert;
-- direct physical DELETE is intentionally not granted anywhere.
