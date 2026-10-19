-- 목록 대조(grocery.item_alerts)에서 농가 단위 농산물 부적합 기록을 뺀다(사용자 결정 2026-10-19).
-- 첫 실제 수집에서 I2620 441건 중 357건이 개인 생산자(이름 일부를 *로 가림)의 농산물 한 로트였고,
-- '당근', '고수'처럼 흔한 채소를 담으면 거의 늘 경고가 떠서 목록에서는 숨기기로 했다.
-- 가려내는 기준: I2620이면서 생산자 이름에 *가 있거나 '생산자 미상'·'특정불가'. 회수·판매중지(I0490)는 그대로 둔다.
-- grocery 스키마만 바꾼다(D-003). create or replace라 권한은 그대로 남는다.

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
    where ((a.source in ('I0490', 'I2620') and (a.registered_on is null or a.registered_on >= current_date - 365))
       or (a.source = 'I2715' and (a.ends_on is null or a.ends_on >= current_date)))
      -- 농가 단위 농산물 부적합은 목록에서 뺀다(사용자 결정 2026-10-19). 업체명이 없는 기록은 남긴다.
      and not (a.source = 'I2620' and coalesce(a.maker, '') ~ '\*|생산자 미상|특정불가')
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
