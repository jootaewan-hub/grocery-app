// 다나와 검색·상품 페이지 파서. 사본은 2026-10-19에 받은 실제 응답(검색은 앞 8개 상품만 남김).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  danawaProductUrl,
  danawaSearchUrl,
  DanawaParseError,
  parseDanawaProduct,
  parseDanawaSearch,
} from '../supabase/functions/_shared/danawa'

const read = (f: string) => readFileSync(new URL(`./fixtures/danawa/${f}`, import.meta.url), 'utf8')

describe('다나와 검색', () => {
  it('상품마다 pcode·이름·수량별 가격·100g당 가격·판매처 수를 읽는다', () => {
    const items = parseDanawaSearch(read('search-bibigo.html'))
    expect(items.length).toBe(8)
    const one = items.find((i) => i.pcode === '5643303')!
    expect(one.name).toBe('CJ제일제당 비비고 왕교자 1.05kg')
    expect(one.rating).toBe(4.8)
    expect(one.variants.slice(0, 3)).toEqual([
      { qty: 1, price: 10380, unitPrice: 989, unitLabel: '100g', mallCount: 26 },
      { qty: 2, price: 21150, unitPrice: 1007, unitLabel: '100g', mallCount: 120 },
      { qty: 3, price: 27650, unitPrice: 878, unitLabel: '100g', mallCount: 279 },
    ])
    expect(one.imageUrl).toMatch(/^https:\/\/img\.danuri\.io\//)
  })

  it('리뷰 수 "999+"는 999로, 숫자는 그대로', () => {
    const items = parseDanawaSearch(read('search-bibigo.html'))
    expect(items.find((i) => i.pcode === '5643303')!.reviewCount).toBe(999)
    expect(items.find((i) => i.pcode === '76322327')!.reviewCount).toBe(906)
  })

  it('가격이 한 줄뿐인 상품도 읽는다', () => {
    const items = parseDanawaSearch(read('search-bibigo.html'))
    expect(items.find((i) => i.pcode === '76322327')!.variants).toEqual([
      { qty: 1, price: 15105, unitPrice: 785, unitLabel: '100g', mallCount: 245 },
      { qty: 2, price: 27300, unitPrice: 709, unitLabel: '100g', mallCount: 156 },
    ])
  })

  it('수량 표시 없이 가격 한 줄뿐인 묶음 상품은 1개 가격으로 읽는다', () => {
    const items = parseDanawaSearch(read('search-bibigo.html'))
    expect(items.find((i) => i.pcode === '122645217')!.variants).toEqual([
      { qty: 1, price: 25360, unitPrice: null, unitLabel: null, mallCount: 24 },
    ])
  })

  it('같은 상품(pcode)이 두 번 나오면 앞의 것만 남긴다', () => {
    const html = read('search-bibigo.html')
    const first = html.indexOf('<li class=')
    const firstEnd = html.indexOf('<li class=', first + 10)
    const doubled = html.slice(0, firstEnd) + html.slice(first, firstEnd) + html.slice(firstEnd)
    const items = parseDanawaSearch(doubled)
    expect(items.filter((i) => i.pcode === '7809349')).toHaveLength(1)
    expect(items).toHaveLength(8)
  })

  it('"검색결과가 없습니다" 페이지는 빈 배열', () => {
    expect(parseDanawaSearch(read('search-none.html'))).toEqual([])
  })

  it('상품 줄도 결과 없음 문구도 없으면 DanawaParseError(구조가 바뀜)', () => {
    expect(() => parseDanawaSearch('<html><body><p>점검 중</p></body></html>')).toThrow(DanawaParseError)
  })

  it('상품 줄은 있는데 이름이나 가격을 하나도 못 읽으면 DanawaParseError', () => {
    expect(() => parseDanawaSearch('<ul><li class="x" data-product-seq="1"><a>?</a></li></ul>')).toThrow(DanawaParseError)
  })
})

describe('다나와 상품 페이지', () => {
  it('페이지 수량·수량별 최저가·쇼핑몰 줄·평점', () => {
    const p = parseDanawaProduct(read('product-5643303.html'), '5643303')
    expect(p.pcode).toBe('5643303')
    expect(p.name).toBe('CJ제일제당 비비고 왕교자 1.05kg (3개)')
    expect(p.pageQty).toBe(3)
    expect(p.rating).toBe(4.8)
    expect(p.reviewCount).toBe(9099)
    expect(p.variants.find((v) => v.qty === 1)).toEqual({ qty: 1, price: 10380, unitPrice: 989, unitLabel: '100g', mallCount: 26 })
    expect(p.offers[0]).toEqual({ seller: '롯데ON', price: 27650, delivery: 3000 })
    expect(p.offers.length).toBeGreaterThanOrEqual(5)
    expect(p.offers.every((o) => o.price > 0 && o.seller.length > 0)).toBe(true)
  })

  it('판매처 이름은 몰 이름만: 기호와 결제 수단 표시는 뺀다', () => {
    const p = parseDanawaProduct(read('product-5643303.html'), '5643303')
    expect(p.offers.map((o) => o.seller)).toContain('리니어스토어')
    expect(p.offers.every((o) => !/^[^가-힣A-Za-z0-9]/.test(o.seller) && !o.seller.includes('네이버페이'))).toBe(true)
  })

  it('무료배송은 delivery 0', () => {
    const p = parseDanawaProduct(read('product-5643303.html'), '5643303')
    expect(p.offers.some((o) => o.delivery === 0)).toBe(true)
  })

  it('쇼핑몰별 최저가 구역이 없으면 offers는 빈 배열이고 variants는 그대로', () => {
    const html = read('product-5643303.html').replace(/쇼핑몰별 최저가/g, '다른 제목')
    const p = parseDanawaProduct(html, '5643303')
    expect(p.offers).toEqual([])
    expect(p.variants.length).toBeGreaterThan(0)
  })

  it('JSON-LD 이름이 없으면 pageQty는 null', () => {
    const html = read('product-5643303.html').replace(/"name"\s*:\s*"CJ제일제당 비비고 왕교자 1\.05kg \(3개\)"/, '"name":"CJ제일제당 비비고 왕교자 1.05kg"')
    expect(parseDanawaProduct(html, '5643303').pageQty).toBeNull()
  })

  it('수량 표시도 다른 구성도 없는 단일 상품은 페이지 수량을 1로 본다', () => {
    const html = read('product-5643303.html')
      .replace(/"name"\s*:\s*"CJ제일제당 비비고 왕교자 1\.05kg \(3개\)"/, '"name":"CJ제일제당 비비고 왕교자 1.05kg"')
      .replace(/다른 구성/g, '다른 제목')
    const p = parseDanawaProduct(html, '5643303')
    expect(p.variants).toEqual([])
    expect(p.pageQty).toBe(1)
    expect(p.offers.length).toBeGreaterThan(0)
  })

  it('JSON-LD Product가 없으면 DanawaParseError', () => {
    expect(() => parseDanawaProduct('<html><body>점검 중</body></html>', '1')).toThrow(DanawaParseError)
  })
})

describe('주소', () => {
  it('검색어를 인코딩하고 https만 쓴다', () => {
    expect(danawaSearchUrl('비비고 왕교자&x')).toBe(
      'https://search.danawa.com/?query=%EB%B9%84%EB%B9%84%EA%B3%A0%20%EC%99%95%EA%B5%90%EC%9E%90%26x',
    )
    expect(danawaProductUrl('5643303')).toBe('https://prod.danawa.com/info/?pcode=5643303')
  })
})
