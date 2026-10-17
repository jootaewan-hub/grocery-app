import { categorize, type Category } from './categories'
import { STAPLES } from './staples'

// nameCut: 이름이 길어 NAME_MAX자까지만 담았을 때만 true(미리보기에서 알린다).
// specIsDefault: 용량을 적지 않아 기본 용량(STAPLES)을 채웠을 때 true. DB에는 보내지 않는다(spec만 저장).
export type ParsedItem = {
  name: string
  spec: string | null
  count: number
  category: Category
  specIsDefault: boolean
  nameCut?: true
}

// DB 제약(grocery.items): name 1..60자, spec 20자 이하. Postgres char_length는 코드 포인트로 센다.
export const NAME_MAX = 60
export const SPEC_MAX = 20
const cpLength = (s: string) => Array.from(s).length

const UNITS = 'kg|g|ml|L|개입|구|포기|단|마리|팩|봉|병|캔|장|모|롤'
// 줄 끝의 개수 표기: x2, ×2, 2개 (6개입은 용량이므로 제외 — 줄 끝이 '개'일 때만 일치)
const COUNT_RE = /(?:^|\s|(?<=[가-힣]))(?:[x×]\s*(\d+)|(\d+)\s*개)$/i
// 줄 끝의 용량 표기: 숫자(소수점·분수 허용) + 단위
const SPEC_RE = new RegExp(String.raw`(?:^|\s|(?<=[가-힣]))((?:\d+\/\d+|\d+(?:\.\d+)?)(?:${UNITS}))$`, 'i')

function parseLine(raw: string): ParsedItem | null {
  let rest = raw.trim()
  if (!rest) return null

  let count = 1
  let countGiven = false
  const c = COUNT_RE.exec(rest)
  if (c && rest.slice(0, c.index).trim()) {
    const n = Number(c[1] ?? c[2])
    // DB 제약(1..99)에 맞춘다: 0·비정상은 1, 99 초과는 99
    count = n >= 1 ? Math.min(99, Math.floor(n)) : 1
    countGiven = true
    rest = rest.slice(0, c.index).trim()
  }

  let spec: string | null = null
  const s = SPEC_RE.exec(rest)
  // 20자가 넘는 "용량"은 용량이 아닐 가능성이 크다(예: 상품 번호). 잘라 내지 않고 이름에 남긴다.
  if (s && rest.slice(0, s.index).trim() && cpLength(s[1]) <= SPEC_MAX) {
    spec = s[1]
    rest = rest.slice(0, s.index).trim()
  }

  // 쇼핑몰 상품명을 통째로 붙여 넣는 경우: 한 줄 때문에 전체 담기가 실패하지 않게 60자에서 자른다.
  if (cpLength(rest) > NAME_MAX) {
    const name = Array.from(rest).slice(0, NAME_MAX).join('').trimEnd()
    return { name, spec, count, category: categorize(name), specIsDefault: false, nameCut: true }
  }
  // 용량도 개수도 안 적은 흔한 품목은 기본 용량을 채운다(이름이 표와 정확히 같을 때만).
  const base = !spec && !countGiven && Object.hasOwn(STAPLES, rest) ? STAPLES[rest] : null
  if (base) return { name: rest, spec: base, count, category: categorize(rest), specIsDefault: true }
  return { name: rest, spec, count, category: categorize(rest), specIsDefault: false }
}

// ── 품목 나누기 ──
// 줄바꿈·쉼표로 나눈 한 조각을 띄어쓰기 단위 토큰으로 보고 품목 경계를 정한다.
const BRANDS = new Set(
  [
    '비비고', '풀무원', 'CJ', '오뚜기', '농심', '동원', '청정원', '하림', '매일', '서울우유', '남양', '빙그레',
    '해태', '롯데', '오리온', '삼양', '사조', '백설', '종가집', '대상', '샘표', '해표', '피코크', '노브랜드',
  ].map((b) => b.toLowerCase()),
)
// 수량 토큰: 600g, 1.5kg, 1/2포기, 30구, 2개, x2, ×2
const QTY_TOKEN_RE = new RegExp(String.raw`^(?:\d+\/\d+|\d+(?:\.\d+)?)(?:${UNITS}|개)$|^[x×]\d+$`, 'i')

function splitChunk(chunk: string): string[] {
  const tokens = chunk.split(/\s+/).filter(Boolean)
  const items: string[] = []
  let words: string[] = []
  let hasStaple = false
  let hasQty = false
  let lastBrand = false // 방금 넣은 말이 브랜드: 뒤따르는 말이 오면 "브랜드 + 상품"으로 한 품목이 갖춰진다
  const flush = () => {
    if (words.length) items.push(words.join(' '))
    words = []
    hasStaple = false
    hasQty = false
    lastBrand = false
  }
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i]
    // "x 6"처럼 띄어 쓴 개수는 한 덩어리로 본다
    if (/^[x×]$/i.test(t) && /^\d+$/.test(tokens[i + 1] ?? '')) t = `${t} ${tokens[++i]}`
    if (words.length && (QTY_TOKEN_RE.test(t) || /^[x×] \d+$/i.test(t))) {
      words.push(t)
      hasQty = true
      continue
    }
    const staple = Object.hasOwn(STAPLES, t)
    const brand = BRANDS.has(t.toLowerCase())
    // 수량까지 적은 품목 뒤의 말은 새 품목이다. 단독 품목 단어가 이미 있는데 또 단독 품목 단어나 브랜드가 와도 새 품목이다.
    if (words.length && (hasQty || ((staple || brand) && hasStaple))) flush()
    words.push(t)
    if (staple || (lastBrand && !brand)) hasStaple = true
    lastBrand = brand
  }
  flush()
  return items
}

export function parseLines(text: string): ParsedItem[] {
  return text
    .normalize('NFC') // macOS·일부 키보드의 자모 분리(NFD) 입력 대비
    .split(/[\r\n,，、]+/)
    .flatMap(splitChunk)
    .map(parseLine)
    .filter((item): item is ParsedItem => item !== null)
}
