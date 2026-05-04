'use client'

import { useEffect, useState, useCallback } from 'react'
import TradeTypeChartSection from './TradeTypeChartSection'
import type { ActiveChartEntry } from '@/app/api/active-charts/route'

type TT = '단타' | '스윙' | '중기'
type Sections = Record<TT, ActiveChartEntry[]>

interface DismissedRecord {
  key:       string
  tradeType: TT
  ticker:    string
  name:      string
  returnPct: number | null
}

const STORAGE_KEY = 'stocksight:dismissed-charts'

function dismissKey(tradeType: TT, entry: ActiveChartEntry) {
  return `${tradeType}:${entry.ticker}:${entry.startAt}`
}

function loadDismissed(): Map<string, DismissedRecord> {
  if (typeof window === 'undefined') return new Map()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return new Map()
    const records: DismissedRecord[] = JSON.parse(stored)
    // 이전 버전 호환: returnPct 필드 없는 기존 레코드는 null로 초기화
    return new Map(records.map(r => [r.key, { ...r, returnPct: r.returnPct ?? null }]))
  } catch { return new Map() }
}

function saveDismissed(map: Map<string, DismissedRecord>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()])) } catch {}
}

const TT_COLOR: Record<TT, string> = {
  '단타': 'var(--accent-red)',
  '스윙': 'var(--accent-blue)',
  '중기': 'var(--accent-green)',
}

export default function PerformanceCharts() {
  const [sections, setSections]   = useState<Sections | null>(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dismissed, setDismissed] = useState<Map<string, DismissedRecord>>(new Map())
  const [showDismissed, setShowDismissed] = useState(false)

  useEffect(() => { setDismissed(loadDismissed()) }, [])

  const dismiss = useCallback((tradeType: TT, entry: ActiveChartEntry, returnPct: number | null) => {
    setDismissed(prev => {
      const next = new Map(prev)
      const key = dismissKey(tradeType, entry)
      next.set(key, { key, tradeType, ticker: entry.ticker, name: entry.name, returnPct })
      saveDismissed(next)
      return next
    })
  }, [])

  const restore = useCallback((key: string) => {
    setDismissed(prev => {
      const next = new Map(prev)
      next.delete(key)
      saveDismissed(next)
      return next
    })
  }, [])

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

  const filtered: Sections | null = sections ? {
    '단타': sections['단타'].filter(e => !dismissed.has(dismissKey('단타', e))),
    '스윙': sections['스윙'].filter(e => !dismissed.has(dismissKey('스윙', e))),
    '중기': sections['중기'].filter(e => !dismissed.has(dismissKey('중기', e))),
  } : null

  const totalCount  = filtered ? filtered['단타'].length + filtered['스윙'].length + filtered['중기'].length : 0
  const dismissedList = [...dismissed.values()]

  // 섹션별 누적 수익률 (숨긴 종목들의 수익률 합산)
  const cumReturn = (tt: TT): number | null => {
    const valid = [...dismissed.values()].filter(r => r.tradeType === tt && r.returnPct != null)
    if (!valid.length) return null
    return valid.reduce((sum, r) => sum + (r.returnPct ?? 0), 0)
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      <div className="section-line" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          추천 종목 수익률 추적
        </h2>
        <div className="flex items-center gap-2">
          {dismissedList.length > 0 && (
            <button
              onClick={() => setShowDismissed(v => !v)}
              className="mono text-xs px-3 py-1 rounded-lg transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
              }}
            >
              숨긴 종목 {dismissedList.length}개 {showDismissed ? '▲' : '▼'}
            </button>
          )}
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
      </div>

      {/* 숨긴 종목 목록 (개별 복원) */}
      {showDismissed && dismissedList.length > 0 && (
        <div
          className="flex flex-wrap gap-2 px-4 py-3 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {dismissedList.map(rec => (
            <div
              key={rec.key}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <span
                className="text-[9px] font-bold px-1 rounded"
                style={{ background: `${TT_COLOR[rec.tradeType]}20`, color: TT_COLOR[rec.tradeType] }}
              >
                {rec.tradeType}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{rec.name}</span>
              <button
                onClick={() => restore(rec.key)}
                className="text-[10px] mono px-1.5 rounded transition-all"
                style={{
                  background: 'rgba(0,229,170,0.1)',
                  border: '1px solid rgba(0,229,170,0.3)',
                  color: 'rgba(0,229,170,0.8)',
                  cursor: 'pointer',
                }}
              >
                복원
              </button>
            </div>
          ))}
        </div>
      )}

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
          <TradeTypeChartSection tradeType="단타" entries={filtered['단타']} onDismiss={(e, ret) => dismiss('단타', e, ret)} cumulativeReturn={cumReturn('단타')} />
          <TradeTypeChartSection tradeType="스윙" entries={filtered['스윙']} onDismiss={(e, ret) => dismiss('스윙', e, ret)} cumulativeReturn={cumReturn('스윙')} />
          <TradeTypeChartSection tradeType="중기" entries={filtered['중기']} onDismiss={(e, ret) => dismiss('중기', e, ret)} cumulativeReturn={cumReturn('중기')} />
        </>
      )}
    </div>
  )
}
