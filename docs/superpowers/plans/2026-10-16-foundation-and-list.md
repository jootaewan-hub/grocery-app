# 기반 + 장보기 목록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가계부 계정으로 로그인해 두 사람이 같은 장보기 목록을 실시간으로 담고 체크하는 PWA를, 승인된 디자인 체계(라이트·다크)로 만든다. 가격·식약처·시세는 아직 없고 그 자리는 "확인 못 함"으로 둔다.

**Architecture:** Vite + React + TypeScript PWA. 데이터는 가계부와 공유하는 Supabase 프로젝트의 `grocery` 스키마(D-003)에 두고 RLS로 가구 구성원만 접근한다. 화면은 `ListStore` 인터페이스로만 데이터를 다뤄서, 실제 Supabase 구현과 메모리 구현(Playwright 스크린샷용 데모)을 바꿔 끼운다. 목록 묶기·요약은 순수 함수로 두고 단위 테스트한다.

**Tech Stack:** React 19, TypeScript, Vite 8, vite-plugin-pwa, @supabase/supabase-js 2, Vitest, @electric-sql/pglite(권한 테스트), Playwright(스크린샷). 버전은 가계부 `package.json`과 맞춘다.

**Spec:** `docs/superpowers/specs/2026-10-16-screens-design.md` (6절 목록, 3절 제약, 9절 상태 문구, 7-1절 상품 고르기 전 상태)

**전체 계획 중 위치:** 승인된 설계를 여섯 계획으로 나눈다. ① 기반 + 목록(이 문서) → ② 식약처 대조 → ③ 시세(KAMIS) → ④ 가격 수집과 품목 상세 → ⑤ 평가·성분·대안 → ⑥ 바코드·사진·캡처. 각 계획은 끝나면 동작하는 앱이 남는다.

## Global Constraints

- 화면의 숫자는 출처가 있는 값만 낸다. 값이 없으면 "확인 못 함". 가격이 없는데 `0원`을 내지 않는다.
- 화면에 "AI", 채팅창, 반짝이 아이콘, "분석 중…"을 쓰지 않는다. 진행 표시는 하는 일을 그대로 적는다.
- 디자인 토큰은 가계부 `DESIGN.md`의 값을 그대로 쓴다: `canvas #FFFFFF`, `oat #F4F1EC`, `oat-deep #EAE5DD`, `line #ECE8E1`, `ink #33312D`, `ink-muted #6B665E`, `ink-faint #77726A`, `sage #56694E`, `sage-soft #E7ECE3`, `blush #E8C4B8`, `blush-soft #F6E4DD`, `rose-ink #7A3F2E`, `clay #A8543E`, `indigo #3D5A78`, 사람 색 `who-husband #1C588E`, `who-wife #C67261`. 반경 태그 6px·버튼 14px·묶음 20px·시트 24px. 간격 4의 배수, 좌우 여백 20px. 그림자 없음.
- 글꼴은 SUIT 2.0.5 가변 woff2 하나(가계부 `src/assets/fonts/`에서 복사, `public/fonts/SUIT-OFL.txt` 라이선스 동봉). 금액은 `font-variant-numeric: tabular-nums`. 한글 문장은 13px 이상, 입력칸 글자 16px 이상.
- 점으로 이은 정보 문자열(`A · B · C`) 금지, 영문 대문자 소제목 금지, 이모지 아이콘 금지. 버튼 이름은 결과를 말한다("3개 담기").
- 터치 대상 44px 이상, 주요 동작은 화면 아래. `100dvh`, `env(safe-area-inset-bottom)`.
- 키는 브라우저에 넣지 않는다. 브라우저에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`만.
- 장보기 마이그레이션은 `grocery` 스키마 안의 객체만 만들고 바꾼다. `public`·`private`·`auth`는 읽거나 참조만 한다.
- 배포 기본 경로는 `/grocery-app/`(GitHub Pages). 개발은 `/`.
- UI 작업은 390px·1280px, 라이트·다크 네 장을 Playwright로 캡처해 보고 고친 뒤에 끝났다고 한다.

## Review Focus

- **글 입력의 흔한 변형**: `비비고 왕교자 1.05kg x2`, `계란 30구`, `우유 2개`, `대파`, 빈 줄, 앞뒤 공백, `×2`. 한 글자 품목(배, 무, 감, 굴)이 `배추`·`무순`·`감자`에 잘못 걸리지 않아야 한다 → Task 2 테스트.
- **가구가 없는 계정**: 가계부에서 가구를 만들기 전 계정으로 로그인하면 빈 화면이나 오류가 아니라 안내 문구가 나와야 한다 → Task 5 테스트.
- **다른 가구 데이터**: 다른 가구 사용자와 로그인 안 한 사용자는 `grocery.items`를 읽지도 쓰지도 못해야 하고, 다른 가구의 `household_id`로 넣는 것도 막혀야 한다 → Task 4 테스트.
- **가격이 하나도 없을 때의 요약**: 합계는 `0원`이 아니라 "확인 못 함", 확인 못 함 개수는 살 것 개수와 같아야 한다 → Task 3 테스트.
- **두 사람이 동시에 체크**: 한 사람이 체크하면 다른 사람 화면에 반영되고, 체크를 풀면 산 사람·시각이 지워져야 한다 → Task 6 테스트(메모리 구현의 구독 알림과 `setBought` 해제).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html` | 빌드·테스트 설정. 가계부 설정을 따른다(CSP meta, PWA, `BASE_PATH`). |
| `src/main.tsx`, `src/App.tsx` | 진입점, 로그인 여부에 따라 화면 전환 |
| `src/styles/tokens.css` | 색·글자·간격 토큰, 라이트·다크 |
| `src/styles/app.css` | 화면 스타일 |
| `src/lib/contrast.ts` | 색 대비 계산 |
| `src/lib/categories.ts` | 분류 목록과 품목명 → 분류 |
| `src/lib/parse.ts` | 글 입력 한 줄 → 품목 |
| `src/lib/types.ts` | `Item`, `Member`, `Membership` 등 공용 타입 |
| `src/lib/listView.ts` | 목록 묶기(분류별·어디서 살지), 요약 |
| `src/lib/store.ts` | `ListStore` 인터페이스와 메모리 구현 |
| `src/lib/supabaseStore.ts` | `ListStore`의 Supabase 구현 |
| `src/lib/supabase.ts` | Supabase 클라이언트 |
| `src/lib/session.ts` | 로그인 사용자의 가구·구성원 읽기, 오류 문구 |
| `src/lib/prefs.ts` | 사람별 마지막 보기 기억(localStorage, 실패해도 기본값) |
| `src/components/Login.tsx`, `ListScreen.tsx`, `ListRow.tsx`, `AddSheet.tsx`, `NoHousehold.tsx` | 화면 |
| `src/demo.ts` | 데모 모드(`?demo=1`, 개발 서버에서만) 메모리 데이터 |
| `supabase/migrations/20261017000000_grocery_items.sql` | `grocery` 스키마, `items` 테이블, RLS, 권한, 실시간 |
| `tests/fixtures/shared-schema.sql` | 가계부 쪽 공유 객체의 최소 사본(테스트용) |
| `tests/*.test.ts` | 단위·권한 테스트 |
| `scripts/screenshots.mjs` | 390·1280 × 라이트·다크 캡처 |
| `DESIGN.md` | 장보기 디자인 문서(가계부 체계 + 장보기 확장) |
| `.github/workflows/deploy.yml` | 테스트 → 빌드 → GitHub Pages |

---

### Task 1: 프로젝트 뼈대와 디자인 토큰

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `src/styles/tokens.css`, `src/lib/contrast.ts`, `src/assets/fonts/SUIT-Variable.woff2`, `public/fonts/SUIT-OFL.txt`, `DESIGN.md`
- Test: `tests/tokens.test.ts`

**Interfaces:**
- Produces: `contrastRatio(fg: string, bg: string): number` (`#RRGGBB` 입력, WCAG 2.x 상대 휘도 공식). CSS 변수 이름 `--canvas`, `--oat`, `--oat-deep`, `--line`, `--ink`, `--ink-muted`, `--ink-faint`, `--sage`, `--sage-soft`, `--clay`, `--clay-soft`, `--indigo`, `--blush-soft`, `--rose-ink`, `--who-husband`, `--who-wife`, `--on-ink`. 다크 값은 `:root[data-theme="dark"]`와 `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` 두 곳에 같은 값으로 둔다.

- [ ] **Step 1: 가계부에서 설정 가져오기** — `package.json`(스크립트 `dev`, `build`=`tsc --noEmit && vite build`, `test`=`vitest run`, `typecheck`, `screens`=`node scripts/screenshots.mjs`), 의존성 버전, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`를 가계부 저장소(`jootaewan-hub/account-book`)에서 복사한다. 바꿀 값: PWA `name` "우리집 장보기", `short_name` "장보기", `description` "둘이 같이 쓰는 장보기 목록". devDependency에 `playwright` 추가. SUIT 글꼴 파일과 OFL 라이선스를 복사한다. PWA 아이콘(192·512·maskable 512)은 귀리 바탕에 먹색 장바구니 선 그림으로 만든다(반짝이·이모지 금지).

- [ ] **Step 2: 실패하는 토큰 테스트 작성** — `tests/tokens.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../src/lib/contrast'

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
function tokens(block: 'light' | 'dark'): Record<string, string> { /* :root 첫 블록 / [data-theme="dark"] 블록에서 --이름: #hex 를 읽는다 */ }

describe('토큰', () => {
  it('contrastRatio 기준값', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#33312D', '#FFFFFF')).toBeCloseTo(12.98, 1)
  })
  it('라이트는 가계부 값 그대로', () => {
    const t = tokens('light')
    expect(t['--canvas']).toBe('#FFFFFF'); expect(t['--oat']).toBe('#F4F1EC'); expect(t['--ink']).toBe('#33312D')
    expect(t['--clay']).toBe('#A8543E'); expect(t['--indigo']).toBe('#3D5A78')
  })
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: 글자 토큰은 바탕과 묶음 면 위에서 4.5:1 이상`, () => {
      const t = tokens(theme)
      for (const fg of ['--ink', '--ink-muted', '--ink-faint', '--sage', '--clay', '--indigo', '--rose-ink'])
        for (const bg of ['--canvas', '--oat'])
          expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 주 버튼 글자(--on-ink on --ink) 4.5:1 이상`, () => {
      const t = tokens(theme)
      expect(contrastRatio(t['--on-ink'], t['--ink'])).toBeGreaterThanOrEqual(4.5)
    })
  }
})
```

- [ ] **Step 3: 실패 확인** — Run: `npm test -- tests/tokens.test.ts` / Expected: FAIL (모듈·파일 없음)

- [ ] **Step 4: `contrastRatio`와 `tokens.css` 작성** — 라이트는 Global Constraints 값 그대로. `--clay-soft`(경고 배지 옅은 바탕)와 다크 값 전체는 새로 정하되 위 테스트를 통과해야 한다. 다크 방향: 바탕은 따뜻한 먹색 계열, 묶음 면은 한 단계 밝게, 주 버튼은 밝은 귀리색 바탕에 먹색 글자. `index.html`에 `theme-color` 라이트 `#FFFFFF`·다크 바탕색 두 개(media 속성).

- [ ] **Step 5: 통과 확인** — Run: `npm test && npm run build` / Expected: 테스트 PASS, `dist/` 생성, 빌드 결과 `index.html`에 CSP meta 포함

- [ ] **Step 6: `DESIGN.md` 작성** — 가계부 `DESIGN.md`를 참조 기준으로 명시하고(복사하지 말고 "가계부 DESIGN.md를 따른다"), 장보기 확장만 쓴다: 다크 모드 표(토큰, 값, 대비), 출처 태그(귀리 바탕 흰 태그, "우리가 산 값"은 `blush-soft` 바탕 `rose-ink` 글자), 경고 배지(기록 있음 `clay` 바탕 흰 글자, 비슷한 기록 `clay-soft` 바탕 `clay` 글자), 시세 등락(오름 `clay` ▲, 내림 `indigo` ▼, 색만으로 알리지 않음), 상품 이미지 타일(12px 반경, 귀리 바탕). 이후 계획에서 쓸 요소도 여기에 정의만 해 둔다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "기반: Vite·React·PWA 뼈대, 라이트·다크 토큰과 대비 검사, DESIGN.md"
```

---

### Task 2: 분류와 글 입력 파싱

**Files:**
- Create: `src/lib/categories.ts`, `src/lib/parse.ts`
- Test: `tests/parse.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES = ['정육','수산','채소','과일','유제품','계란','가공','냉동','음료','생활용품','기타'] as const`, `type Category = typeof CATEGORIES[number]`
  - `categorize(name: string): Category` — 키워드 사전 일치, 없으면 `'기타'`. 한 글자 키워드는 공백·문자열 경계로 나뉜 **단어 전체**가 같을 때만 일치.
  - `type ParsedItem = { name: string; spec: string | null; count: number; category: Category }`
  - `parseLines(text: string): ParsedItem[]` — 한 줄 한 품목, 빈 줄 무시.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/parse.test.ts`

```ts
it.each([
  ['비비고 왕교자 1.05kg x2', { name: '비비고 왕교자', spec: '1.05kg', count: 2, category: '냉동' }],
  ['삼겹살 600g', { name: '삼겹살', spec: '600g', count: 1, category: '정육' }],
  ['계란 30구', { name: '계란', spec: '30구', count: 1, category: '계란' }],
  ['배추 1포기', { name: '배추', spec: '1포기', count: 1, category: '채소' }],
  ['우유 2개', { name: '우유', spec: null, count: 2, category: '유제품' }],
  ['  대파  ', { name: '대파', spec: null, count: 1, category: '채소' }],
  ['콜라 1.5L ×3', { name: '콜라', spec: '1.5L', count: 3, category: '음료' }],
  ['배', { name: '배', spec: null, count: 1, category: '과일' }],
  ['감자 1kg', { name: '감자', spec: '1kg', count: 1, category: '채소' }],
  ['굴 300g', { name: '굴', spec: '300g', count: 1, category: '수산' }],
  ['키친타월', { name: '키친타월', spec: null, count: 1, category: '생활용품' }],
  ['처음 보는 물건', { name: '처음 보는 물건', spec: null, count: 1, category: '기타' }],
])('%s', (line, expected) => expect(parseLines(line)).toEqual([expected]))

it('빈 줄은 건너뛴다', () => expect(parseLines('대파\n\n  \n양파 1.5kg')).toHaveLength(2))
it('개수 표기 x2, ×2, 2개를 모두 읽는다', () =>
  expect(parseLines('a x2\nb ×2\nc 2개').map((i) => i.count)).toEqual([2, 2, 2]))
it('개수 0이나 이상한 값은 1로', () => expect(parseLines('우유 x0')[0].count).toBe(1))
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/parse.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — 용량 단위 `g|kg|ml|L|l|구|개입|포기|단|마리|팩|봉|병|캔|장`(숫자+단위, 소수점 허용). 개수는 줄 끝의 `x\d+`, `×\d+`, `\d+개`(단 `\d+개입`은 용량). 키워드 사전은 v0(`docs/prototype/v0-artifact.html`)의 분류 키워드를 옮기고 위 테스트 품목을 포함한다. 비비고·왕교자·만두는 `냉동`.

- [ ] **Step 4: 통과 확인** — Run: `npm test -- tests/parse.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `git commit -m "글 입력 파싱과 분류 사전"`

---

### Task 3: 목록 묶기와 요약

**Files:**
- Create: `src/lib/types.ts`, `src/lib/listView.ts`
- Test: `tests/listView.test.ts`

**Interfaces:**
- Consumes: `Category`, `CATEGORIES` (Task 2)
- Produces (`src/lib/types.ts`):
  - `type Item = { id: string; householdId: string; name: string; spec: string | null; count: number; category: Category; productKey: string | null; addedBy: string; addedAt: string; boughtBy: string | null; boughtAt: string | null; paid: number | null }`
  - `type Member = { userId: string; displayName: string; spouseRole: 'husband' | 'wife' | null }`
  - `type AlertLevel = 'record' | 'similar'`
  - `type PriceCompare = { onlineBest: number | null; storeBase: number | null }`
- Produces (`src/lib/listView.ts`):
  - `type Section = { key: string; title: string; items: Item[] }`
  - `groupByCategory(items: Item[], alerts: ReadonlyMap<string, AlertLevel>): Section[]`
  - `groupByWhere(items: Item[], alerts: ReadonlyMap<string, AlertLevel>, prices: ReadonlyMap<string, PriceCompare>): Section[]`
  - `summarize(items: Item[], prices: ReadonlyMap<string, PriceCompare>): { toBuy: number; lowestTotal: number | null; unknown: number }`

규칙(스펙 6절):
- 경고가 있는 품목은 두 보기 모두 맨 앞 `{ key: 'alert', title: '먼저 볼 것' }`에만 들어간다.
- 분류별: `CATEGORIES` 순서, 빈 분류는 만들지 않는다. 섹션 key는 분류 이름.
- 어디서 살지: `{ key: 'online', title: '온라인이 더 싼 것' }`은 `onlineBest`와 `storeBase`가 둘 다 있고 `onlineBest < storeBase`일 때만. 나머지는 `{ key: 'store', title: '마트에서 살 것' }`.
- 각 섹션 안에서 아직 안 산 것이 먼저, 산 것(`boughtAt` 있음)은 뒤. 같은 그룹 안은 `addedAt` 순.
- 요약: `toBuy`는 안 산 품목 수. `lowestTotal`은 안 산 품목 중 `onlineBest`가 있는 것들의 `onlineBest × count` 합, 하나도 없으면 `null`. `unknown`은 안 산 품목 중 `onlineBest`가 없는 수.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/listView.test.ts`. 품목 생성 헬퍼 `item(partial)`을 둔다.

```ts
it('분류 순서대로 묶고 빈 분류는 없다', () => {
  const s = groupByCategory([item({ id: '1', category: '채소' }), item({ id: '2', category: '정육' })], new Map())
  expect(s.map((x) => x.key)).toEqual(['정육', '채소'])
})
it('경고 품목은 먼저 볼 것에만', () => {
  const s = groupByCategory([item({ id: '1', category: '냉동' }), item({ id: '2', category: '냉동' })], new Map([['2', 'similar']]))
  expect(s[0]).toMatchObject({ key: 'alert', title: '먼저 볼 것' })
  expect(s[0].items.map((i) => i.id)).toEqual(['2'])
  expect(s[1].items.map((i) => i.id)).toEqual(['1'])
})
it('산 것은 섹션 끝으로', () => {
  const s = groupByCategory([item({ id: '1', boughtAt: '2026-10-16T10:00:00Z' }), item({ id: '2' })], new Map())
  expect(s[0].items.map((i) => i.id)).toEqual(['2', '1'])
})
it('온라인이 더 쌀 때만 온라인으로, 비교 못 하면 마트', () => {
  const prices = new Map([['1', { onlineBest: 9000, storeBase: 10000 }], ['2', { onlineBest: 9000, storeBase: null }], ['3', { onlineBest: 11000, storeBase: 10000 }]])
  const s = groupByWhere([item({ id: '1' }), item({ id: '2' }), item({ id: '3' })], new Map(), prices)
  expect(s.find((x) => x.key === 'online')!.items.map((i) => i.id)).toEqual(['1'])
  expect(s.find((x) => x.key === 'store')!.items.map((i) => i.id)).toEqual(['2', '3'])
})
it('가격이 하나도 없으면 합계는 null, 확인 못 함은 살 것 수와 같다', () => {
  expect(summarize([item({ id: '1' }), item({ id: '2' })], new Map())).toEqual({ toBuy: 2, lowestTotal: null, unknown: 2 })
})
it('합계는 개수를 곱하고 산 것은 뺀다', () => {
  const prices = new Map([['1', { onlineBest: 1000, storeBase: null }], ['2', { onlineBest: 500, storeBase: null }]])
  expect(summarize([item({ id: '1', count: 2 }), item({ id: '2', boughtAt: 'x' })], prices)).toEqual({ toBuy: 1, lowestTotal: 2000, unknown: 0 })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/listView.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 규칙대로.
- [ ] **Step 4: 통과 확인** — Run: `npm test -- tests/listView.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "목록 묶기(분류별·어디서 살지)와 요약"`

---

### Task 4: `grocery` 스키마와 권한

**Files:**
- Create: `supabase/migrations/20261017000000_grocery_items.sql`, `tests/fixtures/shared-schema.sql`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: 가계부 쪽 공유 객체 `public.households(id)`, `public.members(household_id, user_id, display_name, spouse_role)`, `private.is_household_member(uuid) returns boolean`, `auth.uid()`
- Produces: 테이블 `grocery.items` — 열 `id uuid pk default gen_random_uuid()`, `household_id uuid not null references public.households(id) on delete cascade`, `name text not null check (char_length(name) between 1 and 60)`, `spec text check (char_length(spec) <= 20)`, `count int not null default 1 check (count between 1 and 99)`, `category text not null check (category in (...Task 2의 11개))`, `product_key text`, `added_by uuid not null default auth.uid()`, `added_at timestamptz not null default now()`, `bought_by uuid`, `bought_at timestamptz`, `paid bigint check (paid > 0)`, `check ((bought_by is null) = (bought_at is null))`, `foreign key (household_id, added_by) references public.members(household_id, user_id)`, `foreign key (household_id, bought_by) references public.members(household_id, user_id)`. 인덱스 `(household_id, added_at)`.

- [ ] **Step 1: 공유 객체 사본 작성** — `tests/fixtures/shared-schema.sql`: 가계부 `tests/db.test.ts`의 `SUPABASE_STUB`(auth 스키마, `auth.uid()`, anon/authenticated/service_role 역할, `supabase_realtime` publication)과 가계부 `20261015000000_init.sql`의 `private` 스키마, `public.households`, `public.members`, `private.is_household_member`, 그리고 `spouse_role` 열(가계부 `20261015010000_spouse_roles.sql`)만 옮긴다. 파일 맨 위에 "가계부 저장소 기준 사본, 장보기가 기대는 객체만. 가계부 쪽이 바뀌면 함께 고친다"라고 적는다.

- [ ] **Step 2: 실패하는 권한 테스트 작성** — `tests/db.test.ts`. PGlite에 fixture → 가구 두 개(A·B 같은 가구, C 다른 가구)를 service 역할로 직접 넣고 → 마이그레이션 적용. 가계부 테스트의 `as(uid, sql)` 헬퍼를 그대로 쓴다.

```ts
it('같은 가구 구성원은 담고 읽고 체크한다', async () => {
  await as(A, `insert into grocery.items (household_id, name, category) values ($1, '대파', '채소')`, [hhAB])
  expect(await as(B, `select name from grocery.items`)).toEqual([{ name: '대파' }])
  await as(B, `update grocery.items set bought_by = $1, bought_at = now()`, [B])
  expect((await as(A, `select bought_by from grocery.items`))[0].bought_by).toBe(B)
})
it('다른 가구는 못 보고 못 넣는다', async () => {
  expect(await as(C, `select * from grocery.items`)).toEqual([])
  expect(await errorOf(as(C, `insert into grocery.items (household_id, name, category) values ($1, 'x', '기타')`, [hhAB]))).toMatch(/row-level security/)
})
it('로그인 안 하면 아무것도 못 한다', async () => {
  expect(await errorOf(as(null, `select * from grocery.items`))).toMatch(/permission denied/)
})
it('added_by를 남의 아이디로 넣을 수 없다', async () => {
  expect(await errorOf(as(A, `insert into grocery.items (household_id, name, category, added_by) values ($1, 'x', '기타', $2)`, [hhAB, B]))).not.toBe('NO_ERROR')
})
it('bought_by만 있고 bought_at이 없으면 거부', async () => {
  expect(await errorOf(as(A, `update grocery.items set bought_by = $1, bought_at = null`, [A]))).toMatch(/check/)
})
it('산 사람은 같은 가구 구성원이어야 한다', async () => {
  expect(await errorOf(as(A, `update grocery.items set bought_by = $1, bought_at = now()`, [C]))).toMatch(/foreign key/)
})
it('items가 실시간 publication에 들어 있다', async () => {
  const rows = await db.query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='grocery' and tablename='items'`)
  expect(rows.rows).toHaveLength(1)
})
```

- [ ] **Step 3: 실패 확인** — Run: `npm test -- tests/db.test.ts` / Expected: FAIL (스키마 없음)

- [ ] **Step 4: 마이그레이션 작성** — `create schema grocery`, `revoke all on schema grocery from public, anon`, `grant usage on schema grocery to authenticated, service_role`. RLS 켜고 정책 네 개(select/insert/update/delete) 모두 `(select private.is_household_member(household_id))`; insert는 추가로 `added_by = (select auth.uid())`. 권한: `authenticated`에 `select, insert, delete`와 `update (name, spec, count, category, product_key, bought_by, bought_at, paid)`(added_by·household_id 변경 불가), `service_role`에 전체. `anon`에는 없음. publication은 가계부처럼 존재할 때만 `alter publication supabase_realtime add table grocery.items`. 파일 머리에 "장보기 마이그레이션은 grocery 스키마만 바꾼다(D-003)"를 적는다.

- [ ] **Step 5: 통과 확인** — Run: `npm test -- tests/db.test.ts` / Expected: PASS

- [ ] **Step 6: 커밋** — `git commit -m "grocery 스키마와 items 테이블, 가구 단위 RLS"`

---

### Task 5: 로그인과 가구 읽기

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/session.ts`, `src/components/Login.tsx`, `src/components/NoHousehold.tsx`
- Modify: `src/App.tsx`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `Member` (Task 3)
- Produces:
  - `supabase: SupabaseClient` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, 세션 유지)
  - `type Membership = { userId: string; householdId: string; members: Member[] }`
  - `toMembership(userId: string, rows: { household_id: string; user_id: string; display_name: string; spouse_role: string | null }[]): Membership | null` — 본인 행이 없으면 `null`
  - `loadMembership(client: SupabaseClient): Promise<Membership | null>` — `public.members` 조회 후 `toMembership`
  - `loginErrorMessage(code: string | undefined): string`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/session.test.ts`

```ts
it('본인 행이 없으면 null(가구 없음)', () => expect(toMembership('u1', [])).toBeNull())
it('두 사람을 담는다', () => {
  const m = toMembership('u1', [
    { household_id: 'h', user_id: 'u1', display_name: '태완', spouse_role: 'husband' },
    { household_id: 'h', user_id: 'u2', display_name: '배우자', spouse_role: 'wife' },
  ])
  expect(m).toEqual({ userId: 'u1', householdId: 'h', members: [
    { userId: 'u1', displayName: '태완', spouseRole: 'husband' },
    { userId: 'u2', displayName: '배우자', spouseRole: 'wife' }] })
})
it('로그인 오류 문구', () => {
  expect(loginErrorMessage('invalid_credentials')).toBe('이메일이나 비밀번호가 맞지 않아요.')
  expect(loginErrorMessage(undefined)).toBe('지금 로그인할 수 없어요. 잠시 뒤 다시 해 주세요.')
})
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/session.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 함수 셋과 화면 둘. 로그인 화면: 제목 "우리집 장보기", 안내 "가계부와 같은 계정으로 로그인해요", 이메일·비밀번호 칸(16px), 주 버튼 "로그인", 아래 링크 "비밀번호를 잊었으면 가계부 앱에서 바꿀 수 있어요"(가계부 주소 `https://jootaewan-hub.github.io/account-book/`). 회원가입 버튼은 없다. `NoHousehold`: "가계부 앱에서 가구를 먼저 만들거나 초대 코드로 참여해 주세요." + 가계부 링크 + 로그아웃. `App`: 세션 없음 → Login, 가구 없음 → NoHousehold, 있음 → ListScreen(Task 6).
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "가계부 계정 로그인과 가구 읽기"`

---

### Task 6: 목록 저장소(Supabase·메모리)

**Files:**
- Create: `src/lib/store.ts`, `src/lib/supabaseStore.ts`, `src/demo.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `Item`, `ParsedItem`, `Membership`
- Produces:
  - `interface ListStore { list(): Promise<Item[]>; add(items: ParsedItem[]): Promise<void>; setBought(id: string, bought: boolean): Promise<void>; remove(id: string): Promise<void>; subscribe(onChange: () => void): () => void }`
  - `createMemoryStore(seed: Item[], me: { userId: string; householdId: string }, now?: () => string): ListStore`
  - `createSupabaseStore(client: SupabaseClient, me: Membership): ListStore` — `client.schema('grocery').from('items')`, 열 이름 snake_case ↔ `Item` camelCase 변환, 실시간은 `postgres_changes`(schema `grocery`, table `items`, filter `household_id=eq.<id>`)
  - `demoSeed(): { me: Membership; items: Item[] }` — 스펙 시안의 품목들(삼겹살 600g, 한우 국거리 300g, 비비고 왕교자 1.05kg ×2, 대파, 양파 1.5kg 산 것 등), 두 사람(남편·아내)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/store.test.ts` (메모리 구현만; Supabase 구현은 Task 8 실제 확인)

```ts
it('담으면 목록에 나오고 담은 사람·시각이 채워진다', async () => {
  const s = createMemoryStore([], { userId: 'u1', householdId: 'h' }, () => '2026-10-16T10:00:00Z')
  await s.add([{ name: '대파', spec: null, count: 1, category: '채소' }])
  expect(await s.list()).toMatchObject([{ name: '대파', addedBy: 'u1', addedAt: '2026-10-16T10:00:00Z', boughtAt: null }])
})
it('체크하면 산 사람·시각, 풀면 둘 다 지운다', async () => {
  const s = createMemoryStore([], { userId: 'u1', householdId: 'h' }, () => 't')
  await s.add([{ name: '대파', spec: null, count: 1, category: '채소' }])
  const [it1] = await s.list()
  await s.setBought(it1.id, true)
  expect((await s.list())[0]).toMatchObject({ boughtBy: 'u1', boughtAt: 't' })
  await s.setBought(it1.id, false)
  expect((await s.list())[0]).toMatchObject({ boughtBy: null, boughtAt: null })
})
it('바뀔 때마다 구독자에게 알리고, 해제하면 멈춘다', async () => {
  const s = createMemoryStore([], { userId: 'u1', householdId: 'h' })
  let n = 0; const off = s.subscribe(() => n++)
  await s.add([{ name: 'a', spec: null, count: 1, category: '기타' }]); off()
  await s.add([{ name: 'b', spec: null, count: 1, category: '기타' }])
  expect(n).toBe(1)
})
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/store.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 메모리·Supabase 구현과 `demoSeed`. Supabase `setBought(false)`는 `bought_by`, `bought_at`, `paid`를 모두 `null`로.
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "목록 저장소: Supabase 구현과 데모용 메모리 구현"`

---

### Task 7: 목록 화면과 담기

**Files:**
- Create: `src/components/ListScreen.tsx`, `src/components/ListRow.tsx`, `src/components/AddSheet.tsx`, `src/lib/prefs.ts`, `src/styles/app.css`, `scripts/screenshots.mjs`
- Modify: `src/App.tsx`, `src/main.tsx`
- Test: `tests/prefs.test.ts`

**Interfaces:**
- Consumes: `ListStore`, `groupByCategory`, `groupByWhere`, `summarize`, `parseLines`, `Membership`, `demoSeed`
- Produces: `loadListView(userId: string): 'category' | 'where'`(기본 `'category'`), `saveListView(userId: string, v: 'category' | 'where'): void` — localStorage 키 `grocery:listView:<userId>`, 읽기·쓰기 실패 시 기본값·무시. 데모 모드: 개발 서버(`import.meta.env.DEV`)에서 `?demo=1`이면 로그인 없이 `createMemoryStore(demoSeed())`. 빌드 결과에는 데모 진입이 없다.

화면 규칙(스펙 6절, 9절):
- 제목 "이번 장보기". 요약 세 칸: "살 것" `N개`, "찾은 최저가 합계" (`lowestTotal`이 null이면 "확인 못 함"), "확인 못 함" `N개`.
- 보기 전환 "분류별 | 어디서 살지"(분할 버튼, 선택은 먹색). 이 계획에서는 가격·경고가 없으므로 `alerts`, `prices`는 빈 Map을 넘긴다. 어디서 살지 보기의 마트 섹션 품목 둘째 줄에 "비교 못 함".
- 행: 체크 원(44px 터치), 이름 + 용량 + `×N`, 둘째 줄에 담은 사람 색 점(남편 `who-husband`, 아내 `who-wife`, 역할 없으면 `ink-faint`)과 이름, 오른쪽은 가격이 없으므로 `가격 확인 못 함` 태그. `productKey`가 null이면 둘째 줄에 "상품 고르기 전"(스펙 7-1). 산 행은 취소선 + "{이름}이 샀어요".
- 아래 고정 주 버튼 "담기" → `AddSheet`: 여러 줄 입력칸(안내 "한 줄에 하나씩, 예: 비비고 왕교자 1.05kg x2"), 미리보기(파싱 결과 이름·용량·개수·분류), 주 버튼 "N개 담기"(0개면 비활성). 바텀시트 움직임은 가계부 Motion 규칙.
- 빈 상태: "아직 담은 게 없어요. 아래 담기로 시작해 보세요." 불러오는 중: 자리 표시 후 흐림 교차. 오류: "목록을 불러오지 못했어요. 다시 시도" 버튼.
- 넓은 화면(960px 이상): 가계부 규칙대로 읽기 폭 760px 한 단, "담기"는 위쪽 주 버튼.
- 행을 누르면 갈 품목 상세는 계획 ④에서 만든다. 이 계획에서는 행 탭에 동작이 없다.
- 스펙 6절의 "바코드로 상품 보기" 입구는 계획 ⑥에서 붙인다. 이 계획에서는 자리를 만들지 않는다.
- 행 오른쪽 끝을 왼쪽으로 밀거나 길게 눌러 "빼기"(`remove`). 지우기 전 확인 없이 지우고 아래 알림에 "되돌리기"(5초)를 둔다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/prefs.test.ts`: localStorage가 없거나 던질 때 `'category'`, 저장 후 같은 사람은 `'where'`, 다른 사람은 `'category'`.
- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/prefs.test.ts` / Expected: FAIL
- [ ] **Step 3: `prefs.ts`와 화면 구현**
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run build` / Expected: PASS
- [ ] **Step 5: 스크린샷 스크립트 작성** — `scripts/screenshots.mjs`: 이미 떠 있는 개발 서버(`http://localhost:5173/?demo=1`)를 열어 `screenshots/list-{390,1280}-{light,dark}.png` 네 장과 담기 시트 열린 상태 390 라이트·다크 두 장을 저장(`colorScheme` 에뮬레이션). `screenshots/`는 커밋하지 않는다(.gitignore에 `screenshots/` 추가).
- [ ] **Step 6: 눈으로 확인하고 고치기** — Run: `npm run dev`(백그라운드) 후 `npm run screens` / Expected: 여섯 장 생성. 각 장을 열어 확인: 가로 스크롤 없음, 글자 잘림 없음, 다크에서 회색 위 회색 없음, 터치 대상 44px, "0원" 없음, 금지 문구 없음. 문제가 있으면 고치고 다시 캡처.
- [ ] **Step 7: 커밋** — `git commit -m "장보기 목록 화면과 담기 시트, 스크린샷 스크립트"`

---

### Task 8: 공유 DB 적용과 배포 연결 (사용자 확인 필요)

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `docs/tracking/status.md`, `docs/architecture.md`, `README.md`

이 작업의 일부는 공유 운영 DB와 공개 설정을 바꾸므로, 단계마다 사용자에게 무엇을 할지 보여 주고 "예"를 받은 뒤에 한다.

- [ ] **Step 1: 배포 워크플로 작성** — 가계부 `deploy.yml`을 복사하고 이름만 바꾼다: `BASE_PATH: /grocery-app/`, Supabase URL `https://kifdfpbwiebfgvdumqjf.supabase.co`와 공개용 키는 가계부 워크플로의 값과 같다(D-003). `npm test` → `npm run build` → Pages.
- [ ] **Step 2: 공유 DB 현재 상태 확인** — Supabase MCP `list_tables`(schemas `public`, `private`)로 `public.households`, `public.members(spouse_role 포함)`, `private.is_household_member`가 fixture와 같은지 확인. 다르면 fixture와 마이그레이션을 고치고 Task 4 테스트를 다시 돌린다.
- [ ] **Step 3: [사용자 확인] 마이그레이션 적용** — 사용자에게 "공유 DB(가계부와 같은 프로젝트)에 `grocery` 스키마를 추가합니다. 가계부 테이블은 바꾸지 않습니다"라고 알리고 승인 후 Supabase MCP `apply_migration`(name `grocery_items`)으로 적용. 가계부도 MCP로 적용하고 있으므로(`list_migrations` 확인) `supabase db push`는 쓰지 않는다. 적용 후 `get_advisors`(security)에서 새 경고가 `grocery` 관련으로 생겼는지 확인하고 보고.
- [ ] **Step 4: [사용자 작업] API 노출 스키마** — 사용자에게 Supabase 대시보드 Settings → API → Exposed schemas에 `grocery`를 추가해 달라고 요청(설정 변경이므로 사용자가 직접). 추가 후 개발 서버에서 실제 계정으로 로그인해 담기·체크가 두 기기(또는 두 창)에서 실시간으로 보이는지는 **사용자가** 확인한다(실제 비밀번호를 Claude가 입력하지 않는다).
- [ ] **Step 5: [사용자 지시] 저장소 공개와 Pages** — D-006에 따라 사용자가 지시할 때만: 저장소를 공개로 바꾸고 Settings → Pages → Source를 GitHub Actions로. `main` 병합·푸시도 사용자 지시로만(푸시는 곧 배포).
- [ ] **Step 6: 문서 갱신** — `status.md`: 된 것에 이 계획 결과, 다음 할 일 맨 위를 계획 ②(식약처 대조)로. 열린 문제의 "네이버 쇼핑 API 종료로 architecture.md·CLAUDE.md 규칙 불일치"는 그대로 두되 `architecture.md` 데이터 흐름의 "네이버 쇼핑 검색"을 "가격 출처는 `docs/data-sources.md` 1절, 계획 ④에서 확정"으로 고친다. `README.md`에 개발 명령(`npm run dev`, `npm test`, `npm run screens`, `?demo=1`)을 적는다.
- [ ] **Step 7: 커밋** — `git commit -m "배포 워크플로와 공유 DB 적용 기록"`
