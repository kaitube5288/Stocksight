'use client'

import { useState } from 'react'
import StockChart from './StockChart'
import { StockRecommendation } from '@/lib/supabase'

interface Props {
  tradeType:  '단타' | '스윙' | '중기'
  stocks:     StockRecommendation[]
  rankOffset: number
}

const TRADE_META = {
  '단타': { label: '단타 추천 종목 차트', sub: '5분봉 · 2일',  color: 'var(--accent-red)'  },
  '스윙': { label: '스윙 추천 종목 차트', sub: '30분봉 · 4일', color: 'var(--accent-blue)' },
  '중기': { label: '중기 추천 종목 차트', sub: '일봉 · 5주',   color: 'var(--accent-green)'},
}

export default function TradeTypeChartSection({ tradeType, stocks, rankOffset }: Props) {
  const [open, setOpen] = useState(false)
  const meta = TRADE_META[tradeType]

  if (!stocks.length) return null

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* 헤더 (클릭으로 토글) */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 transition-all"
        style={{ background: open ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-md"
            style={{
              background: `${meta.color}20`,
              color: meta.color,
              border: `1px solid ${meta.color}40`,
            }}
          >
            {tradeType}
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {meta.label}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {meta.sub}
          </span>
        </div>
        <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>
          {open ? '▲ 접기' : '▼ 펼치기'}
        </span>
      </button>

      {/* 차트 그리드 */}
      {open && (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4"
          style={{ background: 'rgba(0,0,0,0.2)' }}
        >
          {stocks.map((stock, i) => (
            <StockChart
              key={stock.ticker}
              ticker={stock.ticker}
              name={stock.name}
              buyPrice={stock.buy_price}
              tradeType={tradeType}
              rank={rankOffset + i + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
