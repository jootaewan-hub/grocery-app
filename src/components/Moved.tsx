// 2026-10-19 장보기는 가계부 앱의 '장보기' 탭으로 옮겨졌다(D-010). 예전 주소로 들어오면 이 안내를 보여 주고 가계부 장보기 탭으로 넘긴다.
import { useEffect } from 'react'

export const NEW_URL = 'https://jootaewan-hub.github.io/account-book/?tab=grocery'
const WAIT_MS = 5000

export default function Moved() {
  useEffect(() => {
    const t = window.setTimeout(() => window.location.replace(NEW_URL), WAIT_MS)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <main className="auth">
      <h1>장보기가 가계부 앱으로 옮겨졌어요</h1>
      <p className="auth-lead">이제 가계부 앱의 '장보기' 탭에서 같은 목록을 써요. 담아 둔 품목도 그대로 있어요.</p>
      <p className="auth-lead">홈 화면의 장보기 아이콘은 지워도 돼요. 잠시 뒤 가계부 장보기 탭으로 넘어가요.</p>
      <a className="btn-primary moved-go" href={NEW_URL}>가계부 장보기 탭 열기</a>
    </main>
  )
}
