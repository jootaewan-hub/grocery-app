import { describe, expect, it } from 'vitest'
import type { FetchLike, FoodAlertRow } from '../supabase/functions/_shared/foodAlerts'
import { handle, type SyncDeps } from '../supabase/functions/food-alerts-sync/handle'

type Run = Parameters<SyncDeps['recordRun']>[0]

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

function deps(over: Partial<SyncDeps> = {}) {
  const upserts: FoodAlertRow[][] = []
  const runs: Run[] = []
  const a = api({ I0490: 3, I2620: 2, I2715: 1200 })
  const d: SyncDeps = {
    syncSecret: 'S3CRET',
    apiKey: 'SECRETKEY',
    fetchImpl: a.impl,
    upsert: async (rows) => { upserts.push(rows) },
    recordRun: async (run) => { runs.push(run) },
    ...over,
  }
  return { d, upserts, runs, calls: a.calls }
}

const post = (secret?: string) =>
  new Request('https://x/functions/v1/food-alerts-sync', { method: 'POST', headers: secret ? { 'x-sync-secret': secret } : {} })

describe('food-alerts-sync', () => {
  it('비밀값이 없거나 틀리면 401이고 외부 호출이 없다', async () => {
    for (const req of [post(), post('wrong'), post('S3CRE')]) {
      const { d, calls, upserts } = deps()
      expect((await handle(req, d)).status).toBe(401)
      expect(calls).toHaveLength(0)
      expect(upserts).toHaveLength(0)
    }
    const { d, calls } = deps({ syncSecret: undefined })
    expect((await handle(post(''), d)).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('GET은 405', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
  })

  it('키가 없으면 500 missing_api_key', async () => {
    const { d, calls } = deps({ apiKey: undefined })
    const res = await handle(post('S3CRET'), d)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'missing_api_key' })
    expect(calls).toHaveLength(0)
  })

  it('세 서비스를 받아 500건씩 upsert하고 서비스마다 기록한다', async () => {
    const { d, upserts, runs } = deps()
    const res = await handle(post('S3CRET'), d)
    expect(res.status).toBe(200)
    expect(upserts.map((u) => u.length)).toEqual([3, 2, 500, 500, 200])
    expect(runs).toEqual([
      { source: 'I0490', ok: true, rows: 3, total: 3, error: null },
      { source: 'I2620', ok: true, rows: 2, total: 2, error: null },
      { source: 'I2715', ok: true, rows: 1200, total: 1200, error: null },
    ])
    expect(await res.json()).toEqual({
      results: [
        { source: 'I0490', ok: true, rows: 3, total: 3 },
        { source: 'I2620', ok: true, rows: 2, total: 2 },
        { source: 'I2715', ok: true, rows: 1200, total: 1200 },
      ],
    })
  })

  it('한 서비스가 실패해도 나머지는 계속하고 207', async () => {
    const a = api({ I0490: 3, I2620: 2, I2715: 1 }, { I2620: 'ERROR-300' })
    const { d, runs, upserts } = deps({ fetchImpl: a.impl })
    const res = await handle(post('S3CRET'), d)
    expect(res.status).toBe(207)
    expect(runs.map((r) => [r.source, r.ok])).toEqual([['I0490', true], ['I2620', false], ['I2715', true]])
    expect(runs[1]).toMatchObject({ rows: 0, total: null, error: 'ERROR-300 오류' })
    expect(upserts.map((u) => u.length)).toEqual([3, 1])
  })

  it('저장이 실패해도 그 서비스만 실패로 기록하고, 기록에는 정해진 분류만 남긴다', async () => {
    let n = 0
    const { d, runs } = deps({ upsert: async () => { if (n++ === 0) throw new Error('db down: relation detail') } })
    const res = await handle(post('S3CRET'), d)
    expect(res.status).toBe(207)
    expect(runs[0]).toMatchObject({ source: 'I0490', ok: false, error: 'save_failed' })
    expect(runs.slice(1).every((r) => r.ok)).toBe(true)
  })

  it('네트워크 오류는 network_error로만 남긴다', async () => {
    const { d, runs } = deps({ fetchImpl: async () => { throw new TypeError('fetch failed https://x/SECRETKEY/I0490') } })
    await handle(post('S3CRET'), d)
    expect(runs.map((r) => r.error)).toEqual(['network_error', 'network_error', 'network_error'])
  })

  it('API 오류 문구는 키(그대로·인코딩)를 가리고 200자로 자르고 제어 문자를 뺀다', async () => {
    const key = 'K+Y/1'
    const msg = `bad ${key} ${encodeURIComponent(key)}\n` + 'x'.repeat(300)
    const impl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ I0490: { RESULT: { CODE: 'ERROR-300', MSG: msg } }, I2620: { RESULT: { CODE: 'INFO-200' } }, I2715: { RESULT: { CODE: 'INFO-200' } } }) })
    const { d, runs } = deps({ apiKey: key, fetchImpl: impl })
    await handle(post('S3CRET'), d)
    const err = runs[0].error!
    expect(err.startsWith('ERROR-300 bad *** ***')).toBe(true)
    expect(err).not.toContain(key)
    expect(err).not.toContain(encodeURIComponent(key))
    expect(err).not.toMatch(/[\u0000-\u001f]/)
    expect(err.length).toBeLessThanOrEqual(200)
  })

  it('비밀값이 같으면 통과한다(길이·앞부분이 같은 값은 거부)', async () => {
    expect((await handle(post('S3CRET'), deps().d)).status).toBe(200)
    expect((await handle(post('S3CRET!'), deps().d)).status).toBe(401)
    expect((await handle(post('S3CREX'), deps().d)).status).toBe(401)
  })

  it('응답과 기록에 키가 들어가지 않는다', async () => {
    const a = api({ I0490: 1 }, { I2620: 'ERROR-300' })
    const { d, runs } = deps({ fetchImpl: a.impl })
    const body = await (await handle(post('S3CRET'), d)).text()
    expect(body).not.toContain('SECRETKEY')
    expect(JSON.stringify(runs)).not.toContain('SECRETKEY')
  })
})
