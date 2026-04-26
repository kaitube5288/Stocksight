'use client'

import { useEffect, useState } from 'react'

type MarketData = {
  kospi: { price: number; changePercent: number } | null
  kosdaq: { price: number; changePercent: number } | null
  usdkrw: number | null
}

export default function MarketBar() {
  const [market, setMarket] = useState<MarketData>({ kospi: null, kosdaq: null, usdkrw: null })
  const [time, setTime] = useState('')

  useEffect(() => {
    const fetchMarket = async () => {
      try {
        const res = await fetch('/api/market')
        const data = await res.json()
        setMarket(data)
      } catch {
        // 실패 무시
      }
    }

    fetchMarket()
    const interval = setInterval(fetchMarket, 60 * 1000)
    return () => clearInterval(interval)
  }, [])

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

  return (
    <div
      className="glass flex items-center justify-between px-5 py-2.5 rounded-xl"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      {/* 좌: 지수 */}
      <div className="flex items-center gap-5">
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
      </div>

      {/* 우: 시간 */}
      <div className="mono text-sm" style={{ color: 'var(--text-muted)' }}>
        {time} KST
      </div>
    </div>
  )
}
