import { describe, expect, it } from 'vitest'
import { parseLines } from '../src/lib/parse'
import { CATEGORIES, categorize } from '../src/lib/categories'

describe('parseLines', () => {
  it.each([
    ['비비고 왕교자 1.05kg x2', { name: '비비고 왕교자', spec: '1.05kg', count: 2, category: '냉동' }],
    ['삼겹살 600g', { name: '삼겹살', spec: '600g', count: 1, category: '정육' }],
    ['계란 30구', { name: '계란', spec: '30구', count: 1, category: '계란' }],
    ['배추 1포기', { name: '배추', spec: '1포기', count: 1, category: '채소' }],
    ['우유 2개', { name: '우유', spec: null, count: 2, category: '유제품' }],
    ['  대파  ', { name: '대파', spec: null, count: 1, category: '채소' }],
    ['콜라 1.5L ×3', { name: '콜라', spec: '1.5L', count: 3, category: '음료' }],
    ['배', { name: '배', spec: null, count: 1, category: '과일' }],
    ['감자 1kg', { name: '감자', spec: '1kg', count: 1, category: '채소' }],
    ['굴 300g', { name: '굴', spec: '300g', count: 1, category: '수산' }],
    ['키친타월', { name: '키친타월', spec: null, count: 1, category: '생활용품' }],
    ['처음 보는 물건', { name: '처음 보는 물건', spec: null, count: 1, category: '기타' }],
  ])('%s', (line, expected) => expect(parseLines(line)).toEqual([expected]))

  it('빈 줄은 건너뛴다', () => expect(parseLines('대파\n\n  \n양파 1.5kg')).toHaveLength(2))
  it('개수 표기 x2, ×2, 2개를 모두 읽는다', () =>
    expect(parseLines('a x2\nb ×2\nc 2개').map((i) => i.count)).toEqual([2, 2, 2]))
  it('개수 0이나 이상한 값은 1로', () => expect(parseLines('우유 x0')[0].count).toBe(1))
  it('N개입은 개수가 아니라 용량', () =>
    expect(parseLines('컵라면 6개입')[0]).toMatchObject({ spec: '6개입', count: 1 }))
})

describe('categorize', () => {
  it('분류 11개', () => expect(CATEGORIES).toHaveLength(11))
  it('한 글자 키워드는 단어 전체일 때만 일치', () => {
    expect(categorize('배달 음식')).toBe('기타')
    expect(categorize('배 5kg')).toBe('과일')
    expect(categorize('굴비')).toBe('기타')
    expect(categorize('총각 무')).toBe('채소')
  })
})
