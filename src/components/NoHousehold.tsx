import { ACCOUNT_BOOK_URL } from './Login'

export default function NoHousehold({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="auth">
      <h1>우리집 장보기</h1>
      <p className="auth-lead">가계부 앱에서 가구를 먼저 만들거나 초대 코드로 참여해 주세요.</p>
      <a className="auth-link" href={ACCOUNT_BOOK_URL} target="_blank" rel="noreferrer">가계부 앱 열기</a>
      <button type="button" className="btn-quiet" onClick={onSignOut}>로그아웃</button>
    </main>
  )
}
