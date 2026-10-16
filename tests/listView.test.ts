import { describe, expect, it } from 'vitest'
import type { Item } from '../src/lib/types'
import { groupByCategory, groupByWhere, summarize } from '../src/lib/listView'

function item(partial: Partial<Item>): Item {
  return {
    id: 'x', householdId: 'h', name: '품목', spec: null, count: 1, category: '기타',
    productKey: null, addedBy: 'u', addedAt: '2026-10-16T09:00:00Z', boughtBy: null, boughtAt: null, paid: null,
    ...partial,
  }
}

describe('listView', () => {
  it('분류 순서대로 묶고 빈 분류는 없다', () => {
    const s = groupByCategory([item({ id: '1', category: '채소' }), item({ id: '2', category: '정육' })], new Map())
    expect(s.map((x) => x.key)).toEqual(['정육', '채소'])
  })
  it('경고 품목은 먼저 볼 것에만', () => {
    const s = groupByCategory([item({ id: '1', category: '냉동' }), item({ id: '2', category: '냉동' })], new Map([['2', 'similar']]))
    expect(s[0]).toMatchObject({ key: 'alert', title: '먼저 볼 것' })
    expect(s[0].items.map((i) => i.id)).toEqual(['2'])
    expect(s[1].items.map((i) => i.id)).toEqual(['1'])
  })
  it('산 것은 섹션 끝으로', () => {
    const s = groupByCategory([item({ id: '1', boughtAt: '2026-10-16T10:00:00Z' }), item({ id: '2' })], new Map())
    expect(s[0].items.map((i) => i.id)).toEqual(['2', '1'])
  })
  it('같은 그룹 안은 addedAt 순', () => {
    const s = groupByCategory([item({ id: '1', addedAt: '2026-10-16T11:00:00Z' }), item({ id: '2', addedAt: '2026-10-16T08:00:00Z' })], new Map())
    expect(s[0].items.map((i) => i.id)).toEqual(['2', '1'])
  })
  it('온라인이 더 쌀 때만 온라인으로, 비교 못 하면 마트', () => {
    const prices = new Map([['1', { onlineBest: 9000, storeBase: 10000 }], ['2', { onlineBest: 9000, storeBase: null }], ['3', { onlineBest: 11000, storeBase: 10000 }]])
    const s = groupByWhere([item({ id: '1' }), item({ id: '2' }), item({ id: '3' })], new Map(), prices)
    expect(s.find((x) => x.key === 'online')!.items.map((i) => i.id)).toEqual(['1'])
    expect(s.find((x) => x.key === 'store')!.items.map((i) => i.id)).toEqual(['2', '3'])
  })
  it('어디서 살지: 경고 먼저, 빈 섹션은 없다', () => {
    const prices = new Map([['1', { onlineBest: 9000, storeBase: 10000 }]])
    const s = groupByWhere([item({ id: '1' }), item({ id: '2' })], new Map([['1', 'record']]), prices)
    expect(s.map((x) => x.key)).toEqual(['alert', 'store'])
  })
  it('가격이 하나도 없으면 합계는 null, 확인 못 함은 살 것 수와 같다', () => {
    expect(summarize([item({ id: '1' }), item({ id: '2' })], new Map())).toEqual({ toBuy: 2, lowestTotal: null, unknown: 2 })
  })
  it('합계는 개수를 곱하고 산 것은 뺀다', () => {
    const prices = new Map([['1', { onlineBest: 1000, storeBase: null }], ['2', { onlineBest: 500, storeBase: null }]])
    expect(summarize([item({ id: '1', count: 2 }), item({ id: '2', boughtAt: 'x' })], prices)).toEqual({ toBuy: 1, lowestTotal: 2000, unknown: 0 })
  })
})
