import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DanawaSearchItem } from '../supabase/functions/_shared/danawa'
import { handle, MAX_WAIT_MS, type SearchDeps } from '../supabase/functions/product-search/handle'

const ITEM = '11111111-1111-4111-8111-111111111111'
const SEARCH_HTML = readFileSync(new URL('./fixtures/danawa/search-bibigo.html', import.meta.url), 'utf8')
const NONE_HTML = readFileSync(new URL('./fixtures/danawa/search-none.html', import.meta.url), 'utf8')

function deps(over: Partial<SearchDeps> = {}) {
  const log = {
    urls: [] as string[],
    slept: [] as number[],
    saved: [] as DanawaSearchItem[][],
    chosen: [] as [string, string, number][],
    finished: [] as [string, string, number, string | null][],
    claims: [] as [string, string][],
  }
  const d: SearchDeps = {
    loadItem: async (id) => ({ id, name: '비비고 왕교자', spec: '1.05kg', productId: null, category: '냉동' }),
    remembered: async () => null,
    claim: async (id, q) => {
      log.claims.push([id, q])
      return true
    },
    reserve: async () => 0,
    sleep: async (ms) => {
      log.slept.push(ms)
    },
    fetchHtml: async (url) => {
      log.urls.push(url)
      return { status: 200, text: SEARCH_HTML }
    },
    saveCandidates: async (_id, items) => {
      log.saved.push(items)
      return items.length
    },
    choose: async (id, p, q) => {
      log.chosen.push([id, p, q])
    },
    finish: async (id, status, count, error) => {
      log.finished.push([id, status, count, error])
    },
    now: () => new Date('2026-10-20T01:00:00Z'),
    ...over,
  }
  return { d, log }
}

const post = (body: unknown) =>
  new Request('https://x/functions/v1/product-search', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('product-search: 입력과 권한', () => {
  it('POST가 아니면 405', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
  })

  it('itemId가 uuid가 아니거나 본문이 JSON이 아니면 400', async () => {
    const { d, log } = deps()
    expect((await handle(post({ itemId: 'abc' }), d)).status).toBe(400)
    expect((await handle(post('not json'), d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM, query: 'x'.repeat(61) }), d)).status).toBe(400)
    expect(log.urls).toHaveLength(0)
  })

  it('남의 품목(loadItem null)이면 403이고 다나와를 부르지 않는다', async () => {
    const { d, log } = deps({ loadItem: async () => null })
    expect((await handle(post({ itemId: ITEM }), d)).status).toBe(403)
    expect(log.urls).toHaveLength(0)
    expect(log.claims).toHaveLength(0)
  })
})

describe('product-search: 기억과 중복', () => {
  it('가구 기억이 있으면 choose로 연결하고 remembered, 검색하지 않는다', async () => {
    const { d, log } = deps({ remembered: async () => ({ productId: 'p1', qty: 3 }) })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'remembered' })
    expect(log.chosen).toEqual([[ITEM, 'p1', 3]])
    expect(log.urls).toHaveLength(0)
  })

  it('검색어를 직접 주면(다시 검색) 기억을 쓰지 않고 그 검색어로 찾는다', async () => {
    const { d, log } = deps({ remembered: async () => ({ productId: 'p1', qty: 3 }) })
    await handle(post({ itemId: ITEM, query: '  비비고 김치왕교자 ' }), d)
    expect(log.chosen).toHaveLength(0)
    expect(log.claims).toEqual([[ITEM, '비비고 김치왕교자']])
    expect(log.urls).toEqual(['https://search.danawa.com/?query=%EB%B9%84%EB%B9%84%EA%B3%A0%20%EA%B9%80%EC%B9%98%EC%99%95%EA%B5%90%EC%9E%90'])
  })

  it('신선 품목(정육·수산·채소·과일)은 다나와에서 찾지 않고 fresh로 끝낸다', async () => {
    const { d, log } = deps({ loadItem: async (id) => ({ id, name: '당근', spec: null, productId: null, category: '채소' }) })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(await res.json()).toEqual({ status: 'fresh' })
    expect(log.claims).toHaveLength(0)
    expect(log.urls).toHaveLength(0)
  })

  it('2분 안에 이미 찾는 중이면(claim false) skipped, 다나와를 부르지 않는다', async () => {
    const { d, log } = deps({ claim: async () => false })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(await res.json()).toEqual({ status: 'skipped' })
    expect(log.urls).toHaveLength(0)
  })

  it('검색어는 이름 + 규격, 규격이 없으면 이름만', async () => {
    const a = deps()
    await handle(post({ itemId: ITEM }), a.d)
    expect(a.log.claims[0][1]).toBe('비비고 왕교자 1.05kg')
    const b = deps({ loadItem: async (id) => ({ id, name: '우유', spec: null, productId: null, category: '유제품' }) })
    await handle(post({ itemId: ITEM }), b.d)
    expect(b.log.claims[0][1]).toBe('우유')
  })
})

describe('product-search: 다나와 간격', () => {
  it('예약 대기만큼 잠든 뒤 부른다', async () => {
    const order: string[] = []
    const { d } = deps({
      reserve: async () => 7000,
      sleep: async (ms) => {
        order.push(`sleep ${ms}`)
      },
      fetchHtml: async () => {
        order.push('fetch')
        return { status: 200, text: SEARCH_HTML }
      },
    })
    await handle(post({ itemId: ITEM }), d)
    expect(order).toEqual(['sleep 7000', 'fetch'])
  })

  it('차례가 한도 밖이면(reserve -1) 202 busy, 부르지 않고 찾는 중을 풀어 다시 시도할 수 있게 한다', async () => {
    let asked: number | null = null
    const { d, log } = deps({ reserve: async (max) => { asked = max; return -1 } })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(asked).toBe(MAX_WAIT_MS)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'busy' })
    expect(log.urls).toHaveLength(0)
    expect(log.finished).toEqual([[ITEM, 'error', 0, 'busy']])
  })
})

describe('product-search: 결과', () => {
  it('저장한 후보 수를 done으로 남기고 응답에는 상태만 싣는다', async () => {
    const { d, log } = deps()
    const res = await handle(post({ itemId: ITEM }), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'done' })
    expect(log.saved[0]).toHaveLength(8)
    expect(log.finished).toEqual([[ITEM, 'done', 8, null]])
  })

  it('결과 0개면 none, 후보 저장 안 함', async () => {
    const { d, log } = deps({ fetchHtml: async () => ({ status: 200, text: NONE_HTML }) })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(await res.json()).toEqual({ status: 'none' })
    expect(log.saved).toHaveLength(0)
    expect(log.finished).toEqual([[ITEM, 'none', 0, null]])
  })

  it('HTTP 200이 아니면 error(http_<n>)이고 502', async () => {
    const { d, log } = deps({ fetchHtml: async () => ({ status: 403, text: '' }) })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ status: 'error' })
    expect(log.finished).toEqual([[ITEM, 'error', 0, 'http_403']])
  })

  it('구조가 바뀌어 못 읽으면 error(parse_failed)', async () => {
    const { d, log } = deps({ fetchHtml: async () => ({ status: 200, text: '<html><body>점검 중</body></html>' }) })
    expect((await handle(post({ itemId: ITEM }), d)).status).toBe(502)
    expect(log.finished).toEqual([[ITEM, 'error', 0, 'parse_failed']])
  })

  it('수량이 1~99 밖인 줄은 빼고, 남는 줄이 없는 상품은 빼고 저장한다', async () => {
    const html = SEARCH_HTML
      .replace('>1개<', '>120개<') // 첫 상품 7809349의 유일한 줄
    const { d, log } = deps({ fetchHtml: async () => ({ status: 200, text: html }) })
    await handle(post({ itemId: ITEM }), d)
    const saved = log.saved[0]
    expect(saved.every((i) => i.variants.length > 0 && i.variants.every((v) => v.qty >= 1 && v.qty <= 99))).toBe(true)
    expect(saved.some((i) => i.pcode === '7809349')).toBe(false)
    expect(log.finished[0][1]).toBe('done')
  })

  it('후보 저장이 실패하면 error(save_failed)로 끝낸다', async () => {
    const { d, log } = deps({ saveCandidates: async () => { throw new Error('db down') } })
    expect((await handle(post({ itemId: ITEM }), d)).status).toBe(502)
    expect(log.finished).toEqual([[ITEM, 'error', 0, 'save_failed']])
  })

  it('네트워크 오류는 error(network_error)', async () => {
    const { d, log } = deps({ fetchHtml: async () => { throw new TypeError('fetch failed') } })
    expect((await handle(post({ itemId: ITEM }), d)).status).toBe(502)
    expect(log.finished).toEqual([[ITEM, 'error', 0, 'network_error']])
  })

  it('특수문자뿐인 검색어도 그대로 인코딩해 부르고, 결과가 없으면 none', async () => {
    const { d, log } = deps({
      loadItem: async (id) => ({ id, name: '%%&&', spec: null, productId: null, category: '기타' }),
      fetchHtml: async (url) => {
        log.urls.push(url)
        return { status: 200, text: NONE_HTML }
      },
    })
    expect(await (await handle(post({ itemId: ITEM }), d)).json()).toEqual({ status: 'none' })
    expect(log.urls).toEqual(['https://search.danawa.com/?query=%25%25%26%26'])
  })
})
