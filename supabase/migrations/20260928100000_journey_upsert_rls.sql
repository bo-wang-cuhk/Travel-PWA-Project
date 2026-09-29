-- INSERT ... ON CONFLICT checks SELECT policies against the proposed row,
-- before a new journey exists in the table. Inspect that row's payload instead
-- of calling can_read_journey(), which looks up an already persisted journey.
alter policy journey_records_select on public.journey_records
using (
  public.is_workspace_member(workspace_id, auth.uid())
  and (
    payload->>'ownerAuthId' = auth.uid()::text
    or exists (
      select 1 from jsonb_array_elements(coalesce(payload->'members', '[]'::jsonb)) as member(value)
      where member.value->>'authId' = auth.uid()::text
    )
  )
);

-- Upserts also check INSERT permission on the UPDATE path. An existing
-- journey's editor may propose an update; only its owner may create a new one.
-- The UPDATE policy and validate_journey_record trigger still prohibit viewers,
-- ownership changes, and member/deletion changes by non-owners.
alter policy journey_records_insert on public.journey_records
with check (
  public.is_workspace_member(workspace_id, auth.uid())
  and (
    payload->>'ownerAuthId' = auth.uid()::text
    or public.can_edit_journey(workspace_id, id, auth.uid())
  )
);
