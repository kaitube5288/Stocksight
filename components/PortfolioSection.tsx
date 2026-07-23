'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { PortfolioItem, PortfolioAdvice } from '@/lib/supabase'

type SearchResult = { ticker: string; name: string; sector: string }

type LivePrice = { price: number | null }

const ADVICE_STYLE: Record<string, { bg: string; border: string; color: string; label: string }> = {
  '보유유지': { bg: 'rgba(77,166,255,0.12)', border: 'rgba(77,166,255,0.4)', color: '#4da6ff', label: '보유유지' },
  '물타기':   { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.4)',  color: '#fb923c', label: '물타기' },
  '추매':     { bg: 'rgba(0,229,170,0.12)',    border: 'rgba(0,229,170,0.4)',   color: '#00e5aa', label: '추매' },
  '분할매수': { bg: 'rgba(0,229,170,0.12)',    border: 'rgba(0,229,170,0.4)',   color: '#00e5aa', label: '분할매수' },
  '분할매도': { bg: 'rgba(255,201,77,0.12)',   border: 'rgba(255,201,77,0.4)',  color: '#ffc94d', label: '분할매도' },
  '손절고려': { bg: 'rgba(255,92,92,0.12)',    border: 'rgba(255,92,92,0.4)',   color: '#ff5c5c', label: '손절고려' },
}

const EMPTY_FORM = { ticker: '', name: '', avg_price: '', shares: '' }

export default function PortfolioSection() {
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [cash, setCash] = useState(0)
  const [live, setLive] = useState<Record<string, LivePrice>>({})
  const [advice, setAdvice] = useState<PortfolioAdvice[]>([])
  const [adviceDate, setAdviceDate] = useState<string | null>(null)
  const [adviceIsToday, setAdviceIsToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editTicker, setEditTicker] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingCash, setEditingCash] = useState(false)
  const [cashInput, setCashInput] = useState('')
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchLive = useCallback(async (tickers: string[]) => {
    if (!tickers.length) return
    try {
      const res = await fetch(`/api/prices?tickers=${tickers.join(',')}`)
      const data: { ticker: string; price: number | null }[] = await res.json()
      const map: Record<string, LivePrice> = {}
      data.forEach(d => { map[d.ticker] = { price: d.price } })
      setLive(map)
    } catch { /* 무시 */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [portRes, advRes] = await Promise.all([
        fetch('/api/portfolio'),
        fetch('/api/portfolio/advice'),
      ])
      const portData = await portRes.json()
      const advData = await advRes.json()
      setItems(portData.items ?? [])
      setCash(portData.cash ?? 0)
      setAdvice(advData.advice ?? [])
      setAdviceDate(advData.date ?? null)
      setAdviceIsToday(advData.isToday ?? false)
      if (portData.items?.length) {
        fetchLive(portData.items.map((i: PortfolioItem) => i.ticker))
      }
    } catch {
      setError('데이터 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [fetchLive])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    setEditTicker(null)
    setForm(EMPTY_FORM)
    setSearchQuery('')
    setSearchResults([])
    setShowDropdown(false)
    setShowForm(true)
  }

  const openEdit = (item: PortfolioItem) => {
    setEditTicker(item.ticker)
    setForm({ ticker: item.ticker, name: item.name, avg_price: String(item.avg_price), shares: String(item.shares) })
    setSearchQuery(`${item.name} (${item.ticker})`)
    setSearchResults([])
    setShowDropdown(false)
    setShowForm(true)
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (!editTicker) setForm(f => ({ ...f, ticker: '', name: '' }))
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!value.trim()) { setSearchResults([]); setShowDropdown(false); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/portfolio/search?q=${encodeURIComponent(value.trim())}`)
        const data: SearchResult[] = await res.json()
        setSearchResults(data)
        setShowDropdown(data.length > 0)
      } catch { /* 무시 */ }
    }, 200)
  }

  const selectStock = (stock: SearchResult) => {
    setForm(f => ({ ...f, ticker: stock.ticker, name: stock.name }))
    setSearchQuery(`${stock.name} (${stock.ticker})`)
    setShowDropdown(false)
    setSearchResults([])
  }

  const saveItem = async () => {
    if (!form.ticker || !form.name || !form.avg_price || !form.shares) {
      setError('모든 항목을 입력하세요')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: form.ticker.trim(), name: form.name.trim(), avg_price: Number(form.avg_price.replace(/,/g, '')), shares: Number(form.shares.replace(/,/g, '')) }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setShowForm(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async (ticker: string) => {
    if (!confirm(`${ticker} 종목을 삭제하시겠습니까?`)) return
    setSaving(true)
    try {
      await fetch('/api/portfolio', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }) })
      await load()
    } catch { setError('삭제 실패') }
    finally { setSaving(false) }
  }

  const saveCash = async () => {
    const amount = Number(cashInput.replace(/,/g, ''))
    if (isNaN(amount)) { setError('올바른 금액을 입력하세요'); return }
    setSaving(true)
    try {
      await fetch('/api/portfolio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'cash', amount }) })
      setCash(amount)
      setEditingCash(false)
    } catch { setError('현금 저장 실패') }
    finally { setSaving(false) }
  }

  // 총 평가 계산
  const totalEval = items.reduce((sum, item) => {
    const price = live[item.ticker]?.price ?? item.avg_price
    return sum + price * item.shares
  }, 0)
  const totalCost = items.reduce((sum, item) => sum + item.avg_price * item.shares, 0)
  const totalProfitPct = totalCost > 0 ? ((totalEval - totalCost) / totalCost) * 100 : 0
  const totalAsset = totalEval + cash

  const profitColor = (pct: number) =>
    pct > 0 ? 'var(--accent-green)' : pct < 0 ? 'var(--accent-red)' : 'var(--text-muted)'

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="glass rounded-2xl h-28 animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>내 포트폴리오</h2>
          {adviceDate && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full mono"
              style={{
                background: adviceIsToday ? 'rgba(0,229,170,0.1)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${adviceIsToday ? 'rgba(0,229,170,0.3)' : 'rgba(255,255,255,0.1)'}`,
                color: adviceIsToday ? 'var(--accent-green)' : 'var(--text-muted)',
              }}
            >
              💡 조언 {adviceDate} {adviceIsToday ? '(오늘)' : '(최근)'}
            </span>
          )}
        </div>
        <button
          onClick={openAdd}
          className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all"
          style={{ background: 'rgba(0,229,170,0.12)', border: '1px solid rgba(0,229,170,0.35)', color: 'var(--accent-green)' }}
        >
          + 종목 추가
        </button>
      </div>

      {/* 인라인 종목 추가/수정 폼 */}
      {showForm && (
        <div className="glass rounded-2xl p-4 mb-4" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
          <div className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
            {editTicker ? '종목 수정' : '종목 추가'}
          </div>

          {/* 종목 검색 (자동완성) */}
          <div className="relative mb-2" ref={dropdownRef}>
            <input
              type="text"
              placeholder="종목명 또는 코드 검색 (예: 삼성전자 / 005930)"
              value={searchQuery}
              readOnly={!!editTicker}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              className="w-full px-3 py-2 rounded-xl text-xs mono outline-none"
              style={{
                background: editTicker ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${form.ticker ? 'rgba(0,229,170,0.4)' : 'rgba(255,255,255,0.12)'}`,
                color: 'var(--text-primary)',
              }}
            />
            {/* 선택된 종목 배지 */}
            {form.ticker && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="text-[10px] mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,229,170,0.15)', color: 'var(--accent-green)' }}>
                  {form.ticker}
                </span>
                {!editTicker && (
                  <button
                    onClick={() => { setForm(f => ({ ...f, ticker: '', name: '' })); setSearchQuery('') }}
                    className="text-[10px]"
                    style={{ color: 'var(--text-muted)' }}
                  >✕</button>
                )}
              </div>
            )}
            {/* 드롭다운 */}
            {showDropdown && searchResults.length > 0 && (
              <div
                className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden"
                style={{ background: '#0d1221', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
              >
                {searchResults.map(s => (
                  <button
                    key={s.ticker}
                    onMouseDown={() => selectStock(s)}
                    className="w-full px-3 py-2 text-left flex items-center justify-between transition-all"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{s.sector}</span>
                      <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(77,166,255,0.1)', color: '#4da6ff' }}>{s.ticker}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 평균단가 + 보유수량 */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { key: 'avg_price', placeholder: '평균단가 (예: 62000)' },
              { key: 'shares',    placeholder: '보유수량 (예: 100)' },
            ].map(({ key, placeholder }) => (
              <input
                key={key}
                type="text"
                placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="px-3 py-2 rounded-xl text-xs mono outline-none"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text-primary)',
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={saveItem}
              disabled={saving}
              className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => { setShowForm(false); setError('') }}
              className="px-4 py-2 rounded-xl text-xs"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
            >
              취소
            </button>
          </div>
          {error && <p className="text-xs mt-2" style={{ color: 'var(--accent-red)' }}>{error}</p>}
        </div>
      )}

      {/* 총 자산 요약 */}
      {items.length > 0 && (
        <div
          className="glass rounded-2xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {[
            { label: '총 평가금액', value: `${Math.round(totalEval).toLocaleString('ko-KR')}원`, color: 'var(--text-primary)' },
            { label: '총 수익률', value: `${totalProfitPct >= 0 ? '+' : ''}${totalProfitPct.toFixed(2)}%`, color: profitColor(totalProfitPct) },
            { label: '보유 현금', value: `${cash.toLocaleString('ko-KR')}원`, color: 'var(--text-secondary)' },
            { label: '총 자산', value: `${Math.round(totalAsset).toLocaleString('ko-KR')}원`, color: 'var(--accent-gold)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
              <div className="mono text-sm font-semibold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 보유 종목 카드 목록 */}
      {items.length === 0 ? (
        <div
          className="glass rounded-2xl p-10 text-center mb-4"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>보유 종목 없음</div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            위의 <strong>+ 종목 추가</strong> 버튼으로 보유 종목을 입력하세요.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-4">
          {items.map(item => {
            const currentPrice = live[item.ticker]?.price ?? item.avg_price
            const profitAmt = (currentPrice - item.avg_price) * item.shares
            const profitPct = item.avg_price > 0 ? ((currentPrice - item.avg_price) / item.avg_price) * 100 : 0
            const evalAmt = currentPrice * item.shares
            const itemAdvice = advice.find(a => a.ticker === item.ticker)
            const advStyle = itemAdvice ? (ADVICE_STYLE[itemAdvice.advice_type] ?? ADVICE_STYLE['보유유지']) : null

            return (
              <div key={item.ticker} className="glass rounded-2xl p-4" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* 종목 헤더 */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {item.name}
                      </span>
                      <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {item.ticker}
                      </span>
                      <span
                        className="mono text-xs font-bold"
                        style={{ color: profitColor(profitPct) }}
                      >
                        {profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                      <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>
                        평균 {item.avg_price.toLocaleString('ko-KR')}원
                      </span>
                      <span className="text-xs mono" style={{ color: 'var(--text-secondary)' }}>
                        현재 {currentPrice.toLocaleString('ko-KR')}원
                      </span>
                      <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>
                        {item.shares.toLocaleString()}주
                      </span>
                      <span className="text-xs mono" style={{ color: 'var(--text-secondary)' }}>
                        평가 {Math.round(evalAmt).toLocaleString('ko-KR')}원
                      </span>
                      <span
                        className="text-xs mono font-medium"
                        style={{ color: profitColor(profitPct) }}
                      >
                        {profitAmt >= 0 ? '+' : ''}{Math.round(profitAmt).toLocaleString('ko-KR')}원
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-[10px] px-2 py-1 rounded-lg transition-all"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
                    >
                      편집
                    </button>
                    <button
                      onClick={() => deleteItem(item.ticker)}
                      className="text-[10px] px-2 py-1 rounded-lg transition-all"
                      style={{ background: 'rgba(255,92,92,0.08)', border: '1px solid rgba(255,92,92,0.25)', color: 'var(--accent-red)' }}
                    >
                      삭제
                    </button>
                  </div>
                </div>

                {/* AI 조언 */}
                {itemAdvice && advStyle ? (
                  <div
                    className="rounded-xl p-3"
                    style={{ background: advStyle.bg, border: `1px solid ${advStyle.border}` }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: advStyle.border.replace('0.4', '0.2'), color: advStyle.color }}
                      >
                        💡 {advStyle.label}
                      </span>
                      <span className="text-[10px] mono" style={{ color: 'var(--text-muted)' }}>
                        AI 조언 ({adviceDate})
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {itemAdvice.advice_detail}
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-xl p-3 text-center"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      AI 조언 없음 — 다음 분석 실행 후 표시됩니다
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 보유 현금 */}
      <div
        className="glass rounded-2xl p-4"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>💵 보유 현금</span>
            {!editingCash && (
              <span className="mono text-sm font-semibold" style={{ color: 'var(--accent-gold)' }}>
                {cash.toLocaleString('ko-KR')}원
              </span>
            )}
          </div>
          {editingCash ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cashInput}
                onChange={e => setCashInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveCash()}
                placeholder="보유 현금 (원)"
                autoFocus
                className="px-3 py-1.5 rounded-xl text-xs mono outline-none"
                style={{
                  width: '140px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={saveCash}
                disabled={saving}
                className="btn-primary px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
              >
                저장
              </button>
              <button
                onClick={() => setEditingCash(false)}
                className="px-3 py-1.5 rounded-xl text-xs"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
              >
                취소
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setCashInput(String(cash)); setEditingCash(true) }}
              className="text-[10px] px-2 py-1 rounded-lg transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
            >
              편집
            </button>
          )}
        </div>
      </div>

      {error && !showForm && (
        <p className="text-xs mt-2" style={{ color: 'var(--accent-red)' }}>{error}</p>
      )}
    </div>
  )
}
