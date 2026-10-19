// 품목 이름으로 다나와 후보를 찾는다. 가구가 같은 이름으로 고른 적 있으면 그 상품으로 바로 잇는다.
// 다나와 검색은 robots Crawl-delay 10을 지키려고 DB 예약(reserve_fetch)으로 전역 10초 간격을 둔다.
// 응답에는 결과 종류만 싣는다(후보·가격은 DB에서 읽는다). Deno 전용 API를 쓰지 않아 Vitest로 시험한다.
import { danawaSearchUrl, DanawaParseError, parseDanawaSearch, type DanawaSearchItem } from '../_shared/danawa.ts'

export type SearchDeps = {
  /** 사용자 권한(RLS)으로 읽는다: 남의 품목이면 null */
  loadItem(itemId: string): Promise<{ id: string; name: string; spec: string | null; productId: string | null } | null>
  /** 가구 기억(name_key로 product_choices, 사용자 권한) */
  remembered(itemId: string): Promise<{ productId: string; qty: number } | null>
  /** 2분 안에 'searching'이 아니면 'searching'으로 바꾸고 true */
  claim(itemId: string, query: string, nowIso: string): Promise<boolean>
  /** reserve_fetch('danawa-search', 10000): 기다릴 ms */
  reserve(): Promise<number>
  sleep(ms: number): Promise<void>
  fetchHtml(url: string): Promise<{ status: number; text: string }>
  /** 상품 upsert + 그 품목 후보 교체, 저장한 후보 수 */
  saveCandidates(itemId: string, items: DanawaSearchItem[], foundAt: string): Promise<number>
  /** 사용자 권한으로 choose_product */
  choose(itemId: string, productId: string, qty: number): Promise<void>
  finish(itemId: string, status: 'done' | 'none' | 'error', count: number, error: string | null): Promise<void>
  now(): Date
}

export const MAX_WAIT_MS = 60_000
const MAX_QUERY = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export async function handle(req: Request, deps: SearchDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { itemId?: unknown; query?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const given = typeof body?.query === 'string' ? body.query.replace(/\s+/g, ' ').trim() : ''
  if (!UUID.test(itemId) || given.length > MAX_QUERY) return json(400, { error: 'bad_request' })

  const item = await deps.loadItem(itemId)
  if (!item) return json(403, { error: 'forbidden' })

  if (!given) {
    const mem = await deps.remembered(itemId)
    if (mem) {
      await deps.choose(itemId, mem.productId, mem.qty)
      return json(200, { status: 'remembered' })
    }
  }

  const query = given || (item.spec ? `${item.name} ${item.spec}` : item.name)
  const now = deps.now()
  if (!(await deps.claim(itemId, query, now.toISOString()))) return json(200, { status: 'skipped' })

  const wait = await deps.reserve()
  // 차례가 너무 멀면 기다리지 않는다. 'searching'은 2분 뒤 다시 잡을 수 있으니 끝내지 않는다.
  if (wait > MAX_WAIT_MS) return json(202, { status: 'busy' })
  if (wait > 0) await deps.sleep(wait)

  let res: { status: number; text: string }
  try {
    res = await deps.fetchHtml(danawaSearchUrl(query))
  } catch {
    await deps.finish(itemId, 'error', 0, 'network_error')
    return json(502, { status: 'error' })
  }
  if (res.status !== 200) {
    await deps.finish(itemId, 'error', 0, `http_${res.status}`)
    return json(502, { status: 'error' })
  }
  let items: DanawaSearchItem[]
  try {
    items = parseDanawaSearch(res.text)
  } catch (e) {
    await deps.finish(itemId, 'error', 0, e instanceof DanawaParseError ? 'parse_failed' : 'parse_error')
    return json(502, { status: 'error' })
  }
  if (items.length === 0) {
    await deps.finish(itemId, 'none', 0, null)
    return json(200, { status: 'none' })
  }
  let count: number
  try {
    count = await deps.saveCandidates(itemId, items, deps.now().toISOString())
  } catch {
    await deps.finish(itemId, 'error', 0, 'save_failed')
    return json(502, { status: 'error' })
  }
  await deps.finish(itemId, 'done', count, null)
  return json(200, { status: 'done' })
}
