-- 가격 확인 ④-1: 다나와 가격 확인 기록과 가격 줄, 품목별 오늘 최저가, 고른 상품명까지 더한 식약처 대조.
-- grocery 스키마만 바꾼다(D-003). 쓰기는 product-check(서비스 롤)만 한다.

-- 상품 하나를 출처에서 한 번 확인한 기록. checked_on은 한국 날짜(같은 상품·같은 날 캐시와 "오늘" 판단에 쓴다).
create table grocery.price_checks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references grocery.products (id) on delete cascade,
  source text not null check (source = 'danawa'),
  checked_at timestamptz not null default now(),
  checked_on date generated always as ((checked_at at time zone 'Asia/Seoul')::date) stored,
  ok boolean not null,
  error text,
  page_qty int
);
create index price_checks_product_idx on grocery.price_checks (product_id, checked_at desc);

-- 확인에서 읽은 가격 줄. seller가 null이면 다나와의 수량별 최저가 줄, 있으면 쇼핑몰별 최저가 줄.
create table grocery.price_quotes (
  check_id uuid not null references grocery.price_checks (id) on delete cascade,
  product_id uuid not null references grocery.products (id) on delete cascade,
  qty int not null check (qty between 1 and 999),
  seller text,
  price int not null check (price > 0),
  delivery int check (delivery >= 0),
  unit_price int check (unit_price > 0),
  unit_label text,
  mall_count int
);
create index price_quotes_check_idx on grocery.price_quotes (check_id);

alter table grocery.price_checks enable row level security;
alter table grocery.price_quotes enable row level security;
create policy price_checks_read on grocery.price_checks for select to authenticated using (true);
create policy price_quotes_read on grocery.price_quotes for select to authenticated using (true);
revoke all on grocery.price_checks, grocery.price_quotes from public, anon, authenticated;
grant select on grocery.price_checks, grocery.price_quotes to authenticated;
grant select, insert, update, delete on grocery.price_checks, grocery.price_quotes to service_role;

-- 안 산 내 가구 품목마다: 오늘(한국 시간) 성공한 확인 중 고른 수량과 같은 줄의 최저가 하나.
-- 같은 값이면 판매처가 있는 줄이 먼저(어디서 사는지 보여 줄 수 있게).
create function grocery.item_prices()
returns table (item_id uuid, price int, seller text, source text, qty int, delivery int, checked_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (i.id) i.id, q.price, q.seller, c.source, q.qty, q.delivery, c.checked_at
    from grocery.items i
    join grocery.price_checks c
      on c.product_id = i.product_id and c.ok
     and c.checked_on = (now() at time zone 'Asia/Seoul')::date
    join grocery.price_quotes q on q.check_id = c.id and q.qty = i.product_qty
   where i.bought_at is null and i.product_id is not null
   order by i.id, q.price, (q.seller is null), c.checked_at desc
$$;

-- 식약처 대조의 공통 부분. 품목 이름과 고른 상품명(있으면) 각각을 단어로 나눠 같은 규칙으로 맞춘다
-- (20261019030000의 규칙: 수량·광고 단어 빼기, 단어 하나는 제품명에, 과반은 제품명이나 업체명에).
-- farm: 농가 단위 농산물 부적합(I2620, 생산자 이름 가림·미상·불가·불명). 목록에서는 빼고 상세에서만 보여 준다.
create function grocery._alert_hits()
returns table (
  item_id uuid, source text, source_id text, product_name text, maker text,
  reason text, grade text, pack_unit text, registered_on date, via text, farm boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with names as (
    select i.id as item_id, 'item_name'::text as via, i.name as nm
      from grocery.items i where i.bought_at is null
    union all
    select i.id, 'product_name', p.name
      from grocery.items i join grocery.products p on p.id = i.product_id
     where i.bought_at is null
  ),
  toks as materialized (
    select n.item_id, n.via,
           array(
             select replace(t, '.', '') from (
               select regexp_replace(lower(w), '[^가-힣a-z0-9.]', '', 'g') as t
               from regexp_split_to_table(n.nm, '\s+') as w
             ) s
             where char_length(replace(t, '.', '')) >= 2
               and t !~ '^x?[0-9.]+(g|kg|mg|ml|l|구|개입|개|포기|단|마리|팩|봉|병|캔|장|롤|모|판|망|근|입|ea)?$'
               and replace(t, '.', '') not in
                 ('무료배송', '당일배송', '특가', '행사', '기획', '증정', '세트', '묶음', '정품', '최저가', '할인', '대용량')
           ) as tokens
    from names n
  ),
  cand as materialized (
    select a.source, a.source_id, a.product_name, a.maker, a.reason, a.grade, a.pack_unit, a.registered_on,
           regexp_replace(lower(a.product_name), '[^가-힣a-z0-9]', '', 'g') as pn,
           regexp_replace(lower(coalesce(a.maker, '')), '[^가-힣a-z0-9]', '', 'g') as mk,
           (a.source = 'I2620' and coalesce(a.maker, '') ~ '\*|미상|불가|불명') as farm
    from grocery.food_alerts a
    where (a.source in ('I0490', 'I2620') and (a.registered_on is null or a.registered_on >= current_date - 365))
       or (a.source = 'I2715' and (a.ends_on is null or a.ends_on >= current_date))
  )
  select t.item_id, c.source, c.source_id, c.product_name, c.maker,
         c.reason, c.grade, c.pack_unit, c.registered_on, t.via, c.farm
  from toks t
  join cand c
    on cardinality(t.tokens) > 0
   and exists (select 1 from unnest(t.tokens) k where strpos(c.pn, k) > 0)
   and (select count(*) from unnest(t.tokens) k where strpos(c.pn, k) > 0 or strpos(c.mk, k) > 0) * 2
       > cardinality(t.tokens)
$$;

-- 목록 경고: 농가 기록을 뺀 대조 결과, 품목·기록당 한 행(앱이 읽는 열은 그대로).
create or replace function grocery.item_alerts()
returns table (
  item_id uuid, source text, source_id text, product_name text, maker text,
  reason text, grade text, pack_unit text, registered_on date, level text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.item_id, h.source, h.source_id, h.product_name, h.maker, h.reason, h.grade, h.pack_unit, h.registered_on,
         'similar'::text
    from (
      select distinct on (item_id, source, source_id) *
        from grocery._alert_hits()
       where not farm
       order by item_id, source, source_id
    ) h
   order by h.registered_on desc nulls last
$$;

-- 품목 상세 안전 탭: 그 품목의 모든 기록(농가 기록 포함). 고른 상품명으로도 맞으면 via = product_name.
create function grocery.item_safety(p_item uuid)
returns table (
  source text, source_id text, product_name text, maker text,
  reason text, grade text, pack_unit text, registered_on date, via text, farm boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.source, h.source_id, h.product_name, h.maker, h.reason, h.grade, h.pack_unit, h.registered_on, h.via, h.farm
    from (
      select distinct on (source, source_id) *
        from grocery._alert_hits()
       where item_id = p_item
       order by source, source_id, (via = 'product_name') desc
    ) h
   order by h.farm, h.registered_on desc nulls last
$$;

revoke execute on function grocery.item_prices() from public, anon;
grant execute on function grocery.item_prices() to authenticated;
revoke execute on function grocery._alert_hits() from public, anon;
grant execute on function grocery._alert_hits() to authenticated;
revoke execute on function grocery.item_safety(uuid) from public, anon;
grant execute on function grocery.item_safety(uuid) to authenticated;
