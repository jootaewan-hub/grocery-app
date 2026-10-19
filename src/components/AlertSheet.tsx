import { useEffect, useId, useRef, useState } from 'react'
import { checkedRange, koFullDay, SHEET_HINT, SOURCE_NAME, type AlertsResult, type FoodAlert } from '../lib/alerts'
import { josa } from '../lib/format'

const CLOSE_MS = 250

type Props = {
  itemName: string
  alerts: FoodAlert[]
  syncedAt: AlertsResult['syncedAt']
  onClose: () => void
}

// 품목과 비슷한 식약처 기록을 나란히 보여 주는 시트. 같은 제품인지는 사용자가 포장을 보고 판단한다.
export default function AlertSheet({ itemName, alerts, syncedAt, onClose }: Props) {
  const [closing, setClosing] = useState(false)
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
      if (e.key === 'Tab') {
        e.preventDefault() // 시트 안에서 누를 수 있는 것은 닫기 하나다
        closeBtn.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{itemName}{josa(itemName, '과', '와')} 비슷한 식약처 기록</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          <p className="alert-hint">{SHEET_HINT}</p>
          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={`${a.source}-${a.sourceId}`} className="alert-card">
                <p className="alert-product">{a.productName}</p>
                <dl className="alert-facts">
                  {a.maker && <><dt>업체</dt><dd>{a.maker}</dd></>}
                  {a.packUnit && <><dt>포장 단위</dt><dd>{a.packUnit}</dd></>}
                  {a.reason && <><dt>사유</dt><dd>{a.reason}</dd></>}
                  {a.grade && <><dt>등급</dt><dd>{a.grade}</dd></>}
                  {a.registeredOn && <><dt>등록일</dt><dd className="num">{koFullDay(a.registeredOn)}</dd></>}
                  <dt>출처</dt><dd>{SOURCE_NAME[a.source]}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <p className="alert-range">{checkedRange(syncedAt)}</p>
        </div>
      </div>
    </div>
  )
}
