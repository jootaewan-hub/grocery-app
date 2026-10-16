import { describe, expect, it } from 'vitest'
import { loadMembership, loginErrorMessage, toMembership } from '../src/lib/session'

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

describe('loadMembership', () => {
  // 호출된 조건을 기록하는 가짜 클라이언트
  function fake(householdRows: unknown[], memberRows: unknown[], calls: string[]) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        let n = 0
        q.select = (cols: string) => { calls.push(`${table}.select(${cols})`); n = cols === 'household_id' ? 1 : 2; return q }
        q.eq = (col: string, v: string) => { calls.push(`eq(${col},${v})`); return n === 2 ? Promise.resolve({ data: memberRows, error: null }) : q }
        q.limit = (k: number) => { calls.push(`limit(${k})`); return Promise.resolve({ data: householdRows, error: null }) }
        return q
      },
    } as unknown as Parameters<typeof loadMembership>[0]
  }
  it('내 가구 id로 범위를 좁혀 읽는다', async () => {
    const calls: string[] = []
    const m = await loadMembership(fake([{ household_id: 'h' }], [
      { household_id: 'h', user_id: 'u1', display_name: '태완', spouse_role: 'husband' }], calls))
    expect(m?.householdId).toBe('h')
    expect(calls).toContain('eq(user_id,u1)')
    expect(calls).toContain('eq(household_id,h)')
  })
  it('내 행이 없으면 구성원을 읽지 않고 null', async () => {
    const calls: string[] = []
    expect(await loadMembership(fake([], [], calls))).toBeNull()
    expect(calls.some((c) => c.startsWith('eq(household_id'))).toBe(false)
  })
})
