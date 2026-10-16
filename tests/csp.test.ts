import { describe, expect, it } from 'vitest'
import { buildCsp } from '../src/lib/csp'

const origin = 'https://abcdefgh.supabase.co'
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''

describe('CSP', () => {
  const csp = buildCsp(origin)
  it('img-src에 아무 https나 허용하는 값이 없다', () => {
    const img = directive(csp, 'img-src').split(' ')
    expect(img).not.toContain('https:')
    expect(img).toContain(origin)
  })
  it('connect-src는 주어진 Supabase 주소와 그 wss만, *.supabase.co는 없다', () => {
    const connect = directive(csp, 'connect-src')
    expect(connect).toContain(origin)
    expect(connect).toContain('wss://abcdefgh.supabase.co')
    expect(connect).not.toContain('*')
  })
  it("frame-src 'none'", () => {
    expect(csp).toContain("frame-src 'none'")
  })
})
