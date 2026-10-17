import { categorize, KEYWORD_TABLE, type Category } from './categories'
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

const UNITS = 'kg|g|ml|L|개입|구|포기|단|마리|팩|봉|병|캔|장|모|롤|판|망|근'
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

// 품목 단어: 단독 품목 표(STAPLES)나 분류 사전의 두 글자 이상 키워드와 단어 전체가 같은 말.
const KEYWORDS_2P = new Set(KEYWORD_TABLE.flatMap(([, kws]) => kws.filter((k) => Array.from(k).length >= 2)))
// 수식어: 품목 단어여도 항상 현재 품목에 붙는다(새 품목을 열지도, 품목으로 세지도 않는다).
const MODIFIERS = new Set([
  '국거리', '구이용', '찌개용', '불고기용', '수육용', '볶음용', '튀김용', '다짐육', '왕교자', '물만두',
  '국산', '국내산', '수입', '미국산', '호주산', '냉동', '생', '유기농', '무항생제',
  // 고기 앞에 붙는 말("돼지 목살"): 품목 단어로 세지 않고 뒤 품목에 붙는다
  '한우', '한돈', '돼지', '소고기', '쇠고기', '닭', '오리',
])
// 상품 형태를 나타내는 끝말("오렌지 주스"): 항상 앞 품목에 붙는다. 우유·치즈는 단독으로 흔히 사서 넣지 않는다.
const FORM_SUFFIXES = new Set(['주스', '요거트', '요구르트', '드레싱', '소스', '잼', '즙', '칩', '라떼', '스무디'])
// 두 단어가 합쳐야 한 상품인 것(둘 다 품목 단어라서 그대로 두면 갈라진다)
const COMPOUNDS = new Set(['딸기 우유', '바나나 우유', '초코 우유', '커피 우유'])
// 개수 표기(x2, 2개)인가, 용량 표기인가
const isCountQty = (t: string) => /^[x×]/i.test(t) || /^\d+개$/.test(t)
const hasKind = (item: string, count: boolean) => {
  const tokens = item.replace(/([x×])\s+(\d+)/gi, '$1$2').split(/\s+/)
  return tokens.some((q) => QTY_TOKEN_RE.test(q) && isCountQty(q) === count)
}
const isQty = (t: string) => QTY_TOKEN_RE.test(t) || /^[x×] \d+$/i.test(t)

// 말 뒤에 붙여 쓴 수량을 떼어 낸다: 계란1판 → 계란 + 1판, 우유x2 → 우유 + x2. 단위가 없는 숫자(비타500)는 그대로 둔다.
const ATTACHED_QTY_RE = new RegExp(String.raw`^(.*?[가-힣A-Za-z])((?:\d+\/\d+|\d+(?:\.\d+)?)(?:${UNITS}|개)|[x×]\d+)$`, 'i')
function splitAttachedQty(token: string): string[] {
  const m = ATTACHED_QTY_RE.exec(token)
  return m ? [m[1], m[2]] : [token]
}

// 말 끝에 숫자가 붙은 상품명(비타500)은 그 자체로 한 품목 단어다.
const MODEL_NAME_RE = /^[가-힣A-Za-z]+\d+$/

// 이어지는 조각들을 한 목록으로 모은다: 수량만 있는 조각은 바로 앞 품목에 붙고, 앞 품목이 없으면 버린다.
function splitChunk(chunk: string, items: string[]): void {
  const tokens = chunk.split(/\s+/).filter(Boolean).flatMap(splitAttachedQty)
  let words: string[] = []
  let hasItem = false
  let hasQty = false
  let lastBrand = false // 방금 넣은 말이 브랜드: 뒤따르는 말이 오면 "브랜드 + 상품"으로 한 품목이 갖춰진다
  const flush = () => {
    if (words.length) items.push(words.join(' '))
    words = []
    hasItem = false
    hasQty = false
    lastBrand = false
  }
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i]
    // "x 6"처럼 띄어 쓴 개수는 한 덩어리로 본다
    if (/^[x×]$/i.test(t) && /^\d+$/.test(tokens[i + 1] ?? '')) t = `${t} ${tokens[++i]}`
    else if (COMPOUNDS.has(`${t} ${tokens[i + 1] ?? ''}`)) t = `${t} ${tokens[++i]}`
    if (isQty(t)) {
      if (words.length) {
        words.push(t)
        hasQty = true
      } else if (items.length) {
        // 앞 품목에 같은 종류(개수/용량)가 이미 있으면 버리고, 없으면 붙인다
        const last = items[items.length - 1]
        if (!hasKind(last, isCountQty(t.replace(/\s+/g, '')))) items[items.length - 1] = `${last} ${t}`
      } // 앞 품목이 없으면 버린다
      continue
    }
    const modifier = MODIFIERS.has(t) || FORM_SUFFIXES.has(t)
    const brand = BRANDS.has(t.toLowerCase())
    const itemWord = !modifier && !brand && (Object.hasOwn(STAPLES, t) || COMPOUNDS.has(t) || KEYWORDS_2P.has(t) || MODEL_NAME_RE.test(t))
    // 수량까지 적은 품목 뒤의 말은 새 품목이다. 품목 단어가 이미 있는데 또 품목 단어나 브랜드가 와도 새 품목이다(수식어는 제외).
    if (words.length && (hasQty || (!modifier && (itemWord || brand) && hasItem))) flush()
    words.push(t)
    if (itemWord || (lastBrand && !brand)) hasItem = true
    lastBrand = brand
  }
  flush()
}

export function parseLines(text: string): ParsedItem[] {
  return text
    .normalize('NFC') // macOS·일부 키보드의 자모 분리(NFD) 입력 대비
    .split(/[\r\n]+|(?<!\d),|,(?!\d)|[，、]/) // 숫자 사이의 쉼표(1,000)는 나누지 않는다
    .reduce<string[]>((items, chunk) => (splitChunk(chunk, items), items), [])
    .map(parseLine)
    .filter((item): item is ParsedItem => item !== null)
}
