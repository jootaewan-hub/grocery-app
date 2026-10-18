// 식약처 목록 동기화. 비밀 헤더를 확인한 뒤 세 서비스를 전부 받아 upsert하고 서비스마다 실행 기록을 남긴다.
// 한 서비스가 실패해도 나머지는 계속한다. 기존 행은 지우지 않는다. 응답·기록에 키를 넣지 않는다.
// Deno 전용 API를 쓰지 않아 Vitest에서 그대로 시험한다(진입점은 index.ts).
import { fetchService, FOOD_SERVICES, FoodApiError, type FetchLike, type FoodAlertRow, type FoodService } from '../_shared/foodAlerts.ts'

export type SyncDeps = {
  syncSecret: string | undefined
  apiKey: string | undefined
  fetchImpl: FetchLike
  upsert(rows: FoodAlertRow[]): Promise<void>
  recordRun(run: { source: FoodService; ok: boolean; rows: number; total: number | null; error: string | null }): Promise<void>
}

const CHUNK = 500

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

/** 길이가 같을 때 문자마다 XOR을 모아 비교한다(일치 위치로 시간이 달라지지 않게). */
function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

function describeError(e: unknown, apiKey: string): string {
  const msg = e instanceof FoodApiError ? e.message : e instanceof Error ? e.message : String(e)
  return apiKey ? msg.split(apiKey).join('***') : msg
}

export async function handle(req: Request, deps: SyncDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!sameSecret(req.headers.get('x-sync-secret'), deps.syncSecret)) return json(401, { error: 'unauthorized' })
  if (!deps.apiKey) return json(500, { error: 'missing_api_key' })

  const results: { source: FoodService; ok: boolean; rows: number; total: number | null }[] = []
  for (const source of FOOD_SERVICES) {
    try {
      const { rows, total } = await fetchService(source, deps.apiKey, deps.fetchImpl)
      for (let i = 0; i < rows.length; i += CHUNK) await deps.upsert(rows.slice(i, i + CHUNK))
      await deps.recordRun({ source, ok: true, rows: rows.length, total, error: null })
      results.push({ source, ok: true, rows: rows.length, total })
    } catch (e) {
      await deps.recordRun({ source, ok: false, rows: 0, total: null, error: describeError(e, deps.apiKey) })
      results.push({ source, ok: false, rows: 0, total: null })
    }
  }
  return json(results.every((r) => r.ok) ? 200 : 207, { results })
}
