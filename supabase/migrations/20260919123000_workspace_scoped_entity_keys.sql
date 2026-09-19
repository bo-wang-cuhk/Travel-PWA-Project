-- Entity IDs are stable inside a workspace. Fixed aggregate IDs such as
-- personal-vacay and personal-packing must be allowed to exist in more than one
-- Personal/Shared Workspace without colliding globally.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'trips', 'trip_days', 'day_notes', 'places', 'assignments',
    'accommodations', 'reservations', 'budget_items', 'todo_items',
    'packing_bags', 'packing_items', 'packing_configs', 'trip_files',
    'vacay_records'
  ]
  loop
    execute format('alter table public.%I drop constraint %I', table_name, table_name || '_pkey');
    execute format('alter table public.%I add primary key (workspace_id, id)', table_name);
  end loop;
end $$;
