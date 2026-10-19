-- 농가 단위 농산물 부적합을 가려내는 생산자 표기를 넓힌다(20261019020000에 이어, 2026-10-19).
-- 실제 수집분에 '파악불가', '확인불가', '생산자 정보 파악 불가'처럼 표기가 여럿이라 '당근' 경고가 남았다.
-- 기준: I2620이면서 생산자 이름에 *(이름 일부 가림)가 있거나 '미상'·'불가'·'불명'이 들어 있음.
-- 그날 I2620 업체명 중 이 말이 들어간 업체는 없었다. 회수·판매중지(I0490)는 그대로 둔다. grocery 스키마만 바꾼다(D-003).

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
      and not (a.source = 'I2620' and coalesce(a.maker, '') ~ '\*|미상|불가|불명')
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
