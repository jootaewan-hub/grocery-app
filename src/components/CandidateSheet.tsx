import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { won } from '../lib/format'
import { checkedText, type Candidate } from '../lib/products'
import type { ListStore } from '../lib/store'
import type { Item } from '../lib/types'

const CLOSE_MS = 250
// 묶음 구성(+, 세트, 구성, ×N)은 단품 아래에 둔다
const BUNDLE = /\+|세트|구성|\d\s*종/

type Props = {
  item: Item
  store: ListStore
  /** 상품을 고른 뒤(가격 확인은 부른 쪽이 이어서 한다) */
  onPicked: (productId: string, qty: number) => void
  onClose: () => void
}

// 처음 한 번 상품을 직접 고르는 시트. 후보는 다나와 검색 결과 그대로이고, 같은 상품도 수량마다 따로 고른다.
export default function CandidateSheet({ item, store, onPicked, onClose }: Props) {
  const [closing, setClosing] = useState(false)
  const [list, setList] = useState<Candidate[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState(item.spec ? `${item.name} ${item.spec}` : item.name)
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const titleId = useId()

  const close = () => {
    if (closing) return
    setClosing(true)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(onClose, reduce ? 0 : CLOSE_MS)
  }

  const load = useCallback(() => {
    setFailed(false)
    store.candidates(item.id).then(setList, () => setFailed(true))
  }, [store, item.id])

  useEffect(load, [load])

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) close()
      if (e.key === 'Tab' && sheet.current) {
        // 시트 안에서만 돈다
        const f = [...sheet.current.querySelectorAll<HTMLElement>('button:not([disabled]), input')]
        if (f.length === 0) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const research = (e: FormEvent) => {
    e.preventDefault()
    const q = query.replace(/\s+/g, ' ').trim()
    if (!q || searching) return
    setSearching(true)
    store.findCandidates(item.id, q).then(
      () => {
        setSearching(false)
        load()
      },
      () => {
        setSearching(false)
        setFailed(true)
      },
    )
  }

  const sorted = (list ?? []).slice().sort((a, b) => Number(BUNDLE.test(a.name)) - Number(BUNDLE.test(b.name)))
  const foundAt = sorted[0]?.foundAt

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{item.name} — 어떤 상품인가요?</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          <form className="cand-search" onSubmit={research}>
            <input
              className="cand-input"
              aria-label="다시 검색할 상품 이름"
              value={query}
              maxLength={60}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn-secondary" disabled={searching}>다시 검색</button>
          </form>
          {foundAt && !searching && <p className="cand-source">다나와, {checkedText(foundAt)} 확인</p>}
          {searching && <p className="cand-state" role="status">후보 찾는 중</p>}
          {!searching && list === null && !failed && <p className="cand-state" role="status">후보 불러오는 중</p>}
          {!searching && failed && <p className="cand-state" role="status">후보를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
          {!searching && list !== null && list.length === 0 && !failed && <p className="cand-state">후보를 찾지 못했어요. 이름을 바꿔 다시 검색해 보세요.</p>}
          {!searching && sorted.length > 0 && (
            <ul className="cand-list">
              {sorted.map((c) => (
                <li key={c.productId} className="cand-card">
                  <div className="cand-head">
                    {c.imageUrl ? <img className="cand-img" src={c.imageUrl} alt="" loading="lazy" /> : <div className="cand-img" aria-hidden="true" />}
                    <div className="cand-title">
                      <p className="cand-name">{c.name}</p>
                      {c.rating !== null && <p className="cand-rating num">평점 {c.rating.toFixed(1)}(다나와)</p>}
                    </div>
                  </div>
                  <div className="cand-variants">
                    {c.variants.map((v) => (
                      <button
                        key={v.qty}
                        type="button"
                        className="cand-variant"
                        aria-label={`${c.name} ${v.qty}개 ${won(v.price)} 고르기`}
                        onClick={() => onPicked(c.productId, v.qty)}
                      >
                        <span className="cand-qty num">{v.qty}개</span>
                        <span className="cand-price num">{won(v.price)}</span>
                        <span className="cand-unit num">
                          {v.unitPrice !== null && v.unitLabel ? `${v.unitLabel}당 ${won(v.unitPrice)}` : '단위가격 확인 못 함'}
                          {v.mallCount !== null ? `, 판매처 ${v.mallCount}곳` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
