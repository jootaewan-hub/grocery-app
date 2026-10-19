import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Moved from './components/Moved'
import './styles/tokens.css'
import './styles/app.css'

// 장보기는 가계부 앱으로 옮겨졌다(D-010). 이 주소는 안내만 보여 준다.
// 설치된 앱이 예전 화면을 캐시에서 계속 열지 않게 서비스 워커 등록을 풀고 캐시를 지운다
// (vite.config.ts의 selfDestroying이 만든 sw.js도 같은 일을 한다).
void navigator.serviceWorker?.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {})
void globalThis.caches?.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {})

createRoot(document.getElementById('root')!).render(<StrictMode><Moved /></StrictMode>)
