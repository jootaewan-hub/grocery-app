// 데모 데이터: 개발 중 화면 캡처 전용이다. 실제 가격·기록이 아니며 운영 화면에 쓰지 않는다.
import type { Membership } from './lib/session'
import type { Item } from './lib/types'

const H = 'demo'
const HUSBAND = 'demo-husband'
const WIFE = 'demo-wife'

export function demoSeed(): { me: Membership; items: Item[] } {
  const me: Membership = {
    userId: HUSBAND,
    householdId: H,
    members: [
      { userId: HUSBAND, displayName: '남편', spouseRole: 'husband' },
      { userId: WIFE, displayName: '아내', spouseRole: 'wife' },
    ],
  }
  const mk = (
    n: number,
    name: string,
    spec: string | null,
    count: number,
    category: Item['category'],
    addedBy: string,
    addedAt: string,
    bought?: { by: string; at: string },
  ): Item => ({
    id: `demo-item-${n}`,
    householdId: H,
    name,
    spec,
    count,
    category,
    productKey: null,
    addedBy,
    addedAt,
    boughtBy: bought?.by ?? null,
    boughtAt: bought?.at ?? null,
    paid: null,
  })
  const items: Item[] = [
    mk(1, '삼겹살', '600g', 1, '정육', WIFE, '2026-10-16T08:10:00+09:00'),
    mk(2, '한우 국거리', '300g', 1, '정육', WIFE, '2026-10-16T08:11:00+09:00'),
    mk(3, '비비고 왕교자', '1.05kg', 2, '냉동', HUSBAND, '2026-10-16T08:30:00+09:00'),
    mk(4, '대파', null, 1, '채소', WIFE, '2026-10-16T08:12:00+09:00'),
    mk(5, '양파', '1.5kg', 1, '채소', HUSBAND, '2026-10-15T20:00:00+09:00', {
      by: HUSBAND,
      at: '2026-10-16T09:20:00+09:00',
    }),
  ]
  return { me, items }
}
