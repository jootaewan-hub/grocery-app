import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseStore, rowToItem } from '../src/lib/supabaseStore'
import { createMemoryStore } from '../src/lib/store'
import { demoSeed } from '../src/demo'

const me = { userId: 'u1', householdId: 'h' }

describe('메모리 저장소', () => {
  it('담으면 목록에 나오고 담은 사람·시각이 채워진다', async () => {
    const s = createMemoryStore([], me, () => '2026-10-16T10:00:00Z')
    await s.add([{ name: '대파', spec: null, count: 1, category: '채소', specIsDefault: false }])
    expect(await s.list()).toMatchObject([{ name: '대파', addedBy: 'u1', addedAt: '2026-10-16T10:00:00Z', boughtAt: null }])
  })
  it('체크하면 산 사람·시각, 풀면 둘 다 지운다', async () => {
    const s = createMemoryStore([], me, () => 't')
    await s.add([{ name: '대파', spec: null, count: 1, category: '채소', specIsDefault: false }])
    const [it1] = await s.list()
    await s.setBought(it1.id, true)
    expect((await s.list())[0]).toMatchObject({ boughtBy: 'u1', boughtAt: 't' })
    await s.setBought(it1.id, false)
    expect((await s.list())[0]).toMatchObject({ boughtBy: null, boughtAt: null, paid: null })
  })
  it('바뀔 때마다 구독자에게 알리고, 해제하면 멈춘다', async () => {
    const s = createMemoryStore([], me)
    let n = 0
    const off = s.subscribe(() => n++)
    await s.add([{ name: 'a', spec: null, count: 1, category: '기타', specIsDefault: false }])
    off()
    await s.add([{ name: 'b', spec: null, count: 1, category: '기타', specIsDefault: false }])
    expect(n).toBe(1)
  })
  it('삭제하면 목록에서 빠진다', async () => {
    const s = createMemoryStore([], me)
    await s.add([{ name: 'a', spec: null, count: 1, category: '기타', specIsDefault: false }, { name: 'b', spec: null, count: 1, category: '기타', specIsDefault: false }])
    const [a] = await s.list()
    await s.remove(a.id)
    expect((await s.list()).map((i) => i.name)).toEqual(['b'])
  })
  it('list()는 복사본을 돌려줘 바깥에서 고쳐도 저장소가 바뀌지 않는다', async () => {
    const s = createMemoryStore([], me)
    await s.add([{ name: 'a', spec: null, count: 1, category: '기타', specIsDefault: false }])
    const l = await s.list()
    l[0].name = '바뀜'
    l.pop()
    expect((await s.list())[0].name).toBe('a')
  })
})

describe('경고', () => {
  it('메모리 저장소는 받은 데모 경고를 돌려주고, 없으면 비어 있다', async () => {
    const d = demoSeed()
    const s = createMemoryStore(d.items, d.me, undefined, d.alerts)
    const a = await s.alerts()
    expect([...a.levels.entries()]).toEqual([['demo-item-6', 'similar']])
    expect(a.byItem.get('demo-item-6')![0]).toMatchObject({ source: 'I0490', productName: '○○ 냉동볶음밥 300g' })
    expect(Object.keys(a.syncedAt).sort()).toEqual(['I0490', 'I2620', 'I2715'])
    const empty = await createMemoryStore([], me).alerts()
    expect(empty.levels.size).toBe(0)
    expect(empty.syncedAt).toEqual({})
  })
})

describe('demoSeed', () => {
  it('두 사람과 품목이 있고 산 품목은 하나다', () => {
    const d = demoSeed()
    expect(d.me.members.map((m) => m.spouseRole)).toEqual(['husband', 'wife'])
    expect(d.items.filter((i) => i.boughtAt)).toHaveLength(1)
    expect(d.items.every((i) => i.paid === null && i.productKey === null)).toBe(true)
  })
})

describe('rowToItem', () => {
  const base = {
    id: 'i', household_id: 'h', name: '대파', spec: null, count: 1, category: '채소',
    product_key: null, added_by: null, added_at: 't', bought_by: null, bought_at: null, paid: null,
  }
  it('null 열을 그대로 camelCase로 옮긴다', () => {
    expect(rowToItem(base)).toEqual({
      id: 'i', householdId: 'h', name: '대파', spec: null, count: 1, category: '채소',
      productKey: null, addedBy: null, addedAt: 't', boughtBy: null, boughtAt: null, paid: null,
    })
  })
  it('문자열로 온 paid는 숫자로 바꾼다', () => {
    expect(rowToItem({ ...base, bought_by: 'u', bought_at: 't', paid: '3480' as unknown as number }).paid).toBe(3480)
  })
})

describe('Supabase 구독', () => {
  function fake() {
    const calls: { name: string; ons: { event: string; filter?: string }[] }[] = []
    const removed: unknown[] = []
    const client = {
      channel(name: string) {
        const rec = { name, ons: [] as { event: string; filter?: string }[] }
        calls.push(rec)
        const ch = {
          on(_t: string, cfg: { event: string; filter?: string }) { rec.ons.push(cfg); return ch },
          subscribe() { return ch },
        }
        return ch
      },
      removeChannel(ch: unknown) { removed.push(ch); return Promise.resolve('ok') },
    }
    return { calls, removed, client: client as unknown as SupabaseClient }
  }
  const mem = { userId: 'u', householdId: 'h', members: [] }
  it('구독마다 다른 채널 이름, INSERT·UPDATE만 필터, 해제하면 채널을 지운다', () => {
    const { calls, removed, client } = fake()
    const s = createSupabaseStore(client, mem)
    const off = s.subscribe(() => {})
    s.subscribe(() => {})
    expect(calls[0].name).not.toBe(calls[1].name)
    expect(calls[0].ons).toMatchObject([
      { event: 'INSERT', filter: 'household_id=eq.h' },
      { event: 'UPDATE', filter: 'household_id=eq.h' },
      { event: 'DELETE' },
    ])
    expect(calls[0].ons[2].filter).toBeUndefined()
    off()
    expect(removed).toHaveLength(1)
  })
})
