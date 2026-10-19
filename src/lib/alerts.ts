// 식약처 경고: grocery.item_alerts() 결과를 품목별로 묶고, 확인 범위 문구를 만든다.
import type { AlertLevel } from './types'

export type FoodSource = 'I0490' | 'I2620' | 'I2715'

export type FoodAlert = {
  source: FoodSource
  sourceId: string
  productName: string
  maker: string | null
  reason: string | null
  grade: string | null
  packUnit: string | null
  registeredOn: string | null
}

export type AlertsResult = {
  byItem: ReadonlyMap<string, FoodAlert[]>
  levels: ReadonlyMap<string, AlertLevel>
  /** 서비스별 마지막 성공 실행 시각(ISO) */
  syncedAt: Partial<Record<FoodSource, string>>
}

export const EMPTY_ALERTS: AlertsResult = { byItem: new Map(), levels: new Map(), syncedAt: {} }

export const SOURCE_NAME: Record<FoodSource, string> = {
  I0490: '식약처 회수·판매중지',
  I2620: '식약처 검사부적합',
  I2715: '해외직구 위해식품',
}
export const SOURCES: readonly FoodSource[] = ['I0490', 'I2620', 'I2715']

export const BADGE: Record<AlertLevel, string> = { similar: '비슷한 제품 기록', record: '회수 기록' }
export const SHEET_HINT = '같은 제품인지 포장의 제품명·업체·포장 단위를 확인해 보세요.'

export type ItemAlertRow = {
  item_id: string
  source: string
  source_id: string
  product_name: string
  maker: string | null
  reason: string | null
  grade: string | null
  pack_unit: string | null
  registered_on: string | null
  level: string
}

export function groupAlerts(rows: ItemAlertRow[]): Pick<AlertsResult, 'byItem' | 'levels'> {
  const byItem = new Map<string, FoodAlert[]>()
  const levels = new Map<string, AlertLevel>()
  for (const r of rows) {
    const list = byItem.get(r.item_id) ?? []
    list.push({
      source: r.source as FoodSource,
      sourceId: r.source_id,
      productName: r.product_name,
      maker: r.maker,
      reason: r.reason,
      grade: r.grade,
      packUnit: r.pack_unit,
      registeredOn: r.registered_on,
    })
    byItem.set(r.item_id, list)
    if (r.level === 'record') levels.set(r.item_id, 'record')
    else if (!levels.has(r.item_id)) levels.set(r.item_id, 'similar')
  }
  for (const list of byItem.values()) list.sort((a, b) => (b.registeredOn ?? '').localeCompare(a.registeredOn ?? ''))
  return { byItem, levels }
}

const dayFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })

/** 'YYYY-MM-DD' 또는 ISO 시각 → '10월 20일'(한국 시간) */
export function koDay(v: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+09:00`) : new Date(v)
  const parts = dayFmt.formatToParts(d)
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return `${m}월 ${day}일`
}

const fullFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' })

/** 'YYYY-MM-DD' → '2025년 11월 3일'. 오래된 등록일이 최근처럼 읽히지 않게 연도까지 쓴다. */
export function koFullDay(v: string): string {
  const parts = fullFmt.formatToParts(new Date(`${v}T00:00:00+09:00`))
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  return `${get('year')}년 ${get('month')}월 ${get('day')}일`
}

const STALE_MS = 48 * 3600_000

/** 목록 위 한 줄: 세 서비스를 모두 48시간 안에 확인했으면 가장 오래된 날짜를, 아니면 늦어졌다고 알린다. */
export function listStatus(syncedAt: AlertsResult['syncedAt'], now: Date = new Date()): { tone: 'ok' | 'warn'; text: string } {
  const times = SOURCES.map((s) => syncedAt[s]).filter((t): t is string => Boolean(t))
  if (times.length === 0) return { tone: 'warn', text: '식약처 목록을 아직 확인하지 못했어요' }
  const oldest = times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
  const newest = times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
  if (times.length < SOURCES.length || now.getTime() - Date.parse(oldest) > STALE_MS) {
    return { tone: 'warn', text: `식약처 목록 확인이 늦어지고 있어요. 마지막 확인 ${koDay(newest)}` }
  }
  return { tone: 'ok', text: `식약처 목록 ${koDay(oldest)} 확인` }
}

/** '식약처 회수·판매중지 10월 20일 확인, …' — 확인 기록이 없으면 그렇게 쓴다. */
export function checkedRange(syncedAt: AlertsResult['syncedAt']): string {
  const parts = SOURCES.filter((s) => syncedAt[s]).map((s) => `${SOURCE_NAME[s]} ${koDay(syncedAt[s]!)} 확인`)
  return parts.length ? parts.join(', ') : '식약처 목록을 아직 확인하지 못했어요'
}
