// 다나와 검색 결과·상품 페이지에서 상품·가격을 읽는다. Deno(Edge Function)와 Node(Vitest)가 함께 import하므로
// 외부 라이브러리 없이 정규식과 태그 제거만 쓴다. 다나와 화면 구조가 바뀌면 읽지 못한 것을 DanawaParseError로 알린다
// (빈 값이나 어제 값을 오늘 값처럼 내지 않게). 확인한 구조: 2026-10-19 사본(tests/fixtures/danawa).
// robots: search.danawa.com은 Crawl-delay 10, prod.danawa.com은 /info/ 허용(/info/ajax/ 등 금지) — 여기서는 주소만 만든다.

export type DanawaVariant = { qty: number; price: number; unitPrice: number | null; unitLabel: string | null; mallCount: number | null }
export type DanawaSearchItem = {
  pcode: string
  name: string
  imageUrl: string | null
  rating: number | null
  reviewCount: number | null
  variants: DanawaVariant[]
}
/** delivery 0 = 무료배송, null = 표시가 없어 모름 */
export type DanawaOffer = { seller: string; price: number; delivery: number | null }
export type DanawaProduct = {
  pcode: string
  name: string
  imageUrl: string | null
  rating: number | null
  reviewCount: number | null
  /** 쇼핑몰 줄이 가리키는 수량(JSON-LD 이름의 "(N개)"). 못 읽으면 null */
  pageQty: number | null
  variants: DanawaVariant[]
  offers: DanawaOffer[]
}

export class DanawaParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DanawaParseError'
  }
}

export function danawaSearchUrl(query: string): string {
  return `https://search.danawa.com/?query=${encodeURIComponent(query)}`
}

export function danawaProductUrl(pcode: string): string {
  return `https://prod.danawa.com/info/?pcode=${encodeURIComponent(pcode)}`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

function unescape(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

/** 태그를 지우고 글자 조각만 순서대로 돌려준다. 스크립트·스타일·주석은 뺀다. */
function tokens(html: string): string[] {
  return unescape(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '\u0001')
      .replace(/<style[\s\S]*?<\/style>/gi, '\u0001')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '\u0001'),
  )
    .split('\u0001')
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function textOf(html: string): string {
  return tokens(html).join(' ')
}

function num(s: string): number | null {
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const QTY = /^(\d{1,3})개$/
const PRICE_WON = /^([\d,]+)원$/
const BARE_NUM = /^[\d,]+$/
const UNIT = /^([\d,]+)원\/(\d*(?:g|kg|ml|l|개|매|입))$/i
const MALLS = /^([\d,]+)몰$/
const PAY = /(네이버|카카오|토스|스마일|쿠|삼성|애플)페이|페이코/

/** "N개 | (가격원 | 가격 원) | 단위가격 | (M몰 | M 몰)" 묶음을 읽는다. 순서가 출처마다 조금 달라 앞뒤 몇 칸 안에서 찾는다. */
function readVariants(ts: string[]): DanawaVariant[] {
  const out: DanawaVariant[] = []
  for (let i = 0; i < ts.length; i++) {
    const q = ts[i].match(QTY)
    if (!q) continue
    let price: number | null = null
    let unitPrice: number | null = null
    let unitLabel: string | null = null
    let mallCount: number | null = null
    let j = i + 1
    for (; j < ts.length && j <= i + 8; j++) {
      const t = ts[j]
      if (QTY.test(t)) break
      let m: RegExpMatchArray | null
      if ((m = t.match(UNIT))) {
        unitPrice = num(m[1])
        unitLabel = m[2]
      } else if (price === null && (m = t.match(PRICE_WON))) {
        price = num(m[1])
      } else if (price === null && BARE_NUM.test(t) && ts[j + 1] === '원') {
        price = num(t)
        j++
      } else if ((m = t.match(MALLS))) {
        mallCount = num(m[1])
        break
      } else if (price !== null && BARE_NUM.test(t) && ts[j + 1] === '몰') {
        mallCount = num(t)
        j++
        break
      }
    }
    if (price !== null && price > 0) {
      out.push({ qty: Number(q[1]), price, unitPrice, unitLabel, mallCount })
      i = j
    }
  }
  // 같은 수량이 두 번 읽히면 앞의 것(그 상품의 줄)만 남긴다
  const seen = new Set<number>()
  return out.filter((v) => (seen.has(v.qty) ? false : (seen.add(v.qty), true)))
}

function ratingAndReviews(ts: string[]): { rating: number | null; reviewCount: number | null } {
  const i = ts.indexOf('리뷰수')
  if (i < 0) return { rating: null, reviewCount: null }
  const r = ts[i - 1]?.match(/^(\d(?:\.\d)?)$/)
  let reviewCount: number | null = null
  for (let j = i + 1; j <= i + 3 && j < ts.length; j++) {
    const m = ts[j].match(/^\(?([\d,]+)\+?\)?$/)
    if (m) {
      reviewCount = num(m[1])
      break
    }
  }
  return { rating: r ? Number(r[1]) : null, reviewCount }
}

const LI = /<li class="[^"]*" data-product-seq="(\d+)">/g

export function parseDanawaSearch(html: string): DanawaSearchItem[] {
  const starts = [...html.matchAll(LI)]
  if (starts.length === 0) {
    if (html.includes('검색결과가 없습니다')) return []
    throw new DanawaParseError('search: no product rows')
  }
  const items: DanawaSearchItem[] = []
  const seen = new Set<string>() // 광고 자리와 일반 결과에 같은 상품이 나오면 앞의 것만(한 번에 upsert할 때 겹치면 실패한다)
  for (let k = 0; k < starts.length; k++) {
    if (seen.has(starts[k][1])) continue
    const begin = starts[k].index! + starts[k][0].length
    const end = k + 1 < starts.length ? starts[k + 1].index! : html.length
    const body = html.slice(begin, end)
    const nameHtml = body.match(/class="font-bold text-dnw-gray-900[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    // 검색어 강조(<b>)가 단어를 쪼개므로 태그를 사이 공백 없이 지운다
    const name = nameHtml ? unescape(nameHtml[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() : ''
    const ts = tokens(body)
    const from = Math.max(0, ts.indexOf('상품분류'))
    const after = ts.slice(from)
    const variants = readVariants(after)
    // 묶음 구성 상품은 수량 표시 없이 "가격원 | M | 몰" 한 줄만 있다 → 그 구성 1개의 가격
    if (variants.length === 0) {
      const p = after.findIndex((t) => PRICE_WON.test(t))
      if (p >= 0) {
        const price = num(after[p].match(PRICE_WON)![1])
        const next = after[p + 1] ?? ''
        const mall = MALLS.test(next) ? num(next.match(MALLS)![1]) : BARE_NUM.test(next) && after[p + 2] === '몰' ? num(next) : null
        if (price !== null && price > 0) variants.push({ qty: 1, price, unitPrice: null, unitLabel: null, mallCount: mall })
      }
    }
    if (!name || variants.length === 0) continue
    const img = body.match(/src="(https:\/\/img\.danuri\.io\/[^"]+)"/)
    seen.add(starts[k][1])
    items.push({ pcode: starts[k][1], name, imageUrl: img ? unescape(img[1]) : null, ...ratingAndReviews(ts), variants })
  }
  if (items.length === 0) throw new DanawaParseError('search: rows without name or price')
  return items
}

type JsonLdProduct = {
  '@type'?: string
  name?: string
  image?: string | string[]
  aggregateRating?: { ratingValue?: string | number; reviewCount?: string | number }
}

function findProductLd(html: string): JsonLdProduct | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1])
      for (const x of Array.isArray(d) ? d : [d]) if (x && x['@type'] === 'Product') return x as JsonLdProduct
    } catch {
      // 다른 JSON-LD 블록이 깨져 있어도 나머지를 본다
    }
  }
  return null
}

function readOffers(html: string): DanawaOffer[] {
  const i = html.indexOf('쇼핑몰별 최저가')
  if (i < 0) return []
  const end = html.indexOf('최저가 추이', i)
  const seg = html.slice(i, end > i ? end : i + 40000)
  const rows = seg.split(/<li class="list-item[^"]*"/).slice(1)
  const out: DanawaOffer[] = []
  for (const row of rows) {
    const logo = row.match(/class="box__logo"([\s\S]*?)<div class="box__price/)
    const alt = logo?.[1].match(/alt=['"]([^'"]{1,40})['"]/)
    // 로고가 없으면 글자에서 몰 이름만 고른다(앞의 기호, 뒤의 결제 수단 표시는 뺀다)
    const named = logo ? tokens(logo[1]).find((t) => /^[가-힣A-Za-z0-9]/.test(t) && !PAY.test(t)) : undefined
    const seller = (alt ? unescape(alt[1]) : (named ?? '')).trim()
    const priceHtml = row.match(/class="sell-price"([\s\S]*?)<\/div>/)
    const price = priceHtml ? num((textOf(priceHtml[1]).match(/[\d,]+/) ?? [''])[0]) : null
    const delHtml = row.match(/class="box__delivery"([\s\S]*?)<\/div>/)
    const delText = delHtml ? textOf(delHtml[1]) : ''
    const delivery = /무료/.test(delText) ? 0 : (() => {
      const m = delText.match(/([\d,]+)\s*원/)
      return m ? num(m[1]) : null
    })()
    if (seller && price !== null && price > 0) out.push({ seller, price, delivery })
  }
  return out
}

export function parseDanawaProduct(html: string, pcode: string): DanawaProduct {
  const ld = findProductLd(html)
  if (!ld || !ld.name) throw new DanawaParseError('product: no JSON-LD Product')
  const name = unescape(ld.name).trim()
  const q = name.match(/\((\d{1,3})개\)\s*$/)
  const ts = tokens(html)
  const other = ts.indexOf('다른 구성')
  const variants = other >= 0 ? readVariants(ts.slice(other, other + 300)) : []
  const image = Array.isArray(ld.image) ? ld.image[0] : ld.image
  const rv = ld.aggregateRating?.ratingValue
  const rc = ld.aggregateRating?.reviewCount
  return {
    pcode,
    name,
    imageUrl: typeof image === 'string' && image.startsWith('https://') ? image : null,
    rating: rv != null && Number.isFinite(Number(rv)) ? Number(rv) : null,
    reviewCount: rc != null && Number.isFinite(Number(rc)) ? Number(rc) : null,
    // 이름에 "(N개)"가 없고 다른 구성도 없으면 수량 선택이 없는 단일 상품: 쇼핑몰 줄은 1개 가격
    pageQty: q ? Number(q[1]) : variants.length === 0 ? 1 : null,
    variants,
    offers: readOffers(html),
  }
}
