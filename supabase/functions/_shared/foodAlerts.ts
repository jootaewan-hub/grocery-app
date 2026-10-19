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
const REASON_SEP = ' / '
// https만 쓴다: 키가 주소에 들어가므로 평문 http로는 보내지 않는다(2026-10-19 인증서 확인).
const BASE = 'https://openapi.foodsafetykorea.go.kr/api'
/** 전체 건수 상한. 2026-10 기준 가장 큰 서비스(I2715)가 5,013건이라 넉넉히 둔다. 응답이 이상하게 크면 멈춘다. */
export const MAX_TOTAL = 100_000

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

/** 받은 행(fetched), 고유 id·제품명이 없어 버린 행(dropped), 같은 id로 겹쳐 하나로 합친 행(merged),
 *  겹친 행끼리 값이 달랐던 항목 이름(mergedDiff, 최대 20개). 원본 값은 담지 않는다. */
export type FetchStats = { fetched: number; dropped: number; merged: number; mergedDiff: string[] }

/** 한 서비스의 전체 목록을 1000건씩 받는다. INFO-200(자료 없음)은 빈 결과, 그 밖의 코드는 FoodApiError.
 *  전체 건수는 첫 응답 값만 쓴다(뒤 응답이 늘려도 따르지 않음). 정수가 아니거나 MAX_TOTAL을 넘으면 멈춘다. */
export async function fetchService(
  service: FoodService,
  key: string,
  fetchImpl: FetchLike,
): Promise<{ rows: FoodAlertRow[]; total: number; stats: FetchStats }> {
  // 같은 고유 id가 두 번 오면 뒤의 것만 남긴다: upsert 한 묶음에 같은 키가 겹치면 그 서비스 전체 저장이 실패한다.
  const byId = new Map<string, FoodAlertRow>()
  let total: number | null = null
  const stats: FetchStats = { fetched: 0, dropped: 0, merged: 0, mergedDiff: [] }
  const diff = new Set<string>()
  for (let start = 1; total === null || start <= total; start += PAGE) {
    const end = total === null ? PAGE : Math.min(start + PAGE - 1, total)
    const res = await fetchImpl(`${BASE}/${encodeURIComponent(key)}/${service}/json/${start}/${end}`)
    if (!res.ok) throw new FoodApiError(`HTTP-${res.status}`, `${service} 응답 실패`)
    const body = ((await res.json()) as Record<string, ServiceBody | undefined>)[service]
    const code = body?.RESULT?.CODE ?? 'NO-RESULT'
    if (code === 'INFO-200') return { rows: [], total: 0, stats }
    if (code !== 'INFO-000') throw new FoodApiError(code, body?.RESULT?.MSG ?? `${service} 오류`)
    if (total === null) {
      const t = Number(body?.total_count)
      if (!Number.isInteger(t) || t < 0) throw new FoodApiError('BAD-TOTAL', `${service} 전체 건수가 이상해요`)
      if (t > MAX_TOTAL) throw new FoodApiError('TOO-MANY', `${service} 전체 건수가 상한(${MAX_TOTAL})을 넘어요`)
      total = t
    }
    for (const r of (body?.row ?? []).slice(0, PAGE)) {
      stats.fetched++
      const row = toAlertRow(service, r)
      if (!row) {
        stats.dropped++
        continue
      }
      const prev = byId.get(row.source_id)
      if (prev) {
        stats.merged++
        for (const k of new Set([...Object.keys(prev.raw), ...Object.keys(r)])) {
          if (String(prev.raw[k] ?? '') !== String(r[k] ?? '')) diff.add(k)
        }
        // I2620은 부적합 검사 항목마다 한 줄이 같은 번호로 온다(2026-10-19 실제 수집: 537줄 중 96줄).
        // 마지막 줄만 남기면 항목이 사라지므로 사유를 겹치지 않게 이어 붙인다.
        const reasons = (prev.reason ?? '').split(REASON_SEP).filter(Boolean)
        if (row.reason && !reasons.includes(row.reason)) reasons.push(row.reason)
        row.reason = reasons.length ? reasons.join(REASON_SEP) : null
        byId.delete(row.source_id) // 다시 넣어 순서를 마지막 위치로
      }
      byId.set(row.source_id, row)
    }
  }
  stats.mergedDiff = [...diff].sort().slice(0, 20)
  return { rows: [...byId.values()], total: total ?? 0, stats }
}
