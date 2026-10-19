// 설치한 앱(PWA)이 예전 버전에 머물지 않게 한다.
// 서비스 워커는 페이지를 새로 열 때만 새 버전을 확인해서, 휴대폰에서 앱을 띄워 둔 채 쓰면 배포가 늦게 반영된다
// (2026-10-19 배포 주소에서 예전 화면이 계속 보였다). 앱으로 돌아올 때마다 확인하고,
// 새 버전이 있으면 registerType 'autoUpdate'가 받아서 페이지를 새로 고친다(main.tsx).
type VisibilityDoc = Pick<Document, 'visibilityState'> & {
  addEventListener(type: 'visibilitychange', handler: () => void): void
}

export function watchForUpdates(update: () => Promise<unknown>, doc: VisibilityDoc = document): void {
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') return
    update().catch(() => {}) // 오프라인이면 다음에 다시 확인한다
  })
}
