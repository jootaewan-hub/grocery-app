// 가격 확인(④-1): 후보·가격 줄·안전 기록 타입과 화면 규칙.
// "가장 싼 값"은 오늘(한국 시간) 확인했고 고른 수량과 같은 줄에서만 고른다(설계 4-3, 화면 설계 4절).
import type { AlertsResult, FoodAlert, FoodSource } from './alerts'
import { won } from './format'

export type ItemSearch = { status: 'searching' | 'done' | 'none' | 'error'; candidateCount: number; updatedAt: string }

export type CandidateVariant = { qty: number; price: number; unitPrice: number | null; unitLabel: string | null; mallCount: number | null }
export type Candidate = {
  productId: string
  name: string
  imageUrl: string | null
  rating: number | null
  variants: CandidateVariant[]
  foundAt: string
}

export type ItemPrice = { price: number; seller: string | null; source: 'danawa'; qty: number; delivery: number | null; checkedAt: string }
export type PriceLine = ItemPrice & { unitPrice: number | null; unitLabel: string | null; mallCount: number | null }

export type SafetyRecord = FoodAlert & { via: 'item_name' | 'product_name'; farm: boolean }

export type ItemDetailData = {
  product: { id: string; name: string; imageUrl: string | null; rating: number | null; reviewCount: number | null; pcode: string } | null
  /** 가장 최근 확인 */
  check: { checkedAt: string; ok: boolean; error: string | null } | null
  /** 가장 최근 성공한 확인의 줄 */
  lines: PriceLine[]
  safety: SafetyRecord[]
  syncedAt: AlertsResult['syncedAt']
}

export type ItemExtras = {
  searches: ReadonlyMap<string, ItemSearch>
  prices: ReadonlyMap<string, ItemPrice>
  productNames: ReadonlyMap<string, string>
}

export const EMPTY_EXTRAS: ItemExtras = { searches: new Map(), prices: new Map(), productNames: new Map() }

/** ISO 시각 → 한국 날짜 YYYY-MM-DD */
export function kstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** 확인 시각: 오늘이면 "오늘 09:10", 아니면 "10월 19일 23:59"(한국 시간) */
export function checkedText(iso: string, now: Date = new Date()): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600_000)
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`
  return kstDay(iso) === kstDay(now.toISOString()) ? `오늘 ${hm}` : `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${hm}`
}

/** 상품을 고르기 전 목록 줄의 둘째 줄 */
export function searchLabel(s: ItemSearch | null): string {
  if (!s) return '상품 고르기 전'
  if (s.status === 'searching') return '후보 찾는 중'
  if (s.status === 'done') return `후보 ${s.candidateCount}개 찾음`
  if (s.status === 'none') return '후보를 찾지 못했어요'
  return '후보를 찾지 못했어요(다시 시도)'
}

const valid = (p: number) => Number.isFinite(p) && p > 0

/** 오늘·같은 수량 줄(same, 싼 순)과 나머지(other, 수량·싼 순), 그리고 가장 싼 값. */
export function splitLines(lines: PriceLine[], qty: number, today: string): { same: PriceLine[]; other: PriceLine[]; best: PriceLine | null } {
  const order = (a: PriceLine, b: PriceLine) => a.price - b.price || Number(a.seller === null) - Number(b.seller === null)
  const ok = lines.filter((l) => valid(l.price))
  const same = ok.filter((l) => l.qty === qty && kstDay(l.checkedAt) === today).sort(order)
  const other = ok.filter((l) => !same.includes(l)).sort((a, b) => a.qty - b.qty || order(a, b))
  return { same, other, best: same[0] ?? null }
}

/** 자동으로 가격을 못 가져오는 곳: 그 몰의 검색 결과를 새 창으로 연다(서버를 거치지 않음). */
export const SHORTCUTS: readonly { name: string; url: (q: string) => string }[] = [
  { name: '쿠팡', url: (q) => `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}` },
  { name: 'SSG(이마트몰)', url: (q) => `https://www.ssg.com/search.ssg?query=${encodeURIComponent(q)}` },
  { name: '롯데ON', url: (q) => `https://www.lotteon.com/search/search/search.ecn?render=search&q=${encodeURIComponent(q)}` },
  { name: 'G마켓', url: (q) => `https://www.gmarket.co.kr/n/search?keyword=${encodeURIComponent(q)}` },
  { name: '컬리', url: (q) => `https://www.kurly.com/search?sword=${encodeURIComponent(q)}` },
]

/** 가격 줄 오른쪽 글: 가격과 배송비 */
export function priceRowText(l: PriceLine): string {
  const ship = l.delivery === null ? '배송비 확인 못 함' : l.delivery === 0 ? '무료배송' : `배송비 ${won(l.delivery)}`
  return `${won(l.price)}, ${ship}`
}

const SHORT_SOURCE: Record<FoodSource, string> = { I0490: '회수·판매중지', I2620: '검사부적합', I2715: '해외직구 위해식품' }

/** 요약 칸의 식약처 기록: 농가 단위 기록은 빼고 출처별 건수. 기록이 없을 때 "안전함"이라고 쓰지 않는다. */
export function safetySummary(records: SafetyRecord[], failed: boolean): string {
  if (failed) return '확인 못 함'
  const counts = new Map<FoodSource, number>()
  for (const r of records) if (!r.farm) counts.set(r.source, (counts.get(r.source) ?? 0) + 1)
  if (counts.size === 0) return '찾은 기록 없음'
  return (['I0490', 'I2620', 'I2715'] as FoodSource[])
    .filter((s) => counts.has(s))
    .map((s) => `${SHORT_SOURCE[s]} ${counts.get(s)}건`)
    .join(', ')
}

/** 농가 단위 농산물 부적합(목록에서는 숨김) 줄 */
export function farmLine(records: SafetyRecord[]): string | null {
  const n = records.filter((r) => r.farm).length
  return n === 0 ? null : `같은 품목 농산물 부적합 ${n}건(농가 단위)`
}
