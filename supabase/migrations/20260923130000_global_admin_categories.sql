-- Categories are an instance-wide catalog maintained by Trek administrators.
-- Keep one copy in every workspace so the existing workspace-scoped sync feed,
-- RLS rules and IndexedDB provider can distribute them without a second cursor.

alter table public.category_records
add column is_global boolean not null default false;

drop policy if exists category_records_member_access on public.category_records;

create policy category_records_member_select
on public.category_records for select to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

-- Older clients could create workspace-local categories. Keep those records
-- writable in their own workspace so a pending outbox item cannot block sync.
create policy category_records_member_insert
on public.category_records for insert to authenticated
with check (public.is_workspace_member(workspace_id, auth.uid()));

create policy category_records_member_update
on public.category_records for update to authenticated
using (
  public.is_workspace_member(workspace_id, auth.uid())
  and (not is_global or public.is_trek_admin(auth.uid()))
)
with check (
  public.is_workspace_member(workspace_id, auth.uid())
  and (not is_global or public.is_trek_admin(auth.uid()))
);

drop trigger if exists category_records_prepare_sync on public.category_records;
drop trigger if exists category_records_record_sync on public.category_records;

-- Capture the newest administrator-owned copy before filling the workspaces
-- that could not see it under the earlier workspace-local model.
create temporary table global_category_seed as
select distinct on (category.id)
  category.id,
  category.workspace_id as source_workspace_id,
  category.created_by,
  category.updated_by,
  category.created_at,
  category.updated_at,
  category.revision,
  category.deleted_at,
  category.payload
from public.category_records category
join public.profiles creator on creator.id = category.created_by
where creator.role = 'admin'
order by category.id, category.updated_at desc, category.workspace_id;

update public.category_records category
set is_global = true
where exists (select 1 from global_category_seed seed where seed.id = category.id);

insert into public.category_records (
  id, workspace_id, created_by, updated_by, created_at, updated_at,
  revision, deleted_at, payload, is_global
)
select
  seed.id, workspace.id, seed.created_by, seed.updated_by,
  seed.created_at, seed.updated_at, seed.revision, seed.deleted_at, seed.payload, true
from global_category_seed seed
cross join public.workspaces workspace
where workspace.id <> seed.source_workspace_id
on conflict (workspace_id, id) do update set
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at,
  revision = greatest(public.category_records.revision + 1, excluded.revision),
  deleted_at = excluded.deleted_at,
  payload = excluded.payload;

-- Existing clients learn about the backfilled rows on their next normal pull.
insert into public.sync_changes (
  workspace_id, entity_type, entity_id, operation, revision, payload
)
select
  category.workspace_id,
  'category',
  category.id,
  case
    when category.deleted_at is null then 'upsert'::public.trek_sync_operation
    else 'delete'::public.trek_sync_operation
  end,
  category.revision,
  category.payload
from public.category_records category
join global_category_seed seed on seed.id = category.id;

drop table global_category_seed;

create or replace function public.prepare_global_category_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Direct client writes must target the user's workspace. Administrator
  -- writes join the shared catalog; earlier user-owned rows remain local.
  -- Nested writes are trusted copies made by the trigger functions below.
  if pg_trigger_depth() = 1 then
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
      if old.is_global and not public.is_trek_admin(auth.uid()) then
        raise exception 'Only administrators can manage global categories' using errcode = '42501';
      end if;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      new.revision := old.revision + 1;
    end if;
    new.updated_by := auth.uid();
    new.updated_at := clock_timestamp();
    if tg_op = 'INSERT' then
      new.is_global := public.is_trek_admin(auth.uid());
    else
      new.is_global := old.is_global or public.is_trek_admin(auth.uid());
    end if;
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;

  return new;
end;
$$;

create or replace function public.replicate_global_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or not new.is_global then
    return new;
  end if;

  insert into public.category_records (
    id, workspace_id, created_by, updated_by, created_at, updated_at,
    revision, deleted_at, payload, is_global
  )
  select
    new.id, workspace.id, new.created_by, new.updated_by,
    new.created_at, new.updated_at, new.revision, new.deleted_at, new.payload, true
  from public.workspaces workspace
  where workspace.id <> new.workspace_id
  on conflict (workspace_id, id) do update set
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    payload = excluded.payload,
    is_global = true;

  return new;
end;
$$;

create or replace function public.seed_global_categories_for_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.category_records (
    id, workspace_id, created_by, updated_by, created_at, updated_at,
    revision, deleted_at, payload, is_global
  )
  select distinct on (category.id)
    category.id,
    new.id,
    category.created_by,
    category.updated_by,
    category.created_at,
    category.updated_at,
    category.revision,
    category.deleted_at,
    category.payload,
    true
  from public.category_records category
  where category.workspace_id <> new.id
    and category.is_global
  order by category.id, category.updated_at desc, category.workspace_id;

  return new;
end;
$$;

revoke all on function public.prepare_global_category_row() from public;
revoke all on function public.replicate_global_category() from public;
revoke all on function public.seed_global_categories_for_workspace() from public;

create trigger category_records_prepare_sync
before insert or update on public.category_records
for each row execute function public.prepare_global_category_row();

create trigger category_records_record_sync
after insert or update on public.category_records
for each row execute function public.record_personal_sync_change('category');

create trigger category_records_replicate_global
after insert or update on public.category_records
for each row execute function public.replicate_global_category();

create trigger workspaces_seed_global_categories
after insert on public.workspaces
for each row execute function public.seed_global_categories_for_workspace();
