import { CATEGORIES } from './categories'
import type { AlertLevel, Item, PriceCompare } from './types'

export type Section = { key: string; title: string; items: Item[] }

// 안 산 것이 먼저, 산 것은 뒤. 같은 그룹 안은 addedAt 순(원래 순서는 유지).
function order(items: Item[]): Item[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ba = a.it.boughtAt ? 1 : 0
      const bb = b.it.boughtAt ? 1 : 0
      if (ba !== bb) return ba - bb
      if (a.it.addedAt !== b.it.addedAt) return a.it.addedAt < b.it.addedAt ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.it)
}

function section(key: string, title: string, items: Item[]): Section[] {
  return items.length === 0 ? [] : [{ key, title, items: order(items) }]
}

function split(items: Item[], alerts: ReadonlyMap<string, AlertLevel>) {
  const flagged: Item[] = []
  const rest: Item[] = []
  for (const it of items) (alerts.has(it.id) ? flagged : rest).push(it)
  return { flagged, rest }
}

export function groupByCategory(items: Item[], alerts: ReadonlyMap<string, AlertLevel>): Section[] {
  const { flagged, rest } = split(items, alerts)
  return [
    ...section('alert', '먼저 볼 것', flagged),
    ...CATEGORIES.flatMap((c) => section(c, c, rest.filter((it) => it.category === c))),
  ]
}

export function groupByWhere(
  items: Item[],
  alerts: ReadonlyMap<string, AlertLevel>,
  prices: ReadonlyMap<string, PriceCompare>,
): Section[] {
  const { flagged, rest } = split(items, alerts)
  const online: Item[] = []
  const store: Item[] = []
  for (const it of rest) {
    const p = prices.get(it.id)
    const cheaper = p != null && p.onlineBest != null && p.storeBase != null && p.onlineBest < p.storeBase
    ;(cheaper ? online : store).push(it)
  }
  return [
    ...section('alert', '먼저 볼 것', flagged),
    ...section('online', '온라인이 더 싼 것', online),
    ...section('store', '마트에서 살 것', store),
  ]
}

export function summarize(
  items: Item[],
  prices: ReadonlyMap<string, PriceCompare>,
): { toBuy: number; lowestTotal: number | null; unknown: number } {
  let toBuy = 0
  let unknown = 0
  let total = 0
  let known = 0
  for (const it of items) {
    if (it.boughtAt) continue
    toBuy++
    const best = prices.get(it.id)?.onlineBest
    if (best == null) unknown++
    else {
      known++
      total += best * it.count
    }
  }
  return { toBuy, lowestTotal: known === 0 ? null : total, unknown }
}
