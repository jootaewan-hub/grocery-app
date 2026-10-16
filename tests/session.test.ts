import { describe, expect, it } from 'vitest'
import { loginErrorMessage, toMembership } from '../src/lib/session'

describe('session', () => {
  it('본인 행이 없으면 null(가구 없음)', () => expect(toMembership('u1', [])).toBeNull())
  it('두 사람을 담는다', () => {
    const m = toMembership('u1', [
      { household_id: 'h', user_id: 'u1', display_name: '태완', spouse_role: 'husband' },
      { household_id: 'h', user_id: 'u2', display_name: '배우자', spouse_role: 'wife' },
    ])
    expect(m).toEqual({ userId: 'u1', householdId: 'h', members: [
      { userId: 'u1', displayName: '태완', spouseRole: 'husband' },
      { userId: 'u2', displayName: '배우자', spouseRole: 'wife' }] })
  })
  it('알 수 없는 spouse_role은 null', () => {
    const m = toMembership('u1', [{ household_id: 'h', user_id: 'u1', display_name: '나', spouse_role: 'other' }])
    expect(m?.members[0].spouseRole).toBeNull()
  })
  it('로그인 오류 문구', () => {
    expect(loginErrorMessage('invalid_credentials')).toBe('이메일이나 비밀번호가 맞지 않아요.')
    expect(loginErrorMessage(undefined)).toBe('지금 로그인할 수 없어요. 잠시 뒤 다시 해 주세요.')
  })
})
