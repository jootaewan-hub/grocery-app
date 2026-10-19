import { describe, expect, it } from 'vitest'
import { checkedRange, groupAlerts, koFullDay, listStatus, SOURCE_NAME } from '../src/lib/alerts'

const row = (o: Partial<Parameters<typeof groupAlerts>[0][number]>) => ({
  item_id: 'i1',
  source: 'I0490',
  source_id: 's1',
  product_name: '제품',
  maker: null,
  reason: null,
  grade: null,
  pack_unit: null,
  registered_on: '2026-10-01',
  level: 'similar',
  ...o,
})

describe('groupAlerts', () => {
  it('품목별로 묶고 등록일 최신순으로 둔다', () => {
    const g = groupAlerts([
      row({ item_id: 'i1', source_id: 'a', registered_on: '2026-09-01' }),
      row({ item_id: 'i2', source_id: 'b' }),
      row({ item_id: 'i1', source_id: 'c', registered_on: '2026-10-10', product_name: '최신', maker: '업체', pack_unit: '300g' }),
    ])
    expect(g.byItem.get('i1')!.map((a) => a.sourceId)).toEqual(['c', 'a'])
    expect(g.byItem.get('i1')![0]).toEqual({
      source: 'I0490', sourceId: 'c', productName: '최신', maker: '업체', reason: null, grade: null, packUnit: '300g', registeredOn: '2026-10-10',
    })
    expect(g.levels.get('i1')).toBe('similar')
    expect(g.levels.get('i2')).toBe('similar')
  })

  it('record가 하나라도 있으면 record', () => {
    const g = groupAlerts([row({ source_id: 'a' }), row({ source_id: 'b', level: 'record' })])
    expect(g.levels.get('i1')).toBe('record')
  })

  it('빈 입력은 빈 Map', () => {
    const g = groupAlerts([])
    expect(g.byItem.size).toBe(0)
    expect(g.levels.size).toBe(0)
  })
})

describe('koFullDay', () => {
  it('등록일은 연도까지 쓴다', () => {
    expect(koFullDay('2025-11-03')).toBe('2025년 11월 3일')
  })
})

describe('listStatus', () => {
  const now = new Date('2026-10-20T03:00:00Z') // 한국 10월 20일 낮
  const all = (iso: string) => ({ I0490: iso, I2620: iso, I2715: iso })
  it('세 서비스가 모두 48시간 안에 확인됐으면 차분한 한 줄', () => {
    expect(listStatus(all('2026-10-19T22:01:00Z'), now)).toEqual({ tone: 'ok', text: '식약처 목록 10월 20일 확인' })
  })
  it('가장 오래된 확인 날짜를 쓴다', () => {
    expect(listStatus({ ...all('2026-10-19T22:01:00Z'), I2715: '2026-10-18T22:01:00Z' }, now).text).toBe('식약처 목록 10월 19일 확인')
  })
  it('한 번도 확인하지 못했으면 알린다', () => {
    expect(listStatus({}, now)).toEqual({ tone: 'warn', text: '식약처 목록을 아직 확인하지 못했어요' })
  })
  it('빠진 서비스가 있거나 48시간이 지났으면 늦어진다고 알린다', () => {
    expect(listStatus({ I0490: '2026-10-19T22:01:00Z' }, now)).toEqual({ tone: 'warn', text: '식약처 목록 확인이 늦어지고 있어요. 마지막 확인 10월 20일' })
    expect(listStatus(all('2026-10-17T22:01:00Z'), now)).toEqual({ tone: 'warn', text: '식약처 목록 확인이 늦어지고 있어요. 마지막 확인 10월 18일' })
  })
})

describe('checkedRange', () => {
  it('서비스 이름과 확인한 날을 쉼표로 잇는다', () => {
    expect(checkedRange({ I0490: '2026-10-19T22:01:00Z', I2620: '2026-10-18T22:01:00Z' })).toBe(
      `${SOURCE_NAME.I0490} 10월 20일 확인, ${SOURCE_NAME.I2620} 10월 19일 확인`,
    )
  })
  it('확인 기록이 없으면 그렇게 쓴다', () => {
    expect(checkedRange({})).toBe('식약처 목록을 아직 확인하지 못했어요')
  })
})
