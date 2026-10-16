import { categorize, type Category } from './categories'

export type ParsedItem = { name: string; spec: string | null; count: number; category: Category }

// 줄 끝의 개수 표기: x2, ×2, 2개 (6개입은 용량이므로 제외 — 줄 끝이 '개'일 때만 일치)
const COUNT_RE = /(?:^|\s)(?:[x×]\s*(\d+)|(\d+)\s*개)$/i
// 줄 끝의 용량 표기: 숫자 + 단위(소수점 허용)
const SPEC_RE = /(?:^|\s)(\d+(?:\.\d+)?(?:kg|g|ml|L|개입|구|포기|단|마리|팩|봉|병|캔|장))$/i

function parseLine(raw: string): ParsedItem | null {
  let rest = raw.trim()
  if (!rest) return null

  let count = 1
  const c = COUNT_RE.exec(rest)
  if (c && rest.slice(0, c.index).trim()) {
    const n = Number(c[1] ?? c[2])
    count = Number.isInteger(n) && n >= 1 ? n : 1
    rest = rest.slice(0, c.index).trim()
  }

  let spec: string | null = null
  const s = SPEC_RE.exec(rest)
  if (s && rest.slice(0, s.index).trim()) {
    spec = s[1]
    rest = rest.slice(0, s.index).trim()
  }

  return { name: rest, spec, count, category: categorize(rest) }
}

export function parseLines(text: string): ParsedItem[] {
  return text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((item): item is ParsedItem => item !== null)
}
