-- Run with psql -v ON_ERROR_STOP=1 against a disposable migrated database.
-- All fixtures and writes roll back. No pgTAP extension is required.
begin;

insert into auth.users (id, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', '{"username":"rls-test-owner"}'),
  ('22222222-2222-4222-8222-222222222222', '{"username":"rls-test-editor"}'),
  ('33333333-3333-4333-8333-333333333333', '{"username":"rls-test-viewer"}'),
  ('44444444-4444-4444-8444-444444444444', '{"username":"rls-test-other"}'),
  ('55555555-5555-4555-8555-555555555555', '{"username":"rls-test-outsider"}');
insert into public.workspaces (id, kind, name, owner_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'shared', 'RLS test', '11111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id) select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id from public.profiles
  where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');

create function pg_temp.upsert_journey(candidate_id text, patch jsonb default '{}'::jsonb)
returns void language sql security invoker as $$
  insert into public.journey_records (workspace_id, id, payload) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidate_id,
    jsonb_build_object('id', candidate_id, 'ownerAuthId', '11111111-1111-4111-8111-111111111111',
      'ownerUserId', 1, 'title', 'RLS test', 'members', jsonb_build_array(
        jsonb_build_object('authId', '22222222-2222-4222-8222-222222222222', 'role', 'editor'),
        jsonb_build_object('authId', '33333333-3333-4333-8333-333333333333', 'role', 'viewer')
      )) || patch
  ) on conflict (workspace_id, id) do update set payload = excluded.payload
    returning revision;
$$;

create function pg_temp.expect_denied(statement text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute statement;
  exception when insufficient_privilege then return;
  end;
  raise exception 'Expected permission denial: %', statement;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
-- Both initial INSERT and subsequent UPDATE must return a row under RLS.
select pg_temp.upsert_journey('rls-test-journey');
select pg_temp.upsert_journey('rls-test-journey', '{"title":"Owner edit"}');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select pg_temp.upsert_journey('rls-test-journey', '{"title":"Editor edit"}');
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-new-by-editor')$sql$);
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-journey', '{"members":[]}')$sql$);
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-journey', '{"ownerAuthId":"22222222-2222-4222-8222-222222222222"}')$sql$);
select pg_temp.expect_denied($sql$update public.journey_records set deleted_at = now() where id = 'rls-test-journey'$sql$);

-- The offline RPC uses the same INSERT ... ON CONFLICT path.
do $$
declare saved record;
begin
  select * into saved from public.push_offline_workspace_change(
    'journey', 'rls-test-journey', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select payload || '{"title":"Offline editor edit"}'::jsonb from public.journey_records where id = 'rls-test-journey'),
    null, clock_timestamp() + interval '1 hour');
  if saved.applied is distinct from true then raise exception 'Offline editor update was not applied'; end if;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select * from public.push_offline_workspace_change(
  'journey', 'rls-test-offline-new', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '{"id":"rls-test-offline-new","ownerAuthId":"11111111-1111-4111-8111-111111111111","ownerUserId":1,"members":[]}',
  null, clock_timestamp());

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$ begin
  if (select count(*) from public.journey_records where id = 'rls-test-journey') <> 1 then
    raise exception 'Viewer cannot read invited journey';
  end if;
end $$;
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-journey')$sql$);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
do $$ begin
  if exists (select 1 from public.journey_records where id = 'rls-test-journey') then
    raise exception 'Uninvited workspace member can read journey';
  end if;
end $$;
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-journey')$sql$);

select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
do $$ begin
  if exists (select 1 from public.journey_records where id = 'rls-test-journey') then
    raise exception 'Outsider can read journey';
  end if;
end $$;
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-outsider', '{"ownerAuthId":"55555555-5555-4555-8555-555555555555"}')$sql$);

set local role anon;
select pg_temp.expect_denied($sql$select pg_temp.upsert_journey('rls-test-anon')$sql$);
rollback;
