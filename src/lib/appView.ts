export type AppView = 'config' | 'checking-session' | 'login' | 'checking-household' | 'no-household' | 'load-failed' | 'ready'

export type AppInput = {
  configured: boolean
  userId: string | null | undefined // undefined: 세션 확인 중
  household: 'loading' | 'none' | 'failed' | 'ready'
  timedOut: boolean // 확인이 10초를 넘김
}

export function appView(s: AppInput): AppView {
  if (!s.configured) return 'config'
  if (s.userId === null) return 'login' // 가구를 읽는 중이어도 로그아웃이면 로그인
  if (s.userId === undefined) return s.timedOut ? 'load-failed' : 'checking-session'
  switch (s.household) {
    case 'loading': return s.timedOut ? 'load-failed' : 'checking-household'
    case 'none': return 'no-household'
    case 'failed': return 'load-failed'
    case 'ready': return 'ready'
  }
}
