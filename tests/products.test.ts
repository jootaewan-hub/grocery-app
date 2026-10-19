import { describe, expect, it } from 'vitest'
import { checkedText, kstDay, searchLabel, SHORTCUTS, splitLines, type PriceLine } from '../src/lib/products'

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
})
