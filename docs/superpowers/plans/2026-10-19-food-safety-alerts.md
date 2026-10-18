# 식약처 대조 Implementation Plan (계획 ②)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 식품안전나라의 회수·판매중지, 검사부적합, 해외직구 위해식품 목록을 매일 받아 두고, 장보기 목록 품목과 대조해 "비슷한 제품 기록"을 목록 맨 위에 경고로 보여 준다.

**Architecture:** Supabase Edge Function `food-alerts-sync`가 세 서비스(I0490, I2620, I2715)를 전부 받아 `grocery.food_alerts`에 upsert하고 실행 결과를 `grocery.sync_runs`에 남긴다. GitHub Actions 예약 실행이 매일 이 함수를 부른다(공유 DB에 pg_cron·pg_net 확장을 켜지 않기 위해). 대조는 DB 함수 `grocery.item_alerts()`가 읽을 때마다 계산한다(가구 RLS를 그대로 따름). 앱은 그 결과로 목록 경고와 경고 시트를 그린다.

**Tech Stack:** Supabase Postgres(RLS, SQL 함수), Supabase Edge Functions(Deno, supabase-js), GitHub Actions(schedule), React 19 + TS, Vitest, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-16-screens-design.md` — 8-1절(확인이 언제 도는가), 8-2절(식약처 대조의 네 가지 상태), 6절(먼저 볼 것), 9절(상태 문구). 데이터 사실은 `docs/data-sources.md` 5절.

## 확인된 사실 (2026-10-19, sample 키 호출)

| 서비스 | 전체 건수 | 고유 id | 등록일 형식 | 바코드 |
|---|---|---|---|---|
| I0490 회수·판매중지 | 379 | `RTRVLDSUSE_SEQ` | `CRET_DTM` `2026-10-16 17:53:27.662706` | `BRCDNO` |
| I2620 검사부적합(국내) | 540 | `RTRVLDSUSE_SEQ` | `CRET_DTM` `2026.03.23` | `BRCDNO`(빈 값 많음) |
| I2715 해외직구 위해식품 | 5,013 | `SELF_IMPORT_SEQ` | `CRET_DTM` `20261015` | `BARCD_CTN`(`-`이면 없음) |

- 주소: `http://openapi.foodsafetykorea.go.kr/api/{key}/{서비스}/json/{시작}/{끝}`, 한 번에 최대 1000건(끝-시작+1 ≤ 1000).
- 응답: `{ "<서비스>": { "total_count": "379", "row": [...], "RESULT": { "CODE": "INFO-000", "MSG": "..." } } }`. 자료 없음은 `INFO-200`, 그 밖의 코드(`ERROR-...`, `INFO-100` 등)는 실패로 본다.
- I0490 주요 항목: `PRDTNM` 제품명, `BSSHNM` 업체, `RTRVLPRVNS` 사유, `RTRVL_GRDCD_NM` 등급, `FRMLCUNIT` 포장 단위, `PRDLST_REPORT_NO` 품목보고번호. I2620: `PRDTNM`, `BSSHNM`, `TEST_ITMNM`(검사 항목) + `TESTANALS_RSLT`(결과) + `STDR_STND`(기준), `FRMLCUNIT`. I2715: `PRDT_NM`, `MUFC_NM`(제조사), `INGR_NM_LST`(위해 성분), `MUFC_CNTRY_NM`, `END_YMD`(차단 종료일).
- 공유 DB 확장: `pg_cron`, `pg_net`, `pg_trgm` 꺼짐, `supabase_vault` 켜짐. 이 계획은 확장을 새로 켜지 않는다.

## 이 계획의 판단 (사용자 확인 전 [제안])

- **예약 실행은 GitHub Actions**: 매일 07:00 KST(`0 22 * * *` UTC) + 수동 실행. 공개 저장소의 예약 워크플로는 60일 동안 저장소 활동이 없으면 GitHub가 멈춘다 → status.md 열린 문제에 적는다.
- **함수 보호**: Edge Function은 `verify_jwt = false`로 두고 `x-sync-secret` 헤더를 함수 비밀값 `SYNC_SECRET`과 비교한다. 틀리면 401이고 외부 호출을 하지 않는다.
- **전체 동기화**: 매번 세 서비스 전체를 받아 upsert한다(합계 약 6천 건, 호출 7번). 목록에서 사라진 행은 지우지 않는다(기록 보존).
- **대조 규칙**: 지금 품목에는 바코드·품목보고번호가 없으므로(바코드는 계획 ⑥) 이 계획은 8-2절의 "비슷한 기록 있음"만 만든다. "기록 있음"(바코드 일치)은 계획 ⑥에서 붙인다.
- **비밀값은 사용자가 넣는다**: `FOODSAFETY_API_KEY`, `SYNC_SECRET`(Supabase 함수 비밀값), `FOOD_SYNC_SECRET`(GitHub 저장소 비밀값). Claude는 키 값을 입력하지 않는다.

## Global Constraints

- "찾은 기록 없음"을 "안전함"으로 쓰지 않는다. 기록이 없을 때는 "확인한 범위에서 찾은 기록 없음"과 확인한 출처·기준일을 쓴다.
- 경고에는 출처(서비스 이름)와 등록일을 함께 쓴다. 화면의 날짜·등급·사유는 API 응답 값 그대로다.
- 식품안전나라 키는 서버(Edge Function 비밀값)에만 둔다. 브라우저 번들·저장소·로그에 넣지 않는다. 함수는 키를 로그에 찍지 않는다.
- 장보기 마이그레이션은 `grocery` 스키마만 만들고 바꾼다(D-003). 확장을 켜지 않는다.
- 화면 문구에 "AI", 반짝이, "분석 중"을 쓰지 않는다. 진행 표시는 "식약처 목록 확인 중".
- 경고 배지(DESIGN.md): 기록 있음 `clay` 바탕, 비슷한 기록 `clay-soft` 바탕에 `clay` 글자, 13px 600. 색만으로 알리지 않고 글자를 함께 쓴다.
- UI 변경은 390·1280 × 라이트·다크 캡처를 보고 고친 뒤에 끝났다고 한다.

## Review Focus

- **API 실패**: 키가 틀리거나 서비스가 오류 코드를 주면 그 서비스의 `sync_runs`에 실패를 남기고 기존 행은 그대로 둔다. 화면의 기준일은 마지막 성공 시각이다 → Task 3 테스트.
- **잡음 경고**: "배"·"무" 같은 한 글자 품목, 브랜드만 적은 품목("비비고")이 아무 기록에나 걸리면 안 된다 → Task 1 테스트.
- **날짜 형식 세 가지와 이상한 값**: 세 형식 모두 날짜로 읽고, 읽을 수 없는 값은 `null`로 저장하되 행은 버리지 않는다 → Task 2 테스트.
- **1000건이 넘는 서비스**: I2715(5,013건)는 여러 번 나눠 모두 받아야 한다 → Task 2 테스트.
- **다른 가구**: `item_alerts()`는 내 가구 품목에 대한 경고만 돌려준다 → Task 1 테스트.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20261019000000_grocery_food_alerts.sql` | `grocery.food_alerts`, `grocery.sync_runs`, `grocery.item_alerts()`, 권한 |
| `supabase/functions/_shared/foodAlerts.ts` | 응답 → 행 변환, 날짜 읽기, 페이지 나눠 받기(순수 TS, Deno·Node 모두에서 import) |
| `supabase/functions/food-alerts-sync/index.ts` | Edge Function 진입점(`Deno.serve`), 의존성 주입한 `handle()` 호출 |
| `supabase/functions/food-alerts-sync/handle.ts` | 비밀값 확인 → 세 서비스 받기 → upsert → sync_runs 기록 |
| `supabase/config.toml` | `[functions.food-alerts-sync] verify_jwt = false` |
| `.github/workflows/food-alerts-sync.yml` | 매일 07:00 KST와 수동 실행으로 함수 호출 |
| `src/lib/alerts.ts` | `FoodAlert` 타입, 경고 결과 묶기 |
| `src/lib/store.ts`, `src/lib/supabaseStore.ts`, `src/demo.ts` | `ListStore.alerts()` 추가 |
| `src/components/ListScreen.tsx`, `ListRow.tsx`, `AlertSheet.tsx`(새 파일) | 경고 배지, 먼저 볼 것, 경고 시트 |
| `tests/foodAlerts.test.ts`, `tests/foodAlertsSync.test.ts`, `tests/db.test.ts`, `tests/alerts.test.ts`, `tests/fixtures/foodsafety/*.json` | 테스트 |

---

### Task 1: 경고 테이블과 대조 함수

**Files:**
- Create: `supabase/migrations/20261019000000_grocery_food_alerts.sql`
- Modify: `tests/db.test.ts`(새 마이그레이션도 적용하고 describe 추가)

**Interfaces:**
- Produces:
  - `grocery.food_alerts` — `source text not null check (source in ('I0490','I2620','I2715'))`, `source_id text not null`, `product_name text not null`, `maker text`, `reason text`(I0490 사유 / I2620 "검사 항목: 결과(기준)" / I2715 위해 성분), `grade text`(I0490 등급), `pack_unit text`, `barcode text`(빈 값·`-`는 null), `report_no text`, `registered_on date`, `ends_on date`(I2715 END_YMD), `raw jsonb not null`, `fetched_at timestamptz not null default now()`, `primary key (source, source_id)`. 인덱스 `(registered_on)`.
  - `grocery.sync_runs` — `id bigint generated always as identity primary key`, `source text not null`, `ran_at timestamptz not null default now()`, `ok boolean not null`, `rows int not null default 0`, `total int`, `error text`. 인덱스 `(source, ran_at desc)`.
  - `grocery.item_alerts()` returns `table (item_id uuid, source text, source_id text, product_name text, maker text, reason text, grade text, pack_unit text, registered_on date, level text)`, `language sql stable security invoker`.
- 권한: 두 테이블 RLS 켜고 `authenticated` select 정책 `using (true)`(공공 자료); `authenticated`에는 select만, `anon` 없음, `service_role` 전체. 함수 execute는 `authenticated`만.

대조 규칙(`item_alerts`):
- 품목 이름 정규화: 소문자, 한글·영문·숫자 외 제거. 토큰은 공백으로 나눈 원래 이름의 각 단어를 같은 방식으로 정규화한 것 중 **2글자 이상**만.
- 2글자 이상 토큰이 없으면 대조하지 않는다("배", "무").
- 브랜드만 있는 품목은 대조하지 않는다: 토큰이 하나뿐이고 그 토큰이 `food_alerts.maker` 정규화 값에만 들어 있고 `product_name`에는 없으면 제외(= 모든 토큰 중 최소 하나는 제품명에 있어야 한다).
- 일치: 모든 토큰이 `정규화(product_name) || 정규화(maker)` 안에 들어 있고, 최소 한 토큰은 `정규화(product_name)` 안에 있다.
- 기간: I0490·I2620은 `registered_on`이 오늘 기준 365일 이내, I2715는 `ends_on`이 null이거나 오늘 이후.
- 산 품목(`bought_at` 있음)은 제외. `level`은 이 계획에서 항상 `'similar'`.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/db.test.ts`에 `describe('식약처 대조')`. 슈퍼유저로 `food_alerts`에 행을 넣고 A 가구 품목을 넣은 뒤 `as(A, 'select * from grocery.item_alerts()')`:

```ts
it('제품명에 품목 단어가 모두 있으면 비슷한 기록', ...)        // 품목 '비비고 왕교자' ↔ I0490 '비비고 왕교자 1.05kg'(maker 'CJ제일제당') → 1행, level 'similar'
it('브랜드는 업체명으로 맞춰도 된다', ...)                      // '풀무원 두부' ↔ product '국산콩 두부', maker '풀무원식품' → 1행
it('한 글자 품목은 대조하지 않는다', ...)                        // '배' ↔ product '배즙' → 0행
it('브랜드만 적은 품목은 대조하지 않는다', ...)                  // '풀무원' ↔ product '국산콩 두부', maker '풀무원식품' → 0행
it('1년 지난 회수는 빼고, 해외직구는 차단 종료 전이면 넣는다', ...) // I0490 registered_on 400일 전 → 0; I2715 ends_on 내일 → 1, 어제 → 0
it('산 품목은 뺀다', ...)                                        // bought_at 있음 → 0
it('다른 가구 품목 경고는 보이지 않는다', ...)                    // as(C) → 0행
it('authenticated는 food_alerts를 읽기만 한다', ...)            // as(A) insert → /permission denied/; as(null) select → /permission denied/
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/db.test.ts` / Expected: FAIL(테이블·함수 없음)
- [ ] **Step 3: 마이그레이션 작성** — 위 Interfaces와 규칙대로. 파일 머리에 "grocery 스키마만 바꾼다(D-003), 확장 사용 안 함"을 적는다. 오늘 기준은 `current_date`(Asia/Seoul이 아니어도 하루 차이는 허용 — 주석).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/db.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "식약처 경고 테이블과 품목 대조 함수"`

---

### Task 2: 응답 변환과 나눠 받기

**Files:**
- Create: `supabase/functions/_shared/foodAlerts.ts`, `tests/fixtures/foodsafety/I0490.json`, `I2620.json`, `I2715.json`(2026-10-19 sample 응답 그대로 저장)
- Test: `tests/foodAlerts.test.ts`

**Interfaces:**
- Produces:
  - `type FoodService = 'I0490' | 'I2620' | 'I2715'`
  - `type FoodAlertRow = { source: FoodService; source_id: string; product_name: string; maker: string | null; reason: string | null; grade: string | null; pack_unit: string | null; barcode: string | null; report_no: string | null; registered_on: string | null; ends_on: string | null; raw: Record<string, unknown> }` (날짜는 `YYYY-MM-DD`)
  - `parseFoodDate(v: unknown): string | null` — `2026-10-16 17:53:27.662706`, `2026.03.23`, `20261015` → `YYYY-MM-DD`; 그 밖·빈 값 → `null`
  - `toAlertRow(service: FoodService, row: Record<string, unknown>): FoodAlertRow | null` — 고유 id나 제품명이 비면 `null`
  - `type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>`
  - `fetchService(service: FoodService, key: string, fetchImpl: FetchLike): Promise<{ rows: FoodAlertRow[]; total: number }>` — 1000건씩 `1/1000`, `1001/2000` … `total_count`까지. `RESULT.CODE`가 `INFO-000`이면 계속, `INFO-200`이면 `{rows: [], total: 0}`, 그 밖이면 `FoodApiError(code, msg)`를 던진다. 오류 메시지에 키를 넣지 않는다(URL을 메시지에 쓰지 않음).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/foodAlerts.test.ts`

```ts
it('날짜 세 형식', () => {
  expect(parseFoodDate('2026-10-16 17:53:27.662706')).toBe('2026-10-16')
  expect(parseFoodDate('2026.03.23')).toBe('2026-03-23')
  expect(parseFoodDate('20261015')).toBe('2026-10-15')
  expect(parseFoodDate('데이터없음')).toBeNull(); expect(parseFoodDate('')).toBeNull()
})
it('I0490 행 변환', () => { /* fixture 첫 행 → source_id '3000235959', product_name '만제 자연산 성게알 소스', maker '만제영어조합법인', reason '소비기한 미표시', grade '1등급', pack_unit '210g', barcode '8809565891403', registered_on '2026-10-16' */ })
it('I2620 사유는 검사 항목·결과·기준을 합친다', () => { /* reason '금속성이물: 39.84 mg/kg (기준 10.0미만 mg/kg)', barcode null(빈 값) */ })
it('I2715 바코드 "-"는 null, 차단 종료일', () => { /* barcode null, ends_on '2029-12-31', maker 'Shen Neng Herbal Medicines Group Pty Ltd', reason 'Andrographis' */ })
it('1000건 넘으면 나눠 받는다', async () => { /* 가짜 fetch: total_count '2500' → 호출 URL 끝이 /1/1000, /1001/2000, /2001/2500, rows 2500 */ })
it('INFO-200은 빈 결과', async () => {})
it('오류 코드는 FoodApiError, 메시지에 키가 없다', async () => { /* key 'SECRETKEY', RESULT.CODE 'ERROR-300' → 던짐, String(err)에 'SECRETKEY' 없음 */ })
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/foodAlerts.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — Deno 전용 API(`Deno.*`)와 npm import를 쓰지 않는다(Node 테스트와 Deno 함수가 같이 import).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/foodAlerts.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "식약처 응답 변환과 나눠 받기"`

---

### Task 3: 동기화 Edge Function

**Files:**
- Create: `supabase/functions/food-alerts-sync/handle.ts`, `supabase/functions/food-alerts-sync/index.ts`, `supabase/config.toml`(없으면 만들고 `[functions.food-alerts-sync] verify_jwt = false`만)
- Test: `tests/foodAlertsSync.test.ts`

**Interfaces:**
- Consumes: `fetchService`, `FoodAlertRow`, `FoodService` (Task 2)
- Produces:
  - `type SyncDeps = { syncSecret: string | undefined; apiKey: string | undefined; fetchImpl: FetchLike; upsert(rows: FoodAlertRow[]): Promise<void>; recordRun(run: { source: FoodService; ok: boolean; rows: number; total: number | null; error: string | null }): Promise<void> }`
  - `handle(req: Request, deps: SyncDeps): Promise<Response>` — POST만(그 밖 405). `x-sync-secret`이 `syncSecret`과 다르거나 둘 중 하나가 비면 401(외부 호출 없음). `apiKey`가 비면 500 `{error: 'missing_api_key'}`. 세 서비스를 차례로 받아 500건씩 `upsert`, 서비스마다 `recordRun`. 한 서비스가 실패해도 나머지는 계속한다. 응답 200 `{ results: [{source, ok, rows, total}] }`(하나라도 실패하면 207). 오류 문자열은 `FoodApiError` 코드·메시지만(키·URL 없음).
  - `index.ts`: `Deno.serve`에서 `Deno.env.get('SYNC_SECRET')`, `Deno.env.get('FOODSAFETY_API_KEY')`, `fetch`, 서비스 롤 supabase-js 클라이언트(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 넣어 줌)로 `upsert`(`schema('grocery').from('food_alerts').upsert(rows, { onConflict: 'source,source_id' })`)와 `recordRun`(`sync_runs` insert)을 만들어 `handle`에 넘긴다. supabase-js는 `npm:@supabase/supabase-js@2` import.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/foodAlertsSync.test.ts`(가짜 deps, Node `Request` 사용)

```ts
it('비밀값이 없거나 틀리면 401이고 외부 호출이 없다', ...)
it('GET은 405', ...)
it('키가 없으면 500 missing_api_key', ...)
it('세 서비스를 받아 500건씩 upsert하고 서비스마다 기록한다', ...) // I2715 1200건 → upsert 호출 3번(500,500,200), recordRun 3번 ok
it('한 서비스가 실패해도 나머지는 계속하고 207', ...)            // I2620 ERROR-300 → recordRun ok:false error 'ERROR-300 ...', 나머지 ok, 기존 행 삭제 호출 없음
it('응답과 기록에 키가 들어가지 않는다', ...)                     // apiKey 'SECRETKEY' → 응답 본문·recordRun error에 없음
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/foodAlertsSync.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `handle.ts`는 Deno 전용 API를 쓰지 않는다. 비밀값 비교는 길이가 같을 때 문자별 XOR 누적으로(시간 차 줄이기).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/foodAlertsSync.test.ts` / Expected: PASS. `npm run typecheck`가 `supabase/functions`를 포함하지 않으면 tsconfig에서 제외하고(Deno 전용 `index.ts`), `handle.ts`·`_shared`는 테스트가 import하므로 Vitest가 검사한다.
- [ ] **Step 5: 커밋** — `git commit -m "식약처 목록 동기화 Edge Function"`

---

### Task 4: 매일 실행 워크플로

**Files:**
- Create: `.github/workflows/food-alerts-sync.yml`

내용(그대로):
- `on: schedule: - cron: '0 22 * * *'`(07:00 KST)와 `workflow_dispatch`
- `permissions: {}`, `concurrency: food-alerts-sync`
- job 하나, `runs-on: ubuntu-latest`, step 하나: `curl --fail-with-body -sS -X POST "https://kifdfpbwiebfgvdumqjf.supabase.co/functions/v1/food-alerts-sync" -H "x-sync-secret: ${FOOD_SYNC_SECRET}"`, `env: FOOD_SYNC_SECRET: ${{ secrets.FOOD_SYNC_SECRET }}`. 비밀값이 비어 있으면 `echo "FOOD_SYNC_SECRET가 비어 있어요"; exit 1`. 207도 실패로 처리(`-w '%{http_code}'`로 받아 200이 아니면 exit 1).

- [ ] **Step 1: 워크플로 작성**
- [ ] **Step 2: 검사** — Run: `npx --yes @action-validator/cli .github/workflows/food-alerts-sync.yml`(쓸 수 없으면 들여쓰기를 deploy.yml과 비교해 눈으로) / Expected: 오류 없음
- [ ] **Step 3: 커밋** — `git commit -m "식약처 목록 매일 동기화 워크플로"`

---

### Task 5: 목록 경고와 경고 시트

**Files:**
- Create: `src/lib/alerts.ts`, `src/components/AlertSheet.tsx`
- Modify: `src/lib/store.ts`, `src/lib/supabaseStore.ts`, `src/demo.ts`, `src/components/ListScreen.tsx`, `src/components/ListRow.tsx`, `src/styles/app.css`, `scripts/screenshots.mjs`
- Test: `tests/alerts.test.ts`, `tests/store.test.ts`

**Interfaces:**
- Consumes: `AlertLevel`(`src/lib/types.ts`), `groupByCategory/groupByWhere`의 `alerts` 인자(계획 ①), `grocery.item_alerts()`·`grocery.sync_runs`(Task 1)
- Produces:
  - `type FoodAlert = { source: 'I0490' | 'I2620' | 'I2715'; sourceId: string; productName: string; maker: string | null; reason: string | null; grade: string | null; packUnit: string | null; registeredOn: string | null }`
  - `type AlertsResult = { byItem: ReadonlyMap<string, FoodAlert[]>; levels: ReadonlyMap<string, AlertLevel>; syncedAt: Partial<Record<FoodAlert['source'], string>> }` — `syncedAt`은 서비스별 마지막 **성공** 실행 시각(ISO)
  - `groupAlerts(rows: { item_id: string; source: string; source_id: string; product_name: string; maker: string | null; reason: string | null; grade: string | null; pack_unit: string | null; registered_on: string | null; level: string }[]): Pick<AlertsResult, 'byItem' | 'levels'>` — 같은 품목에 여러 기록이면 등록일 최신순, `level`은 `'record'`가 하나라도 있으면 `'record'` 아니면 `'similar'`
  - `ListStore.alerts(): Promise<AlertsResult>` — Supabase: `client.schema('grocery').rpc('item_alerts')` + `sync_runs`에서 서비스별 `ok = true` 최신 `ran_at`. 메모리: 생성자에 받은 데모 경고.
  - 문구 상수(그대로): 서비스 이름 `I0490: '식약처 회수·판매중지'`, `I2620: '식약처 검사부적합'`, `I2715: '해외직구 위해식품'`; 배지 `'비슷한 제품 기록'`(similar) / `'회수 기록'`(record); 시트 안내 `'같은 제품인지 포장의 제품명·업체·포장 단위를 확인해 보세요.'`; 확인 범위 `'{서비스 이름} {M월 D일} 확인'`을 쉼표로 이음; 확인 기록이 하나도 없으면 `'식약처 목록을 아직 확인하지 못했어요'`.

화면 규칙(스펙 6절·8-2절):
- `ListScreen`은 목록과 함께 `store.alerts()`를 불러 `levels`를 `groupByCategory/groupByWhere`에 넘긴다(먼저 볼 것 고정). 목록이 바뀔 때와 화면 복귀(visibilitychange) 때 다시 부른다. 불러오기 실패는 목록을 막지 않는다(경고만 없이 그리고, 요약 아래 한 줄 "식약처 목록을 불러오지 못했어요").
- 경고가 있는 행: 둘째 줄 맨 앞에 배지(similar: `clay-soft` 바탕 `clay` 글자, record: `clay` 바탕 `on-ink` 글자, 13px 600). 배지를 누르면 `AlertSheet`.
- `AlertSheet`: 제목 "{품목 이름}과 비슷한 식약처 기록", 기록마다 제품명·업체·포장 단위·사유·등급(있을 때)·등록일·출처 이름을 나란히, 안내 문구, 맨 아래 확인 범위. 바텀시트 움직임·닫기·포커스는 `AddSheet`와 같은 방식.
- 데모 데이터: "○○ 냉동볶음밥" 품목에 I0490 비슷한 기록 1건(제품명 "○○ 냉동볶음밥 300g", 업체 "○○식품", 사유 "이물 혼입", 등급 "2등급", 등록일은 데모 날짜), `syncedAt` 세 서비스 모두.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/alerts.test.ts`: `groupAlerts`가 품목별로 묶고 최신순 정렬, record 우선 level; 빈 입력 → 빈 Map. `tests/store.test.ts`: 메모리 스토어 `alerts()`가 받은 데모 경고를 돌려준다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/alerts.test.ts tests/store.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 규칙대로.
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck && npm run build` / Expected: PASS
- [ ] **Step 5: 캡처와 확인** — `scripts/screenshots.mjs`에 `?demo=1` 목록(먼저 볼 것에 경고 품목) 390·1280 × 라이트·다크, 경고 시트 390 라이트·다크를 더하고 열어서 확인한다. "안전" 문구 없음, 배지 대비, 시트 글자 잘림 없음.
- [ ] **Step 6: 커밋** — `git commit -m "목록 식약처 경고와 경고 시트"`

---

### Task 6: 적용·배포·첫 동기화 (사용자 확인 필요)

**Files:**
- Modify: `docs/data-sources.md`(5절에 2026-10-19 확인 사실 표), `docs/tracking/status.md`, `docs/architecture.md`(데이터 흐름 3번을 이 구조로)

컨트롤러가 단계마다 사용자에게 먼저 묻는다.

- [ ] **Step 1: [사용자 확인] 마이그레이션 적용** — Supabase MCP `apply_migration`(이름 `grocery_food_alerts`). 적용 전후 `get_advisors`(security) 비교, 새 경고가 `grocery` 관련이면 보고.
- [ ] **Step 2: [사용자 확인] Edge Function 배포** — Supabase MCP `deploy_edge_function`(이름 `food-alerts-sync`, `verify_jwt: false`, 파일 `index.ts`, `handle.ts`, `../_shared/foodAlerts.ts`).
- [ ] **Step 3: [사용자 작업] 비밀값** — Supabase 대시보드 Edge Functions → Secrets에 `FOODSAFETY_API_KEY`(식품안전나라 인증키), `SYNC_SECRET`(사용자가 정한 긴 임의 문자열). GitHub 저장소 Settings → Secrets and variables → Actions에 `FOOD_SYNC_SECRET`(같은 값). Claude는 값을 입력하지 않는다.
- [ ] **Step 4: 첫 동기화** — 사용자가 Actions에서 "식약처 목록 동기화"를 수동 실행(또는 Claude가 `gh workflow run food-alerts-sync.yml`). 결과: `sync_runs` 세 서비스 ok, `food_alerts` 건수가 각 서비스 `total_count`와 같음(execute_sql로 확인).
- [ ] **Step 5: 화면 확인** — 배포 주소에서 실제 목록에 경고가 뜨는지(해당 품목이 있으면) 사용자와 확인.
- [ ] **Step 6: 문서·커밋** — status.md 열린 문제에 "예약 워크플로는 저장소 활동이 60일 없으면 GitHub가 멈춘다", "기록 있음(바코드 일치)은 계획 ⑥"을 적는다. `git commit -m "식약처 대조 적용 기록"`
