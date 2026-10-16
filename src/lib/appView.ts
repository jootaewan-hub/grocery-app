export type AppView = 'config' | 'checking-session' | 'login' | 'checking-household' | 'no-household' | 'load-failed' | 'ready'

type UserKey = string | null | undefined

export type AppInput = {
  configured: boolean
  userId: UserKey // undefined: 세션 확인 중
  // 가구 판정은 어느 사용자에 대해 구한 것인지를 함께 가진다.
  household: { forUser: UserKey; state: 'loading' | 'none' | 'failed' | 'ready' }
  // 확인이 10초를 넘긴 사용자. 다른 사용자로 바뀌면 이어지지 않는다.
  timedOut: { forUser: UserKey } | null
}

export function appView(s: AppInput): AppView {
  if (!s.configured) return 'config'
  const timedOut = s.timedOut !== null && s.timedOut.forUser === s.userId
  if (s.userId === null) return 'login' // 가구를 읽는 중이어도 로그아웃이면 로그인
  if (s.userId === undefined) return timedOut ? 'load-failed' : 'checking-session'
  // 이전 사용자의 판정이면 쓰지 않는다.
  if (s.household.forUser !== s.userId || s.household.state === 'loading') {
    return timedOut ? 'load-failed' : 'checking-household'
  }
  switch (s.household.state) {
    case 'none': return 'no-household'
    case 'failed': return 'load-failed'
    case 'ready': return 'ready'
  }
}
