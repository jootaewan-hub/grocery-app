import type { Category } from './categories'

// 장보기 품목 한 줄. DB 행과 1:1로 대응한다.
export type Item = {
  id: string
  householdId: string
  name: string
  spec: string | null
  count: number
  category: Category
  /** 고른 상품(grocery.products.id). 고르기 전이면 null */
  productKey: string | null
  /** 고른 상품의 수량(1개·2개…). 고르기 전이면 null */
  productQty: number | null
  addedBy: string | null
  addedAt: string // ISO-8601
  boughtBy: string | null
  boughtAt: string | null // ISO-8601, 있으면 산 것
  paid: number | null
}

export type Member = { userId: string; displayName: string; spouseRole: 'husband' | 'wife' | null }

// record: 회수·처분 기록과 일치, similar: 비슷한 제품 기록
export type AlertLevel = 'record' | 'similar'

export type PriceCompare = { onlineBest: number | null; storeBase: number | null }
