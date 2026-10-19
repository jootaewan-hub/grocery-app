// 식약처 목록 동기화. 세 서비스를 전부 받아 upsert하고 서비스마다 실행 기록을 남긴다.
// 비밀번호 없이 부를 수 있으므로 함수가 스스로 막는다(사용자 결정 2026-10-19):
//   세 목록을 모두 20시간 안에 받아 두었으면 받지 않고, DB 잠금(30분에 한 번만 얻을 수 있음)을 얻지 못하면 429.
//   잠금은 한 행 UPDATE ... WHERE locked_at < 30분 전 이라 동시에 불러도 하나만 얻는다.
//   그래서 누가 주소를 알아도 실제로 받는 것은 하루 한 번 남짓이다(자료는 공개 자료, upsert라 지워지는 것 없음).
//   응답에는 결과 종류만 낸다(마지막 시각·건수는 sync_runs에만).
// 한 서비스가 실패해도 나머지는 계속한다. 기존 행은 지우지 않는다.
// sync_runs.error는 로그인한 사용자가 읽을 수 있으므로 정해진 분류만 남긴다:
//   식약처 오류 코드 + 키를 가린 짧은 문구 / 'network_error' / 'save_failed'.
// Deno 전용 API를 쓰지 않아 Vitest에서 그대로 시험한다(진입점은 index.ts).
import { fetchService, FOOD_SERVICES, FoodApiError, type FetchLike, type FetchStats, type FoodAlertRow, type FoodService } from '../_shared/foodAlerts.ts'

export type SyncDeps = {
  apiKey: string | undefined
  fetchImpl: FetchLike
  now(): Date
  /** sinceIso 이후의 실행 기록 */
  recentRuns(sinceIso: string): Promise<{ source: string; ok: boolean; ran_at: string }[]>
  /** 잠금이 cutoffIso보다 오래됐을 때만 atIso로 바꾸고 true. 동시에 불러도 하나만 true. */
  acquire(cutoffIso: string, atIso: string): Promise<boolean>
  upsert(rows: FoodAlertRow[]): Promise<void>
  recordRun(run: { source: FoodService; ok: boolean; rows: number; total: number | null; error: string | null }): Promise<void>
  /** 받은 서비스마다 집계(건수와 항목 이름만). 함수 로그로 남긴다. */
  log?(event: { source: FoodService } & FetchStats): void
}

const CHUNK = 500
const ERROR_MAX = 200
export const FRESH_MS = 20 * 3600_000
export const COOLDOWN_MS = 30 * 60_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

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
  if (!deps.apiKey) return json(500, { error: 'missing_api_key' })
  const apiKey = deps.apiKey

  const now = deps.now().getTime()
  const recent = await deps.recentRuns(new Date(now - FRESH_MS).toISOString())
  const lastOk = FOOD_SERVICES.map((s) =>
    recent.filter((r) => r.source === s && r.ok).reduce<string | null>((m, r) => (m && m > r.ran_at ? m : r.ran_at), null),
  )
  if (lastOk.every((t) => t !== null)) return json(200, { status: 'skipped' })
  if (!(await deps.acquire(new Date(now - COOLDOWN_MS).toISOString(), new Date(now).toISOString()))) {
    return json(429, { status: 'cooldown' })
  }

  let allOk = true
  for (const source of FOOD_SERVICES) {
    let error: string | null = null
    let fetched: { rows: FoodAlertRow[]; total: number; stats: FetchStats } | null = null
    try {
      fetched = await fetchService(source, apiKey, deps.fetchImpl)
      deps.log?.({ source, ...fetched.stats })
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
    allOk &&= ok
  }
  return allOk ? json(200, { status: 'done' }) : json(207, { status: 'partial' })
}
