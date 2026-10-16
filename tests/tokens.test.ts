import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../src/lib/contrast'

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

/** 블록 시작 문자열 뒤의 첫 { } 안에서 --이름: #hex 를 읽는다 */
function readBlock(start: string): Record<string, string> {
  const at = css.indexOf(start)
  if (at < 0) throw new Error(`tokens.css에 ${start} 블록이 없다`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  const out: Record<string, string> = {}
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toUpperCase()
  return out
}

function tokens(block: 'light' | 'dark'): Record<string, string> {
  return block === 'light' ? readBlock(':root {') : readBlock(':root[data-theme="dark"]')
}

describe('토큰', () => {
  it('contrastRatio 기준값', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#33312D', '#FFFFFF')).toBeCloseTo(12.98, 1)
  })
  it('라이트는 가계부 값 그대로', () => {
    const t = tokens('light')
    expect(t['--canvas']).toBe('#FFFFFF'); expect(t['--oat']).toBe('#F4F1EC'); expect(t['--ink']).toBe('#33312D')
    expect(t['--clay']).toBe('#A8543E'); expect(t['--indigo']).toBe('#3D5A78')
    // 가계부 #77726A와 다르다: 귀리 면 위 4.5:1 규칙을 맞추려고 일부러 어둡게 했다
    expect(t['--ink-faint']).toBe('#726D65')
  })
  it('다크 두 곳(data-theme, 시스템 설정)의 값이 같다', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    expect(readBlock(':root:not([data-theme="light"])')).toEqual(tokens('dark'))
    expect(media).toContain(':root:not([data-theme="light"])')
    expect(Object.keys(tokens('dark')).sort()).toEqual(Object.keys(tokens('light')).sort())
  })
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: 글자 토큰은 바탕과 묶음 면 위에서 4.5:1 이상`, () => {
      const t = tokens(theme)
      for (const fg of ['--ink', '--ink-muted', '--ink-faint', '--sage', '--clay', '--indigo', '--rose-ink'])
        for (const bg of ['--canvas', '--oat'])
          expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 주 버튼 글자(--on-ink on --ink) 4.5:1 이상`, () => {
      const t = tokens(theme)
      expect(contrastRatio(t['--on-ink'], t['--ink'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 배지·태그 글자 쌍 4.5:1 이상`, () => {
      const t = tokens(theme)
      const pairs = [['--clay', '--clay-soft'], ['--rose-ink', '--blush-soft'], ['--on-ink', '--clay'], ['--sage', '--sage-soft']]
      for (const [fg, bg] of pairs) expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
  }
})
