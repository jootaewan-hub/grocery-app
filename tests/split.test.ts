import { describe, expect, it } from 'vitest'
import { parseLines, SPEC_MAX } from '../src/lib/parse'
import { STAPLES } from '../src/lib/staples'

const names = (t: string) => parseLines(t).map((i) => i.name)

describe('품목 나누기', () => {
  it('띄어쓰기만 있어도 나눈다', () =>
    expect(names('양파 당근 감자 비비고 왕교자 파')).toEqual(['양파', '당근', '감자', '비비고 왕교자', '파']))
  it('쉼표로 나누고 수량은 앞 품목에 붙는다', () => {
    const r = parseLines('양파, 당근, 비비고 왕교자 1.05kg x2')
    expect(r.map((i) => [i.name, i.spec, i.count])).toEqual([
      ['양파', '2개', 1], ['당근', '1개', 1], ['비비고 왕교자', '1.05kg', 2],
    ])
  })
  it('전각 쉼표·모점도 쉼표로 본다', () => expect(names('양파，당근、감자')).toEqual(['양파', '당근', '감자']))
  it('빈 조각은 버린다', () => expect(names('양파,, ,당근,')).toEqual(['양파', '당근']))
  it('한우 국거리 300g은 한 품목', () => {
    const r = parseLines('한우 국거리 300g')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: '한우 국거리', spec: '300g' })
  })
  it('삼겹살 목살은 2개', () => expect(names('삼겹살 목살')).toEqual(['삼겹살', '목살']))
  it('대파 1단 양파 2개', () => {
    const r = parseLines('대파 1단 양파 2개')
    expect(r.map((i) => [i.name, i.spec, i.count])).toEqual([['대파', '1단', 1], ['양파', null, 2]])
  })
  it('처음 보는 물건은 한 품목', () => expect(names('처음 보는 물건')).toEqual(['처음 보는 물건']))
  it('브랜드는 앞에 단독 품목이 있을 때만 새 품목을 연다', () => {
    expect(names('비비고 왕교자')).toEqual(['비비고 왕교자'])
    expect(names('두부 풀무원 순두부')).toEqual(['두부', '풀무원 순두부'])
  })
  it('수량 뒤에 오는 일반 단어는 새 품목이다', () =>
    expect(names('삼겹살 600g 한우 국거리')).toEqual(['삼겹살', '한우 국거리']))
  it('줄바꿈과 섞어 쓴다', () => expect(names('양파 당근\n비비고 왕교자, 파')).toEqual(['양파', '당근', '비비고 왕교자', '파']))
  it('x 6처럼 띄어 쓴 개수는 앞 품목에 붙는다', () => {
    const r = parseLines('물 2L x 6 우유')
    expect(r.map((i) => [i.name, i.spec, i.count])).toEqual([['물', '2L', 6], ['우유', '900ml', 1]])
  })
  it('분수 용량', () => {
    expect(parseLines('배추 1/2포기')[0]).toMatchObject({ name: '배추', spec: '1/2포기', specIsDefault: false })
  })
})

describe('기본 수량', () => {
  it('용량·개수를 안 적으면 기본 용량을 채우고 표시한다', () => {
    expect(parseLines('양파')[0]).toMatchObject({ name: '양파', spec: '2개', count: 1, specIsDefault: true })
    expect(parseLines('계란')[0]).toMatchObject({ spec: '10구', specIsDefault: true })
  })
  it('개수를 적으면 채우지 않는다', () =>
    expect(parseLines('양파 x2')[0]).toMatchObject({ spec: null, count: 2, specIsDefault: false }))
  it('x1처럼 1을 적어도 적은 것이다', () =>
    expect(parseLines('양파 x1')[0]).toMatchObject({ spec: null, count: 1, specIsDefault: false }))
  it('용량을 적으면 그대로 둔다', () =>
    expect(parseLines('삼겹살 400g')[0]).toMatchObject({ spec: '400g', specIsDefault: false }))
  it('이름이 정확히 같을 때만 채운다', () => {
    expect(parseLines('한우 삼겹살')[0]).toMatchObject({ spec: null, specIsDefault: false })
    expect(parseLines('양파링')[0]).toMatchObject({ spec: null, specIsDefault: false })
  })
  it('사용자에게 보여 준 값', () => {
    const shown = {
      양파: '2개', 당근: '1개', 감자: '3개', 대파: '1단', 사과: '4개', 배추: '1/2포기',
      애호박: '1개', 두부: '1모', 계란: '10구', 우유: '900ml', 삼겹살: '600g', 고등어: '1마리',
    }
    for (const [k, v] of Object.entries(shown)) expect([k, STAPLES[k]]).toEqual([k, v])
  })
  it('모든 기본 용량은 DB 제약(20자)과 용량 표기를 지킨다', () => {
    for (const [k, v] of Object.entries(STAPLES)) {
      expect([k, Array.from(v).length <= SPEC_MAX]).toEqual([k, true])
      expect([k, /^\d+(?:\.\d+)?(?:\/\d+)?(?:kg|g|ml|L|개|단|포기|봉|팩|모|마리|구)$/.test(v)]).toEqual([k, true])
    }
  })
  it('기본 용량 키는 모두 분류가 있다(기타 아님)', async () => {
    const { categorize } = await import('../src/lib/categories')
    for (const k of Object.keys(STAPLES)) expect([k, categorize(k) !== '기타']).toEqual([k, true])
  })
})

describe('나누기 보강', () => {
  it('품목 단어(사전 키워드)가 이어지면 나눈다', () => {
    expect(names('라면 두부 계란')).toEqual(['라면', '두부', '계란'])
    expect(names('식빵 우유 휴지')).toEqual(['식빵', '우유', '휴지'])
  })
  it('수식어는 항상 앞 품목에 붙는다', () => {
    expect(names('한우 국거리 300g')).toEqual(['한우 국거리'])
    expect(names('양파 국산 당근')).toEqual(['양파 국산', '당근'])
  })
  it('수량만 있는 조각은 앞 품목에 붙는다', () => {
    expect(parseLines('양파, 2개')[0]).toMatchObject({ name: '양파', spec: null, count: 2, specIsDefault: false })
    expect(parseLines('양파, 2개')).toHaveLength(1)
  })
  it('앞 품목이 없는 수량만의 입력은 버린다', () => {
    expect(parseLines('600g')).toEqual([])
    expect(parseLines('2개, 3개')).toEqual([])
  })
  it('숫자 사이의 쉼표는 나누지 않는다', () => expect(names('휴지 1,000원')).toEqual(['휴지 1,000원']))
  it('두 단어짜리 상품은 합친다', () => {
    const r = parseLines('딸기 우유')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: '딸기 우유', category: '유제품', spec: null, specIsDefault: false })
    expect(names('딸기 우유 계란')).toEqual(['딸기 우유', '계란'])
  })
})
