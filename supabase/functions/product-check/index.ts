// Edge Function 진입점: 고른 상품의 다나와 가격 확인. 권한 확인은 사용자 권한(RLS), 저장은 서비스 롤로 한다.
import { admin, cors, fetchHtml, userClient, withCors } from '../_shared/edge.ts'
import { handle } from './handle.ts'

const g = () => admin.schema('grocery')
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const user = userClient(req).schema('grocery')
  const res = await handle(req, {
    allowed: async (productId) => {
      const { data, error } = await user.from('items').select('id').eq('product_id', productId).limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
    product: async (id) => {
      const { data, error } = await g().from('products').select('id, source_id').eq('id', id).maybeSingle()
      if (error) throw error
      return data ? { id: data.id, sourceId: data.source_id } : null
    },
    todayOk: async (id) => {
      const { data, error } = await g().from('price_checks').select('id').eq('product_id', id).eq('ok', true)
        .eq('checked_on', kstToday()).limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
    fetchHtml,
    save: async (id, p, at) => {
      // 평점을 못 읽었으면 이전 평점과 그 시각을 그대로 둔다
      const patch = p.rating === null ? { updated_at: at } : { rating: p.rating, review_count: p.reviewCount, rated_at: at, updated_at: at }
      const up = await g().from('products').update(patch).eq('id', id)
      if (up.error) throw up.error
      const { data: check, error } = await g().from('price_checks')
        .insert({ product_id: id, source: 'danawa', checked_at: at, ok: true, page_qty: p.pageQty })
        .select('id').single()
      if (error) throw error
      const rows = [
        ...p.variants.map((v) => ({
          check_id: check.id, product_id: id, qty: v.qty, seller: null, price: v.price, delivery: null,
          unit_price: v.unitPrice, unit_label: v.unitLabel, mall_count: v.mallCount,
        })),
        ...(p.pageQty === null ? [] : p.offers.map((o) => ({
          check_id: check.id, product_id: id, qty: p.pageQty, seller: o.seller, price: o.price, delivery: o.delivery,
          unit_price: null, unit_label: null, mall_count: null,
        }))),
      ]
      const ins = await g().from('price_quotes').insert(rows)
      if (ins.error) {
        // 줄 없는 성공 기록이 남아 오늘 캐시로 쓰이지 않게 방금 넣은 확인을 지운다
        await g().from('price_checks').delete().eq('id', check.id)
        throw ins.error
      }
    },
    fail: async (id, err, at) => {
      const { error } = await g().from('price_checks').insert({ product_id: id, source: 'danawa', checked_at: at, ok: false, error: err })
      if (error) console.error('price_checks 기록 실패', error.message)
    },
    now: () => new Date(),
  }).catch((e) => {
    console.error('product-check 실패', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  })
  return withCors(res)
})
