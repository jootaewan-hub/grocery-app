// 화면 캡처: 이미 떠 있는 개발 서버(npm run dev)에서 데모 화면을 열어 screenshots/에 저장한다.
// 실행: npm run dev (다른 창) → npm run screens. BASE_URL로 주소를 바꿀 수 있다.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = new URL('../screenshots/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }

const BOTH = ['light', 'dark']
const SHEET_TEXT = '비비고 왕교자 1.05kg x2\n우유 900ml\n대파\n고추장 500g\n휴지 30롤'
// 쇼핑몰 상품명을 통째로 붙여 넣은 경우(60자 넘음): "이름이 길어 60자까지만 담아요"가 보여야 한다.
const LONG_LINE = '[무료배송] 풀무원 국산콩 두부 부침용 300g 2개입 + 찌개용 300g 2개입 냉장 신선 묶음 기획 특가 세트'
const SPLIT_TEXT = '양파 당근 감자 비비고 왕교자 파'
const shots = [
  ...[390, 1280].flatMap((w) => BOTH.map((c) => ({ name: `list-${w}-${c}`, path: '/?demo=1', w, c, full: true }))),
  ...[390, 1280].flatMap((w) => BOTH.map((c) => ({ name: `add-sheet-${w}-${c}`, path: '/?demo=1', w, c, sheet: SHEET_TEXT }))),
  ...BOTH.map((c) => ({ name: `add-sheet-split-390-${c}`, path: '/?demo=1', w: 390, c, sheet: SPLIT_TEXT })),
  { name: 'add-sheet-long-390-light', path: '/?demo=1', w: 390, c: 'light', sheet: `${LONG_LINE}\n대파` },
  ...BOTH.map((c) => ({ name: `list-where-390-${c}`, path: '/?demo=1', w: 390, c, where: true, full: true })),
  // "빼기"가 열린 줄(키보드로 오면 열린다)과, 뺀 뒤의 되돌리기 알림
  { name: 'row-remove-open-390-light', path: '/?demo=1', w: 390, c: 'light', openRemove: '삼겹살 600g' },
  ...BOTH.map((c) => ({ name: `removed-notice-390-${c}`, path: '/?demo=1', w: 390, c, remove: '삼겹살 600g' })),
  // 편집: 줄마다 "빼기"와 묶음 제목 옆 "모두 빼기", 묶음을 통째로 뺀 뒤의 되돌리기 알림
  ...[390, 1280].flatMap((w) => BOTH.map((c) => ({ name: `list-edit-${w}-${c}`, path: '/?demo=1', w, c, edit: true, full: true }))),
  ...BOTH.map((c) => ({ name: `group-removed-390-${c}`, path: '/?demo=1', w: 390, c, edit: true, groupRemove: true })),
  // 식약처 비슷한 기록 배지를 눌러 연 경고 시트(데모의 가상 기록)
  ...BOTH.map((c) => ({ name: `alert-sheet-390-${c}`, path: '/?demo=1', w: 390, c, alert: '비슷한 제품 기록' })),
  { name: 'alert-sheet-1280-light', path: '/?demo=1', w: 1280, c: 'light', alert: '비슷한 제품 기록' },
  // 상품 고르기 시트(데모 후보, 가격은 예시)
  ...BOTH.map((c) => ({ name: `candidate-sheet-390-${c}`, path: '/?demo=1', w: 390, c, pick: true })),
  { name: 'candidate-sheet-1280-light', path: '/?demo=1', w: 1280, c: 'light', pick: true },
  ...BOTH.map((c) => ({ name: `list-empty-390-${c}`, path: '/?demo=empty', w: 390, c, wait: '아직 담은 게 없어요' })),
  { name: 'list-error-390-light', path: '/?demo=error', w: 390, c: 'light', wait: '목록을 불러오지 못했어요.' },
  ...[390, 1280].flatMap((w) => BOTH.map((c) => ({ name: `login-${w}-${c}`, path: '/?demo=login&error=1', w, c }))),
  ...BOTH.map((c) => ({ name: `no-household-390-${c}`, path: '/?demo=nohousehold', w: 390, c })),
  { name: 'no-household-1280-light', path: '/?demo=nohousehold', w: 1280, c: 'light' },
]

// 이름을 주면 그 화면만 다시 찍는다: npm run screens -- list-empty-390-light removed-notice-390-dark
const only = process.argv.slice(2)
const selected = only.length ? shots.filter((s) => only.includes(s.name)) : shots

const browser = await chromium.launch()
const problems = []
try {
  for (const s of selected) {
    const context = await browser.newContext({
      viewport: SIZES[s.w],
      deviceScaleFactor: s.w === 390 ? 2 : 1,
      colorScheme: s.c,
      reducedMotion: 'reduce', // 캡처가 움직임 중간에 찍히지 않게
      locale: 'ko-KR',
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => problems.push(`${s.name}: ${e.message}`))
    await page.goto(BASE + s.path, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    if (s.path.includes('demo=1')) await page.getByRole('heading', { name: '이번 장보기' }).waitFor()
    if (s.wait) await page.getByText(s.wait).waitFor()
    if (s.where) await page.getByRole('button', { name: '어디서 살지' }).click()
    if (s.sheet) {
      await page.getByRole('button', { name: '담기', exact: true }).first().click()
      await page.getByRole('dialog').waitFor()
      await page.getByLabel('살 것').fill(s.sheet)
    }
    if (s.alert) {
      await page.getByRole('button', { name: s.alert }).first().click()
      await page.getByRole('dialog').waitFor()
    }
    if (s.edit) await page.getByRole('button', { name: '편집' }).click()
    if (s.groupRemove) {
      await page.locator('.group-remove').first().click()
      await page.getByRole('button', { name: '되돌리기' }).waitFor()
    }
    if (s.pick) {
      await page.getByRole('button', { name: '상품 고르기' }).first().click()
      await page.getByRole('dialog').waitFor()
      await page.locator('.cand-variant').first().waitFor()
    }
    if (s.openRemove) await page.getByRole('button', { name: `${s.openRemove} 빼기` }).focus()
    if (s.remove) {
      await page.getByRole('button', { name: `${s.remove} 빼기` }).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: '되돌리기' }).waitFor()
    }
    await page.waitForTimeout(450)

    // 숫자로 확인할 수 있는 것은 여기서 먼저 잡는다: 가로 스크롤, 44px보다 작은 버튼, "0원", 금지 문구.
    const check = await page.evaluate(() => {
      const out = []
      if (document.documentElement.scrollWidth > window.innerWidth) out.push(`가로 스크롤 ${document.documentElement.scrollWidth}px`)
      for (const el of document.querySelectorAll('button, a, input, textarea, [role="button"]')) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width === 0 || cs.visibility === 'hidden' || el.closest('.sr-only')) continue
        // data-touch-extend: 보이는 크기는 작고 ::before로 누르는 영역을 넓힌 버튼. 넓힌 크기로 잰다.
        const ext = el.hasAttribute('data-touch-extend') ? getComputedStyle(el, '::before') : null
        const extH = ext ? -parseFloat(ext.top) - parseFloat(ext.bottom) : 0
        const extW = ext ? -parseFloat(ext.left) - parseFloat(ext.right) : 0
        if (r.height + extH < 44 || r.width + extW < 44) out.push(`작은 터치 대상 ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"`)
      }
      const text = document.body.innerText
      if (/(^|[^\d,])0원/.test(text)) out.push('"0원" 있음')
      for (const w of ['AI', '분석 중', '안전함', '문제 없음', ' · ']) if (text.includes(w)) out.push(`금지 문구 "${w}"`)
      return out
    })
    for (const p of check) problems.push(`${s.name}: ${p}`)

    await page.screenshot({ path: fileURLToPath(new URL(`${s.name}.png`, OUT)), fullPage: Boolean(s.full) })
    console.log(`저장 ${s.name}.png`)
    await context.close()
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.log('\n확인할 것:')
  for (const p of problems) console.log(`- ${p}`)
  process.exitCode = 1
} else {
  console.log('\n자동 확인: 문제 없음(눈으로도 확인할 것)')
}
