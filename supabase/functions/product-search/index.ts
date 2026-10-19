// Edge Function 진입점: 다나와 후보 찾기. 사용자 권한으로 품목·기억·고르기를, 서비스 롤로 상태·후보 저장을 한다.
import { admin, cors, fetchHtml, userClient, withCors } from '../_shared/edge.ts'
import { handle } from './handle.ts'

const g = () => admin.schema('grocery')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const user = userClient(req).schema('grocery')
  const res = await handle(req, {
    loadItem: async (id) => {
      const { data, error } = await user.from('items').select('id, name, spec, product_id').eq('id', id).maybeSingle()
      if (error) throw error
      return data ? { id: data.id, name: data.name, spec: data.spec, productId: data.product_id } : null
    },
    remembered: async (id) => {
      const { data, error } = await user.rpc('remembered_product', { p_item: id })
      if (error) throw error
      const row = (data ?? [])[0]
      return row ? { productId: row.product_id, qty: row.qty } : null
    },
    claim: async (id, query, nowIso) => {
      const { data, error } = await g().rpc('claim_search', { p_item: id, p_query: query, p_now: nowIso })
      if (error) throw error
      return data === true
    },
    reserve: async () => {
      const { data, error } = await g().rpc('reserve_fetch', { p_key: 'danawa-search', p_gap_ms: 10_000 })
      if (error) throw error
      return Number(data)
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fetchHtml,
    saveCandidates: async (itemId, items, foundAt) => {
      const { data: products, error } = await g()
        .from('products')
        .upsert(
          items.map((i) => ({
            source: 'danawa', source_id: i.pcode, name: i.name, image_url: i.imageUrl,
            rating: i.rating, review_count: i.reviewCount, updated_at: foundAt,
          })),
          { onConflict: 'source,source_id' },
        )
        .select('id, source_id')
      if (error) throw error
      const idOf = new Map((products ?? []).map((p) => [p.source_id, p.id]))
      const rows = items.flatMap((i, rank) =>
        i.variants.map((v) => ({
          item_id: itemId, product_id: idOf.get(i.pcode), qty: v.qty, price: v.price, unit_price: v.unitPrice,
          unit_label: v.unitLabel, mall_count: v.mallCount, rank, found_at: foundAt,
        })),
      ).filter((r) => r.product_id)
      const del = await g().from('item_candidates').delete().eq('item_id', itemId)
      if (del.error) throw del.error
      const ins = await g().from('item_candidates').insert(rows)
      if (ins.error) throw ins.error
      return items.length
    },
    choose: async (id, productId, qty) => {
      const { error } = await user.rpc('choose_product', { p_item: id, p_product: productId, p_qty: qty })
      if (error) throw error
    },
    finish: async (id, status, count, err) => {
      const { error } = await g().from('item_searches')
        .update({ status, candidate_count: count, error: err, updated_at: new Date().toISOString() })
        .eq('item_id', id)
      if (error) console.error('item_searches 기록 실패', error.message)
    },
    now: () => new Date(),
  }).catch((e) => {
    console.error('product-search 실패', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  })
  return withCors(res)
})
