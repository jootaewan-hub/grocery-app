import { useEffect, useState } from 'react'
import Login from './components/Login'
import NoHousehold from './components/NoHousehold'
import { isConfigured, supabase } from './lib/supabase'
import { loadMembership, type Membership } from './lib/session'

type State =
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'loadFailed' }
  | { kind: 'noHousehold' }
  | { kind: 'ready'; membership: Membership }

export default function App() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined) // undefined: 세션 확인 중
  const [state, setState] = useState<State>({ kind: 'checking' })

  // 로그인·로그아웃·토큰 갱신을 한 곳에서 받는다. 같은 사용자의 토큰 갱신은 userId가 같아 다시 읽지 않는다.
  useEffect(() => {
    if (!isConfigured) return
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (userId === undefined) return
    if (userId === null) {
      setState({ kind: 'signedOut' })
      return
    }
    let cancelled = false
    setState({ kind: 'checking' })
    loadMembership(supabase())
      .then((m) => {
        if (!cancelled) setState(m ? { kind: 'ready', membership: m } : { kind: 'noHousehold' })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'loadFailed' })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const signOut = () => {
    void supabase().auth.signOut()
  }

  if (!isConfigured) return <main className="auth"><h1>앱 설정이 비어 있어요</h1></main>
  switch (state.kind) {
    case 'checking':
      return <main className="auth" aria-busy="true" />
    case 'signedOut':
      return <Login />
    case 'noHousehold':
      return <NoHousehold onSignOut={signOut} />
    case 'loadFailed':
      return (
        <main className="auth">
          <h1>우리집 장보기</h1>
          <p className="auth-lead">가구 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>
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
