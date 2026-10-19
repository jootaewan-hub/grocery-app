-- 식약처 경고(회수·판매중지 I0490, 검사부적합 I2620, 해외직구 위해식품 I2715)와 품목 대조.
-- grocery 스키마만 바꾼다(D-003). 확장(pg_cron·pg_net·pg_trgm)은 쓰지 않는다.
-- 행은 Edge Function food-alerts-sync가 서비스 롤로 넣고, 로그인한 사용자는 읽기만 한다(공공 자료).

create table grocery.food_alerts (
  source text not null check (source in ('I0490', 'I2620', 'I2715')),
  source_id text not null,
  product_name text not null,
  maker text,
  reason text,
  grade text,
  pack_unit text,
  barcode text,
  report_no text,
  registered_on date,
  ends_on date,
  raw jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (source, source_id)
);
create index food_alerts_registered_idx on grocery.food_alerts (registered_on);

create table grocery.sync_runs (
  id bigint generated always as identity primary key,
  source text not null,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  rows int not null default 0,
  total int,
  error text
);
create index sync_runs_source_idx on grocery.sync_runs (source, ran_at desc);

alter table grocery.food_alerts enable row level security;
alter table grocery.sync_runs enable row level security;
create policy food_alerts_read on grocery.food_alerts for select to authenticated using (true);
create policy sync_runs_read on grocery.sync_runs for select to authenticated using (true);

revoke all on grocery.food_alerts, grocery.sync_runs from public, anon, authenticated;
-- raw(원본 응답: 업소 주소·전화 등)는 확인용으로만 남기고 로그인한 사용자에게는 보여 주지 않는다.
grant select (source, source_id, product_name, maker, reason, grade, pack_unit, barcode, report_no,
  registered_on, ends_on, fetched_at) on grocery.food_alerts to authenticated;
grant select on grocery.sync_runs to authenticated;
grant select, insert, update, delete on grocery.food_alerts, grocery.sync_runs to service_role;

-- 내 가구의 아직 사지 않은 품목과 비슷한 식약처 기록. RLS를 그대로 따르도록 security invoker.
-- 놓치는 쪽이 더 위험하다(화면 설계 8-2절). 규칙:
--   품목 이름을 단어로 나눠 소문자·한글·영문·숫자만 남기고, 2글자 미만·수량(600g, 2봉, x2)·광고 단어(무료배송 등)는 뺀다.
--   단어 하나는 제품명에 있어야 하고, 제품명이나 업체명(따로따로 본다)에 들어 있는 단어가 과반이어야 한다.
--   단어가 하나면 그 단어가 제품명에 있어야 한다. 두 이름을 이어 붙이지 않으므로 경계를 넘는 글자 조각은 맞추지 않는다.
-- 기간: I0490·I2620은 등록 365일 이내이거나 등록일을 읽지 못한 것, I2715는 차단 종료 전. 오늘은 current_date(UTC, 하루 차이 허용).
-- 성능: CTE를 materialized로 한 번씩만 계산한다(아니면 품목마다 경고 전체와 정규식을 다시 돈다).
-- 바코드가 아직 없어 level은 늘 'similar'(바코드 일치 'record'는 바코드 담기 계획에서).
create function grocery.item_alerts()
returns table (
  item_id uuid, source text, source_id text, product_name text, maker text,
  reason text, grade text, pack_unit text, registered_on date, level text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with toks as materialized (
    select i.id as item_id,
           array(
             select replace(t, '.', '') from (
               -- 점은 1.05kg 같은 수량을 알아보려고 잠시 남겼다가 뺀다
               select regexp_replace(lower(w), '[^가-힣a-z0-9.]', '', 'g') as t
               from regexp_split_to_table(i.name, '\s+') as w
             ) s
             where char_length(replace(t, '.', '')) >= 2
               and t !~ '^x?[0-9.]+(g|kg|mg|ml|l|구|개입|개|포기|단|마리|팩|봉|병|캔|장|롤|모|판|망|근|입|ea)?$'
               and replace(t, '.', '') not in
                 ('무료배송', '당일배송', '특가', '행사', '기획', '증정', '세트', '묶음', '정품', '최저가', '할인', '대용량')
           ) as tokens
    from grocery.items i
    where i.bought_at is null
  ),
  cand as materialized (
    -- raw는 authenticated가 못 읽으므로 쓰는 열만 고른다(security invoker)
    select a.source, a.source_id, a.product_name, a.maker, a.reason, a.grade, a.pack_unit, a.registered_on,
           regexp_replace(lower(a.product_name), '[^가-힣a-z0-9]', '', 'g') as pn,
           regexp_replace(lower(coalesce(a.maker, '')), '[^가-힣a-z0-9]', '', 'g') as mk
    from grocery.food_alerts a
    where (a.source in ('I0490', 'I2620') and (a.registered_on is null or a.registered_on >= current_date - 365))
       or (a.source = 'I2715' and (a.ends_on is null or a.ends_on >= current_date))
  )
  select t.item_id, c.source, c.source_id, c.product_name, c.maker,
         c.reason, c.grade, c.pack_unit, c.registered_on, 'similar'::text
  from toks t
  join cand c
    on cardinality(t.tokens) > 0
   and exists (select 1 from unnest(t.tokens) k where strpos(c.pn, k) > 0)
   and (select count(*) from unnest(t.tokens) k where strpos(c.pn, k) > 0 or strpos(c.mk, k) > 0) * 2
       > cardinality(t.tokens)
  order by c.registered_on desc nulls last
$$;

revoke execute on function grocery.item_alerts() from public, anon;
grant execute on function grocery.item_alerts() to authenticated;
