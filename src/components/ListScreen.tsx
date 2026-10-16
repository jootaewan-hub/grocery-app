import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { groupByCategory, groupByWhere, summarize } from '../lib/listView'
import type { ParsedItem } from '../lib/parse'
import { loadListView, saveListView, type ListViewMode } from '../lib/prefs'
import type { Membership } from '../lib/session'
import type { ListStore } from '../lib/store'
import type { AlertLevel, Item, PriceCompare } from '../lib/types'
import { josa } from '../lib/format'
import AddSheet from './AddSheet'
import ListRow from './ListRow'

const UNDO_MS = 5000

// 이 계획에서는 가격·식약처 대조가 없다. 빈 값으로 넘겨 모두 "확인 못 함"이 되게 한다.
const NO_ALERTS: ReadonlyMap<string, AlertLevel> = new Map()
const NO_PRICES: ReadonlyMap<string, PriceCompare> = new Map()

type Props = {
  store: ListStore
  me: Membership
  onSignOut?: () => void
}

type Notice = { kind: 'removed'; id: string; name: string } | { kind: 'error'; text: string }

export default function ListScreen({ store, me, onSignOut }: Props) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [staleError, setStaleError] = useState(false) // 한 번 불러온 뒤 다시 불러오기에 실패
  const [view, setView] = useState<ListViewMode>(() => loadListView(me.userId))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const pending = useRef(new Map<string, number>()) // 빼기 대기 중인 id → 타이머
  const noticeTimer = useRef<number | undefined>(undefined)
  const opener = useRef<HTMLElement | null>(null)
  const seq = useRef(0)

  const refetch = useCallback(() => {
    const mine = ++seq.current
    store.list().then(
      (list) => {
        if (mine !== seq.current) return
        setItems(list)
        setLoadState('ready')
        setStaleError(false)
      },
      () => {
        if (mine !== seq.current) return
        setLoadState((s) => (s === 'ready' ? 'ready' : 'error'))
        setStaleError(true)
      },
    )
  }, [store])

  // 처음 불러오기, 실시간 구독(구독마다 채널이 하나 생기므로 정리 때 꼭 해제), 화면으로 돌아왔을 때 다시 불러오기.
  useEffect(() => {
    setItems(null)
    setLoadState('loading')
    refetch()
    const unsubscribe = store.subscribe(refetch)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      seq.current++
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [store, refetch])

  const showNotice = useCallback((n: Notice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), UNDO_MS)
  }, [])

  // 빼기: 줄은 바로 숨기고, 5초 뒤에 지운다. 되돌리기는 타이머를 지우고 줄을 다시 보인다.
  const commitRemove = useCallback(
    (id: string): Promise<void> => {
      pending.current.delete(id)
      return store.remove(id).then(
        () => {
          // 다시 불러오기가 돌아오기 전에 줄이 잠깐 되살아나지 않게, 지역 목록에서 먼저 뺀 뒤 숨김을 푼다.
          setItems((l) => l?.filter((i) => i.id !== id) ?? l)
          setHidden((h) => without(h, id))
          refetch()
        },
        () => {
          setHidden((h) => without(h, id))
          showNotice({ kind: 'error', text: '빼지 못했어요. 잠시 뒤 다시 해 주세요.' })
        },
      )
    },
    [store, refetch, showNotice],
  )

  const remove = (item: Item) => {
    setOpenRow(null)
    setHidden((h) => new Set(h).add(item.id))
    const t = window.setTimeout(() => commitRemove(item.id), UNDO_MS)
    pending.current.set(item.id, t)
    showNotice({ kind: 'removed', id: item.id, name: item.name })
  }

  const undo = (id: string) => {
    const t = pending.current.get(id)
    if (t !== undefined) {
      window.clearTimeout(t)
      pending.current.delete(id)
      setHidden((h) => without(h, id))
    }
    window.clearTimeout(noticeTimer.current)
    setNotice(null)
  }

  // 기다리던 빼기를 지금 지운다. 앱이 백그라운드로 가거나(휴대폰은 그대로 종료될 수 있다) 로그아웃할 때 쓴다.
  // 되돌릴 수 없게 되므로 "되돌리기" 알림도 닫는다.
  const flushRemovals = useCallback((): Promise<unknown> => {
    const ids = [...pending.current.keys()]
    if (ids.length === 0) return Promise.resolve()
    for (const id of ids) window.clearTimeout(pending.current.get(id))
    setNotice((n) => (n?.kind === 'removed' ? null : n))
    return Promise.allSettled(ids.map(commitRemove))
  }, [commitRemove])

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flushRemovals()
    }
    const onPageHide = () => void flushRemovals()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flushRemovals])

  // 로그아웃은 기다리던 빼기가 서버에 닿은 뒤에 한다(세션이 먼저 사라지면 지우기 요청이 거부된다).
  const signOut = onSignOut
    ? async () => {
        await flushRemovals()
        onSignOut()
      }
    : undefined

  // 화면을 떠나면 기다리던 빼기는 바로 지운다(사용자가 이미 뺀 것이므로).
  useEffect(() => {
    const map = pending.current
    return () => {
      window.clearTimeout(noticeTimer.current)
      for (const [id, t] of map) {
        window.clearTimeout(t)
        void store.remove(id).catch(() => {})
      }
      map.clear()
    }
  }, [store])

  // 열린 "빼기"는 다른 곳을 누르면 닫는다.
  useEffect(() => {
    if (openRow === null) return
    const onDown = (e: PointerEvent) => {
      const row = (e.target as Element | null)?.closest?.('[data-row-id]')
      if (row?.getAttribute('data-row-id') !== openRow) setOpenRow(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [openRow])

  const toggle = (item: Item) => {
    const bought = item.boughtAt === null
    // 바로 보이게 먼저 바꾸고, 저장 결과로 다시 맞춘다.
    setItems((list) =>
      list?.map((i) =>
        i.id !== item.id
          ? i
          : bought
            ? { ...i, boughtBy: me.userId, boughtAt: new Date().toISOString() }
            : { ...i, boughtBy: null, boughtAt: null, paid: null },
      ) ?? list,
    )
    store.setBought(item.id, bought).then(refetch, () => {
      refetch()
      showNotice({ kind: 'error', text: '체크를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.' })
    })
  }

  const add = async (parsed: ParsedItem[]) => {
    await store.add(parsed)
    refetch()
  }

  const chooseView = (v: ListViewMode) => {
    setView(v)
    saveListView(me.userId, v)
  }

  const openSheet = (e: MouseEvent<HTMLButtonElement>) => {
    opener.current = e.currentTarget
    setSheetOpen(true)
  }
  const closeSheet = () => {
    setSheetOpen(false)
    opener.current?.focus({ preventScroll: true })
  }

  const visible = useMemo(() => (items ?? []).filter((i) => !hidden.has(i.id)), [items, hidden])
  const sections = useMemo(
    () => (view === 'category' ? groupByCategory(visible, NO_ALERTS) : groupByWhere(visible, NO_ALERTS, NO_PRICES)),
    [view, visible],
  )
  const sum = summarize(visible, NO_PRICES)
  const ready = loadState === 'ready' && items !== null

  return (
    <div className="list-page">
      <header className="list-head">
        <h1>이번 장보기</h1>
        <div className="list-head-actions">
          <button type="button" className="btn-primary only-wide" onClick={openSheet}>담기</button>
          {signOut && <button type="button" className="btn-text" onClick={() => void signOut()}>로그아웃</button>}
        </div>
      </header>

      <main className="list-main" aria-busy={loadState === 'loading'}>
        {loadState === 'loading' && (
          <div className="skeleton" aria-hidden="true">
            <div className="summary">
              <div className="summary-cell sk" />
              <div className="summary-cell sk" />
              <div className="summary-cell sk" />
            </div>
            <div className="sk sk-seg" />
            <div className="sk sk-group" />
          </div>
        )}
        {loadState === 'loading' && <p className="sr-only" role="status">목록 불러오는 중</p>}

        {loadState === 'error' && (
          <div className="state">
            <p>목록을 불러오지 못했어요.</p>
            <button type="button" className="btn-secondary" onClick={() => { setLoadState('loading'); refetch() }}>
              다시 시도
            </button>
          </div>
        )}

        {ready && (
          <div className="fade-in">
            <section className="summary" aria-label="요약">
              <div className="summary-cell">
                <p className="summary-k">살 것</p>
                <p className="summary-v num">{sum.toBuy}개</p>
              </div>
              <div className="summary-cell">
                <p className="summary-k">찾은 최저가 합계</p>
                <p className="summary-v num">{sum.lowestTotal === null ? '확인 못 함' : `${sum.lowestTotal.toLocaleString('ko-KR')}원`}</p>
              </div>
              <div className="summary-cell">
                <p className="summary-k">확인 못 함</p>
                <p className="summary-v num">{sum.unknown}개</p>
              </div>
            </section>

            <div className="seg" role="group" aria-label="보기">
              <button type="button" aria-pressed={view === 'category'} onClick={() => chooseView('category')}>분류별</button>
              <button type="button" aria-pressed={view === 'where'} onClick={() => chooseView('where')}>어디서 살지</button>
            </div>

            {staleError && (
              <div className="stale" role="status">
                <p>목록을 새로 불러오지 못했어요.</p>
                <button type="button" className="btn-text" onClick={refetch}>다시 시도</button>
              </div>
            )}

            {visible.length === 0 ? (
              <p className="state empty">
                아직 담은 게 없어요. <span className="only-narrow">아래</span><span className="only-wide">위</span> 담기로 시작해 보세요.
              </p>
            ) : (
              sections.map((s) => (
                <section key={s.key} className="group" aria-labelledby={`sec-${s.key}`}>
                  <h2 className="group-title" id={`sec-${s.key}`}>
                    {s.title} <span className="group-count num">{s.items.length}개</span>
                  </h2>
                  <ul className="group-rows">
                    {s.items.map((item) => (
                      <ListRow
                        key={item.id}
                        item={item}
                        members={me.members}
                        showNoCompare={s.key === 'store'}
                        open={openRow === item.id}
                        onOpenChange={(o) => setOpenRow(o ? item.id : (cur) => (cur === item.id ? null : cur))}
                        onToggle={() => toggle(item)}
                        onRemove={() => remove(item)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </main>

      <div className="bottom-bar only-narrow">
        <button type="button" className="btn-primary btn-big" onClick={openSheet}>담기</button>
      </div>

      <div className="notice-slot" aria-live="polite">
        {notice?.kind === 'removed' && (
          <div className="notice" key={notice.id}>
            <p>{notice.name}{josa(notice.name, '을', '를')} 뺐어요.</p>
            <button type="button" className="notice-action" onClick={() => undo(notice.id)}>되돌리기</button>
          </div>
        )}
        {notice?.kind === 'error' && (
          <div className="notice" key="error">
            <p>{notice.text}</p>
          </div>
        )}
      </div>

      {sheetOpen && <AddSheet onAdd={add} onClose={closeSheet} />}
    </div>
  )
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}
