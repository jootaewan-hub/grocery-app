// 데모 데이터: 개발 중 화면 캡처 전용이다. 실제 가격·기록이 아니며 운영 화면에 쓰지 않는다.
import { groupAlerts, type AlertsResult } from './lib/alerts'
import type { Membership } from './lib/session'
import type { DemoPrices } from './lib/store'
import type { Item } from './lib/types'

const H = 'demo'
const HUSBAND = 'demo-husband'
const WIFE = 'demo-wife'

export function demoSeed(): { me: Membership; items: Item[]; alerts: AlertsResult; prices: DemoPrices } {
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
    productKey: n === 3 ? 'demo-p-1' : null,
    productQty: n === 3 ? 1 : null,
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
    mk(6, '○○ 냉동볶음밥', null, 1, '냉동', WIFE, '2026-10-16T08:40:00+09:00'),
  ]
  // 데모용 가상 기록(실제 식약처 기록이 아님)
  const alerts: AlertsResult = {
    ...groupAlerts([
      {
        item_id: 'demo-item-6',
        source: 'I0490',
        source_id: 'demo-1',
        product_name: '○○ 냉동볶음밥 300g',
        maker: '○○식품',
        reason: '이물 혼입',
        grade: '2등급',
        pack_unit: '300g',
        registered_on: '2026-10-14',
        level: 'similar',
      },
    ]),
    // 확인 시각은 늘 '방금 전'(캡처에서 정상 상태가 보이게)
    syncedAt: (() => {
      const t = new Date(Date.now() - 3600_000).toISOString()
      return { I0490: t, I2620: t, I2715: t }
    })(),
  }
  // 데모용 가상 가격(실제 다나와 값이 아님). 판매처 이름에 '예시'를 붙인다. 확인 시각은 늘 1시간 전.
  const at = new Date(Date.now() - 3600_000).toISOString()
  const line = (qty: number, seller: string | null, price: number, delivery: number | null, unitPrice: number | null = null, mallCount: number | null = null) => ({
    price, seller, source: 'danawa' as const, qty, delivery, checkedAt: at, unitPrice, unitLabel: unitPrice ? '100g' : null, mallCount,
  })
  const prices: DemoPrices = {
    searches: {
      'demo-item-1': { status: 'none', candidateCount: 0, updatedAt: at },
      'demo-item-2': { status: 'searching', candidateCount: 0, updatedAt: at },
      'demo-item-6': { status: 'done', candidateCount: 3, updatedAt: at },
    },
    candidates: {
      'demo-item-6': [
        { productId: 'demo-p-2', name: '예시 냉동볶음밥 300g', imageUrl: null, rating: 4.6, foundAt: at,
          variants: [{ qty: 1, price: 3980, unitPrice: 1327, unitLabel: '100g', mallCount: 12 }, { qty: 4, price: 14900, unitPrice: 1242, unitLabel: '100g', mallCount: 30 }] },
        { productId: 'demo-p-3', name: '예시 새우볶음밥 420g', imageUrl: null, rating: 4.4, foundAt: at,
          variants: [{ qty: 1, price: 5480, unitPrice: 1305, unitLabel: '100g', mallCount: 8 }] },
        { productId: 'demo-p-4', name: '예시 볶음밥 3종 세트(300g×3)', imageUrl: null, rating: null, foundAt: at,
          variants: [{ qty: 1, price: 11900, unitPrice: null, unitLabel: null, mallCount: 5 }] },
      ],
    },
    products: {
      'demo-p-1': { id: 'demo-p-1', name: 'CJ제일제당 비비고 왕교자 1.05kg', imageUrl: null, rating: 4.8, reviewCount: 9099, ratedAt: at, pcode: '5643303' },
    },
    lines: {
      'demo-p-1': [
        line(1, null, 10380, null, 989, 26),
        line(1, '예시몰 A', 10380, 3000),
        line(1, '예시몰 B', 10900, 0),
        line(2, null, 21150, null, 1007, 120),
        line(3, null, 27650, null, 878, 279),
      ],
    },
  }
  return { me, items, alerts, prices }
}
