import { describe, expect, it, vi } from 'vitest'
import { watchForUpdates } from '../src/lib/pwaUpdate'

function fakeDoc() {
  const handlers: (() => void)[] = []
  return {
    visibilityState: 'hidden' as DocumentVisibilityState,
    addEventListener: (_: 'visibilitychange', h: () => void) => { handlers.push(h) },
    removeEventListener: () => {},
    fire() { handlers.forEach((h) => h()) },
  }
}

describe('새 버전 확인', () => {
  it('앱으로 돌아올 때마다 새 버전을 확인한다', () => {
    const doc = fakeDoc()
    const update = vi.fn(async () => {})
    watchForUpdates(update, doc)
    doc.fire() // 숨겨질 때는 확인하지 않는다
    expect(update).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    doc.fire()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('확인이 실패해도(오프라인) 오류를 밖으로 내지 않는다', async () => {
    const doc = fakeDoc()
    doc.visibilityState = 'visible'
    const update = vi.fn(async () => { throw new Error('offline') })
    watchForUpdates(update, doc)
    doc.fire()
    await Promise.resolve()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
