'use client'

import { useEffect, useState } from 'react'

export type MarketData = {
  kospi: { price: number; changePercent: number } | null
  kosdaq: { price: number; changePercent: number } | null
  usdkrw: number | null
  bullStrength: {
    score: number
    grade: 'S' | 'A' | 'B' | null
    vixPrice: number | null
    categories: {
      indexMomentum: boolean
      volatility: boolean
      trend: boolean
      breadth: boolean
      global: boolean
    }
  } | null
}

type Props = {
  onData?: (data: MarketData) => void
}

export default function MarketBar({ onData }: Props) {
  const [market, setMarket] = useState<MarketData>({ kospi: null, kosdaq: null, usdkrw: null, bullStrength: null })
  const [time, setTime] = useState('')

  useEffect(() => {
    const fetchMarket = async () => {
      try {
        const res = await fetch('/api/market')
        const data = await res.json()
        setMarket(data)
        onData?.(data)
      } catch {
        // 실패 무시
      }
    }

    fetchMarket()
    const interval = setInterval(fetchMarket, 60 * 1000)
    return () => clearInterval(interval)
  }, [onData])

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(
        now.toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone: 'Asia/Seoul',
        })
      )
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const pct = (v: number) => {
    const sign = v >= 0 ? '+' : ''
    return `${sign}${v.toFixed(2)}%`
  }

  const vix = market.bullStrength?.vixPrice ?? null
  const vixColor =
    vix == null ? 'var(--text-muted)' :
    vix < 15   ? 'rgba(74,222,128,0.9)'   :
    vix < 20   ? 'rgba(134,239,172,0.85)' :
    vix < 25   ? 'rgba(250,204,21,0.9)'   :
    vix < 30   ? 'rgba(251,146,60,0.9)'   :
                 'rgba(248,113,113,0.9)'
  const vixLabel =
    vix == null ? '' :
    vix < 15   ? '극안정' :
    vix < 20   ? '안정'   :
    vix < 25   ? '보통'   :
    vix < 30   ? '불안'   :
                 '공포'

  return (
    <div
      className="glass flex items-center justify-between px-5 py-2.5 rounded-xl"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      {/* 좌: 지수 */}
      <div className="flex items-center gap-5 flex-wrap">
        {market.kospi && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>KOSPI</span>
            <span className="mono text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {market.kospi.price.toLocaleString()}
            </span>
            <span className={`mono text-xs ${market.kospi.changePercent >= 0 ? 'up' : 'down'}`}>
              {pct(market.kospi.changePercent)}
            </span>
          </div>
        )}
        {market.kosdaq && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>KOSDAQ</span>
            <span className="mono text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {market.kosdaq.price.toLocaleString()}
            </span>
            <span className={`mono text-xs ${market.kosdaq.changePercent >= 0 ? 'up' : 'down'}`}>
              {pct(market.kosdaq.changePercent)}
            </span>
          </div>
        )}
        {market.usdkrw && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>USD/KRW</span>
            <span className="mono text-sm" style={{ color: 'var(--text-secondary)' }}>
              {market.usdkrw.toFixed(1)}
            </span>
          </div>
        )}
        {vix != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>VIX</span>
            <span className="mono text-sm font-medium" style={{ color: vixColor }}>
              {vix.toFixed(2)}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{
              background: `${vixColor}18`,
              border: `1px solid ${vixColor}40`,
              color: vixColor,
            }}>
              {vixLabel}
            </span>
          </div>
        )}
      </div>

      {/* 우: 시간 */}
      <div className="mono text-sm" style={{ color: 'var(--text-muted)' }}>
        {time} KST
      </div>
    </div>
  )
}
