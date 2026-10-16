import { describe, expect, it } from 'vitest'
import { appView, type AppInput } from '../src/lib/appView'

const base: AppInput = { configured: true, userId: 'u1', household: 'ready', timedOut: false }

describe('appView', () => {
  it('설정이 없으면 config', () => expect(appView({ ...base, configured: false })).toBe('config'))
  it('세션 확인 중', () => expect(appView({ ...base, userId: undefined, household: 'loading' })).toBe('checking-session'))
  it('세션 없음은 login', () => expect(appView({ ...base, userId: null })).toBe('login'))
  it('가구 확인 중', () => expect(appView({ ...base, household: 'loading' })).toBe('checking-household'))
  it('가구 없음', () => expect(appView({ ...base, household: 'none' })).toBe('no-household'))
  it('읽기 실패', () => expect(appView({ ...base, household: 'failed' })).toBe('load-failed'))
  it('가구 있음', () => expect(appView(base)).toBe('ready'))
  it('가구를 읽는 중 로그아웃하면 login', () =>
    expect(appView({ ...base, userId: null, household: 'loading' })).toBe('login'))
  it('세션 확인이 10초를 넘기면 load-failed', () =>
    expect(appView({ ...base, userId: undefined, household: 'loading', timedOut: true })).toBe('load-failed'))
  it('가구 확인이 10초를 넘기면 load-failed', () =>
    expect(appView({ ...base, household: 'loading', timedOut: true })).toBe('load-failed'))
  it('시간 초과여도 로그인 화면은 그대로', () =>
    expect(appView({ ...base, userId: null, timedOut: true })).toBe('login'))
})
