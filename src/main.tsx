import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { watchForUpdates } from './lib/pwaUpdate'
import './styles/tokens.css'
import './styles/app.css'

// 개발 서버에서만: ?demo=1(데모 목록), ?demo=empty(빈 목록), ?demo=error(목록 불러오기 실패),
// ?demo=login(로그인, &error=1이면 오류 문구), ?demo=nohousehold.
// import.meta.env.DEV가 빌드에서 false로 바뀌어 이 분기와 데모 모듈은 빌드 결과에 들어가지 않는다.
async function devScreen(): Promise<ReactNode | null> {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('demo')
  if (mode === '1' || mode === 'empty' || mode === 'error') {
    const [{ demoSeed }, { createMemoryStore }, { default: ListScreen }] = await Promise.all([
      import('./demo'),
      import('./lib/store'),
      import('./components/ListScreen'),
    ])
    const d = demoSeed()
    const memory = createMemoryStore(mode === '1' ? d.items : [], d.me, undefined, mode === '1' ? d.alerts : undefined, mode === '1' ? d.prices : undefined)
    const store = mode === 'error' ? { ...memory, list: () => Promise.reject(new Error('데모: 불러오기 실패')) } : memory
    return <ListScreen store={store} me={d.me} />
  }
  if (mode === 'login') {
    const [{ default: Login }, { loginErrorMessage }] = await Promise.all([import('./components/Login'), import('./lib/session')])
    return <Login initialError={params.get('error') ? loginErrorMessage(undefined) : null} />
  }
  if (mode === 'nohousehold') {
    const { default: NoHousehold } = await import('./components/NoHousehold')
    return <NoHousehold onSignOut={() => {}} />
  }
  return null
}

// 새 버전이 배포되면 받아서 페이지를 새로 고친다(autoUpdate). 기다리던 빼기는 pagehide에서 먼저 지운다(ListScreen).
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) watchForUpdates(() => registration.update())
  },
})

const root = createRoot(document.getElementById('root')!)
const show = (screen: ReactNode) => root.render(<StrictMode>{screen}</StrictMode>)
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
  void devScreen().then((screen) => show(screen ?? <App />))
} else {
  show(<App />)
}
