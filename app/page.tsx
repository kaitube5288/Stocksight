'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import RecommendationCard from '@/components/RecommendationCard'
import NewsPanel from '@/components/NewsPanel'
import MarketBar from '@/components/MarketBar'
import PerformanceCharts from '@/components/PerformanceCharts'
import AIRecommendationPage from '@/components/AIRecommendationPage'
import MacroCharts from '@/components/MacroCharts'
import { DailyRecommendation } from '@/lib/supabase'

type LiveEntry = { price: number | null; per: number | null; pbr: number | null; roe: number | null }

function calcDynamicBuyPrice(
  currentPrice: number,
  tradeType: string | null | undefined,
  probability: number,
  live: LiveEntry,
  storedPer: number | null | undefined,
  storedPbr: number | null | undefined,
  storedRoe: number | null | undefined,
): number {
  // 거래유형별 기준 할인율 (%)
  let discount =
    tradeType === '단타' ? 0.8 :
    tradeType === '스윙' ? 2.0 : 3.5

  const per = live.per ?? storedPer ?? null
  const pbr = live.pbr ?? storedPbr ?? null
  const roe = live.roe ?? storedRoe ?? null

  // PER: 저평가면 빨리 진입, 고평가면 더 눌림 대기
  if (per != null) {
    if (per < 10)       discount -= 0.5
    else if (per > 30)  discount += 1.0
    else if (per > 20)  discount += 0.5
  }

  // PBR: 장부가 이하면 안전마진 확보, 고PBR은 추가 할인
  if (pbr != null) {
    if (pbr < 1)      discount -= 0.3
    else if (pbr > 3) discount += 0.3
  }

  // ROE: 우량 기업은 진입 서두르고, 저수익 기업은 더 기다림
  if (roe != null) {
    if (roe > 20)    discount -= 0.3
    else if (roe < 5) discount += 0.5
  }

  // 상승확률: 높으면 빨리 진입, 낮으면 할인 더 요구
  if (probability > 80)      discount -= 0.3
  else if (probability < 60) discount += 0.5

  // 거래유형별 할인율 범위 클램프
  const [minD, maxD] =
    tradeType === '단타' ? [0.2, 1.5] :
    tradeType === '스윙' ? [0.5, 4.0] : [1.0, 6.0]
  discount = Math.max(minD, Math.min(maxD, discount))

  return Math.round(currentPrice * (1 - discount / 100))
}

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
  const [tab, setTab] = useState<'code' | 'ai'>('code')
  const [recommendation, setRecommendation] = useState<DailyRecommendation | null>(null)
  const [isToday, setIsToday] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showRisk, setShowRisk] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)
  const [liveData, setLiveData] = useState<Record<string, { price: number | null; per: number | null; pbr: number | null; roe: number | null }>>({})
  const [marketData, setMarketData] = useState<{ kospi: { changePercent: number } | null; kosdaq: { changePercent: number } | null } | null>(null)

  const { permission, requestPermission, notify } = usePushNotification()
  const prevDateRef = useRef<string | null>(null)

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  const fetchLiveData = useCallback(async (stocks: { ticker: string }[]) => {
    if (!stocks.length) return
    try {
      const tickers = stocks.map(s => s.ticker).join(',')
      const res = await fetch(`/api/prices?tickers=${tickers}`)
      const data: { ticker: string; price: number | null; per: number | null; pbr: number | null; roe: number | null }[] = await res.json()
      const map: typeof liveData = {}
      data.forEach(d => { map[d.ticker] = { price: d.price, per: d.per, pbr: d.pbr, roe: d.roe } })
      setLiveData(map)
    } catch { /* live price 실패 시 저장된 값 유지 */ }
  }, [])

  const loadRecommendations = useCallback(async (showNotify = false) => {
    setLoading(true)
    try {
      const res = await fetch('/api/recommendations')
      const data = await res.json()
      setRecommendation(data.data)
      setIsToday(data.isToday)
      if (data.data?.stocks?.length) fetchLiveData(data.data.stocks)
      if (showNotify && data.data && data.data.date !== prevDateRef.current) {
        const daytrading = data.data.stocks?.find((s: { trade_type: string }) => s.trade_type === '단타')
        notify(
          '📊 StockSight 오늘의 추천 도착',
          daytrading
            ? `단타 1위: ${daytrading.name} (${daytrading.ticker}) +${daytrading.expected_return?.toFixed(1)}% 예상`
            : '새로운 추천 종목이 생성되었습니다.',
        )
      }
      prevDateRef.current = data.data?.date ?? null
    } catch {
      setError('추천 데이터 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [notify, fetchLiveData])

  useEffect(() => {
    loadRecommendations()
  }, [loadRecommendations])

  // 불장 감지: 라이브 지수 +1% 이상 OR 저장된 AI 분석이 강세장 판단
  const isBullMarketLive = (marketData?.kospi?.changePercent ?? 0) >= 1 || (marketData?.kosdaq?.changePercent ?? 0) >= 1
  const isBullMarketStored = !!(recommendation?.market_outlook?.includes('불장') || recommendation?.market_outlook?.includes('강세장'))
  const isBullMarket = isBullMarketLive || isBullMarketStored


  const handleAnalysisClick = () => {
    setPwInput('')
    setPwError(false)
    setShowPwModal(true)
  }

  const handlePwCancel = () => {
    setShowPwModal(false)
    setPwInput('')
    setPwError(false)
  }

  const handlePwConfirm = async () => {
    if (pwInput !== '1214') {
      setPwError(true)
      return
    }
    setShowPwModal(false)
    setAnalyzing(true)
    setError('')
    try {
      const res = await fetch('/api/cron/daily', { method: 'POST' })
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

      {/* 탭 네비게이션 */}
      <div className="mb-6 flex items-center gap-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0' }}>
        {(['code', 'ai'] as const).map(t => {
          const active = tab === t
          const label = t === 'code' ? 'Code 추천' : 'AI 추천'
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="text-xs font-semibold px-4 py-2 transition-all"
              style={{
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: active ? '2px solid rgba(255,255,255,0.7)' : '2px solid transparent',
                background: 'none',
                marginBottom: '-1px',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* AI 추천 탭 — 항상 마운트, CSS로 보이기/숨기기 (상태 유지) */}
      <div style={{ display: tab === 'ai' ? 'block' : 'none' }}>
        <AIRecommendationPage />
      </div>

      {/* Code 추천 탭 */}
      <div style={{ display: tab === 'code' ? 'block' : 'none' }}>

      {/* 마켓 바 */}
      <div className="mb-5">
        <MarketBar onData={setMarketData} />
      </div>

      {/* 분석 실행 버튼 / 인라인 비밀번호 입력 */}
      <div className="mb-6">
        {showPwModal ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={pwInput}
                onChange={e => { setPwInput(e.target.value); setPwError(false) }}
                onKeyDown={e => e.key === 'Enter' && handlePwConfirm()}
                placeholder="비밀번호"
                autoFocus
                className="px-4 py-2.5 rounded-xl text-sm mono outline-none"
                style={{
                  width: '160px',
                  background: 'rgba(255,255,255,0.06)',
                  border: pwError ? '1px solid var(--accent-red)' : '1px solid rgba(255,255,255,0.18)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={handlePwConfirm}
                className="btn-primary px-4 py-2.5 rounded-xl text-sm font-semibold"
              >
                확인
              </button>
              <button
                onClick={handlePwCancel}
                className="px-4 py-2.5 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
              >
                ▶ 취소
              </button>
            </div>
            {pwError && (
              <span className="text-xs" style={{ color: 'var(--accent-red)', paddingLeft: '4px' }}>
                비밀번호가 올바르지 않습니다
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <button
                onClick={handleAnalysisClick}
                disabled={analyzing}
                className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ cursor: analyzing ? 'not-allowed' : 'pointer' }}
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
              {!analyzing && recommendation?.market_outlook?.startsWith('[하락장 위험]') && (
                <div
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl animate-pulse"
                  style={{
                    background: 'rgba(220,38,38,0.15)',
                    border: '1px solid rgba(255,80,80,0.45)',
                  }}
                >
                  <span style={{ fontSize: '13px' }}>⚠</span>
                  <span className="text-xs font-bold" style={{ color: '#ff6b6b' }}>하락장 위험</span>
                  <span className="text-xs" style={{ color: 'rgba(255,107,107,0.7)' }}>— 오늘 투자 자제 권고</span>
                </div>
              )}
              {!analyzing && isBullMarket &&
                !recommendation?.market_outlook?.startsWith('[하락장 위험]') && (
                <div
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                  style={{
                    background: 'rgba(34,197,94,0.15)',
                    border: '1px solid rgba(74,222,128,0.45)',
                  }}
                >
                  <span style={{ fontSize: '13px' }}>🚀</span>
                  <span className="text-xs font-bold" style={{ color: '#4ade80' }}>불장 감지</span>
                  <span className="text-xs" style={{ color: 'rgba(74,222,128,0.7)' }}>— 모멘텀 전략 적용 중</span>
                </div>
              )}
            </div>
            {error && (
              <span className="text-xs" style={{ color: 'rgba(255,150,150,0.8)', paddingLeft: '2px' }}>
                {error}
              </span>
            )}
          </div>
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
              {[...Array(6)].map((_, i) => (
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
              {([
                { type: '단타', label: '단타', period: '1일 목표', color: 'var(--accent-red)', border: 'rgba(255,92,92,0.3)' },
                { type: '스윙', label: '스윙', period: '3~5일 목표', color: 'var(--accent-blue)', border: 'rgba(77,166,255,0.3)' },
                { type: '중기', label: '중기', period: '2~4주 목표', color: 'var(--accent-green)', border: 'rgba(0,229,170,0.3)' },
              ] as const).map(({ type, label, period, color, border }) => {
                const group = recommendation.stocks.filter(s => s.trade_type === type)
                return (
                  <div key={type} className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className="text-xs font-bold px-2.5 py-1 rounded-lg"
                        style={{ background: `${border.replace('0.3', '0.1')}`, color, border: `1px solid ${border}` }}
                      >
                        {label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{period}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {group.length > 0 ? group.map((stock, i) => {
                        const live = liveData[stock.ticker]
                        const livePrice = live?.price ?? null
                        const dynBuyPrice = livePrice
                          ? calcDynamicBuyPrice(livePrice, stock.trade_type, stock.probability, live ?? { price: null, per: null, pbr: null, roe: null }, stock.per, stock.pbr, stock.roe)
                          : null
                        const merged = live ? {
                          ...stock,
                          current_price: livePrice ?? stock.current_price,
                          buy_price: dynBuyPrice ?? stock.buy_price,
                          sell_price: dynBuyPrice
                            ? Math.round(dynBuyPrice * (1 + stock.expected_return / 100))
                            : stock.sell_price,
                          per: live.per ?? stock.per,
                          pbr: live.pbr ?? stock.pbr,
                          roe: live.roe ?? stock.roe,
                        } : stock
                        return (
                          <RecommendationCard
                            key={stock.ticker}
                            stock={merged}
                            rank={i + 1}
                            animate
                          />
                        )
                      }) : (
                        <div
                          className="col-span-full py-6 text-center rounded-2xl"
                          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontSize: '12px' }}
                        >
                          해당 유형 추천 종목 없음
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

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
                    {recommendation.market_outlook?.startsWith('[하락장 위험]') && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(220,38,38,0.18)', border: '2px solid rgba(255,80,80,0.5)' }}>
                        <span style={{ fontSize: '16px' }}>⚠️</span>
                        <span className="text-xs font-bold" style={{ color: '#ff6b6b' }}>하락장 위험 — 오늘 투자 자제 권고</span>
                      </div>
                    )}
                    {recommendation.market_outlook &&
                      (recommendation.market_outlook.includes('불장') || recommendation.market_outlook.includes('강세장')) &&
                      !recommendation.market_outlook.startsWith('[하락장 위험]') && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(34,197,94,0.18)', border: '2px solid rgba(74,222,128,0.5)' }}>
                        <span style={{ fontSize: '16px' }}>🚀</span>
                        <span className="text-xs font-bold" style={{ color: '#4ade80' }}>불장 감지 — 모멘텀 전략 적용 중</span>
                      </div>
                    )}
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
          <MacroCharts />

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

      {/* 수익률 추적 차트 섹션 */}
      <PerformanceCharts />

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
      </div>
    </main>
  )
}
