import type { Item } from './types'
import type { ParsedItem } from './parse'
import { EMPTY_ALERTS, type AlertsResult } from './alerts'
import {
  kstDay,
  splitLines,
  type Candidate,
  type ItemDetailData,
  type ItemExtras,
  type ItemPrice,
  type ItemSearch,
  type PriceLine,
  type SearchResult,
} from './products'

export interface ListStore {
  list(): Promise<Item[]>
  /** 만든 품목을 돌려준다(담은 뒤 후보 찾기를 바로 시작하려고) */
  add(items: ParsedItem[]): Promise<Item[]>
  setBought(id: string, bought: boolean): Promise<void>
  remove(id: string): Promise<void>
  subscribe(onChange: () => void): () => void
  /** 내 가구 품목과 비슷한 식약처 기록과 확인 시각 */
  alerts(): Promise<AlertsResult>
  /** 품목별 후보 찾기 상태, 오늘 최저가, 고른 상품명 */
  extras(): Promise<ItemExtras>
  candidates(itemId: string): Promise<Candidate[]>
  /** 다나와에서 후보를 찾는다(product-search). 결과 종류를 돌려주고, 실패는 던진다 */
  findCandidates(itemId: string, query?: string): Promise<SearchResult>
  choose(itemId: string, productId: string, qty: number): Promise<void>
  /** 고른 상품의 다나와 가격을 확인한다(product-check). 같은 날은 서버가 캐시를 쓴다 */
  checkPrice(itemId: string): Promise<void>
  detail(itemId: string): Promise<ItemDetailData>
}

/** 개발용 데모 화면에서 쓰는 가격 확인 자료(실제 가격 아님) */
export type DemoPrices = {
  searches: Record<string, ItemSearch>
  candidates: Record<string, Candidate[]>
  products: Record<string, NonNullable<ItemDetailData['product']>>
  /** 상품 id → 가격 줄 */
  lines: Record<string, PriceLine[]>
}

const NO_PRICES: DemoPrices = { searches: {}, candidates: {}, products: {}, lines: {} }

// 메모리 구현: 테스트와 개발용 데모 화면에서 쓴다(저장되지 않음).
export function createMemoryStore(
  seed: Item[],
  me: { userId: string; householdId: string },
  now: () => string = () => new Date().toISOString(),
  demoAlerts: AlertsResult = EMPTY_ALERTS,
  demoPrices: DemoPrices = NO_PRICES,
): ListStore {
  let items: Item[] = seed.map((i) => ({ ...i }))
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((fn) => fn())

  return {
    async list() {
      return items.map((i) => ({ ...i }))
    },
    async add(parsed) {
      const at = now()
      const added = parsed.map(
        (p): Item => ({
          id: crypto.randomUUID(),
          householdId: me.householdId,
          name: p.name,
          spec: p.spec,
          count: p.count,
          category: p.category,
          productKey: null,
          productQty: null,
          addedBy: me.userId,
          addedAt: at,
          boughtBy: null,
          boughtAt: null,
          paid: null,
        }),
      )
      items = [...items, ...added]
      notify()
      return added.map((i) => ({ ...i }))
    },
    async setBought(id, bought) {
      items = items.map((i) =>
        i.id !== id
          ? i
          : bought
            ? { ...i, boughtBy: me.userId, boughtAt: now() }
            : { ...i, boughtBy: null, boughtAt: null, paid: null },
      )
      notify()
    },
    async remove(id) {
      items = items.filter((i) => i.id !== id)
      notify()
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    async alerts() {
      return demoAlerts
    },
    async extras() {
      const today = kstDay(new Date().toISOString())
      const prices = new Map<string, ItemPrice>()
      const productNames = new Map<string, string>()
      for (const i of items) {
        if (!i.productKey || i.productQty === null) continue
        const name = demoPrices.products[i.productKey]?.name
        if (name) productNames.set(i.id, name)
        if (i.boughtAt) continue
        const best = splitLines(demoPrices.lines[i.productKey] ?? [], i.productQty, today).best
        if (best) prices.set(i.id, best)
      }
      return { searches: new Map(Object.entries(demoPrices.searches)), prices, productNames }
    },
    async candidates(itemId) {
      return demoPrices.candidates[itemId] ?? []
    },
    async findCandidates() {
      return 'done' as const
    },
    async choose(itemId, productId, qty) {
      items = items.map((i) => (i.id === itemId ? { ...i, productKey: productId, productQty: qty } : i))
      notify()
    },
    async checkPrice() {},
    async detail(itemId) {
      const it = items.find((i) => i.id === itemId)
      const product = it?.productKey ? (demoPrices.products[it.productKey] ?? null) : null
      const lines = it?.productKey ? (demoPrices.lines[it.productKey] ?? []) : []
      const last = lines.map((l) => l.checkedAt).sort().at(-1)
      return {
        product,
        check: last ? { checkedAt: last, ok: true, error: null } : null,
        lines,
        safety: (demoAlerts.byItem.get(itemId) ?? []).map((a) => ({ ...a, via: 'item_name' as const, farm: false })),
        syncedAt: demoAlerts.syncedAt,
      }
    },
  }
}
