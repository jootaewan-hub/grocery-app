import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  fetchService,
  FoodApiError,
  parseFoodDate,
  toAlertRow,
  type FetchLike,
} from '../supabase/functions/_shared/foodAlerts'

const fixture = (s: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/foodsafety/${s}.json`, import.meta.url), 'utf8')) as Record<
    string,
    { total_count: string; row: Record<string, unknown>[] }
  >
const firstRow = (s: string) => fixture(s)[s].row[0]

/** 서비스 응답을 흉내 내는 가짜 fetch. 호출한 URL을 모은다. */
function fakeFetch(service: string, total: number, code = 'INFO-000') {
  const urls: string[] = []
  const impl: FetchLike = async (url) => {
    urls.push(url)
    const [start, end] = url.split('/').slice(-2).map(Number)
    const row = code === 'INFO-000'
      ? Array.from({ length: Math.max(0, Math.min(end, total) - start + 1) }, (_, i) => ({
          RTRVLDSUSE_SEQ: String(start + i), SELF_IMPORT_SEQ: String(start + i), PRDTNM: `제품${start + i}`, PRDT_NM: `제품${start + i}`,
        }))
      : undefined
    return {
      ok: true,
      status: 200,
      json: async () => ({ [service]: { total_count: String(code === 'INFO-000' ? total : 0), row, RESULT: { CODE: code, MSG: '메시지' } } }),
    }
  }
  return { urls, impl }
}

describe('날짜', () => {
  it('세 형식을 YYYY-MM-DD로 읽고 나머지는 null', () => {
    expect(parseFoodDate('2026-10-16 17:53:27.662706')).toBe('2026-10-16')
    expect(parseFoodDate('2026.03.23')).toBe('2026-03-23')
    expect(parseFoodDate('20261015')).toBe('2026-10-15')
    expect(parseFoodDate('데이터없음')).toBeNull()
    expect(parseFoodDate('')).toBeNull()
    expect(parseFoodDate(undefined)).toBeNull()
    expect(parseFoodDate('20261399')).toBeNull()
  })
})

describe('행 변환', () => {
  it('I0490', () => {
    expect(toAlertRow('I0490', firstRow('I0490'))).toMatchObject({
      source: 'I0490',
      source_id: '3000235959',
      product_name: '만제 자연산 성게알 소스',
      maker: '만제영어조합법인',
      reason: '소비기한 미표시',
      grade: '1등급',
      pack_unit: '210g',
      barcode: '8809565891403',
      report_no: '20070611052319',
      registered_on: '2026-10-16',
      ends_on: null,
    })
  })

  it('I2620 사유는 검사 항목·결과·기준을 합치고 빈 바코드는 null', () => {
    const r = toAlertRow('I2620', firstRow('I2620'))!
    expect(r.product_name).toBe('노니분말')
    expect(r.reason).toBe('금속성이물: 39.84 mg/kg (기준 10.0미만 mg/kg)')
    expect(r.barcode).toBeNull()
    expect(r.registered_on).toBe('2026-03-23')
  })

  it('I2715 바코드 "-"는 null, 차단 종료일', () => {
    const r = toAlertRow('I2715', firstRow('I2715'))!
    expect(r.maker).toBe('Shen Neng Herbal Medicines Group Pty Ltd')
    expect(r.reason).toBe('Andrographis')
    expect(r.barcode).toBeNull()
    expect(r.ends_on).toBe('2029-12-31')
    expect(r.registered_on).toBe('2026-10-15')
  })

  it('고유 id나 제품명이 비면 null', () => {
    expect(toAlertRow('I0490', { RTRVLDSUSE_SEQ: '', PRDTNM: 'x' })).toBeNull()
    expect(toAlertRow('I0490', { RTRVLDSUSE_SEQ: '1', PRDTNM: '  ' })).toBeNull()
  })
})

describe('보안', () => {
  it('https로만 부른다', async () => {
    const f = fakeFetch('I0490', 3)
    await fetchService('I0490', 'KEY', f.impl)
    expect(f.urls[0].startsWith('https://openapi.foodsafetykorea.go.kr/api/')).toBe(true)
  })

  it('전체 건수는 첫 응답 값만 믿고 뒤에서 늘어나도 따르지 않는다', async () => {
    const urls: string[] = []
    let call = 0
    const impl: FetchLike = async (url) => {
      urls.push(url)
      call++
      const n = call === 1 ? 1000 : 5 // 두 번째 응답이 total을 99999로 부풀려도 무시
      return {
        ok: true, status: 200,
        json: async () => ({ I0490: { total_count: call === 1 ? '1005' : '99999', row: Array.from({ length: n }, (_, i) => ({ RTRVLDSUSE_SEQ: `${call}-${i}`, PRDTNM: 'p' })), RESULT: { CODE: 'INFO-000' } } }),
      }
    }
    const res = await fetchService('I0490', 'KEY', impl)
    expect(urls).toHaveLength(2)
    expect(res.total).toBe(1005)
  })

  it('전체 건수가 숫자가 아니거나 너무 크면 FoodApiError', async () => {
    for (const total of ['abc', '-1', '1.5', '100001']) {
      const impl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ I0490: { total_count: total, row: [], RESULT: { CODE: 'INFO-000' } } }) })
      const err = await fetchService('I0490', 'KEY', impl).catch((e) => e)
      expect(err, total).toBeInstanceOf(FoodApiError)
    }
  })

  it('같은 고유 id가 두 번 오면 하나만 남긴다(upsert 한 묶음에 같은 키가 겹치지 않게)', async () => {
    const impl: FetchLike = async () => ({
      ok: true, status: 200,
      json: async () => ({ I0490: { total_count: '3', row: [{ RTRVLDSUSE_SEQ: '1', PRDTNM: 'a' }, { RTRVLDSUSE_SEQ: '1', PRDTNM: 'b' }, { RTRVLDSUSE_SEQ: '2', PRDTNM: 'c' }], RESULT: { CODE: 'INFO-000' } } }),
    })
    const res = await fetchService('I0490', 'KEY', impl)
    expect(res.rows.map((r) => [r.source_id, r.product_name])).toEqual([['1', 'b'], ['2', 'c']])
  })

  it('한 페이지에 1000건이 넘게 와도 1000건까지만 쓴다', async () => {
    const impl: FetchLike = async () => ({
      ok: true, status: 200,
      json: async () => ({ I0490: { total_count: '1000', row: Array.from({ length: 1500 }, (_, i) => ({ RTRVLDSUSE_SEQ: String(i), PRDTNM: 'p' })), RESULT: { CODE: 'INFO-000' } } }),
    })
    expect((await fetchService('I0490', 'KEY', impl)).rows).toHaveLength(1000)
  })
})

describe('나눠 받기', () => {
  it('1000건이 넘으면 나눠서 모두 받는다', async () => {
    const f = fakeFetch('I2715', 2500)
    const res = await fetchService('I2715', 'KEY', f.impl)
    expect(f.urls.map((u) => u.split('/').slice(-2).join('/'))).toEqual(['1/1000', '1001/2000', '2001/2500'])
    expect(res.total).toBe(2500)
    expect(res.rows).toHaveLength(2500)
  })

  it('INFO-200은 빈 결과', async () => {
    const f = fakeFetch('I0490', 0, 'INFO-200')
    expect(await fetchService('I0490', 'KEY', f.impl)).toEqual({ rows: [], total: 0 })
  })

  it('오류 코드는 FoodApiError이고 메시지에 키가 없다', async () => {
    const f = fakeFetch('I2620', 0, 'ERROR-300')
    const err = await fetchService('I2620', 'SECRETKEY', f.impl).catch((e) => e)
    expect(err).toBeInstanceOf(FoodApiError)
    expect(err.code).toBe('ERROR-300')
    expect(String(err)).not.toContain('SECRETKEY')
    expect(String(err.message)).not.toContain('SECRETKEY')
  })

  it('HTTP 실패도 FoodApiError이고 키가 없다', async () => {
    const impl: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) })
    const err = await fetchService('I0490', 'SECRETKEY', impl).catch((e) => e)
    expect(err).toBeInstanceOf(FoodApiError)
    expect(err.code).toBe('HTTP-503')
    expect(String(err)).not.toContain('SECRETKEY')
  })
})
