import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { checkedRange, koFullDay, SOURCE_NAME, SOURCES } from '../lib/alerts'
import { danawaProductUrl } from '../../supabase/functions/_shared/danawa'
import { won } from '../lib/format'
import {
  checkedText,
  farmLine,
  kstDay,
  priceRowText,
  safetySummary,
  SHORTCUTS,
  splitLines,
  type ItemDetailData,
  type PriceLine,
  type SafetyRecord,
} from '../lib/products'
import type { ListStore } from '../lib/store'
import type { Item } from '../lib/types'

const CLOSE_MS = 250
type Tab = 'price' | 'safety' | 'rating'
const TABS: { key: Tab; label: string }[] = [
  { key: 'price', label: '가격' },
  { key: 'safety', label: '안전' },
  { key: 'rating', label: '평가' },
]

type Props = {
  item: Item
  store: ListStore
  onChangeProduct: () => void
  onClose: () => void
}

// 품목 상세: 요약 네 칸과 가격·안전·평가 탭. 숫자마다 출처와 확인 시각을 붙인다(화면 설계 4·5절).
export default function ItemDetail({ item, store, onChangeProduct, onClose }: Props) {
  const [closing, setClosing] = useState(false)
  const [tab, setTab] = useState<Tab>('price')
  const [data, setData] = useState<ItemDetailData | null>(null)
  const [failed, setFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const asked = useRef(false)
  const titleId = useId()

  const close = () => {
    if (closing) return
    setClosing(true)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(onClose, reduce ? 0 : CLOSE_MS)
  }

  const load = useCallback(() => {
    setFailed(false)
    return store.detail(item.id).then(
      (d) => {
        setData(d)
        return d
      },
      () => {
        setFailed(true)
        return null
      },
    )
  }, [store, item.id])

  // 열 때: 고른 상품이 있고 오늘 성공한 확인이 없으면 그때 확인한다(화면 설계 8-1)
  useEffect(() => {
    void load().then((d) => {
      const today = kstDay(new Date().toISOString())
      const fresh = d?.check?.ok && kstDay(d.check.checkedAt) === today
      if (!d?.product || fresh || asked.current) return
      asked.current = true
      setChecking(true)
      store.checkPrice(item.id).then(
        () => load().finally(() => setChecking(false)),
        () => load().finally(() => setChecking(false)),
      )
    })
  }, [load, store, item.id])

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
        const f = [...sheet.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
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

  const today = kstDay(new Date().toISOString())
  const qty = item.productQty ?? 1
  const split = splitLines(data?.lines ?? [], qty, today)
  const query = data?.product?.name ?? [item.name, item.spec].filter(Boolean).join(' ')
  const lastFailed = data?.check && !data.check.ok ? data.check : null

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet detail" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{item.name}{item.spec ? ` ${item.spec}` : ''}</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          {failed && <p className="cand-state" role="status">품목 정보를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
          {!data && !failed && <p className="cand-state" role="status">품목 정보 불러오는 중</p>}
          {data && (
            <>
              <div className="detail-head">
                {data.product?.imageUrl && <img className="cand-img" src={data.product.imageUrl} alt="" />}
                <div className="cand-title">
                  <p className="cand-name">{data.product ? `${data.product.name} (${qty}개)` : '상품 고르기 전'}</p>
                  <p className="cand-rating">{item.category}</p>
                </div>
                <button type="button" className="btn-secondary detail-change" onClick={onChangeProduct}>
                  {data.product ? '상품 바꾸기' : '상품 고르기'}
                </button>
              </div>

              <section className="summary detail-summary" aria-label="요약">
                <div className="summary-cell">
                  <p className="summary-k">가장 싼 값</p>
                  <p className="summary-v num">{split.best ? won(split.best.price) : '확인 못 함'}</p>
                  {split.best && <p className="summary-note">{split.best.seller ?? '다나와 최저가'}, {checkedText(split.best.checkedAt)}</p>}
                </div>
                <div className="summary-cell">
                  <p className="summary-k">식약처 기록</p>
                  <p className="summary-v detail-small">{safetySummary(data.safety, false)}</p>
                </div>
                <div className="summary-cell">
                  <p className="summary-k">평점</p>
                  <p className="summary-v num">{data.product?.rating != null ? data.product.rating.toFixed(1) : '확인 못 함'}</p>
                  {data.product?.rating != null && <p className="summary-note">다나와{data.check ? `, ${checkedText(data.check.checkedAt)}` : ''}</p>}
                </div>
                <div className="summary-cell">
                  <p className="summary-k">더 나은 상품</p>
                  <p className="summary-v detail-small">다음 단계</p>
                </div>
              </section>

              <div className="seg detail-tabs" role="tablist" aria-label="품목 상세">
                {TABS.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'price' && (
                <div role="tabpanel">
                  {checking && <p className="cand-state" role="status">다나와 가격 확인 중</p>}
                  {!checking && lastFailed && (
                    <p className="cand-state" role="status">
                      다나와 가격을 지금 불러오지 못했어요.
                      {split.same.length + split.other.length > 0 ? ` ${checkedText(data.lines[0].checkedAt)}에 확인한 값을 보여 드려요.` : ''}
                    </p>
                  )}
                  {!data.product && <p className="cand-state">상품을 고르면 가격을 확인해요.</p>}
                  {data.product && !checking && split.same.length === 0 && split.other.length === 0 && !lastFailed && (
                    <p className="cand-state">가격 확인 못 함</p>
                  )}
                  {split.same.length > 0 && <PriceList title={`${qty}개`} lines={split.same} />}
                  {split.other.length > 0 && <PriceList title="다른 용량" lines={split.other} showUnit />}
                  <p className="detail-sub">다른 곳에서 보기</p>
                  <div className="detail-links">
                    {SHORTCUTS.map((s) => (
                      <a key={s.name} className="btn-secondary detail-link" href={s.url(query)} target="_blank" rel="noopener noreferrer">
                        {s.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'safety' && (
                <div role="tabpanel">
                  {SOURCES.map((src) => {
                    const recs = data.safety.filter((r) => r.source === src && !r.farm)
                    return (
                      <div key={src} className="detail-block">
                        <p className="detail-sub">{SOURCE_NAME[src]}</p>
                        {recs.length === 0 ? (
                          <p className="detail-none">확인한 범위에서 찾은 기록 없음</p>
                        ) : (
                          <ul className="alert-list">{recs.map((r) => <SafetyCard key={r.sourceId} r={r} />)}</ul>
                        )}
                      </div>
                    )
                  })}
                  <FarmRecords records={data.safety} />
                  <p className="alert-range">{checkedRange(data.syncedAt)}</p>
                </div>
              )}

              {tab === 'rating' && (
                <div role="tabpanel">
                  {data.product?.rating != null ? (
                    <p className="detail-rating">
                      <span className="num">평점 {data.product.rating.toFixed(1)}</span>
                      {data.product.reviewCount != null && <span className="num">, 후기 {data.product.reviewCount.toLocaleString('ko-KR')}개</span>}
                      <span className="detail-none"> (다나와{data.check ? `, ${checkedText(data.check.checkedAt)}` : ''})</span>
                    </p>
                  ) : (
                    <p className="detail-none">평점 확인 못 함</p>
                  )}
                  {data.product && (
                    <a className="btn-secondary detail-link" href={danawaProductUrl(data.product.pcode)} target="_blank" rel="noopener noreferrer">
                      원래 페이지에서 후기 보기
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PriceList({ title, lines, showUnit = false }: { title: string; lines: PriceLine[]; showUnit?: boolean }) {
  return (
    <div className="detail-block">
      <p className="detail-sub">{title}</p>
      <ul className="price-list">
        {lines.map((l, i) => (
          <li key={`${l.seller}-${l.qty}-${i}`} className="price-row">
            <div>
              <p className="price-where">{l.seller ?? `다나와 최저가(${l.qty}개)`}</p>
              <p className="price-src">
                다나와, {checkedText(l.checkedAt)}
                {showUnit && l.seller !== null ? `, ${l.qty}개` : ''}
                {showUnit && l.unitPrice !== null && l.unitLabel ? `, ${l.unitLabel}당 ${won(l.unitPrice)}` : ''}
              </p>
            </div>
            <p className="price-v num">{priceRowText(l)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SafetyCard({ r }: { r: SafetyRecord }) {
  return (
    <li className="alert-card">
      <p className="alert-product">{r.productName}</p>
      <dl className="alert-facts">
        {r.maker && <><dt>업체</dt><dd>{r.maker}</dd></>}
        {r.reason && <><dt>사유</dt><dd>{r.reason}</dd></>}
        {r.grade && <><dt>등급</dt><dd>{r.grade}</dd></>}
        {r.registeredOn && <><dt>등록일</dt><dd className="num">{koFullDay(r.registeredOn)}</dd></>}
        <dt>찾은 방법</dt><dd>{r.via === 'product_name' ? '상품명으로 찾음' : '품목 이름으로 찾음'}</dd>
      </dl>
    </li>
  )
}

function FarmRecords({ records }: { records: SafetyRecord[] }) {
  const [open, setOpen] = useState(false)
  const line = farmLine(records)
  if (!line) return null
  return (
    <div className="detail-block">
      <button type="button" className="btn-text detail-farm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {line}
      </button>
      {open && <ul className="alert-list">{records.filter((r) => r.farm).map((r) => <SafetyCard key={r.sourceId} r={r} />)}</ul>}
    </div>
  )
}
