-- DayNote is separate from the Day's whole-day notes field and is personal
-- itinerary data, so it participates in the same durable sync stream.
create table public.day_notes (like public.trips including all);
alter table public.day_notes add constraint day_notes_workspace_fk foreign key (workspace_id) references public.workspaces(id);
alter table public.day_notes add constraint day_notes_created_by_fk foreign key (created_by) references public.profiles(id);
alter table public.day_notes add constraint day_notes_updated_by_fk foreign key (updated_by) references public.profiles(id);
create index day_notes_workspace_updated_idx on public.day_notes (workspace_id, updated_at);
alter table public.day_notes enable row level security;
create policy day_notes_member_access on public.day_notes for all to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));
grant select, insert, update on public.day_notes to authenticated;
create trigger day_notes_prepare_sync before insert or update on public.day_notes
for each row execute function public.prepare_personal_sync_row();
create trigger day_notes_record_sync after insert or update on public.day_notes
for each row execute function public.record_personal_sync_change('dayNote');

alter table public.sync_changes drop constraint sync_changes_entity_type_check;
alter table public.sync_changes add constraint sync_changes_entity_type_check check (entity_type in (
  'trip','day','dayNote','place','assignment','accommodation','reservation',
  'budgetItem','todo','packingBag','packingItem','packingConfig','vacay'
));
