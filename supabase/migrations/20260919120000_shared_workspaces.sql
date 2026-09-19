-- Direct shared-workspace membership. The existing personal workspace is
-- promoted in place on the first add so every synced row keeps its workspace id.

create or replace function public.current_sync_workspace()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id
  where wm.user_id = auth.uid()
  order by
    case when w.kind = 'shared' then 0 else 1 end,
    w.created_at
  limit 1
$$;

revoke all on function public.current_sync_workspace() from public;
grant execute on function public.current_sync_workspace() to authenticated;
