-- 장보기 마이그레이션은 grocery 스키마만 바꾼다(D-003). 가계부의 public.households, public.members,
-- private.is_household_member는 참조만 하고 고치지 않는다.

create schema if not exists grocery;
revoke all on schema grocery from public, anon;
grant usage on schema grocery to authenticated, service_role;

create table grocery.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  spec text check (char_length(spec) <= 20),
  count int not null default 1 check (count between 1 and 99),
  -- src/lib/categories.ts의 CATEGORIES와 같은 문자열. 바꾸면 양쪽을 함께 바꾼다.
  category text not null check (category in
    ('정육', '수산', '채소', '과일', '유제품', '계란', '가공', '냉동', '음료', '생활용품', '기타')),
  product_key text,
  added_by uuid default auth.uid(),  -- 구성원이 가계부에서 지워지면 null (insert 정책이 새 행에는 항상 본인 id를 요구)
  added_at timestamptz not null default now(),
  bought_by uuid,
  bought_at timestamptz,
  paid bigint check (paid > 0 and paid < 10000000000),
  -- 산 사람이 가계부에서 지워져도 bought_at은 남는다
  check (bought_by is null or bought_at is not null),
  check (paid is null or bought_at is not null),
  -- 담은 사람·산 사람은 같은 가구 구성원이어야 한다. 장보기 데이터가 가계부의 삭제를 막지 않도록 set null.
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by),
  foreign key (household_id, bought_by) references public.members (household_id, user_id) on delete set null (bought_by)
);
create index items_household_added_idx on grocery.items (household_id, added_at);

alter table grocery.items enable row level security;

create policy items_select on grocery.items
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy items_insert on grocery.items
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy items_update on grocery.items
  for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy items_delete on grocery.items
  for delete to authenticated
  using ((select private.is_household_member(household_id)));

-- 로그인하지 않은 사용자(anon)는 아무 권한이 없다.
revoke all on grocery.items from public, anon, authenticated;
grant select, insert, delete on grocery.items to authenticated;
grant update (name, spec, count, category, product_key, bought_by, bought_at, paid)
  on grocery.items to authenticated;  -- household_id·added_by·added_at은 변경 불가
grant select, insert, update, delete on grocery.items to service_role;

-- 실시간 동기화: publication이 있을 때만(가계부와 같은 방식)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table grocery.items;
  end if;
end;
$$;
