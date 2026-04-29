'use client'

import { useEffect, useState, useCallback } from 'react'
import TradeTypeChartSection from './TradeTypeChartSection'
import type { ActiveChartEntry } from '@/app/api/active-charts/route'

type Sections = { '단타': ActiveChartEntry[]; '스윙': ActiveChartEntry[]; '중기': ActiveChartEntry[] }

export default function PerformanceCharts() {
  const [sections, setSections] = useState<Sections | null>(null)
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchSections = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
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

  const totalCount = sections
    ? sections['단타'].length + sections['스윙'].length + sections['중기'].length
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
      ) : !sections || totalCount === 0 ? (
        <div
          className="py-8 text-center rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '12px' }}
        >
          활성 추적 종목 없음 — AI 분석 실행 후 차트가 표시됩니다
        </div>
      ) : (
        <>
          <TradeTypeChartSection tradeType="단타" entries={sections['단타']} />
          <TradeTypeChartSection tradeType="스윙" entries={sections['스윙']} />
          <TradeTypeChartSection tradeType="중기" entries={sections['중기']} />
        </>
      )}
    </div>
  )
}
