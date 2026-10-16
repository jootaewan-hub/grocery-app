# 구조

배포·데이터·로그인은 확정(D-003, D-004, D-006). 테이블 초안은 Supabase 단계에서 확정한다.

## 구성

| 부분 | 선택 | 이유 |
|---|---|---|
| 앱 | React + TypeScript + Vite, PWA | 휴대폰 홈 화면 설치, 카메라(바코드·사진), 오프라인 목록 보기. 가계부와 같은 도구. |
| 데이터·로그인 | 가계부와 같은 Supabase 프로젝트(`account-book`)의 Postgres, Auth, Realtime. 장보기 테이블은 `grocery` 스키마 | 계정·가구를 가계부와 공유(D-003). 로그인은 가계부 계정 이메일+비밀번호(D-004). RLS로 가구 구성원만 접근. |
| 서버 함수 | Supabase Edge Functions | API 키를 서버에만 두고 외부 API를 대신 호출. 응답 캐시. |
| 정기 수집 | Supabase pg_cron | 지켜보는 품목 시세와 식약처 회수 목록을 매일 자동 수집 → 실제 추이 데이터. |
| 배포 | GitHub Pages (Actions에서 테스트 → 빌드 → 배포) | 가계부와 같은 방식(D-006). 저장소는 배포 때 공개로 바꾼다. |

## 공유 DB 규칙 (D-003)

- 장보기 마이그레이션은 `grocery` 스키마 안의 객체만 만들고 바꾼다. 가계부의 `public` 테이블은 읽기만 하고, 가계부 내역에 쓰는 것은 지출 기록 단계에서 정할 함수 하나로만 한다.
- 가구·구성원은 가계부의 테이블을 그대로 쓴다. 아래 초안의 `households`, `household_members`는 새로 만들지 않는다.

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
