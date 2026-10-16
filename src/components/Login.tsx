import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { loginErrorMessage } from '../lib/session'

export const ACCOUNT_BOOK_URL = 'https://jootaewan-hub.github.io/account-book/'

// initialError는 개발용 화면 캡처에서 오류 문구 모양을 보려고 쓴다.
export default function Login({ initialError = null }: { initialError?: string | null } = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
      if (err) setError(loginErrorMessage(err.code))
    } catch {
      setError(loginErrorMessage(undefined))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <h1>우리집 장보기</h1>
      <p className="auth-lead">가계부와 같은 계정으로 로그인해요</p>
      <form onSubmit={submit} className="auth-form">
        <label>
          이메일
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          비밀번호
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="auth-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>로그인</button>
      </form>
      <a className="auth-link" href={ACCOUNT_BOOK_URL} target="_blank" rel="noreferrer">
        비밀번호를 잊었으면 가계부 앱에서 바꿀 수 있어요
      </a>
    </main>
  )
}
