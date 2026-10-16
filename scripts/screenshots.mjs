// 화면 캡처: 이미 떠 있는 개발 서버(npm run dev)에서 데모 화면을 열어 screenshots/에 저장한다.
// 실행: npm run dev (다른 창) → npm run screens. BASE_URL로 주소를 바꿀 수 있다.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = new URL('../screenshots/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }

const shots = [
  ...[390, 1280].flatMap((w) => ['light', 'dark'].map((c) => ({ name: `list-${w}-${c}`, path: '/?demo=1', w, c, full: true }))),
  ...['light', 'dark'].map((c) => ({ name: `add-sheet-390-${c}`, path: '/?demo=1', w: 390, c, sheet: true })),
  { name: 'list-where-390-light', path: '/?demo=1', w: 390, c: 'light', where: true, full: true },
  ...[390, 1280].flatMap((w) => ['light', 'dark'].map((c) => ({ name: `login-${w}-${c}`, path: '/?demo=login&error=1', w, c }))),
  ...['light', 'dark'].map((c) => ({ name: `no-household-390-${c}`, path: '/?demo=nohousehold', w: 390, c })),
]

const browser = await chromium.launch()
const problems = []
try {
  for (const s of shots) {
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
    if (s.where) await page.getByRole('button', { name: '어디서 살지' }).click()
    if (s.sheet) {
      await page.getByRole('button', { name: '담기', exact: true }).first().click()
      await page.getByRole('dialog').waitFor()
      await page.getByLabel('살 것').fill('비비고 왕교자 1.05kg x2\n우유 900ml\n대파\n고추장 500g\n휴지 30롤')
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
        if (r.height < 44 || r.width < 44) out.push(`작은 터치 대상 ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"`)
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
