import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/lib/store'
import { demoSeed } from '../src/demo'

const me = { userId: 'u1', householdId: 'h' }

describe('메모리 저장소', () => {
  it('담으면 목록에 나오고 담은 사람·시각이 채워진다', async () => {
    const s = createMemoryStore([], me, () => '2026-10-16T10:00:00Z')
    await s.add([{ name: '대파', spec: null, count: 1, category: '채소' }])
    expect(await s.list()).toMatchObject([{ name: '대파', addedBy: 'u1', addedAt: '2026-10-16T10:00:00Z', boughtAt: null }])
  })
  it('체크하면 산 사람·시각, 풀면 둘 다 지운다', async () => {
    const s = createMemoryStore([], me, () => 't')
    await s.add([{ name: '대파', spec: null, count: 1, category: '채소' }])
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
    await s.add([{ name: 'a', spec: null, count: 1, category: '기타' }])
    off()
    await s.add([{ name: 'b', spec: null, count: 1, category: '기타' }])
    expect(n).toBe(1)
  })
  it('삭제하면 목록에서 빠진다', async () => {
    const s = createMemoryStore([], me)
    await s.add([{ name: 'a', spec: null, count: 1, category: '기타' }, { name: 'b', spec: null, count: 1, category: '기타' }])
    const [a] = await s.list()
    await s.remove(a.id)
    expect((await s.list()).map((i) => i.name)).toEqual(['b'])
  })
  it('list()는 복사본을 돌려줘 바깥에서 고쳐도 저장소가 바뀌지 않는다', async () => {
    const s = createMemoryStore([], me)
    await s.add([{ name: 'a', spec: null, count: 1, category: '기타' }])
    const l = await s.list()
    l[0].name = '바뀜'
    l.pop()
    expect((await s.list())[0].name).toBe('a')
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
