-- Private attachment metadata plus workspace-scoped Supabase Storage objects.
-- Objects are never public; the first path component is the Personal Workspace UUID.

create table public.trip_files (like public.trips including all);
alter table public.trip_files add constraint trip_files_workspace_fk foreign key (workspace_id) references public.workspaces(id);
alter table public.trip_files add constraint trip_files_created_by_fk foreign key (created_by) references public.profiles(id);
alter table public.trip_files add constraint trip_files_updated_by_fk foreign key (updated_by) references public.profiles(id);
create index trip_files_workspace_updated_idx on public.trip_files (workspace_id, updated_at);
alter table public.trip_files enable row level security;
create policy trip_files_member_access on public.trip_files for all to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));
grant select, insert, update on public.trip_files to authenticated;
create trigger trip_files_prepare_sync before insert or update on public.trip_files
for each row execute function public.prepare_personal_sync_row();
create trigger trip_files_record_sync after insert or update on public.trip_files
for each row execute function public.record_personal_sync_change('tripFile');

alter table public.sync_changes drop constraint sync_changes_entity_type_check;
alter table public.sync_changes add constraint sync_changes_entity_type_check check (entity_type in (
  'trip','day','dayNote','place','assignment','accommodation','reservation',
  'budgetItem','todo','packingBag','packingItem','packingConfig','tripFile','vacay'
));

insert into storage.buckets (id, name, public, file_size_limit)
values ('trip-attachments', 'trip-attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy trip_attachments_member_select on storage.objects for select to authenticated
using (
  bucket_id = 'trip-attachments'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);
create policy trip_attachments_member_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-attachments'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);
create policy trip_attachments_member_update on storage.objects for update to authenticated
using (
  bucket_id = 'trip-attachments'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
)
with check (
  bucket_id = 'trip-attachments'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);
