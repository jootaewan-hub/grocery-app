import { categorize, type Category } from './categories'

// nameCut: 이름이 길어 NAME_MAX자까지만 담았을 때만 true(미리보기에서 알린다).
export type ParsedItem = { name: string; spec: string | null; count: number; category: Category; nameCut?: true }

// DB 제약(grocery.items): name 1..60자, spec 20자 이하. Postgres char_length는 코드 포인트로 센다.
export const NAME_MAX = 60
export const SPEC_MAX = 20
const cpLength = (s: string) => Array.from(s).length

// 줄 끝의 개수 표기: x2, ×2, 2개 (6개입은 용량이므로 제외 — 줄 끝이 '개'일 때만 일치)
const COUNT_RE = /(?:^|\s|(?<=[가-힣]))(?:[x×]\s*(\d+)|(\d+)\s*개)$/i
// 줄 끝의 용량 표기: 숫자 + 단위(소수점 허용)
const SPEC_RE = /(?:^|\s|(?<=[가-힣]))(\d+(?:\.\d+)?(?:kg|g|ml|L|개입|구|포기|단|마리|팩|봉|병|캔|장|모|롤))$/i

function parseLine(raw: string): ParsedItem | null {
  let rest = raw.trim()
  if (!rest) return null

  let count = 1
  const c = COUNT_RE.exec(rest)
  if (c && rest.slice(0, c.index).trim()) {
    const n = Number(c[1] ?? c[2])
    // DB 제약(1..99)에 맞춘다: 0·비정상은 1, 99 초과는 99
    count = n >= 1 ? Math.min(99, Math.floor(n)) : 1
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
    return { name, spec, count, category: categorize(name), nameCut: true }
  }
  return { name: rest, spec, count, category: categorize(rest) }
}

export function parseLines(text: string): ParsedItem[] {
  return text
    .normalize('NFC') // macOS·일부 키보드의 자모 분리(NFD) 입력 대비
    .split(/\r?\n/)
    .map(parseLine)
    .filter((item): item is ParsedItem => item !== null)
}
