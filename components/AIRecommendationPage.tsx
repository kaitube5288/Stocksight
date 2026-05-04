'use client'

import { useState, useCallback } from 'react'
import AIStockCard from './AIStockCard'
import type { AIAnalysisResult } from '@/app/api/ai-analyze/route'

const QUICK_QUERIES = [
  '오늘 코스닥 종목 3개 추천해줘',
  '반도체 관련 종목 추천',
  '바이오 종목 분석해줘',
  '방산·원자력 관련 종목',
  '하락장 대비 방어주 추천',
]

export default function AIRecommendationPage() {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<AIAnalysisResult | null>(null)
  const [error, setError]     = useState('')

  const runAnalysis = useCallback(async (q?: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q ?? query }),
      })
      const data = await res.json()
      if (data.success) {
        setResult(data.data)
      } else {
        setError(data.error ?? 'AI 분석 실패')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 분석 요청 실패')
    } finally {
      setLoading(false)
    }
  }, [query])

  const handleQuick = (q: string) => {
    setQuery(q)
    runAnalysis(q)
  }

  return (
    <div>
      {/* ── 상단 설명 ── */}
      <div
        className="rounded-2xl p-4 mb-5"
        style={{ background: 'rgba(77,148,255,0.06)', border: '1px solid rgba(77,148,255,0.15)' }}
      >
        <div className="flex items-start gap-3">
          <span style={{ fontSize: '20px', lineHeight: 1 }}>◎</span>
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              AI 실시간 종목 분석
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
              오늘의 뉴스·기술적 지표·이동평균선·수급 데이터를 종합해 내일 상승 가능성이 높은 종목을 추천합니다.
              현재가·RSI·MA5/20·52주 범위는 실시간 데이터 기반입니다.
            </p>
          </div>
        </div>
      </div>

      {/* ── 빠른 요청 버튼 ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {QUICK_QUERIES.map(q => (
          <button
            key={q}
            onClick={() => handleQuick(q)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-xl transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.55)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* ── 입력창 + 분석 버튼 ── */}
      <div className="flex items-center gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && runAnalysis()}
          placeholder="직접 요청: 예) 2차전지 눌림목 종목 추천해줘"
          className="flex-1 px-4 py-2.5 rounded-xl text-sm mono outline-none"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            color: 'var(--text-primary)',
          }}
          disabled={loading}
        />
        <button
          onClick={() => runAnalysis()}
          disabled={loading}
          className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap"
          style={{ cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="mono text-xs animate-pulse">▶▶</span> AI 분석 중...
            </span>
          ) : '▶ AI 분석'}
        </button>
      </div>

      {/* ── 로딩 ── */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-16">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{ border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid rgba(77,148,255,0.8)' }}
          />
          <p className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>
            뉴스 수집 → 기술적 지표 분석 → AI 종목 선정 (30~60초)
          </p>
        </div>
      )}

      {/* ── 에러 ── */}
      {error && !loading && (
        <div
          className="rounded-xl px-4 py-3 mb-4 text-xs"
          style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)', color: '#ff8080' }}
        >
          {error}
        </div>
      )}

      {/* ── 분석 결과 ── */}
      {result && !loading && (
        <div>
          {/* 분석 메타 */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                AI 종목 분석 결과
              </span>
              <span className="text-xs ml-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {result.analysis_date} · 뉴스 {result.news_count}건 분석
              </span>
            </div>
            <button
              onClick={() => runAnalysis()}
              className="text-xs px-3 py-1 rounded-lg transition-all mono"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
              }}
            >
              ↺ 재분석
            </button>
          </div>

          {/* 시장 요약 */}
          <div
            className="rounded-xl px-4 py-3 mb-5 text-xs leading-relaxed"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}
          >
            <span className="font-semibold mr-2" style={{ color: 'rgba(255,255,255,0.45)' }}>시장 요약</span>
            {result.market_summary}
            {result.trade_strategy && (
              <>
                <br />
                <span className="font-semibold mr-2 mt-1 inline-block" style={{ color: 'rgba(255,200,0,0.5)' }}>매매 전략</span>
                {result.trade_strategy}
              </>
            )}
          </div>

          {/* 종목 카드 */}
          <div className="flex flex-col gap-5">
            {result.recommendations.map((rec, i) => (
              <AIStockCard key={rec.ticker} rec={rec} index={i} />
            ))}
          </div>

          {/* 면책 고지 */}
          <div
            className="mt-5 px-4 py-3 rounded-xl text-[10px] leading-relaxed"
            style={{
              background: 'rgba(255,255,255,0.015)',
              color: 'rgba(255,255,255,0.25)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            ⚠ 본 AI 분석은 참고 정보이며 투자 권유가 아닙니다. 매수·매도가는 참고용이며, 반드시 분할 매수·손절 설정 후 진입하세요.
            모든 투자 결정과 손실에 대한 책임은 투자자 본인에게 있습니다.
          </div>
        </div>
      )}

      {/* ── 초기 상태 (결과 없음) ── */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span style={{ fontSize: '36px', opacity: 0.15 }}>◎</span>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
            위 버튼을 눌러 AI 분석을 시작하세요
          </p>
        </div>
      )}
    </div>
  )
}
