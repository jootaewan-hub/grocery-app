# 구조 (제안 — 확정 전)

`docs/tracking/status.md`의 "확정할 결정"이 정해지기 전까지는 제안이다.

## 구성

| 부분 | 제안 | 이유 |
|---|---|---|
| 앱 | React + TypeScript + Vite, PWA | 휴대폰 홈 화면 설치, 카메라(바코드·사진), 오프라인 목록 보기. 기존 프로젝트와 같은 도구. |
| 데이터·로그인 | Supabase (Postgres, Auth, Realtime) | 두 사람이 같은 목록을 실시간으로 공유. RLS로 가구 구성원만 접근. |
| 서버 함수 | Supabase Edge Functions | API 키를 서버에만 두고 외부 API를 대신 호출. 응답 캐시. |
| 정기 수집 | Supabase pg_cron (또는 배포처의 cron) | 지켜보는 품목 시세와 식약처 회수 목록을 매일 자동 수집 → 실제 추이 데이터. |
| 배포 | Cloudflare Pages 또는 Vercel (확정 전) | 건강백과는 Cloudflare Pages를 쓰고 있다. |

## 데이터 흐름

1. 담기: 글 → 앱에서 품목·용량·개수 분리 → `items` 저장. 사진 → `photo-extract` 함수(Anthropic API) → 확인 목록 → 저장.
2. 품목 확인(사용자가 누를 때): `product-check` 함수가
   - 네이버 쇼핑 검색 → 상품 후보, 이미지, 쇼핑몰별 가격
   - `recalls` 테이블(매일 수집분)과 바코드·제품명·업체명 대조
   - 신선 품목이면 KAMIS 최근 시세(`price_points`)
   를 모아 `product_checks`에 저장하고 앱에 돌려준다. 같은 품목·같은 날은 캐시.
3. 매일 수집: `recalls-sync`(식품안전나라 I0490, 최근 등록분), `market-sync`(KAMIS 일별, 지켜보는 품목) → `recalls`, `price_points`.

## 테이블 초안

- `households`, `household_members(user_id, household_id, display_name)`
- `items(id, household_id, name, spec, count, category, product_key, barcode, added_by, added_at, bought_at, bought_by, paid, store)`
- `product_checks(product_key, household_id, checked_at, result jsonb, sources jsonb)`
- `price_points(product_key, source, date, price, unit, meta jsonb)` — 공공 시세와 우리가 확인한 온라인 최저가
- `watch(household_id, product_key)`
- `recalls(seq, product_name, maker, reason, grade, barcode, report_no, registered_at, raw jsonb)`

모든 가구 테이블에 RLS: `household_id`가 본인이 속한 가구일 때만 읽기·쓰기.
