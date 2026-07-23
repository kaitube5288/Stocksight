'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { PortfolioItem, PortfolioAdvice, PortfolioAccount } from '@/lib/supabase'

type SearchResult = { ticker: string; name: string; sector: string }
type LivePrice = { price: number | null }
type AcctForm = { name: string; current_investment: string; additional_investment: string; cash: string }

const ADVICE_STYLE: Record<string, { bg: string; border: string; color: string; label: string }> = {
  '보유유지': { bg: 'rgba(77,166,255,0.12)', border: 'rgba(77,166,255,0.4)', color: '#4da6ff', label: '보유유지' },
  '물타기':   { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.4)',  color: '#fb923c', label: '물타기' },
  '추매':     { bg: 'rgba(0,229,170,0.12)',    border: 'rgba(0,229,170,0.4)',   color: '#00e5aa', label: '추매' },
  '분할매수': { bg: 'rgba(0,229,170,0.12)',    border: 'rgba(0,229,170,0.4)',   color: '#00e5aa', label: '분할매수' },
  '분할매도': { bg: 'rgba(255,201,77,0.12)',   border: 'rgba(255,201,77,0.4)',  color: '#ffc94d', label: '분할매도' },
  '손절고려': { bg: 'rgba(255,92,92,0.12)',    border: 'rgba(255,92,92,0.4)',   color: '#ff5c5c', label: '손절고려' },
}

const EMPTY_FORM = { ticker: '', name: '', avg_price: '', shares: '', account_id: '' }
const EMPTY_ACCT = (): AcctForm => ({ name: '', current_investment: '0', additional_investment: '0', cash: '0' })

export default function PortfolioSection() {
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([])
  const [live, setLive] = useState<Record<string, LivePrice>>({})
  const [advice, setAdvice] = useState<PortfolioAdvice[]>([])
  const [adviceDate, setAdviceDate] = useState<string | null>(null)
  const [adviceIsToday, setAdviceIsToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Stock form
  const [showForm, setShowForm] = useState(false)
  const [editTicker, setEditTicker] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Account form
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [acctForm, setAcctForm] = useState<AcctForm>(EMPTY_ACCT())
  const [addingAccount, setAddingAccount] = useState(false)
  const [newAcctForm, setNewAcctForm] = useState<AcctForm>(EMPTY_ACCT())

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
      setAccounts(portData.accounts ?? [])
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

  // ----- Account CRUD -----
  const startEditAccount = (acc: PortfolioAccount) => {
    setEditingAccountId(acc.id ?? null)
    setAcctForm({
      name: acc.name,
      current_investment: String(acc.current_investment),
      additional_investment: String(acc.additional_investment),
      cash: String(acc.cash),
    })
  }

  const saveAccount = async (isNew: boolean) => {
    const f = isNew ? newAcctForm : acctForm
    const id = isNew ? undefined : (editingAccountId ?? undefined)
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'account',
          id,
          name: f.name || '신규 계좌',
          current_investment: Number(String(f.current_investment).replace(/,/g, '') || 0),
          additional_investment: Number(String(f.additional_investment).replace(/,/g, '') || 0),
          cash: Number(String(f.cash).replace(/,/g, '') || 0),
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setEditingAccountId(null)
      setAddingAccount(false)
      setNewAcctForm(EMPTY_ACCT())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const deleteAccount = async (id: string) => {
    if (!confirm('이 계좌를 삭제하시겠습니까?\n(연결된 종목은 미분류로 이동됩니다)')) return
    setSaving(true)
    try {
      await fetch('/api/portfolio', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'account', id }),
      })
      await load()
    } catch { setError('계좌 삭제 실패') }
    finally { setSaving(false) }
  }

  // ----- Stock CRUD -----
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
    setForm({
      ticker: item.ticker,
      name: item.name,
      avg_price: String(item.avg_price),
      shares: String(item.shares),
      account_id: item.account_id ?? '',
    })
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
        body: JSON.stringify({
          ticker: form.ticker.trim(),
          name: form.name.trim(),
          avg_price: Number(form.avg_price.replace(/,/g, '')),
          shares: Number(form.shares.replace(/,/g, '')),
          account_id: form.account_id || null,
        }),
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

  // ----- Derived values -----
  const profitColor = (pct: number) =>
    pct > 0 ? 'var(--accent-green)' : pct < 0 ? 'var(--accent-red)' : 'var(--text-muted)'

  const getItemPrice = (item: PortfolioItem) => live[item.ticker]?.price ?? item.avg_price

  const totalEval = items.reduce((sum, i) => sum + getItemPrice(i) * i.shares, 0)
  const totalCost = items.reduce((sum, i) => sum + i.avg_price * i.shares, 0)
  const totalProfitPct = totalCost > 0 ? ((totalEval - totalCost) / totalCost) * 100 : 0
  const totalCash = accounts.reduce((sum, a) => sum + a.cash, 0)
  const totalCurrentInv = accounts.reduce((sum, a) => sum + a.current_investment, 0)
  const totalAdditionalInv = accounts.reduce((sum, a) => sum + a.additional_investment, 0)
  const totalAsset = totalEval + totalCash

  // Group items by account
  const itemsByAccount: Record<string, PortfolioItem[]> = {}
  const unassigned: PortfolioItem[] = []
  for (const item of items) {
    const aid = item.account_id
    if (!aid) {
      unassigned.push(item)
    } else {
      if (!itemsByAccount[aid]) itemsByAccount[aid] = []
      itemsByAccount[aid].push(item)
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {[...Array(3)].map((_, i) => (
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
              AI 조언 {adviceDate} {adviceIsToday ? '(오늘)' : '(최근)'}
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

      {/* 총 자산 요약 */}
      {(items.length > 0 || accounts.length > 0) && (
        <div className="glass rounded-2xl p-4 mb-5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              { label: '총 평가금액', value: `${Math.round(totalEval).toLocaleString('ko-KR')}원`, color: 'var(--text-primary)' },
              { label: '총 수익률', value: `${totalProfitPct >= 0 ? '+' : ''}${totalProfitPct.toFixed(2)}%`, color: profitColor(totalProfitPct) },
              { label: '현금 합계', value: `${Math.round(totalCash).toLocaleString('ko-KR')}원`, color: 'var(--accent-gold)' },
              { label: '총 자산', value: `${Math.round(totalAsset).toLocaleString('ko-KR')}원`, color: '#a78bfa' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
                <div className="mono text-sm font-semibold" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>
          {(totalCurrentInv > 0 || totalAdditionalInv > 0) && (
            <div className="flex items-center gap-5 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>총 원금 합계&nbsp;&nbsp;</span>
                <span className="mono text-[11px] font-semibold" style={{ color: '#a78bfa' }}>{totalCurrentInv.toLocaleString('ko-KR')}원</span>
              </div>
              <div>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>추가투자금 합계&nbsp;&nbsp;</span>
                <span className="mono text-[11px] font-semibold" style={{ color: 'var(--accent-green)' }}>{totalAdditionalInv.toLocaleString('ko-KR')}원</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 계좌 관리 섹션 ===== */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>계좌 관리</span>
          <button
            onClick={() => { setAddingAccount(true); setNewAcctForm(EMPTY_ACCT()) }}
            className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all"
            style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}
          >
            + 계좌 추가
          </button>
        </div>

        {addingAccount && (
          <div className="mb-3">
            <AccountEditCard
              form={newAcctForm}
              onChange={setNewAcctForm}
              onSave={() => saveAccount(true)}
              onCancel={() => setAddingAccount(false)}
              saving={saving}
              isNew
            />
          </div>
        )}

        {accounts.length === 0 && !addingAccount ? (
          <div className="glass rounded-2xl p-6 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>등록된 계좌가 없습니다. 위의 계좌 추가를 눌러 등록하세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {accounts.map(acc => {
              const isEditing = editingAccountId === acc.id
              const accItems = itemsByAccount[acc.id ?? ''] ?? []
              const evalTotal = accItems.reduce((sum, i) => sum + getItemPrice(i) * i.shares, 0)
              const accCost = accItems.reduce((sum, i) => sum + i.avg_price * i.shares, 0)
              const accProfitPct = accCost > 0 ? ((evalTotal - accCost) / accCost) * 100 : 0

              if (isEditing) {
                return (
                  <AccountEditCard
                    key={acc.id}
                    form={acctForm}
                    onChange={setAcctForm}
                    onSave={() => saveAccount(false)}
                    onCancel={() => setEditingAccountId(null)}
                    saving={saving}
                  />
                )
              }

              return (
                <div key={acc.id} className="glass rounded-2xl p-4" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{acc.name}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => startEditAccount(acc)}
                        className="text-[10px] px-2 py-1 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
                      >편집</button>
                      <button
                        onClick={() => acc.id && deleteAccount(acc.id)}
                        className="text-[10px] px-2 py-1 rounded-lg"
                        style={{ background: 'rgba(255,92,92,0.08)', border: '1px solid rgba(255,92,92,0.25)', color: 'var(--accent-red)' }}
                      >삭제</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '총 원금', value: acc.current_investment, color: '#a78bfa' },
                      { label: '추가투자금', value: acc.additional_investment, color: 'var(--accent-green)' },
                      { label: '보유현금', value: acc.cash, color: 'var(--accent-gold)' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-xl p-2 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="text-[9px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
                        <div className="mono text-[11px] font-semibold" style={{ color }}>{value.toLocaleString('ko-KR')}원</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          label: `계좌평가${accItems.length > 0 ? ` (${accItems.length}개)` : ''}`,
                          value: `${Math.round(evalTotal).toLocaleString('ko-KR')}원`,
                          color: 'var(--text-secondary)',
                        },
                        {
                          label: '손익금',
                          value: accCost > 0
                            ? `${evalTotal - accCost >= 0 ? '+' : ''}${Math.round(evalTotal - accCost).toLocaleString('ko-KR')}원`
                            : '—',
                          color: accCost > 0 ? profitColor(accProfitPct) : 'var(--text-muted)',
                        },
                        {
                          label: '수익률',
                          value: accCost > 0 ? `${accProfitPct >= 0 ? '+' : ''}${accProfitPct.toFixed(2)}%` : '—',
                          color: accCost > 0 ? profitColor(accProfitPct) : 'var(--text-muted)',
                        },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-xl p-2 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                          <div className="text-[9px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
                          <div className="mono text-[11px] font-semibold" style={{ color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== 종목 추가/수정 폼 ===== */}
      {showForm && (
        <div className="glass rounded-2xl p-4 mb-4" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
          <div className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
            {editTicker ? '종목 수정' : '종목 추가'}
          </div>

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

          <div className="grid grid-cols-2 gap-2 mb-2">
            {[
              { key: 'avg_price', placeholder: '평균단가 (예: 62000)' },
              { key: 'shares', placeholder: '보유수량 (예: 100)' },
            ].map(({ key, placeholder }) => (
              <input
                key={key}
                type="text"
                placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="px-3 py-2 rounded-xl text-xs mono outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
              />
            ))}
          </div>

          {accounts.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>계좌 지정</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setForm(f => ({ ...f, account_id: '' }))}
                  className="text-[10px] px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background: !form.account_id ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${!form.account_id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                    color: !form.account_id ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  미분류
                </button>
                {accounts.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setForm(f => ({ ...f, account_id: a.id ?? '' }))}
                    className="text-[10px] px-2.5 py-1 rounded-lg transition-all"
                    style={{
                      background: form.account_id === a.id ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${form.account_id === a.id ? 'rgba(167,139,250,0.45)' : 'rgba(255,255,255,0.1)'}`,
                      color: form.account_id === a.id ? '#a78bfa' : 'var(--text-muted)',
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

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

      {/* ===== 보유 종목 섹션 ===== */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>보유 종목</span>
          {items.length > 0 && (
            <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>총 {items.length}개</span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>보유 종목 없음</div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              위의 <strong>+ 종목 추가</strong> 버튼으로 보유 종목을 입력하세요.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* 계좌별 그룹 */}
            {accounts.map(acc => {
              const accItems = itemsByAccount[acc.id ?? ''] ?? []
              if (accItems.length === 0) return null
              const accEval = accItems.reduce((sum, i) => sum + getItemPrice(i) * i.shares, 0)
              const accCost = accItems.reduce((sum, i) => sum + i.avg_price * i.shares, 0)
              const accProfitPct = accCost > 0 ? ((accEval - accCost) / accCost) * 100 : 0

              return (
                <div key={acc.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[11px] font-semibold px-2.5 py-0.5 rounded-lg"
                        style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }}
                      >
                        {acc.name}
                      </span>
                      <span className="mono text-[10px]" style={{ color: profitColor(accProfitPct) }}>
                        {accProfitPct >= 0 ? '+' : ''}{accProfitPct.toFixed(2)}%
                      </span>
                    </div>
                    <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {Math.round(accEval).toLocaleString('ko-KR')}원
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {accItems.map(item => (
                      <StockCard
                        key={item.ticker}
                        item={item}
                        live={live}
                        advice={advice}
                        adviceDate={adviceDate}
                        profitColor={profitColor}
                        onEdit={openEdit}
                        onDelete={deleteItem}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {/* 미분류 종목 */}
            {unassigned.length > 0 && (
              <div>
                {accounts.length > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="text-[11px] px-2.5 py-0.5 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
                    >
                      미분류
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {unassigned.map(item => (
                    <StockCard
                      key={item.ticker}
                      item={item}
                      live={live}
                      advice={advice}
                      adviceDate={adviceDate}
                      profitColor={profitColor}
                      onEdit={openEdit}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && !showForm && (
        <p className="text-xs mt-2" style={{ color: 'var(--accent-red)' }}>{error}</p>
      )}
    </div>
  )
}

// ===== Sub-components =====

function AccountEditCard({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew = false,
}: {
  form: AcctForm
  onChange: (f: AcctForm) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isNew?: boolean
}) {
  return (
    <div className="glass rounded-2xl p-4" style={{ border: '1px solid rgba(167,139,250,0.3)' }}>
      <div className="text-[10px] mb-2.5 font-medium" style={{ color: '#a78bfa' }}>
        {isNew ? '새 계좌 추가' : '계좌 편집'}
      </div>
      <input
        type="text"
        placeholder="계좌명 (예: 신한투자)"
        value={form.name}
        onChange={e => onChange({ ...form, name: e.target.value })}
        className="w-full px-3 py-2 rounded-xl text-xs mono outline-none mb-2"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
      />
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { key: 'current_investment' as const, label: '총 원금', color: '#a78bfa' },
          { key: 'additional_investment' as const, label: '추가투자금', color: 'var(--accent-green)' },
          { key: 'cash' as const, label: '보유현금', color: 'var(--accent-gold)' },
        ].map(({ key, label, color }) => (
          <div key={key}>
            <div className="text-[9px] mb-1" style={{ color }}>{label}</div>
            <input
              type="text"
              placeholder="0"
              value={form[key]}
              onChange={e => onChange({ ...form, [key]: e.target.value })}
              className="w-full px-2 py-1.5 rounded-lg text-xs mono outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 rounded-xl text-xs"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
        >취소</button>
      </div>
    </div>
  )
}

function StockCard({
  item,
  live,
  advice,
  adviceDate,
  profitColor,
  onEdit,
  onDelete,
}: {
  item: PortfolioItem
  live: Record<string, LivePrice>
  advice: PortfolioAdvice[]
  adviceDate: string | null
  profitColor: (pct: number) => string
  onEdit: (item: PortfolioItem) => void
  onDelete: (ticker: string) => void
}) {
  const currentPrice = live[item.ticker]?.price ?? item.avg_price
  const profitAmt = (currentPrice - item.avg_price) * item.shares
  const profitPct = item.avg_price > 0 ? ((currentPrice - item.avg_price) / item.avg_price) * 100 : 0
  const evalAmt = currentPrice * item.shares
  const itemAdvice = advice.find(a => a.ticker === item.ticker)
  const advStyle = itemAdvice ? (ADVICE_STYLE[itemAdvice.advice_type] ?? ADVICE_STYLE['보유유지']) : null

  return (
    <div className="glass rounded-2xl p-4" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
            <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>{item.ticker}</span>
            <span className="mono text-xs font-bold" style={{ color: profitColor(profitPct) }}>
              {profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>평균 {item.avg_price.toLocaleString('ko-KR')}원</span>
            <span className="text-xs mono" style={{ color: 'var(--text-secondary)' }}>현재 {currentPrice.toLocaleString('ko-KR')}원</span>
            <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>{item.shares.toLocaleString()}주</span>
            <span className="text-xs mono" style={{ color: 'var(--text-secondary)' }}>평가 {Math.round(evalAmt).toLocaleString('ko-KR')}원</span>
            <span className="text-xs mono font-medium" style={{ color: profitColor(profitPct) }}>
              {profitAmt >= 0 ? '+' : ''}{Math.round(profitAmt).toLocaleString('ko-KR')}원
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onEdit(item)}
            className="text-[10px] px-2 py-1 rounded-lg transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
          >편집</button>
          <button
            onClick={() => onDelete(item.ticker)}
            className="text-[10px] px-2 py-1 rounded-lg transition-all"
            style={{ background: 'rgba(255,92,92,0.08)', border: '1px solid rgba(255,92,92,0.25)', color: 'var(--accent-red)' }}
          >삭제</button>
        </div>
      </div>

      {itemAdvice && advStyle ? (
        <div className="rounded-xl p-3" style={{ background: advStyle.bg, border: `1px solid ${advStyle.border}` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: advStyle.border.replace('0.4', '0.2'), color: advStyle.color }}
            >
              {advStyle.label}
            </span>
            <span className="text-[10px] mono" style={{ color: 'var(--text-muted)' }}>AI 조언 ({adviceDate})</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{itemAdvice.advice_detail}</p>
        </div>
      ) : (
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>AI 조언 없음 — 다음 분석 실행 후 표시됩니다</p>
        </div>
      )}
    </div>
  )
}
