import { describe, expect, it } from 'vitest'
import type { FetchLike, FoodAlertRow } from '../supabase/functions/_shared/foodAlerts'
import { handle, type SyncDeps } from '../supabase/functions/food-alerts-sync/handle'

type Run = Parameters<SyncDeps['recordRun']>[0]
type RecentRun = Awaited<ReturnType<SyncDeps['recentRuns']>>[number]

const NOW = new Date('2026-10-19T22:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const H = 3600_000

/** 서비스별 건수와 오류 코드를 정해 주는 가짜 식약처 API. */
function api(totals: Record<string, number>, errors: Record<string, string> = {}) {
  const calls: string[] = []
  const impl: FetchLike = async (url) => {
    calls.push(url)
    const parts = url.split('/')
    const service = parts.at(-4)!
    const [start, end] = parts.slice(-2).map(Number)
    const code = errors[service] ?? 'INFO-000'
    const total = totals[service] ?? 0
    const row = Array.from({ length: Math.max(0, Math.min(end, total) - start + 1) }, (_, i) => ({
      RTRVLDSUSE_SEQ: String(start + i), SELF_IMPORT_SEQ: String(start + i), PRDTNM: 'p', PRDT_NM: 'p',
    }))
    return { ok: true, status: 200, json: async () => ({ [service]: { total_count: String(total), row, RESULT: { CODE: code, MSG: '오류' } } }) }
  }
  return { calls, impl }
}

function deps(over: Partial<SyncDeps> = {}, recent: RecentRun[] = []) {
  const upserts: FoodAlertRow[][] = []
  const runs: Run[] = []
  const since: string[] = []
  let attempts = 0
  const acquires: [string, string][] = []
  const a = api({ I0490: 3, I2620: 2, I2715: 1200 })
  const d: SyncDeps = {
    apiKey: 'SECRETKEY',
    fetchImpl: a.impl,
    now: () => NOW,
    recentRuns: async (s) => {
      since.push(s)
      return recent
    },
    acquire: async (cutoff, at) => {
      acquires.push([cutoff, at])
      attempts++
      return true
    },
    upsert: async (rows) => { upserts.push(rows) },
    recordRun: async (run) => { runs.push(run) },
    ...over,
  }
  return { d, upserts, runs, calls: a.calls, since, attempts: () => attempts, acquires }
}

const post = () => new Request('https://x/functions/v1/food-alerts-sync', { method: 'POST' })
const okAll = (t: string): RecentRun[] => ['I0490', 'I2620', 'I2715'].map((source) => ({ source, ok: true, ran_at: t }))

describe('food-alerts-sync: 하루 한 번만', () => {
  it('세 목록을 모두 20시간 안에 받아 두었으면 받지 않고 200 skipped', async () => {
    const { d, calls, upserts, attempts } = deps({}, okAll(ago(19 * H)))
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'skipped' }) // 마지막 시각·건수는 응답에 내지 않는다
    expect(calls).toHaveLength(0)
    expect(upserts).toHaveLength(0)
    expect(attempts()).toBe(0)
  })

  it('최근 기록은 20시간 전부터 묻는다', async () => {
    const { d, since } = deps({}, okAll(ago(19 * H)))
    await handle(post(), d)
    expect(since).toEqual([ago(20 * H)])
  })

  it('한 목록이라도 20시간 안에 성공하지 못했으면 다시 받는다', async () => {
    const recent = okAll(ago(19 * H)).filter((r) => r.source !== 'I2620')
    const { d, calls, attempts } = deps({}, recent)
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(calls.length).toBeGreaterThan(0)
    expect(attempts()).toBe(1)
  })

  it('잠금을 얻지 못하면(30분 안에 다른 시도) 429이고 받지 않는다', async () => {
    const { d, calls } = deps({ acquire: async () => false })
    const res = await handle(post(), d)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ status: 'cooldown' })
    expect(calls).toHaveLength(0)
  })

  it('잠금은 30분 전을 기준으로, 지금 시각으로 건다', async () => {
    const { d, acquires } = deps()
    await handle(post(), d)
    expect(acquires).toEqual([[ago(30 * 60_000), NOW.toISOString()]])
  })

  it('동시에 여러 번 불러도 잠금을 얻은 한 번만 받는다', async () => {
    let locked = false
    const a = api({ I0490: 1 })
    const { d } = deps({
      fetchImpl: a.impl,
      acquire: async () => {
        await Promise.resolve()
        if (locked) return false
        locked = true
        return true
      },
    })
    const statuses = await Promise.all([1, 2, 3, 4, 5].map(() => handle(post(), d).then((r) => r.status)))
    expect(statuses.filter((s) => s === 429)).toHaveLength(4)
    expect(a.calls.filter((u) => u.includes('/I0490/'))).toHaveLength(1)
  })

  it('잠금을 얻은 뒤에 받는다', async () => {
    const order: string[] = []
    const a = api({ I0490: 1 })
    const { d } = deps({
      acquire: async () => { order.push('lock'); return true },
      fetchImpl: async (u) => { order.push('fetch'); return a.impl(u) },
    })
    await handle(post(), d)
    expect(order[0]).toBe('lock')
  })
})

describe('food-alerts-sync: 받기와 기록', () => {
  it('GET은 405', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
  })

  it('키가 없으면 500 missing_api_key이고 시도도 기록하지 않는다', async () => {
    const { d, calls, attempts } = deps({ apiKey: undefined })
    const res = await handle(post(), d)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'missing_api_key' })
    expect(calls).toHaveLength(0)
    expect(attempts()).toBe(0)
  })

  it('세 서비스를 받아 500건씩 upsert하고 서비스마다 기록한다', async () => {
    const { d, upserts, runs } = deps()
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(upserts.map((u) => u.length)).toEqual([3, 2, 500, 500, 200])
    expect(runs).toEqual([
      { source: 'I0490', ok: true, rows: 3, total: 3, error: null },
      { source: 'I2620', ok: true, rows: 2, total: 2, error: null },
      { source: 'I2715', ok: true, rows: 1200, total: 1200, error: null },
    ])
    expect(await res.json()).toEqual({ status: 'done' }) // 서비스별 결과는 sync_runs에만 남긴다
  })

  it('한 서비스가 실패해도 나머지는 계속하고 207', async () => {
    const a = api({ I0490: 3, I2620: 2, I2715: 1 }, { I2620: 'ERROR-300' })
    const { d, runs, upserts } = deps({ fetchImpl: a.impl })
    const res = await handle(post(), d)
    expect(res.status).toBe(207)
    expect(runs.map((r) => [r.source, r.ok])).toEqual([['I0490', true], ['I2620', false], ['I2715', true]])
    expect(runs[1]).toMatchObject({ rows: 0, total: null, error: 'ERROR-300 오류' })
    expect(upserts.map((u) => u.length)).toEqual([3, 1])
  })

  it('저장이 실패해도 그 서비스만 실패로 기록하고, 기록에는 정해진 분류만 남긴다', async () => {
    let n = 0
    const { d, runs } = deps({ upsert: async () => { if (n++ === 0) throw new Error('db down: relation detail') } })
    const res = await handle(post(), d)
    expect(res.status).toBe(207)
    expect(runs[0]).toMatchObject({ source: 'I0490', ok: false, error: 'save_failed' })
    expect(runs.slice(1).every((r) => r.ok)).toBe(true)
  })

  it('네트워크 오류는 network_error로만 남긴다', async () => {
    const { d, runs } = deps({ fetchImpl: async () => { throw new TypeError('fetch failed https://x/SECRETKEY/I0490') } })
    await handle(post(), d)
    expect(runs.map((r) => r.error)).toEqual(['network_error', 'network_error', 'network_error'])
  })

  it('API 오류 문구는 키(그대로·인코딩)를 가리고 200자로 자르고 제어 문자를 뺀다', async () => {
    const key = 'K+Y/1'
    const msg = `bad ${key} ${encodeURIComponent(key)}\n` + 'x'.repeat(300)
    const impl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ I0490: { RESULT: { CODE: 'ERROR-300', MSG: msg } }, I2620: { RESULT: { CODE: 'INFO-200' } }, I2715: { RESULT: { CODE: 'INFO-200' } } }) })
    const { d, runs } = deps({ apiKey: key, fetchImpl: impl })
    await handle(post(), d)
    const err = runs[0].error!
    expect(err.startsWith('ERROR-300 bad *** ***')).toBe(true)
    expect(err).not.toContain(key)
    expect(err).not.toContain(encodeURIComponent(key))
    expect(err).not.toMatch(/[\u0000-\u001f]/)
    expect(err.length).toBeLessThanOrEqual(200)
  })

  it('응답과 기록에 키가 들어가지 않는다', async () => {
    const a = api({ I0490: 1 }, { I2620: 'ERROR-300' })
    const { d, runs } = deps({ fetchImpl: a.impl })
    const body = await (await handle(post(), d)).text()
    expect(body).not.toContain('SECRETKEY')
    expect(JSON.stringify(runs)).not.toContain('SECRETKEY')
  })
})
