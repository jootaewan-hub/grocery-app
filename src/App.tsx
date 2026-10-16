import { useEffect, useState } from 'react'
import Login from './components/Login'
import NoHousehold from './components/NoHousehold'
import { appView, type AppInput } from './lib/appView'
import { isConfigured, supabase } from './lib/supabase'
import { loadMembership } from './lib/session'

const CHECK_TIMEOUT_MS = 10_000

export default function App() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined) // undefined: 세션 확인 중
  const [household, setHousehold] = useState<AppInput['household']>('loading')
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // 로그인·로그아웃·토큰 갱신을 한 곳에서 받는다. 같은 사용자의 토큰 갱신은 userId가 같아 다시 읽지 않는다.
  // getSession()은 이벤트가 오지 않거나 늦을 때 처음 상태를 정하는 보조 경로다.
  useEffect(() => {
    if (!isConfigured) return
    setUserId(undefined)
    setTimedOut(false)
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    supabase()
      .auth.getSession()
      .then(({ data: d }) => setUserId((cur) => (cur === undefined ? (d.session?.user.id ?? null) : cur)))
      .catch(() => {})
    return () => data.subscription.unsubscribe()
  }, [attempt])

  useEffect(() => {
    if (!isConfigured || userId === undefined || userId === null) return
    let cancelled = false
    setHousehold('loading')
    loadMembership(supabase())
      .then((m) => {
        if (!cancelled) setHousehold(m ? 'ready' : 'none')
      })
      .catch(() => {
        if (!cancelled) setHousehold('failed')
      })
    return () => {
      cancelled = true
    }
  }, [userId, attempt])

  const view = appView({ configured: isConfigured, userId, household, timedOut })

  // 확인 중인 상태가 10초를 넘기면 실패 화면으로 넘어간다.
  const checking = view === 'checking-session' || view === 'checking-household'
  useEffect(() => {
    if (!checking) return
    const t = setTimeout(() => setTimedOut(true), CHECK_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [checking, userId])

  const signOut = () => {
    void supabase().auth.signOut()
  }

  switch (view) {
    case 'config':
      return <main className="auth"><h1>앱 설정이 비어 있어요</h1></main>
    case 'checking-session':
      return <main className="auth" aria-busy="true"><p className="auth-lead">로그인 확인 중</p></main>
    case 'checking-household':
      return <main className="auth" aria-busy="true"><p className="auth-lead">가구 정보 확인 중</p></main>
    case 'login':
      return <Login />
    case 'no-household':
      return <NoHousehold onSignOut={signOut} />
    case 'load-failed':
      return (
        <main className="auth">
          <h1>우리집 장보기</h1>
          <p className="auth-lead">가구 정보를 불러오지 못했어요.</p>
          <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
          <button type="button" className="btn-quiet" onClick={signOut}>로그아웃</button>
        </main>
      )
    case 'ready':
      // Task 7이 목록 화면으로 바꾼다.
      return (
        <main className="auth">
          <h1>이번 장보기</h1>
          <button type="button" className="btn-quiet" onClick={signOut}>로그아웃</button>
        </main>
      )
  }
}
