import type { Item } from './types'
import type { ParsedItem } from './parse'

export interface ListStore {
  list(): Promise<Item[]>
  add(items: ParsedItem[]): Promise<void>
  setBought(id: string, bought: boolean): Promise<void>
  remove(id: string): Promise<void>
  subscribe(onChange: () => void): () => void
}

// 메모리 구현: 테스트와 개발용 데모 화면에서 쓴다(저장되지 않음).
export function createMemoryStore(
  seed: Item[],
  me: { userId: string; householdId: string },
  now: () => string = () => new Date().toISOString(),
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
          addedBy: me.userId,
          addedAt: at,
          boughtBy: null,
          boughtAt: null,
          paid: null,
        }),
      )
      items = [...items, ...added]
      notify()
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
  }
}
