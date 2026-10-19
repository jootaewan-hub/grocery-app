import { describe, expect, it } from 'vitest'
import { checkedText, farmLine, isFresh, isStale, kstDay, priceRowText, ratingNote, safetySummary, searchLabel, SHORTCUTS, splitLines, toFind, type ItemSearch, type PriceLine, type SafetyRecord } from '../src/lib/products'
import type { Item } from '../src/lib/types'

const line = (p: Partial<PriceLine>): PriceLine => ({
  price: 10000, seller: null, source: 'danawa', qty: 1, delivery: null, checkedAt: '2026-10-20T01:00:00Z',
  unitPrice: null, unitLabel: null, mallCount: null, ...p,
})

describe('kstDay', () => {
  it('한국 날짜로 바꾼다', () => {
    expect(kstDay('2026-10-19T15:00:00Z')).toBe('2026-10-20')
    expect(kstDay('2026-10-19T14:59:59Z')).toBe('2026-10-19')
  })
})

describe('splitLines', () => {
  const today = '2026-10-20'
  it('오늘·같은 수량 줄에서 최저가를 고르고 싼 순서로 둔다', () => {
    const r = splitLines([line({ price: 12000, seller: 'G마켓' }), line({ price: 10380, seller: '11번가' })], 1, today)
    expect(r.best?.seller).toBe('11번가')
    expect(r.same.map((l) => l.price)).toEqual([10380, 12000])
    expect(r.other).toEqual([])
  })

  it('수량이 다르면 other로 보낸다', () => {
    const r = splitLines([line({ qty: 3, price: 27650 }), line({ qty: 1, price: 10380 })], 1, today)
    expect(r.same.map((l) => l.qty)).toEqual([1])
    expect(r.other.map((l) => l.qty)).toEqual([3])
  })

  it('어제 확인한 값은 가장 싼 값이 될 수 없다(같은 수량이어도 other)', () => {
    const r = splitLines([line({ price: 9000, checkedAt: '2026-10-19T14:00:00Z' })], 1, today)
    expect(r.best).toBeNull()
    expect(r.other).toHaveLength(1)
  })

  it('0원·음수·NaN은 버린다', () => {
    const r = splitLines([line({ price: 0 }), line({ price: -1 }), line({ price: Number.NaN }), line({ price: 500 })], 1, today)
    expect(r.same.map((l) => l.price)).toEqual([500])
  })

  it('같은 값이면 판매처가 있는 줄이 먼저', () => {
    const r = splitLines([line({ price: 10380, seller: null }), line({ price: 10380, seller: '옥션' })], 1, today)
    expect(r.best?.seller).toBe('옥션')
  })
})

describe('바로가기', () => {
  it('쿠팡·SSG·롯데ON·G마켓·컬리, 모두 https이고 검색어를 인코딩한다', () => {
    expect(SHORTCUTS.map((s) => s.name)).toEqual(['쿠팡', 'SSG(이마트몰)', '롯데ON', 'G마켓', '컬리'])
    for (const s of SHORTCUTS) {
      const u = s.url('비비고 왕교자&1')
      expect(u.startsWith('https://')).toBe(true)
      expect(u).toContain(encodeURIComponent('비비고 왕교자&1'))
    }
  })
})

describe('확인 시각 문구', () => {
  const now = new Date('2026-10-20T03:00:00Z') // 한국 12:00
  it('오늘이면 "오늘 HH:MM", 아니면 "M월 D일 HH:MM"(한국 시간)', () => {
    expect(checkedText('2026-10-20T00:10:00Z', now)).toBe('오늘 09:10')
    expect(checkedText('2026-10-19T14:59:00Z', now)).toBe('10월 19일 23:59')
  })
})

describe('목록 줄의 후보 상태 문구', () => {
  it('상태마다 하는 일 그대로', () => {
    expect(searchLabel({ status: 'searching', candidateCount: 0, updatedAt: 't' })).toBe('후보 찾는 중')
    expect(searchLabel({ status: 'done', candidateCount: 8, updatedAt: 't' })).toBe('후보 8개 찾음')
    expect(searchLabel({ status: 'none', candidateCount: 0, updatedAt: 't' })).toBe('후보를 찾지 못했어요')
    expect(searchLabel({ status: 'error', candidateCount: 0, updatedAt: 't' })).toBe('후보를 찾지 못했어요(다시 시도)')
    expect(searchLabel(null)).toBe('상품 고르기 전')
  })

  it('신선 품목은 후보 상태 대신 시세로 확인한다고 쓴다(이전에 찾은 후보가 있어도)', () => {
    expect(searchLabel({ status: 'done', candidateCount: 40, updatedAt: 't' }, true)).toBe('농수산물 시세로 확인(준비 중)')
    expect(searchLabel(null, true)).toBe('농수산물 시세로 확인(준비 중)')
  })
})

describe('품목 상세 문구', () => {
  it('가격 줄: 배송비가 있으면 금액, 0이면 무료배송, 모르면 확인 못 함', () => {
    expect(priceRowText(line({ price: 10380, delivery: 3000 }))).toBe('10,380원, 배송비 3,000원')
    expect(priceRowText(line({ price: 10380, delivery: 0 }))).toBe('10,380원, 무료배송')
    expect(priceRowText(line({ price: 10380, delivery: null }))).toBe('10,380원, 배송비 확인 못 함')
  })

  const rec = (p: Partial<SafetyRecord>): SafetyRecord => ({
    source: 'I0490', sourceId: '1', productName: 'x', maker: null, reason: null, grade: null, packUnit: null, registeredOn: null,
    via: 'item_name', farm: false, ...p,
  })

  const synced = { I0490: 't', I2620: 't', I2715: 't' }
  it('식약처 기록 요약: 농가 기록을 빼고 출처별 건수, 없으면 찾은 기록 없음', () => {
    expect(safetySummary([rec({}), rec({ sourceId: '2', source: 'I2620' }), rec({ sourceId: '3', source: 'I2620' })], synced)).toBe('회수·판매중지 1건, 검사부적합 2건')
    expect(safetySummary([rec({ source: 'I2620', farm: true })], synced)).toBe('찾은 기록 없음')
    expect(safetySummary([], synced)).toBe('찾은 기록 없음')
  })

  it('식약처 목록을 한 번도 받지 못했으면 기록 없음 대신 확인 못 함', () => {
    expect(safetySummary([], {})).toBe('확인 못 함')
    expect(safetySummary([], { I0490: 't' })).toBe('찾은 기록 없음')
  })

  it('평점 기준 시각: 읽은 시각이 있으면 다나와와 시각, 없으면 시각 모름', () => {
    expect(ratingNote('2026-10-20T00:10:00Z', new Date('2026-10-20T03:00:00Z'))).toBe('다나와, 오늘 09:10')
    expect(ratingNote(null)).toBe('다나와(확인 시각 모름)')
  })

  it('농가 단위 기록 줄: 있으면 건수, 없으면 null', () => {
    expect(farmLine([rec({ farm: true }), rec({ sourceId: '2', farm: true }), rec({ sourceId: '3' })])).toBe('같은 품목 농산물 부적합 2건(농가 단위)')
    expect(farmLine([rec({})])).toBeNull()
  })
})

describe('자동 후보 찾기 대상', () => {
  const NOW = Date.parse('2026-10-20T03:00:00Z')
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const it_ = (p: Partial<Item>): Item => ({
    id: 'i', householdId: 'h', name: 'x', spec: null, count: 1, category: '기타', productKey: null, productQty: null,
    addedBy: 'u', addedAt: 't', boughtBy: null, boughtAt: null, paid: null, ...p,
  })
  const search = (status: ItemSearch['status'], updatedAt: string): ItemSearch => ({ status, candidateCount: 0, updatedAt })

  it('상태가 없고 요청한 적 없는 안 산·안 고른 품목만', () => {
    const items = [it_({ id: 'a' }), it_({ id: 'b', boughtAt: 't' }), it_({ id: 'c', productKey: 'p' }), it_({ id: 'd' })]
    const searches = new Map([['d', search('done', ago(1000))]])
    expect(toFind(items, searches, new Map(), NOW)).toEqual(['a'])
  })

  it('2분 안에 요청한 품목은 다시 고르지 않는다(상태가 아직 없어도) — 요청이 끝없이 반복되지 않게', () => {
    const items = [it_({ id: 'a' })]
    expect(toFind(items, new Map(), new Map([['a', NOW - 60_000]]), NOW)).toEqual([])
    expect(toFind(items, new Map(), new Map([['a', NOW - 121_000]]), NOW)).toEqual(['a'])
  })

  it('신선 품목(정육·수산·채소·과일)은 다나와에서 찾지 않는다(농수산물 시세로 확인)', () => {
    const items = [it_({ id: 'a', category: '채소' }), it_({ id: 'b', category: '과일' }), it_({ id: 'c', category: '정육' }), it_({ id: 'd', category: '수산' }), it_({ id: 'e', category: '냉동' })]
    expect(toFind(items, new Map(), new Map(), NOW)).toEqual(['e'])
    expect(isFresh('채소')).toBe(true)
    expect(isFresh('유제품')).toBe(false)
  })

  it('찾는 중이 2분 넘게 멈춘 품목은 다시 찾는다', () => {
    const items = [it_({ id: 'a' }), it_({ id: 'b' })]
    const searches = new Map([['a', search('searching', ago(121_000))], ['b', search('searching', ago(30_000))]])
    expect(toFind(items, searches, new Map(), NOW)).toEqual(['a'])
    expect(isStale(searches.get('a')!, NOW)).toBe(true)
    expect(isStale(searches.get('b')!, NOW)).toBe(false)
  })
})
