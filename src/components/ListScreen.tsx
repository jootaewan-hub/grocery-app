import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { EMPTY_ALERTS, listStatus, type AlertsResult } from '../lib/alerts'
import { groupByCategory, groupByWhere, summarize } from '../lib/listView'
import type { ParsedItem } from '../lib/parse'
import { loadListView, saveListView, type ListViewMode } from '../lib/prefs'
import type { Membership } from '../lib/session'
import type { ListStore } from '../lib/store'
import type { Item, PriceCompare } from '../lib/types'
import { josa } from '../lib/format'
import { EMPTY_EXTRAS, toFind, type ItemExtras } from '../lib/products'
import AddSheet from './AddSheet'
import AlertSheet from './AlertSheet'
import CandidateSheet from './CandidateSheet'
import ItemDetail from './ItemDetail'
import ListRow from './ListRow'

const UNDO_MS = 5000


type Props = {
  store: ListStore
  me: Membership
  onSignOut?: () => void
}

type Notice = { kind: 'removed'; ids: string[]; what: string } | { kind: 'error'; text: string }

export default function ListScreen({ store, me, onSignOut }: Props) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [staleError, setStaleError] = useState(false) // 한 번 불러온 뒤 다시 불러오기에 실패
  const [view, setView] = useState<ListViewMode>(() => loadListView(me.userId))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editing, setEditing] = useState(false)
  const pending = useRef(new Map<string, number>()) // 빼기 대기 중인 id → 타이머
  const noticeTimer = useRef<number | undefined>(undefined)
  const opener = useRef<HTMLElement | null>(null)
  const seq = useRef(0)
  const [alerts, setAlerts] = useState<AlertsResult | null>(null) // null: 아직 한 번도 못 불러옴
  const [alertsFailed, setAlertsFailed] = useState(false)
  const [alertItem, setAlertItem] = useState<Item | null>(null)
  const alertSeq = useRef(0)
  const [extras, setExtras] = useState<ItemExtras>(EMPTY_EXTRAS)
  const [extrasReady, setExtrasReady] = useState(false) // 한 번이라도 받아 왔는가
  const extrasSeq = useRef(0)
  const requested = useRef(new Map<string, number>()) // 이 화면에서 후보 찾기를 부른 품목 → 부른 시각(ms)
  const [pickItem, setPickItem] = useState<Item | null>(null)
  const refetchRef = useRef<() => void>(() => {}) // find가 refetch보다 먼저 정의돼 ref로 부른다
  const [detailItem, setDetailItem] = useState<Item | null>(null)

  // 후보 상태·오늘 최저가·고른 상품명. 실패해도 목록은 그대로(가격은 "확인 못 함"으로 남는다).
  const refetchExtras = useCallback(() => {
    const mine = ++extrasSeq.current
    store.extras().then(
      (x) => {
        if (mine !== extrasSeq.current) return
        setExtras(x)
        setExtrasReady(true)
      },
      () => {},
    )
  }, [store])

  // 다나와 후보 찾기. 서버가 10초 간격으로 줄을 세우므로 기다리지 않고, 끝나면 다시 읽는다.
  // 2분 안에 부른 품목은 다시 부르지 않고, 새로 부른 것이 있을 때만 다시 읽기를 예약한다(요청이 되풀이되지 않게).
  // 기억으로 이어졌으면(remembered) 바로 가격 확인까지 한다(화면 설계 8-1).
  const find = useCallback(
    (ids: string[]) => {
      const now = Date.now()
      const fresh = ids.filter((id) => {
        const at = requested.current.get(id)
        return at === undefined || now - at > 2 * 60_000
      })
      for (const id of fresh) {
        requested.current.set(id, now)
        store.findCandidates(id).then(
          (st) => {
            refetchExtras()
            if (st === 'remembered') {
              refetchRef.current()
              store.checkPrice(id).then(refetchExtras, refetchExtras)
            }
          },
          refetchExtras,
        )
      }
      if (fresh.length) window.setTimeout(refetchExtras, 300) // '후보 찾는 중'을 바로 보이게
    },
    [store, refetchExtras],
  )

  // 식약처 대조는 목록과 따로 불러온다. 실패해도 목록은 그대로 보이고 한 줄로 알린다.
  const refetchAlerts = useCallback(() => {
    const mine = ++alertSeq.current
    store.alerts().then(
      (a) => {
        if (mine !== alertSeq.current) return
        setAlerts(a)
        setAlertsFailed(false)
      },
      () => {
        if (mine === alertSeq.current) setAlertsFailed(true)
      },
    )
  }, [store])

  const refetch = useCallback(() => {
    const mine = ++seq.current
    store.list().then(
      (list) => {
        if (mine !== seq.current) return
        setItems(list)
        setLoadState('ready')
        setStaleError(false)
        refetchAlerts() // 품목이 바뀌면 대조도 다시 한다
        refetchExtras()
      },
      () => {
        if (mine !== seq.current) return
        setLoadState((s) => (s === 'ready' ? 'ready' : 'error'))
        setStaleError(true)
      },
    )
  }, [store, refetchAlerts, refetchExtras])
  refetchRef.current = refetch

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
      alertSeq.current++
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

  // 한 품목이나 한 묶음(분류 통째로)을 뺀다. 되돌리기 하나로 모두 되살린다.
  const removeMany = (list: Item[], what: string) => {
    if (list.length === 0) return
    setOpenRow(null)
    setHidden((h) => {
      const next = new Set(h)
      for (const i of list) next.add(i.id)
      return next
    })
    for (const i of list) pending.current.set(i.id, window.setTimeout(() => commitRemove(i.id), UNDO_MS))
    showNotice({ kind: 'removed', ids: list.map((i) => i.id), what })
  }
  const remove = (item: Item) => removeMany([item], `${item.name}${josa(item.name, '을', '를')}`)

  const undo = (ids: string[]) => {
    for (const id of ids) {
      const t = pending.current.get(id)
      if (t === undefined) continue
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
    const made = await store.add(parsed)
    refetch()
    find(made.map((i) => i.id))
  }

  // 다른 기기에서 담았거나 예전에 담아 후보 찾기를 한 적 없는 품목도 찾는다
  useEffect(() => {
    if (!items || !extrasReady) return
    find(toFind(items, extras.searches, requested.current, Date.now()))
    // extras를 한 번 받은 뒤에만 판단한다(빈 extras로 모든 품목을 다시 찾지 않게)
  }, [items, extras, extrasReady, find])

  const pick = (item: Item, productId: string, qty: number) => {
    setPickItem(null)
    store.choose(item.id, productId, qty).then(
      () => {
        refetch()
        store.checkPrice(item.id).then(refetchExtras, () => {
          refetchExtras()
          showNotice({ kind: 'error', text: '다나와 가격을 지금 불러오지 못했어요.' })
        })
      },
      () => showNotice({ kind: 'error', text: '상품을 고르지 못했어요. 잠시 뒤 다시 해 주세요.' }),
    )
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

  const prices = useMemo(() => {
    const m = new Map<string, PriceCompare>()
    for (const [id, p] of extras.prices) m.set(id, { onlineBest: p.price, storeBase: null })
    return m
  }, [extras])
  const visible = useMemo(() => (items ?? []).filter((i) => !hidden.has(i.id)), [items, hidden])
  const sections = useMemo(
    () => {
      const levels = (alerts ?? EMPTY_ALERTS).levels
      return view === 'category' ? groupByCategory(visible, levels) : groupByWhere(visible, levels, prices)
    },
    [view, visible, alerts, prices],
  )
  const status = alerts ? listStatus(alerts.syncedAt) : null

  // 다 빼서 목록이 비면 편집을 끝낸다
  useEffect(() => {
    if (visible.length === 0) setEditing(false)
  }, [visible.length])
  const sum = summarize(visible, prices)
  const ready = loadState === 'ready' && items !== null

  return (
    <div className="list-page">
      <header className="list-head">
        <h1>이번 장보기</h1>
        <div className="list-head-actions">
          <button type="button" className="btn-primary only-wide" onClick={openSheet}>담기</button>
          {ready && visible.length > 0 && (
            <button type="button" className="btn-text" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? '완료' : '편집'}
            </button>
          )}
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
                {sum.lowestTotal !== null && <p className="summary-note">배송비 제외</p>}
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

            {status && !alertsFailed && (
              <p className={status.tone === 'ok' ? 'check-status' : 'check-status is-warn'} role="status">{status.text}</p>
            )}

            {alertsFailed && (
              <div className="stale" role="status">
                <p>식약처 목록을 불러오지 못했어요.</p>
                <button type="button" className="btn-text" onClick={refetchAlerts}>다시 시도</button>
              </div>
            )}

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
                  <div className="group-head">
                    <h2 className="group-title" id={`sec-${s.key}`}>
                      {s.title} <span className="group-count num">{s.items.length}개</span>
                    </h2>
                    {editing && s.key !== 'alert' && ( // '먼저 볼 것'은 분류가 아니라 경고 모음이라 통째로 빼지 않는다
                      <button
                        type="button"
                        className="group-remove"
                        aria-label={`${s.title} ${s.items.length}개 모두 빼기`}
                        onClick={() => removeMany(s.items, `${s.title} ${s.items.length}개를`)}
                      >
                        모두 빼기
                      </button>
                    )}
                  </div>
                  <ul className="group-rows">
                    {s.items.map((item) => (
                      <ListRow
                        key={item.id}
                        item={item}
                        members={me.members}
                        showNoCompare={s.key === 'store'}
                        alertLevel={alerts?.levels.get(item.id) ?? null}
                        onAlert={(e) => {
                          opener.current = e.currentTarget
                          setAlertItem(item)
                        }}
                        open={openRow === item.id}
                        onOpenChange={(o) => setOpenRow(o ? item.id : (cur) => (cur === item.id ? null : cur))}
                        onToggle={() => toggle(item)}
                        onRemove={() => remove(item)}
                        editing={editing}
                        search={extras.searches.get(item.id) ?? null}
                        price={extras.prices.get(item.id) ?? null}
                        productName={extras.productNames.get(item.id) ?? null}
                        onPick={() => setPickItem(item)}
                        onOpen={() => setDetailItem(item)}
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
          <div className="notice" key={notice.ids.join()}>
            <p>{notice.what} 뺐어요.</p>
            <button type="button" className="notice-action" onClick={() => undo(notice.ids)}>되돌리기</button>
          </div>
        )}
        {notice?.kind === 'error' && (
          <div className="notice" key="error">
            <p>{notice.text}</p>
          </div>
        )}
      </div>

      {sheetOpen && <AddSheet onAdd={add} onClose={closeSheet} />}
      {detailItem && (
        <ItemDetail
          item={detailItem}
          store={store}
          onChangeProduct={() => {
            setPickItem(detailItem)
            setDetailItem(null)
          }}
          onClose={() => {
            setDetailItem(null)
            refetchExtras()
          }}
        />
      )}
      {pickItem && (
        <CandidateSheet
          item={pickItem}
          store={store}
          onPicked={(productId, qty) => pick(pickItem, productId, qty)}
          onClose={() => setPickItem(null)}
        />
      )}
      {alertItem && (
        <AlertSheet
          itemName={alertItem.name}
          alerts={alerts?.byItem.get(alertItem.id) ?? []}
          syncedAt={alerts?.syncedAt ?? {}}
          onClose={() => {
            setAlertItem(null)
            opener.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </div>
  )
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}
