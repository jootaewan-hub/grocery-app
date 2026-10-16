import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadListView, saveListView } from '../src/lib/prefs'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('목록 보기 기억', () => {
  it('localStorage가 없으면 분류별', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadListView('u1')).toBe('category')
    expect(() => saveListView('u1', 'where')).not.toThrow()
  })

  it('localStorage가 던지면 분류별, 저장은 무시', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    vi.stubGlobal('localStorage', throwing)
    expect(loadListView('u1')).toBe('category')
    expect(() => saveListView('u1', 'where')).not.toThrow()
  })

  it('저장하면 같은 사람은 어디서 살지, 다른 사람은 분류별', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    saveListView('u1', 'where')
    expect(s.getItem('grocery:listView:u1')).toBe('where')
    expect(loadListView('u1')).toBe('where')
    expect(loadListView('u2')).toBe('category')
  })

  it('알 수 없는 값이 저장돼 있으면 분류별', () => {
    const s = memoryStorage()
    s.setItem('grocery:listView:u1', 'price')
    vi.stubGlobal('localStorage', s)
    expect(loadListView('u1')).toBe('category')
  })
})
