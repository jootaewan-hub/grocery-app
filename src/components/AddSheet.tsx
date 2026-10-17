import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { NAME_MAX, parseLines, type ParsedItem } from '../lib/parse'

const CLOSE_MS = 250 // 가계부 Motion: 닫기는 여는 것(400ms)보다 빠르게

type Props = {
  onAdd: (items: ParsedItem[]) => Promise<void>
  onClose: () => void
}

// 담기 시트. 휴대폰은 아래에서 올라오는 시트, 넓은 화면(960px 이상)은 가운데 창이다(CSS가 나눈다).
export default function AddSheet({ onAdd, onClose }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const parsed = useMemo(() => parseLines(text), [text])
  const area = useRef<HTMLTextAreaElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const titleId = useId()
  const hintId = useId()

  const close = () => {
    if (closing) return
    setClosing(true)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(onClose, reduce ? 0 : CLOSE_MS)
  }

  useEffect(() => {
    area.current?.focus({ preventScroll: true })
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
      // 창 안에서만 Tab이 돌게 한다
      if (e.key === 'Tab' && sheet.current) {
        const els = [...sheet.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea')]
        if (els.length === 0) return
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function submit() {
    if (parsed.length === 0 || busy || closing) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(parsed)
    } catch {
      setError('담지 못했어요. 잠시 뒤 다시 해 주세요.')
      setBusy(false)
      return
    }
    // 담은 뒤에는 시트가 닫힐 때까지 busy를 풀지 않는다: 닫히는 동안 한 번 더 누르면 같은 품목이 두 번 담긴다.
    close()
  }

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>담기</h2>
          <button type="button" className="btn-text" onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          <label className="field-label" htmlFor={`${titleId}-text`}>살 것</label>
          <textarea
            id={`${titleId}-text`}
            ref={area}
            className="add-text"
            rows={4}
            value={text}
            placeholder="한 줄에 하나씩, 또는 쉼표로 나눠 적어요. 예: 양파, 당근, 비비고 왕교자 1.05kg x2"
            aria-describedby={hintId}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <p id={hintId} className="sr-only">한 줄에 하나씩, 또는 쉼표로 나눠 적어요. 예: 양파, 당근, 비비고 왕교자 1.05kg x2</p>
          {parsed.length > 0 && (
            <section className="preview" aria-label="담을 것 미리보기">
              <h3 className="preview-title">
                담을 것 <span className="num">{parsed.length}개</span>
              </h3>
              <ul className="preview-list">
                {parsed.map((p, i) => (
                  <li key={i} className="preview-row">
                    <span className="preview-name">
                      {p.name}
                      {p.spec && <span className="row-spec num"> {p.spec}</span>}
                      {p.specIsDefault && <span className="tag tag-default">기본</span>}
                      {p.count > 1 && <span className="row-count num"> ×{p.count}</span>}
                      {p.nameCut && <span className="preview-note">이름이 길어 {NAME_MAX}자까지만 담아요</span>}
                    </span>
                    <span className="tag">{p.category}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn-primary btn-big" disabled={parsed.length === 0 || busy || closing} onClick={() => void submit()}>
            {busy ? '담는 중' : <><span className="num">{parsed.length}</span>개 담기</>}
          </button>
        </div>
      </div>
    </div>
  )
}
