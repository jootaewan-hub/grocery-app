// 고른 상품의 다나와 상품 페이지에서 수량별 최저가·쇼핑몰별 최저가·평점을 읽어 저장한다.
// 같은 상품을 오늘(한국 시간) 이미 확인했으면 다시 받지 않는다. 내 가구가 고른 상품만 확인한다.
// 쇼핑몰 줄은 페이지 수량(pageQty) 기준이라, 그 수량을 못 읽으면 어느 수량인지 모르는 값이므로 버린다.
import { danawaProductUrl, DanawaParseError, parseDanawaProduct, type DanawaProduct } from '../_shared/danawa.ts'

export type CheckDeps = {
  /** 사용자 권한: 내 가구 품목 중 이 상품을 고른 것이 있는가 */
  allowed(productId: string): Promise<boolean>
  product(productId: string): Promise<{ id: string; sourceId: string } | null>
  /** 오늘(한국 시간) 성공한 확인이 있는가 */
  todayOk(productId: string): Promise<boolean>
  fetchHtml(url: string): Promise<{ status: number; text: string }>
  /** products 평점 갱신 + price_checks(ok) + price_quotes */
  save(productId: string, p: DanawaProduct, checkedAt: string): Promise<void>
  /** price_checks(ok = false) */
  fail(productId: string, error: string, checkedAt: string): Promise<void>
  now(): Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export async function handle(req: Request, deps: CheckDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { productId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  if (!UUID.test(productId)) return json(400, { error: 'bad_request' })
  if (!(await deps.allowed(productId))) return json(403, { error: 'forbidden' })
  const product = await deps.product(productId)
  if (!product) return json(404, { error: 'not_found' })
  if (await deps.todayOk(productId)) return json(200, { status: 'cached' })

  const at = deps.now().toISOString()
  const failWith = async (reason: string) => {
    await deps.fail(productId, reason, at)
    return json(502, { status: 'error' })
  }
  let res: { status: number; text: string }
  try {
    res = await deps.fetchHtml(danawaProductUrl(product.sourceId))
  } catch {
    return failWith('network_error')
  }
  if (res.status !== 200) return failWith(`http_${res.status}`)
  let parsed: DanawaProduct
  try {
    parsed = parseDanawaProduct(res.text, product.sourceId)
  } catch (e) {
    return failWith(e instanceof DanawaParseError ? 'parse_failed' : 'parse_error')
  }
  if (parsed.pageQty === null) parsed = { ...parsed, offers: [] }
  // 가격 줄을 하나도 못 읽었으면 성공으로 저장하지 않는다(구조 변경이 하루 종일 캐시로 숨지 않게)
  if (parsed.variants.length === 0 && parsed.offers.length === 0) return failWith('parse_empty')
  try {
    await deps.save(productId, parsed, at)
  } catch {
    return failWith('save_failed')
  }
  return json(200, { status: 'done' })
}
