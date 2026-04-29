'use client'

import { useEffect, useState, useCallback } from 'react'
import TradeTypeChartSection from './TradeTypeChartSection'
import type { ActiveChartEntry } from '@/app/api/active-charts/route'

type Sections = { '단타': ActiveChartEntry[]; '스윙': ActiveChartEntry[]; '중기': ActiveChartEntry[] }
type TT = '단타' | '스윙' | '중기'

const STORAGE_KEY = 'stocksight:dismissed-charts'

function dismissKey(tradeType: TT, entry: ActiveChartEntry) {
  return `${tradeType}:${entry.ticker}:${entry.startAt}`
}

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set()
  } catch { return new Set() }
}

function saveDismissed(set: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])) } catch {}
}

export default function PerformanceCharts() {
  const [sections, setSections]   = useState<Sections | null>(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // localStorage는 hydration 후 로드
  useEffect(() => { setDismissed(loadDismissed()) }, [])

  const dismiss = useCallback((tradeType: TT, entry: ActiveChartEntry) => {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(dismissKey(tradeType, entry))
      saveDismissed(next)
      return next
    })
  }, [])

  const fetchSections = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true)
      // 전체 갱신 시 삭제 목록 초기화
      setDismissed(new Set())
      try { localStorage.removeItem(STORAGE_KEY) } catch {}
    } else {
      setLoading(true)
    }
    try {
      const res  = await fetch('/api/active-charts')
      const data = await res.json()
      if (data.sections) setSections(data.sections)
    } catch { /* ignore */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchSections() }, [fetchSections])

  // 삭제된 항목 필터링
  const filtered: Sections | null = sections ? {
    '단타': sections['단타'].filter(e => !dismissed.has(dismissKey('단타', e))),
    '스윙': sections['스윙'].filter(e => !dismissed.has(dismissKey('스윙', e))),
    '중기': sections['중기'].filter(e => !dismissed.has(dismissKey('중기', e))),
  } : null

  const totalCount = filtered
    ? filtered['단타'].length + filtered['스윙'].length + filtered['중기'].length
    : 0

  return (
    <div className="mt-8 flex flex-col gap-3">
      <div className="section-line" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          추천 종목 수익률 추적
        </h2>
        <button
          onClick={() => fetchSections(true)}
          disabled={refreshing || loading}
          className="mono text-xs px-3 py-1 rounded-lg transition-all"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: (refreshing || loading) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
            cursor: (refreshing || loading) ? 'not-allowed' : 'pointer',
          }}
        >
          {refreshing ? '갱신 중...' : '↺ 전체 갱신'}
        </button>
      </div>

      {loading ? (
        <div className="py-6 text-center" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          로딩 중...
        </div>
      ) : !filtered || totalCount === 0 ? (
        <div
          className="py-8 text-center rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '12px' }}
        >
          활성 추적 종목 없음 — AI 분석 실행 후 차트가 표시됩니다
        </div>
      ) : (
        <>
          <TradeTypeChartSection tradeType="단타" entries={filtered['단타']} onDismiss={(e) => dismiss('단타', e)} />
          <TradeTypeChartSection tradeType="스윙" entries={filtered['스윙']} onDismiss={(e) => dismiss('스윙', e)} />
          <TradeTypeChartSection tradeType="중기" entries={filtered['중기']} onDismiss={(e) => dismiss('중기', e)} />
        </>
      )}
    </div>
  )
}
