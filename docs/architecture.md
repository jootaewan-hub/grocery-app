# 구조

배포·데이터·로그인은 확정(D-003, D-004, D-006). 테이블 초안은 Supabase 단계에서 확정한다.

## 구성

| 부분 | 선택 | 이유 |
|---|---|---|
| 앱 | React + TypeScript + Vite, PWA | 휴대폰 홈 화면 설치, 카메라(바코드·사진), 오프라인 목록 보기. 가계부와 같은 도구. |
| 데이터·로그인 | 가계부와 같은 Supabase 프로젝트(`account-book`)의 Postgres, Auth, Realtime. 장보기 테이블은 `grocery` 스키마 | 계정·가구를 가계부와 공유(D-003). 로그인은 가계부 계정 이메일+비밀번호(D-004). RLS로 가구 구성원만 접근. |
| 서버 함수 | Supabase Edge Functions | API 키를 서버에만 두고 외부 API를 대신 호출. 응답 캐시. |
| 정기 수집 | GitHub Actions 예약 실행 → Edge Function | 식약처 목록은 매일 07:00(한국 시간) `.github/workflows/food-alerts-sync.yml`이 `food-alerts-sync`를 부른다. 시세 수집도 같은 방식을 쓸 예정(계획 ③). |
| 배포 | GitHub Pages (Actions에서 테스트 → 빌드 → 배포) | 가계부와 같은 방식(D-006). 저장소는 배포 때 공개로 바꾼다. |

## 공유 DB 규칙 (D-003)

- 장보기 마이그레이션은 `grocery` 스키마 안의 객체만 만들고 바꾼다. 가계부의 `public` 테이블은 읽기만 하고, 가계부 내역에 쓰는 것은 지출 기록 단계에서 정할 함수 하나로만 한다.
- `grocery.items`의 `added_by`·`bought_by`는 가계부 구성원을 참조하되 `on delete set null`이다(D-007). 장보기 데이터가 가계부의 구성원·계정 삭제를 막지 않고, 떠난 구성원이 담은 품목은 이름 없이 남는다. 새 행은 RLS가 `added_by` = 본인을 강제한다.
- 장보기 스키마(`grocery`)와 RLS는 `supabase/migrations/`에 있고 PGlite 테스트로 검증한다. 공유 DB 적용과 Exposed schemas 추가는 사용자 확인 후 한다.
- 가구·구성원은 가계부의 테이블을 그대로 쓴다. 아래 초안의 `households`, `household_members`는 새로 만들지 않는다.
- 공유 DB에 마이그레이션을 적용하는 방법은 두 저장소(가계부·장보기) 모두 Supabase MCP의 `apply_migration` 하나뿐이다. 어느 쪽도 `supabase db push`를 쓰지 않는다(한쪽 저장소의 마이그레이션 목록만 보고 다른 쪽 적용분을 되돌리거나 어긋나게 할 수 있다).
- Realtime: `grocery.items`의 INSERT·UPDATE는 `household_id` 필터로 구독하지만, DELETE는 Supabase가 필터를 지원하지 않아 필터 없이 구독한다. 그래서 공유 프로젝트에 로그인한 사용자는 어느 가구의 삭제든 지워진 행의 `id`만 받는다(행 내용은 오지 않는다). 앱은 이 이벤트를 받으면 자기 가구 목록을 다시 읽을 뿐이다.

## 데이터 흐름

1. 담기: 글 → 앱에서 품목·용량·개수 분리 → `items` 저장. 사진 → `photo-extract` 함수(Anthropic API) → 확인 목록 → 저장.
2. 품목 확인(품목을 담고 상품을 고르면 자동, 사지 않은 품목은 하루 한 번 다시, 상세를 열었는데 오늘 값이 없으면 그때 확인 — 화면 설계 8-1절): `product-check` 함수가
   - 상품 후보, 이미지, 쇼핑몰별 가격: 가격 출처는 `docs/data-sources.md` 1절, 계획 ④에서 확정
   - `grocery.food_alerts`(매일 수집분)와 대조 — 지금은 목록 화면이 `grocery.item_alerts()`로 제품명·업체명 단어를 맞춘다(계획 ②). 바코드 일치는 계획 ⑥
   - 신선 품목이면 KAMIS 최근 시세(`price_points`)
   를 모아 `product_checks`에 저장하고 앱에 돌려준다. 같은 품목·같은 날은 캐시.
3. 매일 수집:
   - `food-alerts-sync`(계획 ②): 식품안전나라 I0490 회수·판매중지, I2620 검사부적합, I2715 해외직구 차단 전체를 1,000건씩 받아 `grocery.food_alerts`에 upsert(지우지 않음), 서비스마다 `grocery.sync_runs`에 결과를 남긴다. 호출 비밀번호 없이 스스로 막는다: 세 서비스 모두 20시간 안에 성공했으면 받지 않고, `grocery.sync_lock` 한 행을 `UPDATE … WHERE locked_at < 30분 전`으로 잡아야만 받는다(동시 호출도 하나만). 응답은 결과 종류(`done`·`partial`·`skipped`·`cooldown`)만.
   - 목록 화면은 `grocery.item_alerts()`(로그인한 사용자 권한, RLS 적용)로 자기 가구의 안 산 품목과 대조하고, `sync_runs`의 마지막 성공 시각으로 "확인한 범위"와 48시간 넘은 경고를 보여 준다.
   - `market-sync`(KAMIS 일별, 지켜보는 품목) → `price_points`(계획 ③).

## 테이블 초안

- `households`, `household_members(user_id, household_id, display_name)`
- `items(id, household_id, name, spec, count, category, product_key, barcode, added_by, added_at, bought_at, bought_by, paid, store)`
- `product_checks(product_key, household_id, checked_at, result jsonb, sources jsonb)`
- `price_points(product_key, source, date, price, unit, meta jsonb)` — 공공 시세와 우리가 확인한 온라인 최저가
- `watch(household_id, product_key)`
- `recalls(seq, product_name, maker, reason, grade, barcode, report_no, registered_at, raw jsonb)`

모든 가구 테이블에 RLS: `household_id`가 본인이 속한 가구일 때만 읽기·쓰기.
