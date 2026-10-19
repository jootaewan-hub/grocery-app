// 데모 데이터: 개발 중 화면 캡처 전용이다. 실제 가격·기록이 아니며 운영 화면에 쓰지 않는다.
import { groupAlerts, type AlertsResult } from './lib/alerts'
import type { Membership } from './lib/session'
import type { Item } from './lib/types'

const H = 'demo'
const HUSBAND = 'demo-husband'
const WIFE = 'demo-wife'

export function demoSeed(): { me: Membership; items: Item[]; alerts: AlertsResult } {
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
  return { me, items, alerts }
}
