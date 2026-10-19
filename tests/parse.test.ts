import { describe, expect, it } from 'vitest'
import { parseLines } from '../src/lib/parse'
import { CATEGORIES, KEYWORD_TABLE, categorize } from '../src/lib/categories'

describe('parseLines', () => {
  it.each([
    ['비비고 왕교자 1.05kg x2', { name: '비비고 왕교자', spec: '1.05kg', count: 2, category: '냉동', specIsDefault: false }],
    ['삼겹살 600g', { name: '삼겹살', spec: '600g', count: 1, category: '정육', specIsDefault: false }],
    ['계란 30구', { name: '계란', spec: '30구', count: 1, category: '계란', specIsDefault: false }],
    ['배추 1포기', { name: '배추', spec: '1포기', count: 1, category: '채소', specIsDefault: false }],
    ['우유 2개', { name: '우유', spec: null, count: 2, category: '유제품', specIsDefault: false }],
    ['  대파  ', { name: '대파', spec: '1단', count: 1, category: '채소', specIsDefault: true }],
    ['콜라 1.5L ×3', { name: '콜라', spec: '1.5L', count: 3, category: '음료', specIsDefault: false }],
    ['배', { name: '배', spec: '2개', count: 1, category: '과일', specIsDefault: true }],
    ['감자 1kg', { name: '감자', spec: '1kg', count: 1, category: '채소', specIsDefault: false }],
    ['굴 300g', { name: '굴', spec: '300g', count: 1, category: '수산', specIsDefault: false }],
    ['키친타월', { name: '키친타월', spec: null, count: 1, category: '생활용품', specIsDefault: false }],
    ['처음 보는 물건', { name: '처음 보는 물건', spec: null, count: 1, category: '기타', specIsDefault: false }],
  ])('%s', (line, expected) => expect(parseLines(line)).toEqual([expected]))

  it('빈 줄은 건너뛴다', () => expect(parseLines('대파\n\n  \n양파 1.5kg')).toHaveLength(2))
  it('개수 표기 x2, ×2, 2개를 모두 읽는다', () =>
    expect(parseLines('a x2\nb ×2\nc 2개').map((i) => i.count)).toEqual([2, 2, 2]))
  it('개수 0이나 이상한 값은 1로', () => {
    expect(parseLines('우유 x0')[0]).toMatchObject({ name: '우유', count: 1 })
  })
  it('개수는 99까지', () => expect(parseLines('우유 x150')[0]).toMatchObject({ name: '우유', count: 99 }))
  it('붙여 쓴 용량', () =>
    expect(parseLines('삼겹살600g')[0]).toMatchObject({ name: '삼겹살', spec: '600g', category: '정육' }))
  it('모 단위', () => expect(parseLines('두부 2모')[0]).toMatchObject({ name: '두부', spec: '2모', count: 1 }))
  it('롤 단위', () =>
    expect(parseLines('휴지 30롤')[0]).toEqual({ name: '휴지', spec: '30롤', count: 1, category: '생활용품', specIsDefault: false }))
  it('물 2L x 6', () =>
    expect(parseLines('물 2L x 6')[0]).toEqual({ name: '물', spec: '2L', count: 6, category: '음료', specIsDefault: false }))
  it('NFD 입력도 같은 결과', () =>
    expect(parseLines('대파'.normalize('NFD'))[0]).toMatchObject({ name: '대파', category: '채소' }))
  it('N개입은 개수가 아니라 용량', () =>
    expect(parseLines('컵라면 6개입')[0]).toMatchObject({ spec: '6개입', count: 1 }))

  // DB 제약: name 1..60자, spec 20자 이하(Postgres char_length는 코드 포인트로 센다)
  const cp = (s: string) => Array.from(s).length
  it('긴 이름은 60자(코드 포인트)까지만 담고 표시해 둔다', () => {
    const [p] = parseLines('가'.repeat(70))
    expect(cp(p.name)).toBe(60)
    expect(p.name).toBe('가'.repeat(60))
    expect(p.nameCut).toBe(true)
  })
  it('이모지(서로게이트 쌍)는 한 글자로 센다', () => {
    const [p] = parseLines('🍎'.repeat(70))
    expect(cp(p.name)).toBe(60)
    expect(p.name).toBe('🍎'.repeat(60))
    expect(p.name.length).toBe(120) // UTF-16 길이로 자르면 30개가 된다
  })
  it('이모지 59개 + 글자 1개 = 60자는 자르지 않는다', () => {
    const [p] = parseLines('🍎'.repeat(59) + '가')
    expect(cp(p.name)).toBe(60)
    expect(p.nameCut).toBeUndefined()
  })
  it('자른 끝의 공백은 지운다', () => {
    const [p] = parseLines('가'.repeat(59) + ' 나다라마바')
    expect(p.name).toBe('가'.repeat(59))
    expect(p.nameCut).toBe(true)
  })
  it('긴 이름 뒤의 용량·개수는 그대로 읽는다', () =>
    expect(parseLines('가'.repeat(70) + ' 500g x2')[0]).toMatchObject({ name: '가'.repeat(60), spec: '500g', count: 2, nameCut: true }))
  it('20자가 넘는 용량 표기는 용량으로 보지 않고 이름에 남긴다', () => {
    const line = '설탕 ' + '1'.repeat(20) + 'g'
    expect(parseLines(line)[0]).toEqual({ name: line, spec: null, count: 1, category: '가공', specIsDefault: false })
  })
  it('딱 20자 용량은 용량으로 읽는다', () =>
    expect(parseLines('설탕 ' + '1'.repeat(19) + 'g')[0]).toMatchObject({ name: '설탕', spec: '1'.repeat(19) + 'g' }))
  it('60자 이하 이름에는 표시가 없다', () =>
    expect(parseLines('가'.repeat(60))[0]).toEqual({ name: '가'.repeat(60), spec: null, count: 1, category: '기타', specIsDefault: false }))
})

describe('categorize', () => {
  it.each([
    ['고추장', '가공'], ['참치캔', '가공'], ['오리온 초코파이', '가공'], ['딸기잼', '가공'],
    ['감자칩', '가공'], ['피자치즈', '유제품'], ['새우깡', '가공'], ['양파링', '가공'],
    ['닭가슴살 500g', '정육'], ['열무 1단', '채소'], ['총각무', '채소'], ['실파', '채소'],
    ['닭다리', '정육'], ['찹쌀', '가공'], ['김밥', '가공'], ['떡볶이', '가공'], ['단무지', '가공'],
    ['생수', '음료'],
    // 잎채소·나물(신선 품목이라 다나와 대신 농수산물 시세로 확인한다)
    ['고수', '채소'], ['쑥갓', '채소'], ['취나물', '채소'], ['참나물', '채소'], ['얼갈이', '채소'],
    ['근대', '채소'], ['아욱', '채소'], ['치커리', '채소'], ['바질', '채소'], ['고춧잎', '채소'],
  ])('%s -> %s', (name, cat) => expect(categorize(name)).toBe(cat))
  it('사전의 모든 키워드는 단독으로 자기 분류가 된다', () => {
    for (const [cat, kws] of KEYWORD_TABLE) for (const kw of kws) expect([kw, categorize(kw)]).toEqual([kw, cat])
  })
  it('분류 11개', () => expect(CATEGORIES).toHaveLength(11))
  it('한 글자 키워드는 단어 전체일 때만 일치', () => {
    expect(categorize('배달 음식')).toBe('기타')
    expect(categorize('배 5kg')).toBe('과일')
    expect(categorize('굴비')).toBe('기타')
    expect(categorize('총각 무')).toBe('채소')
  })
})

describe('판 단위', () => {
  it('계란 1판은 용량', () =>
    expect(parseLines('계란 1판')[0]).toMatchObject({ name: '계란', spec: '1판', count: 1, specIsDefault: false }))
})
