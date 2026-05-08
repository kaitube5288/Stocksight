'use client'

import { useState, useCallback, useEffect } from 'react'
import AIStockCard from './AIStockCard'
import type { AIAnalysisResult } from '@/app/api/ai-analyze/route'

const CACHE_KEY = 'ai_analysis_cache'

type CachedAnalysis = {
  result: AIAnalysisResult
  query: string
  savedAt: string // ISO
}

function formatSavedAt(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const QUICK_QUERIES: { label: string; query: string }[] = [
  { label: '당일 2종목씩 추천', query: '오늘 상승확률이 가장 높은 코스피/코스닥 각 2종목씩 추천해줘' },
  { label: '반도체 관련 종목 추천', query: '반도체 관련 종목 추천' },
  { label: '바이오 종목 분석해줘', query: '바이오 종목 분석해줘' },
  { label: '방산·원자력 관련 종목', query: '방산·원자력 관련 종목' },
  { label: '하락장 대비 방어주 추천', query: '하락장 대비 방어주 추천' },
]

export default function AIRecommendationPage() {
  const [query, setQuery]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<AIAnalysisResult | null>(null)
  const [error, setError]             = useState('')
  const [savedQuery, setSavedQuery]   = useState('')
  const [savedAt, setSavedAt]         = useState('')
  const [fromCache, setFromCache]     = useState(false)
  const [cacheMsg, setCacheMsg]       = useState('')
  const [marketIndex, setMarketIndex] = useState<{ kospi: number | null; kosdaq: number | null; kospiChg: number | null; kosdaqChg: number | null }>({
    kospi: null, kosdaq: null, kospiChg: null, kosdaqChg: null,
  })

  // 코스피/코스닥 지수 조회
  useEffect(() => {
    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        setMarketIndex({
          kospi:     d.kospi?.price        ?? null,
          kospiChg:  d.kospi?.changePercent ?? null,
          kosdaq:    d.kosdaq?.price        ?? null,
          kosdaqChg: d.kosdaq?.changePercent ?? null,
        })
      })
      .catch(() => {})
  }, [])

  // 마운트 시 localStorage에서 마지막 분석 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return
      const cached: CachedAnalysis = JSON.parse(raw)
      setResult(cached.result)
      setSavedQuery(cached.query)
      setSavedAt(cached.savedAt)
      setFromCache(true)
    } catch { /* ignore */ }
  }, [])

  const CACHE_TTL_MS = 10 * 60 * 1000 // 10분

  const runAnalysis = useCallback(async (q?: string, forceRefresh = false) => {
    const finalQuery = q ?? query
    setCacheMsg('')

    // 10분 이내 동일 쿼리 결과가 있으면 API 재호출 없이 캐시 반환
    if (!forceRefresh && result && savedQuery === finalQuery && savedAt) {
      const ageMs = Date.now() - new Date(savedAt).getTime()
      if (ageMs < CACHE_TTL_MS) {
        const mins = Math.floor(ageMs / 60000)
        const secs = Math.floor((ageMs % 60000) / 1000)
        setCacheMsg(`${mins}분 ${secs}초 전 분석 결과입니다. 새로 분석하려면 ↺ 재분석을 클릭하세요.`)
        setFromCache(true)
        return
      }
    }

    setLoading(true)
    setError('')
    setFromCache(false)
    try {
      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQuery }),
      })
      const data = await res.json()
      if (data.success) {
        const now = new Date().toISOString()
        setResult(data.data)
        setSavedQuery(finalQuery)
        setSavedAt(now)
        const cache: CachedAnalysis = { result: data.data, query: finalQuery, savedAt: now }
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
      } else {
        setError(data.error ?? 'AI 분석 실패')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 분석 요청 실패')
    } finally {
      setLoading(false)
    }
  }, [query, result, savedQuery, savedAt, CACHE_TTL_MS])

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
        {QUICK_QUERIES.map(({ label, query: q }) => (
          <button
            key={label}
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
            {label}
          </button>
        ))}
      </div>

      {/* ── 입력창 + 분석 버튼 + 지수 ── */}
      <div className="flex flex-col gap-2 mb-6">
        <div className="flex items-center gap-2">
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
          {/* 코스피 / 코스닥 */}
          {(marketIndex.kospi || marketIndex.kosdaq) && (
            <div className="flex items-center gap-2 shrink-0">
              {marketIndex.kospi && (
                <div className="flex flex-col items-end">
                  <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>코스피</span>
                  <span className="mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {marketIndex.kospi.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
                  </span>
                  {marketIndex.kospiChg != null && (
                    <span
                      className="mono text-[9px] font-semibold"
                      style={{ color: marketIndex.kospiChg >= 0 ? '#ff6b6b' : '#00e5aa' }}
                    >
                      {marketIndex.kospiChg >= 0 ? '+' : ''}{marketIndex.kospiChg.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
              <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '10px' }}>|</span>
              {marketIndex.kosdaq && (
                <div className="flex flex-col items-end">
                  <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>코스닥</span>
                  <span className="mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {marketIndex.kosdaq.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
                  </span>
                  {marketIndex.kosdaqChg != null && (
                    <span
                      className="mono text-[9px] font-semibold"
                      style={{ color: marketIndex.kosdaqChg >= 0 ? '#ff6b6b' : '#00e5aa' }}
                    >
                      {marketIndex.kosdaqChg >= 0 ? '+' : ''}{marketIndex.kosdaqChg.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
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

      {/* ── 캐시 안내 ── */}
      {cacheMsg && !loading && (
        <div
          className="rounded-xl px-4 py-2.5 mb-4 text-xs flex items-center gap-2"
          style={{ background: 'rgba(255,200,0,0.07)', border: '1px solid rgba(255,200,0,0.2)', color: 'rgba(255,200,0,0.75)' }}
        >
          <span>⏱</span>
          <span className="flex-1">{cacheMsg}</span>
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
          <div
            className="rounded-xl px-4 py-3 mb-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0">
                {/* 검색 쿼리 */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>요청</span>
                  <span
                    className="text-xs font-semibold truncate"
                    style={{ color: 'var(--text-secondary)' }}
                    title={savedQuery || '(직접 요청 없음)'}
                  >
                    {savedQuery || '(직접 요청 없음)'}
                  </span>
                </div>
                {/* 날짜·시각·뉴스 수 */}
                <div className="flex items-center gap-2 flex-wrap">
                  {fromCache && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-md"
                      style={{ background: 'rgba(255,200,0,0.1)', color: 'rgba(255,200,0,0.6)', border: '1px solid rgba(255,200,0,0.2)' }}
                    >
                      저장된 분석
                    </span>
                  )}
                  <span className="text-[10px] mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {savedAt ? formatSavedAt(savedAt) : result.analysis_date}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    뉴스 {result.news_count}건 분석
                  </span>
                </div>
              </div>
              <button
                onClick={() => { setCacheMsg(''); runAnalysis(savedQuery || undefined, true) }}
                className="text-xs px-3 py-1 rounded-lg transition-all mono shrink-0"
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
