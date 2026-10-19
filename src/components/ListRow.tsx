import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { BADGE } from '../lib/alerts'
import type { AlertLevel, Item, Member } from '../lib/types'
import { josa, won } from '../lib/format'

const ACTION_W = 88 // "빼기" 버튼 폭
const LONG_PRESS_MS = 500
const SLOP = 8 // 이만큼 움직이기 전에는 누르기로 본다

type Props = {
  item: Item
  members: Member[]
  showNoCompare: boolean
  alertLevel: AlertLevel | null
  onAlert: (e: MouseEvent<HTMLButtonElement>) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: () => void
  onRemove: () => void
}

function whoClass(m: Member): string {
  if (m.spouseRole === 'husband') return 'who-dot who-husband'
  if (m.spouseRole === 'wife') return 'who-dot who-wife'
  return 'who-dot who-none'
}

export default function ListRow({ item, members, showNoCompare, alertLevel, onAlert, open, onOpenChange, onToggle, onRemove }: Props) {
  const bought = item.boughtAt !== null
  const adder = members.find((m) => m.userId === item.addedBy)
  const buyer = members.find((m) => m.userId === item.boughtBy)

  // 왼쪽으로 밀기와 길게 누르기. 손을 떼기 전까지는 dx만 바꾸고, 떼면 열지 닫을지 정한다.
  const drag = useRef<{ x: number; y: number; id: number; mode: 'idle' | 'swipe'; base: number } | null>(null)
  const live = useRef<number | null>(null)
  const [dx, setDx] = useState<number | null>(null)
  const longTimer = useRef<number | undefined>(undefined)
  const suppressClick = useRef(false)

  useEffect(() => () => window.clearTimeout(longTimer.current), [])

  const setLive = (v: number | null) => {
    live.current = v
    setDx(v)
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'idle', base: open ? -ACTION_W : 0 }
    window.clearTimeout(longTimer.current)
    longTimer.current = window.setTimeout(() => {
      if (drag.current?.mode === 'idle') {
        drag.current = null
        suppressClick.current = true
        onOpenChange(true)
      }
    }, LONG_PRESS_MS)
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const mx = e.clientX - d.x
    const my = e.clientY - d.y
    if (d.mode === 'idle') {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return
      window.clearTimeout(longTimer.current)
      if (Math.abs(mx) <= Math.abs(my)) {
        drag.current = null // 세로 스크롤은 브라우저에 맡긴다
        return
      }
      d.mode = 'swipe'
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setLive(Math.max(-ACTION_W, Math.min(0, d.base + mx)))
  }

  function up() {
    window.clearTimeout(longTimer.current)
    const d = drag.current
    drag.current = null
    if (d?.mode === 'swipe') {
      suppressClick.current = true
      const final = live.current ?? d.base
      setLive(null)
      onOpenChange(final < -ACTION_W / 2)
    }
  }

  function click() {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    // 행 누르기의 품목 상세는 다음 계획에서 붙인다. 지금은 열린 "빼기"만 닫는다.
    if (open) onOpenChange(false)
  }

  const offset = dx ?? (open ? -ACTION_W : 0)
  const label = [item.name, item.spec].filter(Boolean).join(' ')

  const second: ReactNode[] = []
  if (bought) {
    second.push(buyer ? `${buyer.displayName}${josa(buyer.displayName, '이', '가')} 샀어요` : '샀어요')
    if (item.paid != null && item.paid > 0) second.push(<span className="num" key="paid">{won(item.paid)}</span>)
  } else {
    if (adder) {
      second.push(
        <span className="who" key="who">
          <span className={whoClass(adder)} aria-hidden="true" />
          {adder.displayName}
        </span>,
      )
    }
    if (item.productKey === null) second.push('상품 고르기 전')
    if (showNoCompare) second.push('비교 못 함')
  }

  return (
    <li className={`row${bought ? ' is-bought' : ''}${open ? ' is-open' : ''}${dx !== null ? ' is-swiping' : ''}`} data-row-id={item.id}>
      <div
        className={`row-body${dx !== null ? ' is-dragging' : ''}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={click}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          className="check"
          aria-pressed={bought}
          aria-label={`${label} 산 것`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <span className="check-mark" aria-hidden="true">
            {bought && (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
        <div className="row-main">
          <p className="row-name">
            {item.name}
            {item.spec && <span className="row-spec num"> {item.spec}</span>}
            {item.count > 1 && <span className="row-count num"> ×{item.count}</span>}
          </p>
          {alertLevel && (
            <button
              type="button"
              className={`alert-badge alert-${alertLevel}`}
              data-touch-extend
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onAlert(e)
              }}
            >
              {BADGE[alertLevel]}
            </button>
          )}
          {second.length > 0 && (
            <p className="row-meta">
              {second.map((part, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  {part}
                </span>
              ))}
            </p>
          )}
        </div>
        {!bought && <span className="tag">가격 확인 못 함</span>}
      </div>
      <button
        type="button"
        className="row-remove"
        aria-label={`${label} 빼기`}
        onFocus={() => {
          if (!open) onOpenChange(true) // 키보드로 오면 "빼기"를 보여 준다
        }}
        onBlur={() => onOpenChange(false)}
        onClick={onRemove}
      >
        빼기
      </button>
    </li>
  )
}
