// 식품안전나라 Open API 응답을 grocery.food_alerts 행으로 바꾸고, 1000건씩 나눠 받는다.
// Deno(Edge Function)와 Node(Vitest)가 함께 import하므로 Deno 전용 API와 npm import를 쓰지 않는다.
// 키는 URL에만 들어가고, 오류 메시지에는 URL·키를 넣지 않는다.

export type FoodService = 'I0490' | 'I2620' | 'I2715'
export const FOOD_SERVICES: readonly FoodService[] = ['I0490', 'I2620', 'I2715']

export type FoodAlertRow = {
  source: FoodService
  source_id: string
  product_name: string
  maker: string | null
  reason: string | null
  grade: string | null
  pack_unit: string | null
  barcode: string | null
  report_no: string | null
  registered_on: string | null
  ends_on: string | null
  raw: Record<string, unknown>
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class FoodApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code} ${message}`)
    this.name = 'FoodApiError'
  }
}

const PAGE = 1000
const BASE = 'http://openapi.foodsafetykorea.go.kr/api'

/** '2026-10-16 17:53:27', '2026.03.23', '20261015' → '2026-10-16'. 그 밖·없는 날짜는 null. */
export function parseFoodDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null
  return `${y}-${mo}-${d}`
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' || t === '-' ? null : t
}

export function toAlertRow(service: FoodService, row: Record<string, unknown>): FoodAlertRow | null {
  const base = { source: service, raw: row, report_no: null, grade: null, ends_on: null }
  if (service === 'I0490') {
    const id = text(row.RTRVLDSUSE_SEQ)
    const name = text(row.PRDTNM)
    if (!id || !name) return null
    return {
      ...base,
      source_id: id,
      product_name: name,
      maker: text(row.BSSHNM),
      reason: text(row.RTRVLPRVNS),
      grade: text(row.RTRVL_GRDCD_NM),
      pack_unit: text(row.FRMLCUNIT),
      barcode: text(row.BRCDNO),
      report_no: text(row.PRDLST_REPORT_NO),
      registered_on: parseFoodDate(row.CRET_DTM),
    }
  }
  if (service === 'I2620') {
    const id = text(row.RTRVLDSUSE_SEQ)
    const name = text(row.PRDTNM)
    if (!id || !name) return null
    const item = text(row.TEST_ITMNM)
    const result = text(row.TESTANALS_RSLT)
    const standard = text(row.STDR_STND)
    const reason = item
      ? `${item}${result ? `: ${result}` : ''}${standard ? ` (기준 ${standard})` : ''}`
      : null
    return {
      ...base,
      source_id: id,
      product_name: name,
      maker: text(row.BSSHNM),
      reason,
      pack_unit: text(row.FRMLCUNIT),
      barcode: text(row.BRCDNO),
      report_no: text(row.PRDLST_REPORT_NO),
      registered_on: parseFoodDate(row.CRET_DTM),
    }
  }
  const id = text(row.SELF_IMPORT_SEQ)
  const name = text(row.PRDT_NM)
  if (!id || !name) return null
  return {
    ...base,
    source_id: id,
    product_name: name,
    maker: text(row.MUFC_NM),
    reason: text(row.INGR_NM_LST),
    pack_unit: null,
    barcode: text(row.BARCD_CTN),
    registered_on: parseFoodDate(row.CRET_DTM),
    ends_on: parseFoodDate(row.END_YMD),
  }
}

type ServiceBody = { total_count?: string; row?: Record<string, unknown>[]; RESULT?: { CODE?: string; MSG?: string } }

/** 한 서비스의 전체 목록을 1000건씩 받는다. INFO-200(자료 없음)은 빈 결과, 그 밖의 코드는 FoodApiError. */
export async function fetchService(
  service: FoodService,
  key: string,
  fetchImpl: FetchLike,
): Promise<{ rows: FoodAlertRow[]; total: number }> {
  const rows: FoodAlertRow[] = []
  let total = Infinity
  for (let start = 1; start <= total; start += PAGE) {
    const end = Number.isFinite(total) ? Math.min(start + PAGE - 1, total) : start + PAGE - 1
    const res = await fetchImpl(`${BASE}/${encodeURIComponent(key)}/${service}/json/${start}/${end}`)
    if (!res.ok) throw new FoodApiError(`HTTP-${res.status}`, `${service} 응답 실패`)
    const body = ((await res.json()) as Record<string, ServiceBody | undefined>)[service]
    const code = body?.RESULT?.CODE ?? 'NO-RESULT'
    if (code === 'INFO-200') return { rows: [], total: 0 }
    if (code !== 'INFO-000') throw new FoodApiError(code, body?.RESULT?.MSG ?? `${service} 오류`)
    total = Number(body?.total_count ?? 0)
    for (const r of body?.row ?? []) {
      const row = toAlertRow(service, r)
      if (row) rows.push(row)
    }
  }
  return { rows, total: Number.isFinite(total) ? total : 0 }
}
