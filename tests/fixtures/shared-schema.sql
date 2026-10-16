-- 가계부 저장소 기준 사본, 장보기가 기대는 객체만. 가계부 쪽이 바뀌면 함께 고친다.
-- 출처: 가계부 tests/db.test.ts의 SUPABASE_STUB, supabase/migrations/20261015000000_init.sql(private 스키마,
-- households, members, is_household_member), 20261015010000_spouse_roles.sql(spouse_role).
-- 근사한 곳: households는 장보기가 쓰지 않는 열(invite_code, share_ratio)을 뺐다.
-- 가계부의 households/members RLS 정책과 grant는 옮기지 않았다(장보기 테스트는 기본 역할로 행을 넣고,
-- 권한 검사는 is_household_member(security definer)를 통해서만 이 표를 읽는다).

-- Supabase 흉내: auth 스키마, auth.uid(), 역할, realtime publication
create schema auth;
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create role service_role nologin;
grant usage on schema public to service_role;
create publication supabase_realtime;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '우리집' check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  role text not null check (role in ('owner', 'partner')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id),
  unique (household_id, role)
);
alter table public.members
  add column spouse_role text check (spouse_role in ('husband', 'wife'));
alter table public.members
  add constraint members_household_spouse_role_key unique (household_id, spouse_role);

create or replace function private.is_household_member(hh uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hh and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_household_member(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.members enable row level security;
