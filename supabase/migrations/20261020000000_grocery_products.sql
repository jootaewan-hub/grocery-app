-- 가격 확인 ④-1: 다나와 상품·품목별 후보·검색 상태·가구 기억·요청 간격과 고르기 RPC.
-- grocery 스키마만 바꾼다(D-003). 쓰기는 Edge Function(서비스 롤)이 하고, 고르기만 사용자가 RPC로 한다.

-- 다나와 상품(공개 자료). 가구와 상관없이 하나씩 둔다.
create table grocery.products (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source = 'danawa'),
  source_id text not null,
  name text not null,
  image_url text,
  rating numeric(2, 1),
  review_count int,
  rated_at timestamptz, -- 평점·후기 수를 마지막으로 읽은 시각(화면의 기준 시각)
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

-- 품목마다 마지막 후보 찾기 상태. 'searching'이 2분 넘게 남아 있으면 다시 찾을 수 있다(product-search).
create table grocery.item_searches (
  item_id uuid primary key references grocery.items (id) on delete cascade,
  status text not null check (status in ('searching', 'done', 'none', 'error')),
  query text,
  candidate_count int,
  error text,
  updated_at timestamptz not null default now()
);

-- 품목의 후보(상품 × 수량). 가격은 다나와 검색 결과의 그 수량 최저가와 찾은 시각.
create table grocery.item_candidates (
  item_id uuid not null references grocery.items (id) on delete cascade,
  product_id uuid not null references grocery.products (id) on delete cascade,
  qty int not null check (qty between 1 and 99),
  price int not null check (price > 0),
  unit_price int check (unit_price > 0),
  unit_label text,
  mall_count int,
  rank int,
  found_at timestamptz not null default now(),
  primary key (item_id, product_id, qty)
);

-- 가구가 고른 상품 기억: 같은 이름·규격을 다시 담으면 이 상품으로 바로 잡는다.
create table grocery.product_choices (
  household_id uuid not null references public.households (id) on delete cascade,
  name_key text not null,
  product_id uuid not null references grocery.products (id) on delete cascade,
  qty int not null check (qty between 1 and 99),
  chosen_by uuid default auth.uid(),
  chosen_at timestamptz not null default now(),
  primary key (household_id, name_key)
);

alter table grocery.items
  add column product_id uuid references grocery.products (id) on delete set null,
  add column product_qty int check (product_qty between 1 and 99);

-- 다나와 검색 간격(robots Crawl-delay 10). 한 행 UPDATE로 예약하므로 동시에 불러도 겹치지 않는다.
create table grocery.fetch_gate (
  key text primary key,
  next_at timestamptz not null
);
insert into grocery.fetch_gate (key, next_at) values ('danawa-search', '-infinity');

-- 이름 비교 열쇠: 소문자, 한글·영문·숫자·점만 남기고, 규격을 '|' 뒤에 붙인다.
create function grocery.name_key(p_name text, p_spec text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p_name, ''), '[^가-힣a-zA-Z0-9.]', '', 'g'))
      || '|' || lower(regexp_replace(coalesce(p_spec, ''), '[^가-힣a-zA-Z0-9.]', '', 'g'))
$$;

-- 품목에 상품을 연결하고 가구 기억을 남긴다. RLS를 그대로 따른다(security invoker): 남의 품목이면 오류.
create function grocery.choose_product(p_item uuid, p_product uuid, p_qty int)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it record;
begin
  update grocery.items set product_id = p_product, product_qty = p_qty
   where id = p_item
  returning household_id, name, spec into it;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  insert into grocery.product_choices (household_id, name_key, product_id, qty, chosen_by, chosen_at)
  values (it.household_id, grocery.name_key(it.name, it.spec), p_product, p_qty, auth.uid(), now())
  on conflict (household_id, name_key)
  do update set product_id = excluded.product_id, qty = excluded.qty, chosen_by = excluded.chosen_by, chosen_at = excluded.chosen_at;
end;
$$;

-- 기다릴 ms를 돌려주고 다음 차례를 예약한다. 기다림이 p_max_wait_ms를 넘으면 -1이고 자리를 잡지 않는다
-- (잡고 안 쓰면 뒤 차례가 쓸데없이 밀린다). 서비스 롤만 부른다.
create function grocery.reserve_fetch(p_key text, p_gap_ms int, p_max_wait_ms int)
returns int
language sql
volatile
set search_path = ''
as $$
  with up as (
    update grocery.fetch_gate g
       set next_at = greatest(g.next_at, now()) + make_interval(secs => p_gap_ms / 1000.0)
     where g.key = p_key
       and greatest(g.next_at, now()) - now() <= make_interval(secs => p_max_wait_ms / 1000.0)
    returning greatest(0, ceil(extract(epoch from (g.next_at - make_interval(secs => p_gap_ms / 1000.0) - now())) * 1000))::int as wait
  )
  select coalesce((select wait from up), -1)
$$;

-- 후보 찾기를 시작한다고 표시한다. 처음이거나, 끝났거나, 'searching'이 2분 넘게 남았을 때만 잡는다(두 기기 중복 방지).
create function grocery.claim_search(p_item uuid, p_query text, p_now timestamptz)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with up as (
    insert into grocery.item_searches as s (item_id, status, query, candidate_count, error, updated_at)
    values (p_item, 'searching', p_query, null, null, p_now)
    on conflict (item_id) do update
      set status = 'searching', query = excluded.query, candidate_count = null, error = null, updated_at = excluded.updated_at
      where s.status <> 'searching' or s.updated_at < excluded.updated_at - interval '2 minutes'
    returning 1
  )
  select exists (select 1 from up)
$$;

-- 그 품목과 같은 이름·규격으로 가구가 고른 상품. RLS를 따른다: 남의 품목이면 빈 결과.
create function grocery.remembered_product(p_item uuid)
returns table (product_id uuid, qty int)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.product_id, c.qty
    from grocery.items i
    join grocery.product_choices c
      on c.household_id = i.household_id and c.name_key = grocery.name_key(i.name, i.spec)
   where i.id = p_item
$$;

-- RLS
alter table grocery.products enable row level security;
alter table grocery.item_searches enable row level security;
alter table grocery.item_candidates enable row level security;
alter table grocery.product_choices enable row level security;
alter table grocery.fetch_gate enable row level security; -- 정책 없음: 서비스 롤만

create policy products_read on grocery.products for select to authenticated using (true);
create policy item_searches_read on grocery.item_searches for select to authenticated
  using (exists (select 1 from grocery.items i where i.id = item_id and (select private.is_household_member(i.household_id))));
create policy item_candidates_read on grocery.item_candidates for select to authenticated
  using (exists (select 1 from grocery.items i where i.id = item_id and (select private.is_household_member(i.household_id))));
create policy product_choices_select on grocery.product_choices for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy product_choices_insert on grocery.product_choices for insert to authenticated
  with check ((select private.is_household_member(household_id)) and chosen_by = (select auth.uid()));
create policy product_choices_update on grocery.product_choices for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)) and chosen_by = (select auth.uid()));

revoke all on grocery.products, grocery.item_searches, grocery.item_candidates, grocery.product_choices, grocery.fetch_gate
  from public, anon, authenticated;
grant select on grocery.products, grocery.item_searches, grocery.item_candidates to authenticated;
grant select, insert on grocery.product_choices to authenticated;
grant update (product_id, qty, chosen_by, chosen_at) on grocery.product_choices to authenticated;
grant update (product_id, product_qty) on grocery.items to authenticated;
grant select, insert, update, delete on grocery.products, grocery.item_searches, grocery.item_candidates,
  grocery.product_choices to service_role;
grant select, update on grocery.fetch_gate to service_role;

revoke execute on function grocery.name_key(text, text) from public, anon;
grant execute on function grocery.name_key(text, text) to authenticated, service_role;
revoke execute on function grocery.choose_product(uuid, uuid, int) from public, anon;
grant execute on function grocery.choose_product(uuid, uuid, int) to authenticated;
revoke execute on function grocery.reserve_fetch(text, int, int) from public, anon, authenticated;
grant execute on function grocery.reserve_fetch(text, int, int) to service_role;
revoke execute on function grocery.claim_search(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function grocery.claim_search(uuid, text, timestamptz) to service_role;
revoke execute on function grocery.remembered_product(uuid) from public, anon;
grant execute on function grocery.remembered_product(uuid) to authenticated;
