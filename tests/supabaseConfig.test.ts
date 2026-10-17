import { describe, expect, it } from 'vitest'
import { DEFAULT_SUPABASE_ORIGIN } from '../src/lib/csp'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../src/lib/supabaseConfig'

describe('코드에 둔 Supabase 공개용 값', () => {
  it('공개용(publishable) 키만 둔다 — 비밀 키·서비스 롤 JWT는 안 된다', () => {
    expect(SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/)
    expect(SUPABASE_PUBLISHABLE_KEY).not.toMatch(/sb_secret_|^eyJ/)
  })
  it('주소는 가계부와 같은 프로젝트의 https 주소', () => {
    expect(new URL(SUPABASE_URL).protocol).toBe('https:')
    expect(new URL(SUPABASE_URL).hostname).toBe('kifdfpbwiebfgvdumqjf.supabase.co')
  })
  it('CSP 기본 주소와 클라이언트 주소가 같다', () => {
    expect(DEFAULT_SUPABASE_ORIGIN).toBe(new URL(SUPABASE_URL).origin)
  })
})
