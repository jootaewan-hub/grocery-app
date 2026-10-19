# 가격 확인 ④-1: 다나와 후보·고르기·가격·품목 상세 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담으면 다나와에서 후보 상품을 찾고, 목록에서 한 번 고르면 기억하며, 고른 상품의 다나와 가격(수량별 최저가·쇼핑몰별 최저가)과 평점을 목록·품목 상세에 출처·확인 시각과 함께 보여 준다. 품목 상세에는 가격·안전(주의사항)·평가 탭과 바로가기를 둔다.

**Architecture:** 외부 요청은 Edge Function 두 개가 한다. `product-search`(다나와 검색 → 후보 저장, 가구 기억이 있으면 바로 연결)와 `product-check`(다나와 상품 페이지 → 가격 줄·평점 저장, 같은 상품·같은 날은 캐시)예요. 둘 다 로그인 JWT를 확인하고(verify_jwt true), 가구 소속은 사용자 권한 클라이언트(RLS)로 확인한 뒤, 공용 표는 서비스 롤로 써요. 다나와 검색은 DB의 예약 함수로 전역 10초 간격을 지켜요. 앱은 새 저장소 메서드로 후보·가격·안전 기록을 읽어요. 고르기는 RPC 하나로 하고, 품목 상세는 시트로 열어요.

**Tech Stack:** Vite + React 19 + TS, Vitest, PGlite(DB 시험), Supabase Postgres/Edge Functions(Deno), Playwright(화면 캡처).

**Spec:** `docs/superpowers/specs/2026-10-19-price-check-design.md` (그 위에 `docs/superpowers/specs/2026-10-16-screens-design.md` 4·5·6·7-1·8-1절). 이 계획은 설계 9절 순서의 2·3단계예요. 나머지는 다음 계획으로 넘겨요: 4단계(나머지 출처·어디서 살지·하루 한 번 다시 확인·I2810)는 ④-2, 5단계(사진으로 찾기·캡처로 가격 넣기)는 ④-3.

## Global Constraints

- 화면의 숫자는 출처가 있는 값만 쓴다. 모든 가격에 출처 태그와 확인 시각을 붙이고, 없으면 "확인 못 함"으로 둔다. 0원·음수는 버린다.
- "가장 싼 값"은 확인 시각이 **오늘(한국 시간)**이고 고른 상품·수량과 같은 줄에서만 고른다. 수량이 다른 줄은 "다른 용량"으로 묶고 100g(또는 1개)당 가격을 함께 쓴다.
- 배송비는 줄마다 따로 적는다(모르면 "배송비 확인 못 함"). 가장 싼 값은 상품 가격 기준으로 고른다. 목록 합계는 상품 가격 × 개수를 더하고 "배송비 제외"라고 적는다.
- 다나와 검색(`search.danawa.com`)은 전역으로 10초에 한 번만 부른다(robots `Crawl-delay: 10`). robots 금지 경로(`/info/ajax/`, `/api/`, `/bridge/`, `/list/ajax/`, search의 `/api_ui/` 등)는 부르지 않는다.
- 위반 기록이 없을 때는 "확인한 범위에서 찾은 기록 없음"과 확인한 출처를 적고, "안전함"이라고 쓰지 않는다. 목록과 상세는 같은 대조 결과를 쓴다(품목 이름 대조 ∪ 고른 상품명 대조).
- 공유 DB는 `grocery` 스키마만 바꾼다(D-003). 적용은 Supabase MCP `apply_migration`으로, 사용자 확인 뒤에만 한다.
- 화면에 "AI"·채팅·반짝이·"분석 중…"을 쓰지 않는다. 진행 문구는 하는 일 그대로 쓴다("후보 찾는 중", "다나와 가격 확인 중").
- UI 작업은 `npm run screens`로 390·1280px, 라이트·다크를 캡처해 눈으로 확인한 뒤에 끝났다고 한다.
- 커밋 메시지는 한국어로 쓰고 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`로 끝낸다. main 병합·푸시는 사용자 지시가 있을 때만 한다.

## Review Focus

1. 다나와 HTML 구조가 바뀌어 파싱 결과가 0개이거나 값이 비면, 오류를 "가격 확인 못 함"과 출처 오류 문구로 드러내야 한다. 어제 값을 오늘 값처럼 보이게 하거나 화면이 깨지면 안 된다. Task 1·4에서 시험한다.
2. 두 사람이 같은 품목을 거의 동시에 열거나 담아도 다나와 검색은 품목당 한 번만 해야 한다. 2분 안에 이미 '찾는 중'인 품목은 건너뛴다. Task 3에서 시험한다.
3. 다른 가구의 품목 id나 상품 id로 함수를 불러도 거부(403)해야 하고, 남의 후보·선택·가격 연결을 읽거나 쓸 수 없어야 한다. Task 2·3·4에서 시험한다.
4. 한국 시간 자정 직후에는 "오늘" 확인 값이 없는 것으로 봐야 한다. UTC 날짜로 계산해 어제 값을 오늘로 치면 안 된다. Task 2(SQL)에서 시험한다.
5. 검색어가 특수문자·영문·숫자만이거나 결과가 0개면 "후보를 찾지 못했어요"로 끝나야 한다. 무한 재시도나 오류 화면이 되면 안 된다. Task 3에서 시험한다.

---

## 파일 구조

| 파일 | 하는 일 |
|---|---|
| `tests/fixtures/danawa/search-bibigo.html` | 다나와 검색 응답 사본(앞 8개 상품 `li`와 JSON-LD만 남김) |
| `tests/fixtures/danawa/product-5643303.html` | 다나와 상품 페이지 사본 |
| `supabase/functions/_shared/danawa.ts` | 다나와 검색·상품 페이지 파서(Deno·Node 공용, 외부 import 없음) |
| `supabase/migrations/20261020000000_grocery_products.sql` | 상품·후보·검색 상태·가구 기억·요청 간격 표와 RPC |
| `supabase/migrations/20261020010000_grocery_prices.sql` | 가격 확인·가격 줄 표, `item_prices()`, 안전 대조 재구성(`item_alerts`, `item_safety`) |
| `supabase/functions/product-search/{handle.ts,index.ts}` | 후보 찾기 함수 |
| `supabase/functions/product-check/{handle.ts,index.ts}` | 가격 확인 함수 |
| `src/lib/products.ts` | 앱 쪽 타입·행 변환·가격 규칙(`bestPrice`, `unitPrice`), 바로가기 주소 |
| `src/lib/store.ts`, `src/lib/supabaseStore.ts`, `src/demo.ts` | 저장소 메서드 추가(메모리·Supabase·데모) |
| `src/components/CandidateSheet.tsx` | 상품 고르기 시트 |
| `src/components/ItemDetail.tsx` | 품목 상세 시트(가격·안전·평가 탭) |
| `src/components/ListRow.tsx`, `ListScreen.tsx`, `src/lib/listView.ts` | 목록 줄 상태·최저가·합계 |
| `src/lib/csp.ts` | 상품 이미지 호스트 `https://img.danuri.io` 허용 |

---

### Task 1: 다나와 파서와 응답 사본

**Files:**
- Create: `tests/fixtures/danawa/search-bibigo.html`, `tests/fixtures/danawa/product-5643303.html`, `supabase/functions/_shared/danawa.ts`
- Test: `tests/danawa.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DanawaVariant = { qty: number; price: number; unitPrice: number | null; unitLabel: string | null; mallCount: number | null }
  export type DanawaSearchItem = { pcode: string; name: string; imageUrl: string | null; rating: number | null; reviewCount: number | null; variants: DanawaVariant[] }
  export type DanawaOffer = { seller: string; price: number; delivery: number | null } // delivery 0 = 무료배송, null = 모름
  export type DanawaProduct = { pcode: string; name: string; imageUrl: string | null; rating: number | null; reviewCount: number | null; pageQty: number | null; variants: DanawaVariant[]; offers: DanawaOffer[] }
  export class DanawaParseError extends Error {}
  export function parseDanawaSearch(html: string): DanawaSearchItem[]
  export function parseDanawaProduct(html: string, pcode: string): DanawaProduct
  export function danawaSearchUrl(query: string): string   // https://search.danawa.com/?query=<encodeURIComponent>
  export function danawaProductUrl(pcode: string): string  // https://prod.danawa.com/info/?pcode=<pcode>
  ```

- [ ] **Step 1: 사본 저장.** 집 PC에서 아래 두 주소를 한 번씩 받는다(둘 사이 10초 이상 간격, UA는 일반 브라우저). 검색 사본은 1.3MB이므로 `<script type="application/ld+json">` 블록 하나와 처음 8개 `<li … data-product-seq="…">` 블록만 남기고, 그 바깥은 `<html><body>…</body></html>`로 감싼다. 상품 페이지는 그대로 저장한다.
  - `https://search.danawa.com/?query=%EB%B9%84%EB%B9%84%EA%B3%A0+%EC%99%95%EA%B5%90%EC%9E%90`
  - `https://prod.danawa.com/info/?pcode=5643303`
  - 받은 날의 값이 아래 테스트 값과 다르면, 테스트 기대값을 그 사본의 실제 값으로 고친다. 값은 사본에서 직접 읽어 넣고 지어내지 않는다.

- [ ] **Step 2: 실패하는 테스트 작성** (`tests/danawa.test.ts`). 2026-10-19 사본 기준 기대값:
  ```ts
  it('검색: 상품마다 pcode·이름·수량별 가격·100g당 가격·판매처 수를 읽는다', () => {
    const items = parseDanawaSearch(read('search-bibigo.html'))
    expect(items.length).toBe(8)
    const one = items.find((i) => i.pcode === '5643303')!
    expect(one.name).toBe('CJ제일제당 비비고 왕교자 1.05kg')
    expect(one.rating).toBe(4.8)
    expect(one.variants.slice(0, 3)).toEqual([
      { qty: 1, price: 10380, unitPrice: 989, unitLabel: '100g', mallCount: 26 },
      { qty: 2, price: 21150, unitPrice: 1007, unitLabel: '100g', mallCount: 120 },
      { qty: 3, price: 27650, unitPrice: 878, unitLabel: '100g', mallCount: 279 },
    ])
    expect(one.imageUrl).toMatch(/^https:\/\/img\.danuri\.io\//)
  })
  it('검색: 리뷰 수 "999+"는 999로, 숫자가 없으면 null', …)
  it('검색: 상품 li가 없으면 DanawaParseError(구조 변경)', () => {
    expect(() => parseDanawaSearch('<html><body>검색 결과가 없습니다</body></html>')).toThrow(DanawaParseError)
  })
  it('검색: "검색 결과가 없습니다" 페이지는 빈 배열', …)   // 결과 없음과 구조 변경을 구분한다
  it('상품: 페이지 수량·수량별 최저가·쇼핑몰 줄·평점', () => {
    const p = parseDanawaProduct(read('product-5643303.html'), '5643303')
    expect(p.pageQty).toBe(3)                       // JSON-LD 이름 "… (3개)"
    expect(p.rating).toBe(4.8); expect(p.reviewCount).toBe(9099)
    expect(p.variants.find((v) => v.qty === 1)).toEqual({ qty: 1, price: 10380, unitPrice: 989, unitLabel: '100g', mallCount: 26 })
    expect(p.offers[0]).toEqual({ seller: '롯데ON', price: 27650, delivery: 3000 })
    expect(p.offers.length).toBeGreaterThanOrEqual(5)
    expect(p.offers.every((o) => o.price > 0)).toBe(true)
  })
  it('상품: 무료배송은 delivery 0, 표시가 없으면 null', …)
  it('상품: 쇼핑몰별 최저가 구역이 없으면 offers는 빈 배열이고 variants는 그대로', …)
  it('주소: 검색어를 인코딩하고 https만 쓴다', () => {
    expect(danawaSearchUrl('비비고 왕교자&x')).toBe('https://search.danawa.com/?query=%EB%B9%84%EB%B9%84%EA%B3%A0%20%EC%99%95%EA%B5%90%EC%9E%90%26x')
  })
  ```

- [ ] **Step 3: 실패 확인.** `npx vitest run tests/danawa.test.ts` → FAIL(모듈 없음).

- [ ] **Step 4: 구현.** 정규식과 태그 제거만 쓰고 DOM 라이브러리는 쓰지 않는다(Deno·Node 공용). 검색 결과는 `data-product-seq` 기준으로 `li`를 나누고, 글자만 뽑아 `N개 | X원/100g | Y원 | M몰` 순서로 수량 줄을 읽는다. 이름은 `font-bold text-dnw-gray-900` 링크의 글자, 평점은 "리뷰수" 앞의 소수다. 상품 페이지는 JSON-LD `Product`에서 이름·평점·후기 수를, 이름 끝 `(N개)`에서 pageQty를 읽는다. "다른 구성" 구역에서 수량 줄을, "쇼핑몰별 최저가" 구역에서 `alt='몰 이름'` 이미지 또는 몰 이름 글자와 그 뒤 가격·배송비(`N,NNN원` / `무료배송`)를 읽는다.

- [ ] **Step 5: 통과 확인.** `npx vitest run tests/danawa.test.ts` → PASS.

- [ ] **Step 6: 커밋.** `git add tests/fixtures/danawa tests/danawa.test.ts supabase/functions/_shared/danawa.ts && git commit -m "다나와 검색·상품 페이지 파서"`

---

### Task 2: 상품·후보·가구 기억 표와 고르기 RPC

**Files:**
- Create: `supabase/migrations/20261020000000_grocery_products.sql`
- Test: `tests/productsDb.test.ts`(PGlite, `tests/foodAlertsDb.test.ts`의 `as()`·`errorOf()` 방식을 따른다. 앞선 grocery 마이그레이션을 모두 실행한 뒤 이 파일을 실행한다)

**Interfaces:**
- Produces(SQL):
  - `grocery.products(id uuid pk, source text check (source = 'danawa'), source_id text, name text, image_url text, rating numeric(2,1), review_count int, updated_at timestamptz, unique(source, source_id))`: authenticated는 select만 할 수 있고, 쓰기는 service_role만 한다.
  - `grocery.item_searches(item_id uuid pk references grocery.items on delete cascade, status text check (status in ('searching','done','none','error')), query text, candidate_count int, error text, updated_at timestamptz)`: 가구 구성원은 select만 할 수 있고, 쓰기는 service_role만 한다.
  - `grocery.item_candidates(item_id uuid references grocery.items on delete cascade, product_id uuid references grocery.products, qty int, price int check (price > 0), unit_price int, unit_label text, mall_count int, rank int, found_at timestamptz, primary key(item_id, product_id, qty))`: select·쓰기 권한은 item_searches와 같다.
  - `grocery.product_choices(household_id uuid references public.households on delete cascade, name_key text, product_id uuid references grocery.products, qty int, chosen_by uuid default auth.uid(), chosen_at timestamptz default now(), primary key(household_id, name_key))`: 가구 구성원이 select·insert·update할 수 있다.
  - `alter table grocery.items add column product_id uuid references grocery.products, add column product_qty int check (product_qty between 1 and 99)`: authenticated에게 update 권한을 더한다.
  - `grocery.name_key(p_name text, p_spec text) returns text`: immutable. 소문자로 바꾸고 공백·문장부호를 없앤 이름에 `|`와 규격을 붙인다.
  - `grocery.choose_product(p_item uuid, p_product uuid, p_qty int) returns void`: security invoker. 품목의 product_id·product_qty를 바꾸고, `name_key(item.name, item.spec)`로 product_choices를 upsert한다.
  - `grocery.fetch_gate(key text pk, next_at timestamptz)`: 행 `('danawa-search', '-infinity')`. 권한은 service_role만 갖는다.
  - `grocery.reserve_fetch(p_key text, p_gap_ms int) returns int`: 기다릴 ms를 돌려준다. 한 문장으로 `next_at = greatest(next_at, now()) + gap`을 잡고, 예약한 시작 시각에서 now()를 뺀 값을 0 이상으로 돌려준다. execute 권한은 service_role만 갖는다.

- [ ] **Step 1: 실패하는 테스트 작성.**
  ```ts
  it('name_key: 대소문자·공백·문장부호를 무시하고 규격을 붙인다', async () => {
    expect(await scalar(`select grocery.name_key(' 비비고  왕교자 ', '1.05KG')`)).toBe(await scalar(`select grocery.name_key('비비고왕교자', '1.05kg')`))
    expect(await scalar(`select grocery.name_key('우유', null)`)).not.toBe(await scalar(`select grocery.name_key('우유', '2.3L')`))
  })
  it('choose_product: 내 가구 품목에 상품을 연결하고 가구 기억을 남긴다', …)       // items.product_id/qty, product_choices 행
  it('choose_product: 다른 가구 품목은 바꾸지 못한다(0행, 기억도 안 남음)', …)
  it('후보·검색 상태: 내 가구 것만 보이고 authenticated는 쓰지 못한다', …)
  it('product_choices: 다른 가구 기억은 보이지 않는다', …)
  it('reserve_fetch: 처음 0, 바로 다시 약 10000, 그다음 약 20000(동시 예약도 겹치지 않음)', async () => {
    const w = [] as number[]
    for (let i = 0; i < 3; i++) w.push(await scalar(`select grocery.reserve_fetch('danawa-search', 10000)`))
    expect(w[0]).toBe(0); expect(w[1]).toBeGreaterThan(9000); expect(w[2]).toBeGreaterThan(19000)
  })
  it('reserve_fetch·fetch_gate: authenticated는 부르거나 읽지 못한다', …)
  it('products: authenticated는 읽기만', …)
  ```
- [ ] **Step 2: 실패 확인.** `npx vitest run tests/productsDb.test.ts` → FAIL(파일 없음 → 빈 마이그레이션으로 assertion 실패를 본다).
- [ ] **Step 3: 마이그레이션 작성.** RLS 패턴은 `20261017000000_grocery_items.sql`을 따른다. 후보·검색 상태의 정책은 `exists (select 1 from grocery.items i where i.id = item_id and private.is_household_member(i.household_id))`이다. 맨 위 주석에 "grocery 스키마만 바꾼다(D-003)"를 적는다.
- [ ] **Step 4: 통과 확인.** `npx vitest run tests/productsDb.test.ts tests/db.test.ts tests/foodAlertsDb.test.ts` → PASS.
- [ ] **Step 5: 커밋.** `"상품·후보·가구 기억 표와 고르기 RPC"`

---

### Task 3: 후보 찾기 함수 `product-search`

**Files:**
- Create: `supabase/functions/product-search/handle.ts`, `supabase/functions/product-search/index.ts`
- Modify: `supabase/config.toml`(`[functions.product-search] verify_jwt = true`)
- Test: `tests/productSearch.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseDanawaSearch`, `danawaSearchUrl`, `DanawaParseError`; Task 2 표·RPC.
- Produces:
  ```ts
  export type SearchDeps = {
    loadItem(itemId: string): Promise<{ id: string; name: string; spec: string | null; productId: string | null } | null> // 사용자 권한(RLS): 남의 품목은 null
    remembered(itemId: string): Promise<{ productId: string; qty: number } | null>  // name_key로 product_choices 조회(사용자 권한)
    claim(itemId: string, query: string, nowIso: string): Promise<boolean>   // 2분 안에 'searching'이 아니면 'searching'으로 바꾸고 true
    reserve(): Promise<number>          // reserve_fetch('danawa-search', 10000)
    sleep(ms: number): Promise<void>
    fetchHtml(url: string): Promise<{ status: number; text: string }>
    saveCandidates(itemId: string, items: DanawaSearchItem[], foundAt: string): Promise<number> // products upsert + 후보 교체, 후보 수
    choose(itemId: string, productId: string, qty: number): Promise<void>  // 기억으로 바로 연결(사용자 권한 choose_product)
    finish(itemId: string, status: 'done' | 'none' | 'error', count: number, error: string | null): Promise<void>
    now(): Date
  }
  export const MAX_WAIT_MS = 60_000
  export async function handle(req: Request, deps: SearchDeps): Promise<Response>
  // POST { itemId: string, query?: string } → 200 { status: 'remembered' | 'done' | 'none' | 'skipped' } | 202 { status: 'busy' } | 400 | 403 | 405 | 502 { status: 'error' }
  ```
- [ ] **Step 1: 실패하는 테스트 작성.** 가짜 deps로 확인한다(`tests/foodAlertsSync.test.ts` 방식).
  - 'POST가 아니면 405, itemId가 uuid가 아니면 400'
  - '남의 품목(loadItem null)이면 403이고 다나와를 부르지 않는다'
  - '가구 기억이 있으면 choose로 연결하고 remembered, 검색하지 않는다'(query가 주어지면 기억을 쓰지 않고 검색한다: "다시 검색")
  - '2분 안에 이미 찾는 중이면 skipped, 다나와를 부르지 않는다'
  - '예약 대기만큼 잠든 뒤 부른다; 대기가 MAX_WAIT_MS를 넘으면 202 busy이고 상태는 error가 아니라 searching을 풀어 둔다(finish 안 함, claim 시각이 2분 지나면 다시 가능)'
  - '검색어는 query가 있으면 그것, 없으면 이름 + 공백 + 규격(규격 없으면 이름)'
  - '결과 0개면 none, 후보 저장 안 함'
  - 'HTTP 200이 아니거나 DanawaParseError면 finish(error, 0, "parse_failed" | "http_<n>")이고 502'
  - '저장한 후보 수를 finish(done, n)으로 남기고 응답에 후보·가격 값은 싣지 않는다'
- [ ] **Step 2: 실패 확인.** `npx vitest run tests/productSearch.test.ts` → FAIL.
- [ ] **Step 3: 구현.** 순서는 메서드 확인 → 입력 확인 → loadItem → (query 없음 && remembered) → claim → reserve·sleep → fetch → parse → save → finish 이다. `index.ts`는 `Authorization` 헤더로 사용자 권한 클라이언트를 만들고(loadItem·remembered·choose), 서비스 롤 클라이언트로 claim·reserve·save·finish를 한다. fetch에는 일반 브라우저 UA와 `accept-language: ko-KR`을 넣고 20초 제한을 둔다. CORS는 앱 주소에서 POST·OPTIONS를 허용한다(가계부 `extract-entries`의 cors 헤더 형식).
- [ ] **Step 4: 통과 확인.** → PASS.
- [ ] **Step 5: 커밋.** `"후보 찾기 함수(product-search)"`

---

### Task 4: 가격 표와 가격 확인 함수 `product-check`

**Files:**
- Create: `supabase/migrations/20261020010000_grocery_prices.sql`, `supabase/functions/product-check/{handle.ts,index.ts}`
- Modify: `supabase/config.toml`(`[functions.product-check] verify_jwt = true`)
- Test: `tests/pricesDb.test.ts`, `tests/productCheck.test.ts`

**Interfaces:**
- Produces(SQL):
  - `grocery.price_checks(id uuid pk, product_id uuid references grocery.products, source text, checked_at timestamptz, checked_on date generated always as ((checked_at at time zone 'Asia/Seoul')::date) stored, ok boolean, error text, page_qty int)`
  - `grocery.price_quotes(check_id uuid references grocery.price_checks on delete cascade, product_id uuid, qty int, seller text /* null = 다나와 수량별 최저가 */, price int check (price > 0), delivery int, unit_price int, unit_label text, mall_count int)`. 두 표 모두 authenticated는 읽기만 하고, 쓰기는 service_role만 한다.
  - `grocery.item_prices() returns table(item_id uuid, price int, seller text, source text, qty int, delivery int, checked_at timestamptz)`: security invoker. 안 산 내 가구 품목마다, 오늘(한국 시간) ok인 확인 중 `qty = items.product_qty`인 줄에서 가장 싼 값 하나를 고른다(같으면 seller가 있는 줄이 먼저).
  - 안전 대조 재구성: `grocery._alert_hits()`는 품목 이름 토큰과 고른 상품명 토큰 각각으로 기존 규칙(20261019030000의 토큰·과반·기간)대로 맞추고 `via text ('item_name'|'product_name')`, `farm boolean`(I2620 생산자 `\*|미상|불가|불명`)을 함께 낸다. `grocery.item_alerts()`는 farm이 아닌 것만 같은 열 그대로 내고(품목·기록당 한 행, 앱 변경 없음), `grocery.item_safety(p_item uuid)`는 그 품목의 모든 기록을 `via`·`farm`과 함께 낸다.
- Produces(TS):
  ```ts
  export type CheckDeps = {
    allowed(productId: string): Promise<boolean>     // 사용자 권한: 내 가구 품목 중 이 상품을 고른 것이 있는가
    product(productId: string): Promise<{ id: string; sourceId: string } | null>
    todayOk(productId: string): Promise<boolean>     // 오늘(한국 시간) ok 확인이 있는가
    fetchHtml(url: string): Promise<{ status: number; text: string }>
    save(productId: string, p: DanawaProduct, checkedAt: string): Promise<void>  // products 평점 갱신 + price_checks(ok) + price_quotes
    fail(productId: string, error: string, checkedAt: string): Promise<void>       // price_checks(ok=false)
    now(): Date
  }
  export async function handle(req: Request, deps: CheckDeps): Promise<Response>
  // POST { productId } → 200 { status: 'cached' | 'done' } | 403 | 404 | 502 { status: 'error' }
  ```
  수량별 줄(variants)은 seller null로 저장하고, 쇼핑몰 줄(offers)은 `qty = pageQty`로 저장한다. pageQty를 못 읽으면 쇼핑몰 줄은 저장하지 않는다(어느 수량인지 모르는 값은 버린다).
- [ ] **Step 1: 실패하는 테스트 작성.**
  - pricesDb: 'item_prices: 오늘 확인한 같은 수량 줄 중 최저가', '수량이 다른 줄은 고르지 않는다', '한국 시간 어제(UTC로는 오늘) 확인은 고르지 않는다(checked_at = 오늘 KST 00:00 − 1분)', '0원 줄은 넣을 수 없다(check)', 'ok=false 확인의 줄은 쓰지 않는다', '다른 가구 품목 가격은 안 보인다'
  - pricesDb 안전: 'item_alerts는 품목 이름이나 고른 상품명 중 하나로 맞으면 낸다', 'item_alerts는 농가 기록을 내지 않고 item_safety는 farm=true로 낸다', 'item_safety의 via가 맞게 나온다', 기존 `tests/foodAlertsDb.test.ts`는 새 마이그레이션을 실행한 뒤에도 그대로 통과해야 한다(그 파일의 beforeAll에 두 마이그레이션 추가).
  - productCheck: '남의 상품이면 403·다나와 안 부름', '오늘 ok가 있으면 cached·안 부름', '받으면 save 후 done', 'HTTP 오류·파싱 실패면 fail("http_<n>"|"parse_failed")·502', 'pageQty를 못 읽으면 쇼핑몰 줄 없이 저장(Task 1 사본에서 JSON-LD 이름을 지운 변형으로 시험)'
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.** 함수 구조는 Task 3과 같다. 상품 페이지 주소는 `danawaProductUrl(sourceId)`.
- [ ] **Step 4: 통과 확인.** `npx vitest run tests/pricesDb.test.ts tests/productCheck.test.ts tests/foodAlertsDb.test.ts` → PASS.
- [ ] **Step 5: 커밋.** `"가격 표·가격 확인 함수(product-check)·안전 대조에 고른 상품명 더하기"`

---

### Task 5: 앱 저장소와 가격 규칙

**Files:**
- Create: `src/lib/products.ts`
- Modify: `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/supabaseStore.ts`, `src/demo.ts`, `src/lib/csp.ts`
- Test: `tests/products.test.ts`, `tests/store.test.ts`, `tests/csp.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts: Item에 productQty: number | null 추가, productKey는 product_id로 채운다
  // products.ts
  export type ItemSearch = { status: 'searching' | 'done' | 'none' | 'error'; candidateCount: number; updatedAt: string }
  export type Candidate = { productId: string; name: string; imageUrl: string | null; rating: number | null; variants: { qty: number; price: number; unitPrice: number | null; unitLabel: string | null; mallCount: number | null }[]; foundAt: string }
  export type ItemPrice = { price: number; seller: string | null; source: 'danawa'; qty: number; delivery: number | null; checkedAt: string }
  export type PriceLine = ItemPrice & { unitPrice: number | null; unitLabel: string | null; mallCount: number | null }
  export type SafetyRecord = FoodAlert & { via: 'item_name' | 'product_name'; farm: boolean }
  export type ItemDetailData = {
    product: { id: string; name: string; imageUrl: string | null; rating: number | null; reviewCount: number | null; pcode: string } | null
    check: { checkedAt: string; ok: boolean; error: string | null } | null   // 가장 최근 확인
    lines: PriceLine[]       // 가장 최근 ok 확인의 줄
    safety: SafetyRecord[]
    syncedAt: AlertsResult['syncedAt']
  }
  export type ItemExtras = { searches: ReadonlyMap<string, ItemSearch>; prices: ReadonlyMap<string, ItemPrice>; productNames: ReadonlyMap<string, string> }
  export function splitLines(lines: PriceLine[], qty: number, today: string /* YYYY-MM-DD KST */): { same: PriceLine[]; other: PriceLine[]; best: PriceLine | null }
  export function kstDay(iso: string): string
  export const SHORTCUTS: readonly { name: string; url: (q: string) => string }[]
  // store.ts ListStore 추가
  add(items: ParsedItem[]): Promise<Item[]>        // 만든 품목을 돌려준다(기존 void에서 변경)
  extras(): Promise<ItemExtras>
  candidates(itemId: string): Promise<Candidate[]>
  findCandidates(itemId: string, query?: string): Promise<void>   // product-search 호출, 실패는 던진다
  choose(itemId: string, productId: string, qty: number): Promise<void>
  checkPrice(itemId: string): Promise<void>        // 고른 상품의 product-check
  detail(itemId: string): Promise<ItemDetailData>
  ```
- [ ] **Step 1: 실패하는 테스트 작성.**
  - products: `splitLines`가 오늘·같은 수량에서 최저가를 고르는지, 수량이 다르거나 어제 값이면 other로 보내는지, 0원을 버리는지, 같은 값이면 seller가 있는 줄을 먼저 고르는지 시험한다. `kstDay('2026-10-19T15:00:00Z') === '2026-10-20'`. `SHORTCUTS`는 쿠팡·SSG(이마트몰)·롯데ON·G마켓을 담고, 모든 주소가 https이며 검색어가 인코딩되는지 시험한다(오늘의집·킴스클럽은 Step 3에서 브라우저로 검색 주소를 확인한 뒤 넣고, 확인하지 못하면 뺀다).
  - store(메모리): `add`가 만든 품목을 돌려주는지, `choose` 뒤 `list()`의 productKey·productQty가 바뀌는지, `extras()`가 데모 가격을 돌려주는지 시험한다.
  - csp: img-src에 `https://img.danuri.io`가 있고 `*`나 `https:` 전체 허용은 없는지 시험한다.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.** supabaseStore는 다음처럼 부른다. `functions.invoke('product-search'|'product-check')`를 쓰고, 상세는 `rpc('item_safety')`와 `price_checks`·`price_quotes`·`products` select, 목록 가격은 `rpc('item_prices')`로 읽는다. 데모 데이터(`src/demo.ts`)의 가격 줄에는 출처 "다나와"와 "예시" 표기를 넣는다. 데모는 개발 서버에서만 쓰이고 빌드에 들어가지 않는다.
- [ ] **Step 4: 통과 확인.** `npm test` → 전체 PASS, `npx tsc --noEmit -p .` 깨끗.
- [ ] **Step 5: 커밋.** `"앱 저장소: 후보·고르기·가격·상세 읽기"`

---

### Task 6: 목록 — 후보 상태, 상품 고르기, 최저가와 합계

**Files:**
- Create: `src/components/CandidateSheet.tsx`
- Modify: `src/components/ListRow.tsx`, `src/components/ListScreen.tsx`, `src/lib/listView.ts`, `src/styles/app.css`, `scripts/screenshots.mjs`
- Test: `tests/listView.test.ts`

**Interfaces:**
- Consumes: Task 5 `ItemExtras`, `Candidate`, store 메서드.
- Produces: `summarize(items, prices)`의 lowestTotal이 `price × item.count`의 합이 된다(같은 시그니처). `ListRow`에 `search: ItemSearch | null`, `price: ItemPrice | null`, `productName: string | null`, `onPick: () => void` props.

- [ ] **Step 1: 실패하는 테스트 작성** (listView): '합계는 가격 × 개수', '가격 없는 품목은 확인 못 함 개수로'.
- [ ] **Step 2: 실패 확인 → Step 3: 구현.**
  - 줄 둘째 줄: 고른 상품이 없을 때는 상태에 따라 "후보 찾는 중", "후보 N개 찾음", "후보를 찾지 못했어요", "후보를 찾지 못했어요(다시 시도)"를 쓴다. 고른 상품이 있으면 고른 상품명을 쓴다.
  - 오른쪽: 고른 상품이 없고 후보가 있으면 "상품 고르기" 버튼을 둔다. 오늘 가격이 있으면 "10,380원 · 11번가"처럼 쓴다(seller가 null이면 "다나와 최저가"). 없으면 "가격 확인 못 함"을 쓴다.
  - 요약 "찾은 최저가 합계" 아래에 "배송비 제외"를 적는다.
  - 담기 뒤 만든 품목마다 `findCandidates`를 부른다(기다리지 않음, 끝나면 extras 다시 읽기). 목록을 처음 읽을 때도, 안 산 품목 중 고른 상품도 검색 상태도 없는 것에 `findCandidates`를 부른다(다른 기기에서 담은 경우).
  - CandidateSheet: 후보마다 사진, 이름, 수량 줄(수량을 크게 쓰고 가격, 100g당 가격, 판매처 수를 붙인다)을 보여 준다. 묶음 상품도 그대로 보여 주고 단품을 위에 둔다. 머리에는 "다나와 · {확인 시각}"을 쓰고, "다시 검색" 입력을 둔다. 수량 줄을 누르면 `choose` → `checkPrice`를 하고 시트를 닫는다. 시트 구조·포커스·닫기는 AlertSheet와 같다.
  - 데모(`?demo=1`)에서 후보 있는 품목·찾는 중인 품목·가격 있는 품목이 모두 보이게 한다. `scripts/screenshots.mjs`에 `candidate-sheet-390-{light,dark}`, `candidate-sheet-1280-light`를 더한다.
- [ ] **Step 4: 확인.** `npm test`, `npx tsc --noEmit -p .`, `npm run dev`를 띄운 뒤 `npm run screens` → "자동 확인: 문제 없음". `list-390-light`, `list-390-dark`, `candidate-sheet-390-light`, `candidate-sheet-1280-light`를 직접 열어 보고, 숫자마다 출처·시각이 붙었는지와 금지 문구가 없는지 확인한다.
- [ ] **Step 5: 커밋.** `"목록: 후보 상태, 상품 고르기, 최저가·합계"`

---

### Task 7: 품목 상세 — 가격·안전·평가 탭

**Files:**
- Create: `src/components/ItemDetail.tsx`
- Modify: `src/components/ListRow.tsx`(행 누르기 → 상세), `src/components/ListScreen.tsx`, `src/styles/app.css`, `scripts/screenshots.mjs`
- Test: `tests/products.test.ts`(문구 함수가 생기면 함께 시험)

**Interfaces:**
- Consumes: Task 5 `detail`, `checkPrice`, `splitLines`, `SHORTCUTS`, `SafetyRecord`; 기존 `checkedRange`, `SOURCE_NAME`, `koFullDay`.

- [ ] **Step 1: 실패하는 테스트 작성.** 화면 문구를 순수 함수로 뺀다: `priceRowText(line)`는 "10,380원 · 배송비 3,000원" / "무료배송" / "배송비 확인 못 함"을 만든다. `safetySummary(records, syncedAt)`는 farm이 아닌 기록이 있으면 "회수·판매중지 1건"처럼, 없으면 "찾은 기록 없음"을, 대조에 실패하면 "확인 못 함"을 만든다. `farmLine(records)`는 "같은 품목 농산물 부적합 N건(농가 단위)"을 만든다. 각각 테스트를 쓴다.
- [ ] **Step 2: 실패 확인 → Step 3: 구현.**
  - 머리: 상품 사진, 상품명, 분류, "상품 바꾸기"(CandidateSheet를 다시 연다). 고른 상품이 없으면 머리 아래에 "상품 고르기"를 둔다.
  - 요약 네 칸: 가장 싼 값(best와 곳·수량·확인 시각, 없으면 "확인 못 함"), 식약처 기록(`safetySummary`), 평점(다나와 평점·후기 수·기준일, 없으면 "확인 못 함"), 더 나은 상품("다음 단계").
  - 가격 탭: same 줄을 가장 싼 값부터, 줄마다 판매처·가격·배송비·출처 "다나와"·확인 시각을 쓴다. 다나와 수량별 최저가 줄은 "다나와 최저가(N개)"로 쓴다. other 줄은 "다른 용량" 제목 아래에 단위가격과 함께 둔다. 그 아래 바로가기 버튼(`SHORTCUTS`, 새 창, `rel="noopener noreferrer"`)을 둔다. 최근 확인이 실패면 "다나와 가격을 지금 불러오지 못했어요. {시각}에 확인한 값을 보여 드려요."를 쓴다.
  - 안전 탭: 출처(I0490·I2620·I2715)마다 `checkedRange` 문구와 기록 목록을 보여 준다(제품명·업체·사유·등급·등록일, `via`가 product_name이면 "상품명으로 찾음", item_name이면 "품목 이름으로 찾음"). 기록이 없으면 "확인한 범위에서 찾은 기록 없음"을 쓴다. 농가 기록은 맨 아래 `farmLine`으로 접어 두고 누르면 목록이 펼쳐진다.
  - 평가 탭: 다나와 평점·후기 수·기준일과 "원래 페이지에서 후기 보기"(`danawaProductUrl`) 링크를 둔다. 후기 본문은 싣지 않는다.
  - 열 때: 고른 상품이 있고 오늘 ok 확인이 없으면 `checkPrice`를 부른다. 그동안 가격 탭에 "다나와 가격 확인 중"을 쓰고, 끝나면 `detail`을 다시 읽는다.
  - 행 누르기로 상세를 연다(편집 중이거나 "빼기"가 열려 있을 때는 열지 않는다). 시트 구조는 AlertSheet와 같다. 1280px에서는 가운데 넓은 시트로 연다.
  - 스크린샷: `item-detail-{price,safety,rating}-390-{light,dark}`, `item-detail-price-1280-light`.
- [ ] **Step 4: 확인.** Task 6 Step 4와 같다. 상세의 모든 숫자 옆에 출처·시각이 있는지, "안전함"·"문제 없음"이 없는지 눈으로 확인한다.
- [ ] **Step 5: 커밋.** `"품목 상세: 가격·안전·평가 탭과 바로가기"`

---

### Task 8: 적용·배포·실제 확인 (사용자 확인 필요)

**Files:**
- Modify: `docs/data-sources.md`, `docs/tracking/status.md`, `docs/architecture.md`(데이터 흐름 2번)

- [ ] **Step 1: [사용자 확인] 마이그레이션 적용.** 적용 전 `get_advisors(security)`를 기록한다. `apply_migration`으로 `grocery_products`, `grocery_prices`를 적용하고 advisors를 다시 비교한다. `grocery` 관련 새 경고가 의도한 것(정책 없는 fetch_gate INFO)인지 보고한다.
- [ ] **Step 2: [사용자 확인] 함수 배포.** `product-search`·`product-check`를 `deploy_edge_function`(verify_jwt **true**, 파일 index.ts·handle.ts·`../_shared/danawa.ts`)으로 배포한다. 배포 뒤 `get_edge_function`으로 내용이 저장소와 같은지 비교한다.
- [ ] **Step 3: 실제 확인.**
  - 로그인 없이 POST하면 401인지 확인한다.
  - 사용자가 배포 주소(main 병합 뒤)나 개발 서버에 로그인해서 "비비고 왕교자"를 담고 후보가 뜨는지 본다. 고른 뒤 상세 가격 줄이 다나와 페이지 값과 같은지 화면과 다나와 페이지를 나란히 놓고 확인한다(같은 시각 기준).
  - `item_searches`·`price_checks` 행을 execute_sql로 확인한다.
  - danawa-probe 임시 함수가 남아 있으면 대시보드에서 지워 달라고 다시 알린다.
- [ ] **Step 4: 문서·커밋.** data-sources 1-2-1에 "앱에서 실제 사용 시작(날짜), 파서가 기대는 구조"를 적는다. status.md의 된 것과 다음 할 일(④-2 계획 쓰기: 나머지 출처 확인부터)을 갱신한다. `"가격 확인 ④-1 적용 기록"`
