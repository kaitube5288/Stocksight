'use client'

import { useState } from 'react'
import StockChart from './StockChart'
import type { ActiveChartEntry } from '@/app/api/active-charts/route'

interface Props {
  tradeType: '단타' | '스윙' | '중기'
  entries:   ActiveChartEntry[]
}

const TRADE_META = {
  '단타': { label: '단타 수익률 추적', sub: '5분봉 · 3거래일',  color: 'var(--accent-red)'   },
  '스윙': { label: '스윙 수익률 추적', sub: '30분봉 · 5거래일', color: 'var(--accent-blue)'  },
  '중기': { label: '중기 수익률 추적', sub: '일봉 · 25거래일',  color: 'var(--accent-green)' },
}

export default function TradeTypeChartSection({ tradeType, entries }: Props) {
  const [open, setOpen] = useState(false)
  const meta = TRADE_META[tradeType]

  if (!entries.length) return null

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* 헤더 */}
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
          <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {entries.length}종목
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
          {entries.map(entry => (
            <StockChart
              key={`${entry.ticker}-${entry.startAt}`}
              ticker={entry.ticker}
              name={entry.name}
              instances={entry.instances}
              tradeType={tradeType}
              rank={entry.rank}
              from={entry.startAt}
              expiresAt={entry.expiresAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
