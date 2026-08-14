'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { PortfolioItem, PortfolioAdvice, PortfolioAccount, PortfolioSnapshot, PortfolioTransaction } from '@/lib/supabase'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'

type SearchResult = { ticker: string; name: string; sector: string }
type LivePrice = { price: number | null }
type AcctForm = { name: string; current_investment: string; additional_investment: string; cash: string; brokerage: string; commission_rate: string }

const ADVICE_STYLE: Record<string, { bg: string; border: string; color: string; label: string }> = {
  '보유유지': { bg: 'rgba(77,166,255,0.12)', border: 'rgba(77,166,255,0.4)', color: '#4da6ff', label: '보유유지' },
  '물타기':   { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.4)',  color: '#fb923c', label: '물타기' },
  '추매':     { bg: 'rgba(0,229,170,0.12)',    border: 'rgba(0,229,170,0.4)',   color: '#00e5aa', label: '추매' },
  '분할매수': { bg: 'rgba(0,229,170,0.12)',    border: 'rgba(0,229,170,0.4)',   color: '#00e5aa', label: '분할매수' },
  '분할매도': { bg: 'rgba(255,201,77,0.12)',   border: 'rgba(255,201,77,0.4)',  color: '#ffc94d', label: '분할매도' },
  '손절고려': { bg: 'rgba(255,92,92,0.12)',    border: 'rgba(255,92,92,0.4)',   color: '#ff5c5c', label: '손절고려' },
}

const EMPTY_FORM = { id: '', ticker: '', name: '', avg_price: '', shares: '', account_id: '' }
const EMPTY_ACCT = (): AcctForm => ({ name: '', current_investment: '0', additional_investment: '0', cash: '0', brokerage: 'etc', commission_rate: '0.015' })

const BROKERAGES: { name: string; rate: number | null }[] = [
  { name: '키움증권', rate: 0.015 },
  { name: '미래에셋', rate: 0.015 },
  { name: '삼성증권', rate: 0.014 },
  { name: 'NH투자증권', rate: 0.015 },
  { name: 'KB증권', rate: 0.015 },
  { name: '한국투자', rate: 0.015 },
  { name: '신한투자', rate: 0.015 },
  { name: '하나증권', rate: 0.015 },
  { name: '토스증권', rate: 0.015 },
  { name: '카카오페이', rate: 0 },
  { name: '직접입력', rate: null },
]
const SELL_TAX_RATE = 0.18 // 증권거래세+농특세 합계(%)
const TX_TABS = ['추매', '매도', '추가투자'] as const

type AccountTheme = {
  bg: string; border: string; shadow: string; accent: string
  divider: string; selectedBg: string; selectedBorder: string
}
const ACCOUNT_THEMES: { match: string; theme: AccountTheme }[] = [
  { match: '신한', theme: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', shadow: 'rgba(59,130,246,0.1)', accent: '#60a5fa', divider: 'rgba(59,130,246,0.15)', selectedBg: 'rgba(59,130,246,0.18)', selectedBorder: 'rgba(59,130,246,0.5)' } },
  { match: '카카오', theme: { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.3)', shadow: 'rgba(234,179,8,0.1)', accent: '#fbbf24', divider: 'rgba(234,179,8,0.15)', selectedBg: 'rgba(234,179,8,0.18)', selectedBorder: 'rgba(234,179,8,0.5)' } },
  { match: '나무', theme: { bg: 'rgba(74,222,128,0.07)', border: 'rgba(74,222,128,0.3)', shadow: 'rgba(74,222,128,0.1)', accent: '#86efac', divider: 'rgba(74,222,128,0.15)', selectedBg: 'rgba(74,222,128,0.15)', selectedBorder: 'rgba(74,222,128,0.45)' } },
]
const DEFAULT_THEME: AccountTheme = { bg: 'rgba(139,92,246,0.07)', border: 'rgba(167,139,250,0.25)', shadow: 'rgba(167,139,250,0.08)', accent: '#a78bfa', divider: 'rgba(167,139,250,0.12)', selectedBg: 'rgba(167,139,250,0.18)', selectedBorder: 'rgba(167,139,250,0.45)' }
function getAccountTheme(name: string): AccountTheme {
  for (const { match, theme } of ACCOUNT_THEMES) {
    if (name.includes(match)) return theme
  }
  return DEFAULT_THEME
}

// 한국 증시 관례: 상승=빨간색, 하락=파란색
const profitColor = (pct: number) =>
  pct > 0 ? '#ff5c5c' : pct < 0 ? '#4da6ff' : 'var(--text-muted)'

export default function PortfolioSection() {
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([])
  const [live, setLive] = useState<Record<string, LivePrice>>({})
  const [adviceByItemId, setAdviceByItemId] = useState<Record<string, PortfolioAdvice[]>>({})
  const [adviceIdx, setAdviceIdx] = useState<Record<string, number>>({})
  const [hasToday, setHasToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [runningAdvice, setRunningAdvice] = useState<Record<string, boolean>>({})
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const snapshotSavedRef = useRef(false)
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>([])
  const [txTabByAccount, setTxTabByAccount] = useState<Record<string, number>>({})
  const [txPageByAccType, setTxPageByAccType] = useState<Record<string, number>>({})

  // Stock form
  const [showForm, setShowForm] = useState(false)
  const [editTicker, setEditTicker] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // Account form
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [acctForm, setAcctForm] = useState<AcctForm>(EMPTY_ACCT())
  const [addingAccount, setAddingAccount] = useState(false)
  const [newAcctForm, setNewAcctForm] = useState<AcctForm>(EMPTY_ACCT())

  // Collapsible account stock groups
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set())

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
      const [portRes, advRes, txRes] = await Promise.all([
        fetch('/api/portfolio'),
        fetch('/api/portfolio/advice'),
        fetch('/api/portfolio/transactions'),
      ])
      const portData = await portRes.json()
      const advData = await advRes.json()
      const txData = await txRes.json()
      setItems(portData.items ?? [])
      setAccounts(portData.accounts ?? [])
      setTransactions(txData.transactions ?? [])

      const allAdvice: PortfolioAdvice[] = advData.allAdvice ?? []
      const byItemId: Record<string, PortfolioAdvice[]> = {}
      for (const a of allAdvice) {
        const key = a.portfolio_item_id ?? a.ticker
        if (!byItemId[key]) byItemId[key] = []
        byItemId[key].push(a)
      }
      setAdviceByItemId(byItemId)
      setHasToday(advData.hasToday ?? false)

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

  // 스냅샷 초기 로드
  useEffect(() => {
    fetch('/api/portfolio/snapshots')
      .then(r => r.json())
      .then(d => setSnapshots(d.snapshots ?? []))
      .catch(() => {})
  }, [])

  // 당일 스냅샷 저장 (라이브 가격 수신 후 1회)
  useEffect(() => {
    if (loading || snapshotSavedRef.current || items.length === 0) return
    if (Object.keys(live).length === 0) return
    snapshotSavedRef.current = true
    const totalEval = items.reduce((s, i) => s + (live[i.ticker]?.price ?? i.avg_price) * i.shares, 0)
    const totalCost = items.reduce((s, i) => s + i.avg_price * i.shares, 0)
    const totalCash = accounts.reduce((s, a) => s + a.cash, 0)
    fetch('/api/portfolio/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_eval: Math.round(totalEval), total_cost: Math.round(totalCost), total_cash: Math.round(totalCash) }),
    }).then(r => r.json()).then(d => {
      if (d.success) {
        setSnapshots(prev => {
          const today = new Date().toISOString().slice(0, 10)
          const filtered = prev.filter(s => s.date !== today)
          return [...filtered, { date: today, total_eval: Math.round(totalEval), total_cost: Math.round(totalCost), total_cash: Math.round(totalCash) }]
            .sort((a, b) => a.date.localeCompare(b.date))
        })
      }
    }).catch(() => {})
  }, [loading, items, live, accounts])

  // ----- Account CRUD -----
  const startEditAccount = (acc: PortfolioAccount) => {
    setEditingAccountId(acc.id ?? null)
    setAcctForm({
      name: acc.name,
      current_investment: String(acc.current_investment),
      additional_investment: String(acc.additional_investment),
      cash: String(Math.round(acc.cash)),
      brokerage: acc.brokerage ?? 'etc',
      commission_rate: String(acc.commission_rate ?? 0.015),
    })
  }

  const saveAccount = async (isNew: boolean) => {
    const f = isNew ? newAcctForm : acctForm
    const id = isNew ? undefined : (editingAccountId ?? undefined)
    const oldAcc = !isNew && id ? accounts.find(a => a.id === id) : null
    const oldAddlInv = oldAcc?.additional_investment ?? 0
    const newAddlInv = Number(String(f.additional_investment).replace(/,/g, '') || 0)
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'account', id,
          name: f.name || '신규 계좌',
          current_investment: Number(String(f.current_investment).replace(/,/g, '') || 0),
          additional_investment: newAddlInv,
          cash: Number(String(f.cash).replace(/,/g, '') || 0),
          commission_rate: Number(f.commission_rate || 0),
          brokerage: f.brokerage || 'etc',
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      if (!isNew && id && newAddlInv > oldAddlInv) {
        await fetch('/api/portfolio/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: id, type: '추가투자', amount: Math.round(newAddlInv - oldAddlInv) }),
        })
      }
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
      await fetch('/api/portfolio', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'account', id }) })
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
    setForm({ id: item.id ?? '', ticker: item.ticker, name: item.name, avg_price: String(item.avg_price), shares: String(item.shares), account_id: item.account_id ?? '' })
    setSearchQuery(`${item.name} (${item.ticker})`)
    setSearchResults([])
    setShowDropdown(false)
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
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
    if (!form.ticker || !form.name || !form.avg_price || !form.shares) { setError('모든 항목을 입력하세요'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id || undefined, ticker: form.ticker.trim(), name: form.name.trim(), avg_price: Number(form.avg_price.replace(/,/g, '')), shares: Number(form.shares.replace(/,/g, '')), account_id: form.account_id || null }),
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

  const deleteItem = async (id: string, ticker: string) => {
    if (!confirm(`${ticker} 종목을 삭제하시겠습니까?`)) return
    setSaving(true)
    try {
      await fetch('/api/portfolio', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      await load()
    } catch { setError('삭제 실패') }
    finally { setSaving(false) }
  }

  const updateItem = async (
    id: string, ticker: string, name: string, avgPrice: number, shares: number,
    accountId: string | null, buyCost?: number, txInfo?: { price: number; qty: number }
  ) => {
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ticker, name, avg_price: avgPrice, shares, account_id: accountId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      if (buyCost && buyCost > 0 && accountId) {
        const acc = accounts.find(a => String(a.id) === String(accountId))
        if (acc) {
          await fetch('/api/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'account', id: accountId, cash: Math.round(acc.cash - buyCost) }),
          })
        }
      }
      if (txInfo && accountId) {
        await fetch('/api/portfolio/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId, ticker, name, type: '추매', price: txInfo.price, quantity: txInfo.qty, amount: Math.round(txInfo.price * txInfo.qty) }),
        })
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '업데이트 실패')
    }
  }

  const handleSell = async (item: PortfolioItem, sPrice: number, sQty: number) => {
    if (!item.id) return
    try {
      if (sQty >= item.shares) {
        await fetch('/api/portfolio', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }),
        })
      } else {
        await fetch('/api/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, ticker: item.ticker, name: item.name, avg_price: item.avg_price, shares: item.shares - sQty, account_id: item.account_id ?? null }),
        })
      }
      if (sPrice > 0 && item.account_id) {
        const acc = accounts.find(a => a.id === item.account_id)
        if (acc) {
          const commRate = (acc.commission_rate ?? 0.015) / 100
          const netReceived = sPrice * sQty * (1 - commRate - SELL_TAX_RATE / 100)
          await fetch('/api/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'account', id: acc.id, cash: Math.round(acc.cash + netReceived) }),
          })
          await fetch('/api/portfolio/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: item.account_id, ticker: item.ticker, name: item.name, type: '매도', price: sPrice, quantity: sQty, amount: Math.round(netReceived) }),
          })
        }
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '매도 처리 실패')
    }
  }

  // ----- AI 조언 수동 실행 -----
  const runAdvice = async (itemId?: string) => {
    const key = itemId ?? 'all'
    setRunningAdvice(prev => ({ ...prev, [key]: true }))
    try {
      const body = itemId ? JSON.stringify({ item_id: itemId }) : undefined
      await fetch('/api/portfolio/advice/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      // 조언 데이터만 새로고침
      const advRes = await fetch('/api/portfolio/advice')
      const advData = await advRes.json()
      const allAdvice: PortfolioAdvice[] = advData.allAdvice ?? []
      const byItemId: Record<string, PortfolioAdvice[]> = {}
      for (const a of allAdvice) {
        const k = a.portfolio_item_id ?? a.ticker
        if (!byItemId[k]) byItemId[k] = []
        byItemId[k].push(a)
      }
      setAdviceByItemId(byItemId)
      setHasToday(advData.hasToday ?? false)
    } catch {
      setError('AI 조언 실행 실패')
    } finally {
      setRunningAdvice(prev => ({ ...prev, [key]: false }))
    }
  }

  // ----- Advice navigation -----
  const navigateAdvice = (itemId: string, delta: number, listLength: number) => {
    setAdviceIdx(prev => {
      const current = prev[itemId] ?? 0
      const next = Math.max(0, Math.min(listLength - 1, current + delta))
      return { ...prev, [itemId]: next }
    })
  }

  // ----- Collapse toggle -----
  const toggleCollapse = (accountId: string) => {
    setCollapsedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  // ----- Derived values -----
  const getItemPrice = (item: PortfolioItem) => live[item.ticker]?.price ?? item.avg_price

  const totalEval = items.reduce((sum, i) => sum + getItemPrice(i) * i.shares, 0)
  const totalCost = items.reduce((sum, i) => sum + i.avg_price * i.shares, 0)
  const totalProfitPct = totalCost > 0 ? ((totalEval - totalCost) / totalCost) * 100 : 0
  const totalCash = accounts.reduce((sum, a) => sum + a.cash, 0)
  const totalCurrentInv = accounts.reduce((sum, a) => sum + a.current_investment, 0)
  const totalAdditionalInv = accounts.reduce((sum, a) => sum + a.additional_investment, 0)
  const totalAsset = totalEval + totalCash

  // 일별 그래프 데이터 (스냅샷 + 오늘 현재값)
  const graphData = snapshots.map(s => ({
    date: s.date.slice(5).replace('-', '/'),
    value: s.total_eval,
  }))
  const todayStr = new Date().toISOString().slice(5, 10).replace('-', '/')
  if (!loading && items.length > 0 && !graphData.some(d => d.date === todayStr)) {
    graphData.push({ date: todayStr, value: Math.round(totalEval) })
  }

  // Group items by account (account_id가 현재 accounts에 없는 고아 종목도 미분류로 표시)
  const knownAccountIds = new Set(accounts.map(a => a.id).filter((id): id is string => id != null))
  const itemsByAccount: Record<string, PortfolioItem[]> = {}
  const unassigned: PortfolioItem[] = []
  for (const item of items) {
    const aid = item.account_id
    if (!aid || !knownAccountIds.has(aid)) {
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
      <div className="flex items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>내 포트폴리오</h2>
          {hasToday && (
            <span className="text-[10px] px-2 py-0.5 rounded-full mono" style={{ background: 'rgba(0,229,170,0.1)', border: '1px solid rgba(0,229,170,0.3)', color: 'var(--accent-green)' }}>
              AI 조언 오늘
            </span>
          )}
        </div>
      </div>

      {/* ===== 1. 총 자산 요약 (맨 위) ===== */}
      {(items.length > 0 || accounts.length > 0) && (
        <div className="rounded-2xl p-3 mb-5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 2px 20px rgba(0,0,0,0.25)' }}>
          <div className="flex gap-3 items-stretch">
            {/* 왼쪽: 지표 (2줄 레이아웃 — 상: 총수익률/총손익금/현금합계, 하: 총평가금액/총자산) */}
            <div className="flex-1 min-w-0 flex flex-col">
              {(() => {
                const profitBg     = totalCost > 0 ? (totalProfitPct > 0 ? 'rgba(255,92,92,0.09)' : totalProfitPct < 0 ? 'rgba(77,166,255,0.09)' : 'rgba(255,255,255,0.04)') : 'rgba(255,255,255,0.04)'
                const profitBorder = totalCost > 0 ? (totalProfitPct > 0 ? 'rgba(255,92,92,0.22)' : totalProfitPct < 0 ? 'rgba(77,166,255,0.22)' : 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.08)'
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {[
                        { label: '총 수익률', value: `${totalProfitPct >= 0 ? '+' : ''}${totalProfitPct.toFixed(2)}%`, color: profitColor(totalProfitPct), bg: profitBg, border: profitBorder },
                        { label: '총 손익금', value: `${totalEval - totalCost >= 0 ? '+' : ''}${Math.round(totalEval - totalCost).toLocaleString('ko-KR')}원`, color: profitColor(totalProfitPct), bg: profitBg, border: profitBorder },
                        { label: '현금 합계', value: `${Math.round(totalCash).toLocaleString('ko-KR')}원`, color: 'var(--accent-gold)', bg: 'rgba(255,201,77,0.1)', border: 'rgba(255,201,77,0.27)' },
                      ].map(({ label, value, color, bg, border }) => (
                        <div key={label} className="rounded-xl p-2 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                          <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
                          <div className="mono text-sm font-semibold" style={{ color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {[
                        { label: '총 평가금액', value: `${Math.round(totalEval).toLocaleString('ko-KR')}원`, color: '#ff5c5c', bg: 'rgba(255,92,92,0.09)', border: 'rgba(255,92,92,0.22)' },
                        { label: '총 자산', value: `${Math.round(totalAsset).toLocaleString('ko-KR')}원`, color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' },
                      ].map(({ label, value, color, bg, border }) => (
                        <div key={label} className="rounded-xl p-2 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                          <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
                          <div className="mono text-sm font-semibold" style={{ color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )
              })()}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 mt-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>총 매입금액&nbsp;&nbsp;</span>
                  <span className="mono text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{Math.round(totalCost).toLocaleString('ko-KR')}원</span>
                </div>
                {totalCurrentInv > 0 && (
                  <div>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>원금 합계&nbsp;&nbsp;</span>
                    <span className="mono text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{totalCurrentInv.toLocaleString('ko-KR')}원</span>
                  </div>
                )}
                {totalAdditionalInv > 0 && (
                  <div>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>추가투자금 합계&nbsp;&nbsp;</span>
                    <span className="mono text-[11px] font-semibold" style={{ color: 'var(--accent-green)' }}>{totalAdditionalInv.toLocaleString('ko-KR')}원</span>
                  </div>
                )}
              </div>
            </div>
            {/* 오른쪽: 일별 평가금액 그래프 (더 넓게) */}
            <div className="w-96 sm:w-[28rem] shrink-0">
              <div className="text-[10px] mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>총 평가금액 추이</div>
              {graphData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={graphData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#ffffff', fontWeight: 700 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 9, fill: '#ffffff', fontWeight: 700 }}
                      axisLine={false}
                      tickLine={false}
                      width={42}
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `${Math.round(v / 1000).toLocaleString()}k`}
                    />
                    <Tooltip
                      contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '10px', color: 'rgba(255,255,255,0.85)' }}
                      formatter={(v: unknown) => [`₩${Number(v).toLocaleString()}`, '평가금액']}
                    />
                    <Line type="monotone" dataKey="value" stroke="#a78bfa" dot={false} strokeWidth={1.5} activeDot={{ r: 3, fill: '#a78bfa' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center" style={{ height: '110px' }}>
                  <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>데이터 수집 중</div>
                  <div className="text-[9px] mt-1" style={{ color: 'rgba(255,255,255,0.15)' }}>방문마다 기록됩니다</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 2. 계좌 관리 섹션 ===== */}
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
            <AccountEditCard form={newAcctForm} onChange={setNewAcctForm} onSave={() => saveAccount(true)} onCancel={() => setAddingAccount(false)} saving={saving} isNew />
          </div>
        )}

        {accounts.length === 0 && !addingAccount ? (
          <div className="glass rounded-2xl p-6 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>등록된 계좌가 없습니다. 계좌 추가를 눌러 등록하세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
            {accounts.map(acc => {
              const isEditing = editingAccountId === acc.id
              const accItems = itemsByAccount[acc.id ?? ''] ?? []
              const evalTotal = accItems.reduce((sum, i) => sum + getItemPrice(i) * i.shares, 0)
              const accCost = accItems.reduce((sum, i) => sum + i.avg_price * i.shares, 0)
              const accProfitPct = accCost > 0 ? ((evalTotal - accCost) / accCost) * 100 : 0
              const theme = getAccountTheme(acc.name)

              if (isEditing) {
                return <AccountEditCard key={acc.id} form={acctForm} onChange={setAcctForm} onSave={() => saveAccount(false)} onCancel={() => setEditingAccountId(null)} saving={saving} />
              }

              const profitBg = accCost > 0
                ? accProfitPct > 0 ? 'rgba(255,92,92,0.08)' : accProfitPct < 0 ? 'rgba(77,166,255,0.08)' : 'rgba(255,255,255,0.04)'
                : 'rgba(255,255,255,0.04)'
              const profitBorder = accCost > 0
                ? accProfitPct > 0 ? 'rgba(255,92,92,0.22)' : accProfitPct < 0 ? 'rgba(77,166,255,0.22)' : 'rgba(255,255,255,0.08)'
                : 'rgba(255,255,255,0.08)'

              return (
                <div key={acc.id} className="rounded-2xl p-4 h-full flex flex-col" style={{ minHeight: '280px', background: theme.bg, border: `1px solid ${theme.border}`, boxShadow: `0 0 28px ${theme.shadow}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-semibold" style={{ color: theme.accent }}>{acc.name}</span>
                      {acc.brokerage && acc.brokerage !== 'etc' && (
                        <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {acc.brokerage} · 수수료 {acc.commission_rate ?? 0.015}%
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => startEditAccount(acc)} className="text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--text-muted)' }}>편집</button>
                      <button onClick={() => acc.id && deleteAccount(acc.id)} className="text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(255,92,92,0.1)', border: '1px solid rgba(255,92,92,0.3)', color: 'var(--accent-red)' }}>삭제</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '원금', value: acc.current_investment, color: 'var(--text-primary)', bg: 'rgba(167,139,250,0.13)', border: 'rgba(167,139,250,0.3)' },
                      { label: '추가투자금', value: acc.additional_investment, color: 'var(--accent-green)', bg: 'rgba(0,229,170,0.1)', border: 'rgba(0,229,170,0.27)' },
                      { label: '보유현금', value: Math.round(acc.cash), color: 'var(--accent-gold)', bg: 'rgba(255,201,77,0.1)', border: 'rgba(255,201,77,0.27)' },
                    ].map(({ label, value, color, bg, border }) => (
                      <div key={label} className="rounded-xl p-2 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                        <div className="text-[9px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
                        <div className="mono text-[11px] font-semibold" style={{ color }}>{value.toLocaleString('ko-KR')}원</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${theme.divider}` }}>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: `계좌평가${accItems.length > 0 ? ` (${accItems.length}개)` : ''}`, value: `${Math.round(evalTotal).toLocaleString('ko-KR')}원`, color: '#ff5c5c', bg: 'rgba(255,92,92,0.09)', border: 'rgba(255,92,92,0.22)' },
                        { label: '손익금', value: accCost > 0 ? `${evalTotal - accCost >= 0 ? '+' : ''}${Math.round(evalTotal - accCost).toLocaleString('ko-KR')}원` : '—', color: accCost > 0 ? profitColor(accProfitPct) : 'var(--text-muted)', bg: profitBg, border: profitBorder },
                        { label: '수익률', value: accCost > 0 ? `${accProfitPct >= 0 ? '+' : ''}${accProfitPct.toFixed(2)}%` : '—', color: accCost > 0 ? profitColor(accProfitPct) : 'var(--text-muted)', bg: profitBg, border: profitBorder },
                      ].map(({ label, value, color, bg, border }) => (
                        <div key={label} className="rounded-xl p-2 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                          <div className="text-[9px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
                          <div className="mono text-[11px] font-semibold" style={{ color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 계좌 총 자산 = 계좌평가 + 보유현금 */}
                  <div className="mt-auto pt-2.5">
                    <div className="rounded-xl p-2 text-center" style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' }}>
                      <div className="text-[9px] mb-1" style={{ color: 'var(--text-muted)' }}>계좌 총 자산</div>
                      <div className="mono text-[11px] font-semibold" style={{ color: '#a78bfa' }}>{Math.round(evalTotal + acc.cash).toLocaleString('ko-KR')}원</div>
                    </div>
                  </div>

                </div>
              )
            })}

            {/* 통합 거래 이력 카드 — 그리드 빈 셀 채움 */}
            {accounts.length > 0 && (() => {
              const ROW_COLORS  = ['var(--accent-green)', 'var(--accent-gold)', '#a78bfa']
              const ROW_BG      = ['rgba(0,229,170,0.08)', 'rgba(255,201,77,0.08)', 'rgba(167,139,250,0.08)']
              const ROW_BORDER  = ['rgba(0,229,170,0.25)', 'rgba(255,201,77,0.25)', 'rgba(167,139,250,0.25)']
              return (
                <div className="rounded-2xl overflow-hidden h-full" style={{ minHeight: '280px', display: 'grid', gridTemplateRows: 'auto 1fr 1fr 1fr', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 0 20px rgba(0,0,0,0.2)' }}>
                  {/* 증권사 헤더 행 */}
                  <div className="flex" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {accounts.map((acc, i) => {
                      const t = getAccountTheme(acc.name)
                      return (
                        <div key={acc.id} className="flex-1 py-2.5 text-center text-[10px] font-semibold" style={{ color: t.accent, borderRight: i < accounts.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', background: t.bg }}>
                          {acc.name}
                        </div>
                      )
                    })}
                  </div>

                  {/* 거래유형 행 × 증권사 열 — gridTemplateRows: 1fr 1fr 1fr 로 3등분 보장 */}
                  {TX_TABS.map((txType, rowIdx) => (
                    <div key={txType} className="flex" style={{ borderBottom: rowIdx < TX_TABS.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none', minHeight: 0 }}>
                      {accounts.map((acc, colIdx) => {
                        const accTheme = getAccountTheme(acc.name)
                        const pageKey = `${acc.id}_${txType}`
                        const page = txPageByAccType[pageKey] ?? 0
                        const txs = transactions.filter(t => String(t.account_id) === String(acc.id) && t.type === txType)
                        const tx = txs[page] ?? null
                        return (
                          <div key={acc.id} className="flex-1 p-2 flex flex-col items-center gap-1" style={{ borderRight: colIdx < accounts.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                            {/* 거래유형 레이블 */}
                            <div className="text-[9px] font-semibold shrink-0" style={{ color: ROW_COLORS[rowIdx] }}>{txType}</div>

                            {/* 둥근 테두리 박스 — 버튼 포함 */}
                            <div className="w-full rounded-xl p-2 flex flex-col items-center gap-0.5 flex-1 justify-center" style={{ background: ROW_BG[rowIdx], border: `1px solid ${ROW_BORDER[rowIdx]}` }}>
                              {tx ? (
                                <>
                                  {/* 날짜 */}
                                  <div className="text-[8px] mono" style={{ color: 'rgba(255,255,255,0.35)' }}>{tx.date.slice(5)}</div>
                                  {/* ◀ 종목명 ▶ */}
                                  <div className="flex items-center justify-between w-full gap-0.5">
                                    <button
                                      onClick={() => setTxPageByAccType(prev => ({ ...prev, [pageKey]: Math.max(0, page - 1) }))}
                                      disabled={page === 0}
                                      className="shrink-0 w-4 h-4 flex items-center justify-center rounded transition-all disabled:opacity-20 text-[8px]"
                                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--text-muted)' }}
                                    >◀</button>
                                    <div className="flex-1 text-[9px] font-medium text-center truncate" style={{ color: accTheme.accent }}>{tx.name ?? '—'}</div>
                                    <button
                                      onClick={() => setTxPageByAccType(prev => ({ ...prev, [pageKey]: Math.min(txs.length - 1, page + 1) }))}
                                      disabled={page >= txs.length - 1}
                                      className="shrink-0 w-4 h-4 flex items-center justify-center rounded transition-all disabled:opacity-20 text-[8px]"
                                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--text-muted)' }}
                                    >▶</button>
                                  </div>
                                  {/* 수량 금액 */}
                                  <div className="flex items-center gap-1.5">
                                    {tx.quantity != null && <span className="text-[8px] mono" style={{ color: 'var(--text-muted)' }}>{tx.quantity}주</span>}
                                    <span className="text-[9px] mono font-semibold" style={{ color: 'var(--text-secondary)' }}>{Math.round(tx.amount).toLocaleString('ko-KR')}원</span>
                                  </div>
                                  <div className="text-[7px] mono" style={{ color: 'rgba(255,255,255,0.18)' }}>{page + 1}/{txs.length}</div>
                                </>
                              ) : (
                                <div className="text-[8px]" style={{ color: 'rgba(255,255,255,0.18)' }}>내역 없음</div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ===== 3. 종목 추가/수정 폼 ===== */}

      {showForm && (
        <div ref={formRef} className="glass rounded-2xl p-4 mb-4" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
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
              style={{ background: editTicker ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)', border: `1px solid ${form.ticker ? 'rgba(0,229,170,0.4)' : 'rgba(255,255,255,0.12)'}`, color: 'var(--text-primary)' }}
            />
            {form.ticker && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="text-[10px] mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,229,170,0.15)', color: 'var(--accent-green)' }}>{form.ticker}</span>
                {!editTicker && (
                  <button onClick={() => { setForm(f => ({ ...f, ticker: '', name: '' })); setSearchQuery('') }} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>✕</button>
                )}
              </div>
            )}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden" style={{ background: '#0d1221', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
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
              { key: 'shares', placeholder: '보유수량 (예: 100 또는 10.5)' },
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
                  style={{ background: !form.account_id ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${!form.account_id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`, color: !form.account_id ? 'var(--text-primary)' : 'var(--text-muted)' }}
                >미분류</button>
                {accounts.map(a => {
                  const t = getAccountTheme(a.name)
                  const selected = form.account_id === a.id
                  return (
                    <button
                      key={a.id}
                      onClick={() => setForm(f => ({ ...f, account_id: a.id ?? '' }))}
                      className="text-[10px] px-2.5 py-1 rounded-lg transition-all"
                      style={{ background: selected ? t.selectedBg : 'rgba(255,255,255,0.04)', border: `1px solid ${selected ? t.selectedBorder : 'rgba(255,255,255,0.1)'}`, color: selected ? t.accent : 'var(--text-muted)' }}
                    >{a.name}</button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={saveItem} disabled={saving} className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40">{saving ? '저장 중...' : '저장'}</button>
            <button onClick={() => { setShowForm(false); setError('') }} className="px-4 py-2 rounded-xl text-xs" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>취소</button>
          </div>
          {error && <p className="text-xs mt-2" style={{ color: 'var(--accent-red)' }}>{error}</p>}
        </div>
      )}

      {/* ===== 4. 보유 종목 섹션 ===== */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>보유 종목</span>
            {items.length > 0 && <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>총 {items.length}개</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openAdd}
              className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all"
              style={{ background: 'rgba(0,229,170,0.12)', border: '1px solid rgba(0,229,170,0.35)', color: 'var(--accent-green)' }}
            >
              + 종목 추가
            </button>
            <button
              onClick={() => runAdvice()}
              disabled={runningAdvice['all']}
              className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all disabled:opacity-50"
              style={{ background: 'rgba(0,229,170,0.1)', border: '1px solid rgba(0,229,170,0.3)', color: 'var(--accent-green)' }}
            >
              {runningAdvice['all'] ? '⏳ 실행 중…' : '전체조언실행'}
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>보유 종목 없음</div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>위의 <strong>+ 종목 추가</strong> 버튼으로 보유 종목을 입력하세요.</p>
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
              const badgeTheme = getAccountTheme(acc.name)
              const isCollapsed = collapsedAccounts.has(acc.id ?? '')

              return (
                <div key={acc.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-lg" style={{ background: badgeTheme.selectedBg, border: `1px solid ${badgeTheme.border}`, color: badgeTheme.accent }}>
                        {acc.name}
                      </span>
                      <span className="mono text-[10px]" style={{ color: profitColor(accProfitPct) }}>
                        {accProfitPct >= 0 ? '+' : ''}{accProfitPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{Math.round(accEval).toLocaleString('ko-KR')}원</span>
                      <button
                        onClick={() => acc.id && toggleCollapse(acc.id)}
                        className="text-[10px] px-2 py-0.5 rounded-lg transition-all"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
                      >
                        {isCollapsed ? '열기 ▼' : '접기 ▲'}
                      </button>
                    </div>
                  </div>
                  {!isCollapsed && (
                    <div className="flex flex-col gap-2">
                      {accItems.map(item => {
                        const byId = item.id ? (adviceByItemId[item.id] ?? []) : []
                        const byTicker = adviceByItemId[item.ticker] ?? []
                        const mergedAdvice = [...byId, ...byTicker.filter(a => !byId.some(b => b.date === a.date))]
                        return (
                        <StockCard
                          key={item.id ?? item.ticker}
                          item={item}
                          live={live}
                          adviceList={mergedAdvice}
                          adviceIdx={adviceIdx[item.id ?? item.ticker] ?? 0}
                          onAdviceNav={(delta) => navigateAdvice(item.id ?? item.ticker, delta, mergedAdvice.length)}
                          onEdit={openEdit}
                          onDelete={(id, ticker) => deleteItem(id, ticker)}
                          onUpdate={updateItem}
                          onSell={handleSell}
                          onRunAdvice={(itemId) => runAdvice(itemId)}
                          runningAdvice={runningAdvice[item.id ?? ''] ?? false}
                          commissionRate={acc.commission_rate ?? 0.015}
                        />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* 미분류 종목 */}
            {unassigned.length > 0 && (
              <div>
                {accounts.length > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] px-2.5 py-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>미분류</span>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {unassigned.map(item => {
                    const byId = item.id ? (adviceByItemId[item.id] ?? []) : []
                    const byTicker = adviceByItemId[item.ticker] ?? []
                    const mergedAdvice = [...byId, ...byTicker.filter(a => !byId.some(b => b.date === a.date))]
                    return (
                    <StockCard
                      key={item.id ?? item.ticker}
                      item={item}
                      live={live}
                      adviceList={mergedAdvice}
                      adviceIdx={adviceIdx[item.id ?? item.ticker] ?? 0}
                      onAdviceNav={(delta) => navigateAdvice(item.id ?? item.ticker, delta, mergedAdvice.length)}
                      onEdit={openEdit}
                      onDelete={(id, ticker) => deleteItem(id, ticker)}
                      onUpdate={updateItem}
                      onSell={handleSell}
                      onRunAdvice={(itemId) => runAdvice(itemId)}
                      runningAdvice={runningAdvice[item.id ?? ''] ?? false}
                      commissionRate={0.015}
                    />
                    )
                  })}
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
  form, onChange, onSave, onCancel, saving, isNew = false,
}: {
  form: AcctForm; onChange: (f: AcctForm) => void; onSave: () => void; onCancel: () => void; saving: boolean; isNew?: boolean
}) {
  return (
    <div className="glass rounded-2xl p-4" style={{ border: '1px solid rgba(167,139,250,0.3)' }}>
      <div className="text-[10px] mb-2.5 font-medium" style={{ color: '#a78bfa' }}>{isNew ? '새 계좌 추가' : '계좌 편집'}</div>
      <input type="text" placeholder="계좌명 (예: 신한투자)" value={form.name} onChange={e => onChange({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-xl text-xs mono outline-none mb-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }} />
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <div className="text-[9px] mb-1" style={{ color: 'rgba(255,201,77,0.7)' }}>증권사</div>
          <select
            value={form.brokerage}
            onChange={e => {
              const b = BROKERAGES.find(x => x.name === e.target.value)
              onChange({ ...form, brokerage: e.target.value, commission_rate: b?.rate != null ? String(b.rate) : form.commission_rate })
            }}
            className="w-full px-2 py-1.5 rounded-lg text-xs mono outline-none"
            style={{ background: 'rgba(30,30,40,0.95)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
          >
            <option value="etc">기타</option>
            {BROKERAGES.filter(b => b.name !== '직접입력').map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
            <option value="직접입력">직접입력</option>
          </select>
        </div>
        <div>
          <div className="text-[9px] mb-1" style={{ color: 'rgba(255,201,77,0.7)' }}>수수료율 (%)</div>
          <input
            type="text"
            placeholder="0.015"
            value={form.commission_rate}
            onChange={e => onChange({ ...form, commission_rate: e.target.value })}
            className="w-full px-2 py-1.5 rounded-lg text-xs mono outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { key: 'current_investment' as const, label: '총 원금', color: '#a78bfa' },
          { key: 'additional_investment' as const, label: '추가투자금', color: 'var(--accent-green)' },
          { key: 'cash' as const, label: '보유현금', color: 'var(--accent-gold)' },
        ].map(({ key, label, color }) => (
          <div key={key}>
            <div className="text-[9px] mb-1" style={{ color }}>{label}</div>
            <input type="text" placeholder="0" value={form[key]} onChange={e => onChange({ ...form, [key]: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-xs mono outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onSave} disabled={saving} className="btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40">{saving ? '저장 중...' : '저장'}</button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded-xl text-xs" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>취소</button>
      </div>
    </div>
  )
}

function StockCard({
  item, live, adviceList, adviceIdx, onAdviceNav, onEdit, onDelete, onUpdate, onSell, onRunAdvice, runningAdvice, commissionRate,
}: {
  item: PortfolioItem
  live: Record<string, LivePrice>
  adviceList: PortfolioAdvice[]
  adviceIdx: number
  onAdviceNav: (delta: number) => void
  onEdit: (item: PortfolioItem) => void
  onDelete: (id: string, ticker: string) => void
  onUpdate: (id: string, ticker: string, name: string, avgPrice: number, shares: number, accountId: string | null, buyCost?: number, txInfo?: { price: number; qty: number }) => void
  onSell: (item: PortfolioItem, sellPrice: number, sellQty: number) => void
  onRunAdvice: (itemId: string) => void
  runningAdvice: boolean
  commissionRate: number
}) {
  const [mode, setMode] = useState<'none' | 'buy' | 'sell'>('none')
  const [buyPrice, setBuyPrice] = useState('')
  const [buyQty, setBuyQty] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellQty, setSellQty] = useState('')

  const currentPrice = live[item.ticker]?.price ?? item.avg_price
  const profitAmt = (currentPrice - item.avg_price) * item.shares
  const profitPct = item.avg_price > 0 ? ((currentPrice - item.avg_price) / item.avg_price) * 100 : 0
  const evalAmt = currentPrice * item.shares
  const costAmt = item.avg_price * item.shares

  const currentAdvice = adviceList[adviceIdx]
  const advStyle = currentAdvice ? (ADVICE_STYLE[currentAdvice.advice_type] ?? ADVICE_STYLE['보유유지']) : null

  const cardBg = profitPct > 0 ? 'rgba(255,92,92,0.05)' : profitPct < 0 ? 'rgba(77,166,255,0.05)' : 'rgba(255,255,255,0.03)'
  const cardBorder = profitPct > 0 ? 'rgba(255,92,92,0.18)' : profitPct < 0 ? 'rgba(77,166,255,0.16)' : 'rgba(255,255,255,0.1)'
  const pColor = profitPct > 0 ? '#ff5c5c' : profitPct < 0 ? '#4da6ff' : 'var(--text-muted)'

  // 추매 미리보기
  const bPrice = Number(buyPrice.replace(/,/g, ''))
  const bQty = Number(buyQty.replace(/,/g, ''))
  const previewBuyAvg = bPrice > 0 && bQty > 0
    ? (item.avg_price * item.shares + bPrice * bQty) / (item.shares + bQty)
    : null
  const previewBuyShares = bQty > 0 ? item.shares + bQty : null
  const buyCommission = bPrice > 0 && bQty > 0 ? bPrice * bQty * commissionRate / 100 : 0
  const buyTotal = bPrice > 0 && bQty > 0 ? bPrice * bQty + buyCommission : 0

  // 매도 미리보기
  const sQty = Number(sellQty.replace(/,/g, ''))
  const sPrice = Number(sellPrice.replace(/,/g, ''))
  const previewSellShares = sQty > 0 ? item.shares - sQty : null
  const sellCommission = sQty > 0 && sPrice > 0 ? sPrice * sQty * commissionRate / 100 : 0
  const sellTax = sQty > 0 && sPrice > 0 ? sPrice * sQty * SELL_TAX_RATE / 100 : 0
  const netReceived = sQty > 0 && sPrice > 0 ? sPrice * sQty - sellCommission - sellTax : 0
  const previewSellProfit = sQty > 0 && sPrice > 0 ? netReceived - item.avg_price * sQty : null

  const handleBuyConfirm = () => {
    if (!previewBuyAvg || !previewBuyShares || !item.id) return
    onUpdate(item.id, item.ticker, item.name, Math.round(previewBuyAvg * 100) / 100, previewBuyShares, item.account_id ?? null, Math.round(buyTotal), bPrice > 0 && bQty > 0 ? { price: bPrice, qty: bQty } : undefined)
    setMode('none'); setBuyPrice(''); setBuyQty('')
  }

  const handleSellConfirm = () => {
    if (sQty <= 0 || !item.id) return
    onSell(item, sPrice, sQty)
    setMode('none'); setSellPrice(''); setSellQty('')
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: cardBg, border: `1px solid ${cardBorder}` }}>
      {/* 1행: 종목명 | 코드 | 현재가 | 손익% | 버튼들 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`https://finance.naver.com/item/main.naver?code=${item.ticker}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >{item.name}</a>
          <span className="mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>{item.ticker}</span>
          <span className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>현재가 {currentPrice.toLocaleString('ko-KR')}원</span>
          <span className="mono text-xs font-bold" style={{ color: pColor }}>
            {profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          <button
            onClick={() => setMode(mode === 'buy' ? 'none' : 'buy')}
            className="text-[10px] px-2 py-1 rounded-lg transition-all"
            style={{ background: mode === 'buy' ? 'rgba(0,229,170,0.18)' : 'rgba(0,229,170,0.08)', border: `1px solid ${mode === 'buy' ? 'rgba(0,229,170,0.5)' : 'rgba(0,229,170,0.25)'}`, color: 'var(--accent-green)' }}
          >추매</button>
          <button
            onClick={() => setMode(mode === 'sell' ? 'none' : 'sell')}
            className="text-[10px] px-2 py-1 rounded-lg transition-all"
            style={{ background: mode === 'sell' ? 'rgba(255,201,77,0.18)' : 'rgba(255,201,77,0.08)', border: `1px solid ${mode === 'sell' ? 'rgba(255,201,77,0.5)' : 'rgba(255,201,77,0.25)'}`, color: 'var(--accent-gold)' }}
          >매도</button>
          <button onClick={() => onEdit(item)} className="text-[10px] px-2 py-1 rounded-lg transition-all" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>편집</button>
          <button onClick={() => item.id && onDelete(item.id, item.ticker)} className="text-[10px] px-2 py-1 rounded-lg transition-all" style={{ background: 'rgba(255,92,92,0.08)', border: '1px solid rgba(255,92,92,0.25)', color: 'var(--accent-red)' }}>삭제</button>
        </div>
      </div>

      {/* 2행: 매입금액 | 평단가 | 수량 | 평가금액 | 손익금 */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>매입금액 {Math.round(costAmt).toLocaleString('ko-KR')}원</span>
        <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>평단가 {item.avg_price.toLocaleString('ko-KR')}원</span>
        <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>수량 {item.shares.toLocaleString()}주</span>
        <span className="text-xs mono font-medium" style={{ color: 'var(--text-primary)' }}>평가금액 {Math.round(evalAmt).toLocaleString('ko-KR')}원</span>
        <span className="text-xs mono font-medium" style={{ color: pColor }}>
          손익금 {profitAmt >= 0 ? '+' : ''}{Math.round(profitAmt).toLocaleString('ko-KR')}원
        </span>
      </div>

      {/* 추매 폼 */}
      {mode === 'buy' && (
        <div className="rounded-xl p-3 mb-3" style={{ background: 'rgba(0,229,170,0.06)', border: '1px solid rgba(0,229,170,0.25)' }}>
          <div className="text-[10px] font-medium mb-2" style={{ color: 'var(--accent-green)' }}>추매</div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>단가</span>
              <input
                type="text" placeholder="0" value={buyPrice}
                onChange={e => setBuyPrice(e.target.value)}
                className="w-24 px-2 py-1 rounded-lg text-xs mono outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>원</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>수량</span>
              <input
                type="text" placeholder="0" value={buyQty}
                onChange={e => setBuyQty(e.target.value)}
                className="w-20 px-2 py-1 rounded-lg text-xs mono outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>주</span>
            </div>
          </div>
          {previewBuyAvg && previewBuyShares && (
            <div className="text-[10px] mb-2 mono space-y-0.5">
              <div style={{ color: 'var(--accent-green)' }}>
                → 새 평단가 {Math.round(previewBuyAvg).toLocaleString('ko-KR')}원 · 총 {previewBuyShares.toLocaleString()}주
              </div>
              {commissionRate > 0 && (
                <div style={{ color: 'rgba(255,201,77,0.75)' }}>
                  수수료 {Math.round(buyCommission).toLocaleString('ko-KR')}원 / 총 차감 {Math.round(buyTotal).toLocaleString('ko-KR')}원
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleBuyConfirm}
              disabled={!previewBuyAvg}
              className="text-[10px] px-3 py-1 rounded-lg font-medium disabled:opacity-30 transition-all"
              style={{ background: 'rgba(0,229,170,0.2)', border: '1px solid rgba(0,229,170,0.4)', color: 'var(--accent-green)' }}
            >확인</button>
            <button
              onClick={() => { setMode('none'); setBuyPrice(''); setBuyQty('') }}
              className="text-[10px] px-3 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
            >취소</button>
          </div>
        </div>
      )}

      {/* 매도 폼 */}
      {mode === 'sell' && (
        <div className="rounded-xl p-3 mb-3" style={{ background: 'rgba(255,201,77,0.06)', border: '1px solid rgba(255,201,77,0.25)' }}>
          <div className="text-[10px] font-medium mb-2" style={{ color: 'var(--accent-gold)' }}>매도</div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>매도단가</span>
              <input
                type="text" placeholder="0" value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                className="w-24 px-2 py-1 rounded-lg text-xs mono outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>원</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>수량</span>
              <input
                type="text" placeholder="0" value={sellQty}
                onChange={e => setSellQty(e.target.value)}
                className="w-20 px-2 py-1 rounded-lg text-xs mono outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>주</span>
            </div>
            <span className="text-[10px] mono" style={{ color: 'var(--text-muted)' }}>보유 {item.shares.toLocaleString()}주</span>
          </div>
          {previewSellShares !== null && (
            <div className="text-[10px] mb-1 mono" style={{ color: previewSellShares <= 0 ? 'var(--accent-red)' : 'var(--accent-gold)' }}>
              {previewSellShares <= 0 ? '→ 전량 매도 (종목 삭제)' : `→ 잔여 ${previewSellShares.toLocaleString()}주`}
            </div>
          )}
          {previewSellProfit !== null && (
            <div className="text-[10px] mb-2 mono space-y-0.5">
              <div style={{ color: previewSellProfit >= 0 ? '#ff5c5c' : '#4da6ff' }}>
                실현손익 {previewSellProfit >= 0 ? '+' : ''}{Math.round(previewSellProfit).toLocaleString('ko-KR')}원
              </div>
              <div style={{ color: 'rgba(255,255,255,0.4)' }}>
                수수료+거래세 {Math.round(sellCommission + sellTax).toLocaleString('ko-KR')}원 / 실수령 {Math.round(netReceived).toLocaleString('ko-KR')}원
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSellConfirm}
              disabled={sQty <= 0}
              className="text-[10px] px-3 py-1 rounded-lg font-medium disabled:opacity-30 transition-all"
              style={{ background: 'rgba(255,201,77,0.2)', border: '1px solid rgba(255,201,77,0.4)', color: 'var(--accent-gold)' }}
            >확인</button>
            <button
              onClick={() => { setMode('none'); setSellPrice(''); setSellQty('') }}
              className="text-[10px] px-3 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
            >취소</button>
          </div>
        </div>
      )}

      {/* AI 조언 */}
      {currentAdvice && advStyle ? (
        <div className="rounded-xl p-3" style={{ background: advStyle.bg, border: `1px solid ${advStyle.border}` }}>
          <div className="flex items-center justify-between mb-1.5">
            <button
              onClick={() => onAdviceNav(1)}
              disabled={adviceIdx >= adviceList.length - 1}
              className="text-xs px-1.5 py-0.5 rounded-lg disabled:opacity-20 transition-all"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)' }}
            >◀</button>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: advStyle.border.replace('0.4', '0.2'), color: advStyle.color }}>{advStyle.label}</span>
              <span className="text-[10px] mono" style={{ color: 'var(--text-muted)' }}>
                {currentAdvice.date}
                {adviceList.length > 1 && <span> ({adviceIdx + 1}/{adviceList.length})</span>}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={
                currentAdvice.source === 'manual'
                  ? { background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.35)', color: '#a78bfa' }
                  : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)' }
              }>
                {currentAdvice.source === 'manual' ? '수동' : '자동'}
              </span>
            </div>
            <button
              onClick={() => onAdviceNav(-1)}
              disabled={adviceIdx <= 0}
              className="text-xs px-1.5 py-0.5 rounded-lg disabled:opacity-20 transition-all"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)' }}
            >▶</button>
          </div>
          <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-secondary)' }}>{currentAdvice.advice_detail}</p>
          <div className="flex justify-end">
            <button
              onClick={() => item.id && onRunAdvice(item.id)}
              disabled={runningAdvice || !item.id}
              className="text-[9px] px-2 py-0.5 rounded-lg transition-all disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)' }}
            >
              {runningAdvice ? '⏳ 실행 중…' : '↺ 재실행'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>AI 조언 없음</p>
            <button
              onClick={() => item.id && onRunAdvice(item.id)}
              disabled={runningAdvice || !item.id}
              className="text-[9px] px-2 py-0.5 rounded-lg transition-all disabled:opacity-40"
              style={{ background: 'rgba(0,229,170,0.08)', border: '1px solid rgba(0,229,170,0.25)', color: 'var(--accent-green)' }}
            >
              {runningAdvice ? '⏳ 실행 중…' : '▶ AI 조언 실행'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
