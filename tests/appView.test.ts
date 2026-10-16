import { describe, expect, it } from 'vitest'
import { appView, type AppInput } from '../src/lib/appView'

const base: AppInput = { configured: true, userId: 'u1', household: { forUser: 'u1', state: 'ready' }, timedOut: null }
const hh = (forUser: string | null | undefined, state: AppInput['household']['state']) => ({ forUser, state })

describe('appView', () => {
  it('설정이 없으면 config', () => expect(appView({ ...base, configured: false })).toBe('config'))
  it('세션 확인 중', () => expect(appView({ ...base, userId: undefined, household: hh(undefined, 'loading') })).toBe('checking-session'))
  it('세션 없음은 login', () => expect(appView({ ...base, userId: null })).toBe('login'))
  it('가구 확인 중', () => expect(appView({ ...base, household: hh('u1', 'loading') })).toBe('checking-household'))
  it('가구 없음', () => expect(appView({ ...base, household: hh('u1', 'none') })).toBe('no-household'))
  it('읽기 실패', () => expect(appView({ ...base, household: hh('u1', 'failed') })).toBe('load-failed'))
  it('가구 있음', () => expect(appView(base)).toBe('ready'))
  it('가구를 읽는 중 로그아웃하면 login', () =>
    expect(appView({ ...base, userId: null, household: hh('u1', 'loading') })).toBe('login'))
  it('세션 확인이 10초를 넘기면 load-failed', () =>
    expect(appView({ ...base, userId: undefined, household: hh(undefined, 'loading'), timedOut: { forUser: undefined } })).toBe('load-failed'))
  it('가구 확인이 10초를 넘기면 load-failed', () =>
    expect(appView({ ...base, household: hh('u1', 'loading'), timedOut: { forUser: 'u1' } })).toBe('load-failed'))
  it('시간 초과여도 로그인 화면은 그대로', () =>
    expect(appView({ ...base, userId: null, timedOut: { forUser: 'u1' } })).toBe('login'))
  it('사용자 A의 가구 판정은 사용자 B에게 쓰지 않는다', () => {
    for (const state of ['ready', 'none', 'failed'] as const) {
      expect(appView({ ...base, userId: 'uB', household: hh('uA', state) })).toBe('checking-household')
    }
  })
  it('시간 초과는 새 사용자에게 이어지지 않는다', () =>
    expect(appView({ ...base, userId: 'uB', household: hh('uB', 'loading'), timedOut: { forUser: 'uA' } })).toBe('checking-household'))
})
