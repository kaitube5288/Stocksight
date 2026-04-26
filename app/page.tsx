'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import RecommendationCard from '@/components/RecommendationCard'
import NewsPanel from '@/components/NewsPanel'
import MarketBar from '@/components/MarketBar'
import { DailyRecommendation } from '@/lib/supabase'

function usePushNotification() {
  const [permission, setPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission)
    }
  }, [])

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }

  const notify = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
    })
  }, [])

  return { permission, requestPermission, notify }
}

export default function Home() {
  const [recommendation, setRecommendation] = useState<DailyRecommendation | null>(null)
  const [isToday, setIsToday] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showRisk, setShowRisk] = useState(false)
  const { permission, requestPermission, notify } = usePushNotification()
  const prevDateRef = useRef<string | null>(null)

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  const loadRecommendations = useCallback(async (showNotify = false) => {
    setLoading(true)
    try {
      const res = await fetch('/api/recommendations')
      const data = await res.json()
      setRecommendation(data.data)
      setIsToday(data.isToday)
      if (showNotify && data.data && data.data.date !== prevDateRef.current) {
        const top = data.data.stocks?.[0]
        notify(
          '📊 StockSight 오늘의 추천 도착',
          top ? `1위: ${top.name} (${top.ticker}) +${top.expected_return?.toFixed(1)}% 예상` : '새로운 추천 종목이 생성되었습니다.',
        )
      }
      prevDateRef.current = data.data?.date ?? null
    } catch {
      setError('추천 데이터 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    loadRecommendations()
  }, [loadRecommendations])

  const runAnalysis = async () => {
    setAnalyzing(true)
    setError('')
    try {
      const res = await fetch('/api/analyze', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await loadRecommendations(true)
      } else {
        setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error) || '분석 실패')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 요청 실패')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 max-w-7xl mx-auto">
      {/* 헤더 */}
      <header className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1
              className="text-2xl font-light tracking-widest mono"
              style={{ color: 'var(--text-primary)', letterSpacing: '0.2em' }}
            >
              STOCKSIGHT
            </h1>
            <span className="badge">BETA</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            AI 기반 한국 주식 추천 시스템 · 뉴스 + 공시 + 역사적 패턴 분석
          </p>
        </div>
        <div className="text-right flex flex-col items-end gap-1.5">
          <div className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {today}
          </div>
          <div className="flex items-center gap-1 justify-end">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: isToday ? 'rgba(200,255,200,0.6)' : 'rgba(255,200,100,0.6)' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {isToday ? '오늘 분석 완료' : '최근 분석 데이터'}
            </span>
          </div>
          {permission !== 'granted' && (
            <button
              onClick={requestPermission}
              className="text-[10px] px-2 py-0.5 rounded-lg transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: permission === 'denied' ? 'rgba(255,150,150,0.6)' : 'rgba(255,255,255,0.35)',
                cursor: permission === 'denied' ? 'not-allowed' : 'pointer',
              }}
              disabled={permission === 'denied'}
            >
              {permission === 'denied' ? '🔕 알림 차단됨' : '🔔 알림 허용'}
            </button>
          )}
          {permission === 'granted' && (
            <span className="text-[10px]" style={{ color: 'rgba(180,255,180,0.5)' }}>🔔 알림 활성화됨</span>
          )}
        </div>
      </header>

      {/* 마켓 바 */}
      <div className="mb-5">
        <MarketBar />
      </div>

      {/* 분석 실행 버튼 */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="glass glass-hover px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-40"
          style={{ color: 'var(--text-primary)', cursor: analyzing ? 'not-allowed' : 'pointer' }}
        >
          {analyzing ? (
            <span className="flex items-center gap-2">
              <span className="mono text-xs animate-pulse">▶▶</span> AI 분석 중...
            </span>
          ) : (
            '▶ AI 분석 실행'
          )}
        </button>
        {analyzing && (
          <span className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>
            뉴스 수집 → DART 공시 확인 → Gemini 분석 → 추천 생성 (30~60초 소요)
          </span>
        )}
        {error && (
          <span className="text-xs" style={{ color: 'rgba(255,150,150,0.8)' }}>
            {error}
          </span>
        )}
      </div>

      {/* 메인 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 추천 종목 (좌 2/3) */}
        <div className="lg:col-span-2">
          {/* 섹션 헤더 */}
          <div className="mb-4">
            <div className="section-line" />
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                오늘의 추천 종목
              </h2>
              {recommendation && (
                <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  {new Date(recommendation.created_at).toLocaleTimeString('ko-KR', {
                    hour: '2-digit', minute: '2-digit',
                  })} 기준
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="glass rounded-2xl h-64 animate-pulse"
                  style={{ animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          ) : !recommendation ? (
            <div className="glass glow-white rounded-2xl p-10 text-center">
              <div className="mono text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                추천 데이터 없음
              </div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                위의 <strong>AI 분석 실행</strong> 버튼을 클릭하여 오늘의 추천 종목을 생성하세요.
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                최초 실행 시 API 키 설정이 필요합니다 (.env.local)
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {recommendation.stocks.map((stock, i) => (
                  <RecommendationCard
                    key={stock.ticker}
                    stock={stock}
                    rank={i + 1}
                    animate
                  />
                ))}
              </div>

              {/* 시장 전망 + 위험 요소 */}
              <div className="glass glow-white rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    시장 전망 / 위험 요소
                  </h3>
                  <button
                    onClick={() => setShowRisk(!showRisk)}
                    className="mono text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showRisk ? '▲' : '▼'}
                  </button>
                </div>
                {showRisk && (
                  <div className="flex flex-col gap-3 animate-fade-in">
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>전망</div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {recommendation.market_outlook}
                      </p>
                    </div>
                    <hr className="separator" />
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>위험 요소</div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {recommendation.risk_factors}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 뉴스 패널 (우 1/3) */}
        <div className="lg:col-span-1">
          <div className="mb-4">
            <div className="section-line" />
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              실시간 뉴스
            </h2>
          </div>
          <NewsPanel />

          {/* 면책 고지 */}
          <div
            className="mt-4 p-3 rounded-xl text-[10px] leading-relaxed"
            style={{
              background: 'rgba(255,255,255,0.015)',
              color: 'var(--text-muted)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            ⚠ 본 서비스는 AI 분석 기반 참고 정보이며 투자 권유가 아닙니다. 모든 투자 결정과 손실에 대한 책임은 투자자 본인에게 있습니다.
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <footer className="mt-10 pt-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between">
          <div className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
            STOCKSIGHT v0.1 · Powered by Gemini 2.5 Flash
          </div>
          <div className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
            데이터: 네이버 금융 · Google 뉴스 · DART · Yahoo Finance
          </div>
        </div>
      </footer>
    </main>
  )
}
