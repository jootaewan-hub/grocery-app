// 식약처 목록 동기화. 비밀 헤더를 확인한 뒤 세 서비스를 전부 받아 upsert하고 서비스마다 실행 기록을 남긴다.
// 한 서비스가 실패해도 나머지는 계속한다. 기존 행은 지우지 않는다.
// sync_runs.error는 로그인한 사용자가 읽을 수 있으므로 정해진 분류만 남긴다:
//   식약처 오류 코드 + 키를 가린 짧은 문구 / 'network_error' / 'save_failed'.
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
const ERROR_MAX = 200

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}

/** 두 값을 SHA-256으로 같은 길이(32바이트)로 만든 뒤 모든 바이트를 XOR로 모아 비교한다(길이·일치 위치가 시간에 드러나지 않게). */
async function sameSecret(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected) return false
  const [a, b] = await Promise.all([sha256(given ?? ''), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0 && given !== null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 키(그대로·인코딩 대소문자 모두)를 가리고, 제어 문자를 빼고, ERROR_MAX자로 자른다. */
function sanitize(text: string, apiKey: string): string {
  let out = text
  for (const form of [apiKey, encodeURIComponent(apiKey)]) {
    if (form) out = out.replace(new RegExp(escapeRe(form), 'gi'), '***')
  }
  return out.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, ERROR_MAX)
}

export async function handle(req: Request, deps: SyncDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await sameSecret(req.headers.get('x-sync-secret'), deps.syncSecret))) return json(401, { error: 'unauthorized' })
  if (!deps.apiKey) return json(500, { error: 'missing_api_key' })
  const apiKey = deps.apiKey

  const results: { source: FoodService; ok: boolean; rows: number; total: number | null }[] = []
  for (const source of FOOD_SERVICES) {
    let error: string | null = null
    let fetched: { rows: FoodAlertRow[]; total: number } | null = null
    try {
      fetched = await fetchService(source, apiKey, deps.fetchImpl)
    } catch (e) {
      error = e instanceof FoodApiError ? sanitize(e.message, apiKey) : 'network_error'
    }
    if (fetched) {
      try {
        for (let i = 0; i < fetched.rows.length; i += CHUNK) await deps.upsert(fetched.rows.slice(i, i + CHUNK))
      } catch {
        error = 'save_failed'
      }
    }
    const ok = error === null && fetched !== null
    const run = { source, ok, rows: ok ? fetched!.rows.length : 0, total: ok ? fetched!.total : null, error }
    await deps.recordRun(run)
    results.push({ source, ok, rows: run.rows, total: run.total })
  }
  return json(results.every((r) => r.ok) ? 200 : 207, { results })
}
