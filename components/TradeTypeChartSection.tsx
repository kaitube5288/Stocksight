'use client'

import { useState } from 'react'
import StockChart from './StockChart'
import type { ActiveChartEntry } from '@/app/api/active-charts/route'

interface Props {
  tradeType:        '단타' | '스윙' | '중기'
  entries:          ActiveChartEntry[]
  onDismiss:        (entry: ActiveChartEntry) => void
  cumulativeReturn: number | null
}

const TRADE_META = {
  '단타': { label: '단타 수익률 추적', sub: '5분봉 · 1거래일',  color: 'var(--accent-red)'   },
  '스윙': { label: '스윙 수익률 추적', sub: '30분봉 · 5거래일', color: 'var(--accent-blue)'  },
  '중기': { label: '중기 수익률 추적', sub: '일봉 · 20거래일',  color: 'var(--accent-green)' },
}

export default function TradeTypeChartSection({ tradeType, entries, onDismiss, cumulativeReturn }: Props) {
  const [open, setOpen] = useState(false)
  const meta = TRADE_META[tradeType]

  if (!entries.length && cumulativeReturn == null) return null

  // 한국 주식 색상 관례: 수익=빨강, 손실=파랑
  const isProfit = cumulativeReturn != null && cumulativeReturn >= 0
  const cumColor   = isProfit ? '#ff4d4d' : '#4d94ff'
  const cumBg      = isProfit ? 'rgba(255,77,77,0.12)' : 'rgba(77,148,255,0.12)'
  const cumBorder  = isProfit ? 'rgba(255,77,77,0.35)' : 'rgba(77,148,255,0.35)'

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
          {entries.length > 0 && (
            <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {entries.length}종목
            </span>
          )}
        </div>

        {/* 누적 수익률 + 펼치기 버튼 */}
        <div className="flex items-center gap-2">
          {cumulativeReturn != null && (
            <span
              className="mono text-xs font-bold px-2 py-0.5 rounded-md"
              style={{ background: cumBg, color: cumColor, border: `1px solid ${cumBorder}` }}
            >
              누적 {isProfit ? '+' : ''}{cumulativeReturn.toFixed(2)}%
            </span>
          )}
          {entries.length > 0 && (
            <span className="text-xs mono" style={{ color: 'var(--text-muted)' }}>
              {open ? '▲ 접기' : '▼ 펼치기'}
            </span>
          )}
        </div>
      </button>

      {/* 차트 그리드 */}
      {open && entries.length > 0 && (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4"
          style={{ background: 'rgba(0,0,0,0.2)' }}
        >
          {entries.map((entry, i) => (
            <StockChart
              key={`${entry.ticker}-${entry.startAt}`}
              ticker={entry.ticker}
              name={entry.name}
              instances={entry.instances}
              tradeType={tradeType}
              rank={entry.rank}
              from={entry.startAt}
              expiresAt={entry.expiresAt}
              onDismiss={() => onDismiss(entry)}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  )
}
