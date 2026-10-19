import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DanawaProduct } from '../supabase/functions/_shared/danawa'
import { handle, type CheckDeps } from '../supabase/functions/product-check/handle'

const PRODUCT = '22222222-2222-4222-8222-222222222222'
const HTML = readFileSync(new URL('./fixtures/danawa/product-5643303.html', import.meta.url), 'utf8')

function deps(over: Partial<CheckDeps> = {}) {
  const log = { urls: [] as string[], saved: [] as DanawaProduct[], failed: [] as string[] }
  const d: CheckDeps = {
    allowed: async () => true,
    product: async (id) => ({ id, sourceId: '5643303' }),
    todayOk: async () => false,
    fetchHtml: async (url) => {
      log.urls.push(url)
      return { status: 200, text: HTML }
    },
    save: async (_id, p) => {
      log.saved.push(p)
    },
    fail: async (_id, err) => {
      log.failed.push(err)
    },
    now: () => new Date('2026-10-20T01:00:00Z'),
    ...over,
  }
  return { d, log }
}
const post = (body: unknown) =>
  new Request('https://x/functions/v1/product-check', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('product-check', () => {
  it('POST가 아니면 405, productId가 uuid가 아니면 400', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
    expect((await handle(post({ productId: 'x' }), d)).status).toBe(400)
    expect((await handle(post('nope'), d)).status).toBe(400)
  })

  it('내 가구가 고른 상품이 아니면 403이고 다나와를 부르지 않는다', async () => {
    const { d, log } = deps({ allowed: async () => false })
    expect((await handle(post({ productId: PRODUCT }), d)).status).toBe(403)
    expect(log.urls).toHaveLength(0)
  })

  it('상품이 없으면 404', async () => {
    const { d } = deps({ product: async () => null })
    expect((await handle(post({ productId: PRODUCT }), d)).status).toBe(404)
  })

  it('오늘 성공한 확인이 있으면 cached, 부르지 않는다', async () => {
    const { d, log } = deps({ todayOk: async () => true })
    const res = await handle(post({ productId: PRODUCT }), d)
    expect(await res.json()).toEqual({ status: 'cached' })
    expect(log.urls).toHaveLength(0)
  })

  it('상품 페이지를 받아 저장하고 done', async () => {
    const { d, log } = deps()
    const res = await handle(post({ productId: PRODUCT }), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'done' })
    expect(log.urls).toEqual(['https://prod.danawa.com/info/?pcode=5643303'])
    expect(log.saved[0].pageQty).toBe(3)
    expect(log.saved[0].offers.length).toBeGreaterThan(0)
  })

  it('HTTP 오류·파싱 실패·네트워크 오류는 이유를 남기고 502', async () => {
    for (const [fetchHtml, reason] of [
      [async () => ({ status: 503, text: '' }), 'http_503'],
      [async () => ({ status: 200, text: '<html>점검 중</html>' }), 'parse_failed'],
      [async () => { throw new TypeError('fetch failed') }, 'network_error'],
    ] as const) {
      const { d, log } = deps({ fetchHtml })
      const res = await handle(post({ productId: PRODUCT }), d)
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ status: 'error' })
      expect(log.failed).toEqual([reason])
      expect(log.saved).toHaveLength(0)
    }
  })

  it('페이지 수량을 못 읽으면 어느 수량인지 모르는 쇼핑몰 줄은 버리고 저장한다', async () => {
    const html = HTML.replace(/"name"\s*:\s*"CJ제일제당 비비고 왕교자 1\.05kg \(3개\)"/, '"name":"CJ제일제당 비비고 왕교자 1.05kg"')
    const { d, log } = deps({ fetchHtml: async () => ({ status: 200, text: html }) })
    await handle(post({ productId: PRODUCT }), d)
    expect(log.saved[0].pageQty).toBeNull()
    expect(log.saved[0].offers).toEqual([])
    expect(log.saved[0].variants.length).toBeGreaterThan(0)
  })

  it('저장이 실패하면 save_failed로 남기고 502', async () => {
    const { d, log } = deps({ save: async () => { throw new Error('db') } })
    expect((await handle(post({ productId: PRODUCT }), d)).status).toBe(502)
    expect(log.failed).toEqual(['save_failed'])
  })
})
