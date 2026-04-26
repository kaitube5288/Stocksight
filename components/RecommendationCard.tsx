'use client'

import { StockRecommendation } from '@/lib/supabase'

interface Props {
  stock: StockRecommendation
  rank: number
  animate?: boolean
}

const RANK_LABELS = ['', '🥇', '🥈', '🥉']
const RANK_COLORS = ['', 'var(--accent-gold)', 'var(--accent-blue)', 'var(--accent-green)']

function ProbBar({ value, rank }: { value: number; rank: number }) {
  const color =
    value >= 90 ? 'linear-gradient(90deg, #00e5aa, #4dffce)' :
    value >= 75 ? 'linear-gradient(90deg, #4da6ff, #00e5aa)' :
    value >= 60 ? 'linear-gradient(90deg, #ffc94d, #4da6ff)' :
                  'linear-gradient(90deg, #ff5c5c, #ffc94d)'

  const rankColor = rank >= 1 && rank <= 3 ? RANK_COLORS[rank] : 'var(--accent-green)'

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>상승 확률</span>
        <span className="mono text-sm font-bold" style={{ color: rankColor }}>
          {value}%
        </span>
      </div>
      <div className="prob-bar">
        <div className="prob-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

export default function RecommendationCard({ stock, rank, animate }: Props) {
  const rankClass = rank <= 3 ? `rank-${rank}` : ''

  return (
    <div
      className={`glass glass-hover ${rankClass} relative rounded-2xl p-5 flex flex-col gap-4 transition-all duration-300 ${animate ? 'animate-slide-up' : ''}`}
      style={{ animationDelay: `${rank * 100}ms` }}
    >
      {/* 순위 뱃지 */}
      <div className="absolute top-4 right-4 text-lg">
        {rank <= 3 ? RANK_LABELS[rank] : `#${rank}`}
      </div>

      {/* 종목명 + 코드 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
            {stock.name}
          </span>
        </div>
        <span className="badge">{stock.ticker}</span>
      </div>

      {/* 가격 정보 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>매수가</div>
          <div className="mono text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            ₩{stock.buy_price.toLocaleString()}
          </div>
        </div>
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(0,229,170,0.07)', border: '1px solid rgba(0,229,170,0.15)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>목표가</div>
          <div className="mono text-sm font-semibold up">
            ₩{stock.sell_price.toLocaleString()}
          </div>
        </div>
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(0,229,170,0.07)', border: '1px solid rgba(0,229,170,0.15)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>예상수익</div>
          <div className="mono text-base font-bold up">
            +{stock.expected_return.toFixed(1)}%
          </div>
        </div>
      </div>

      <hr className="separator" />

      {/* 확률 바 */}
      <ProbBar value={stock.probability} rank={rank} />

      {/* 핵심 촉매 */}
      <div
        className="flex items-start gap-2 p-3 rounded-xl"
        style={{ background: 'rgba(77,166,255,0.07)', border: '1px solid rgba(77,166,255,0.15)' }}
      >
        <span style={{ color: 'var(--accent-blue)' }}>⚡</span>
        <span className="text-xs leading-relaxed font-medium" style={{ color: 'var(--text-secondary)' }}>
          {stock.key_catalyst}
        </span>
      </div>

      {/* 추천 이유 */}
      <div
        className="text-xs leading-relaxed p-3 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {stock.reasoning}
      </div>
    </div>
  )
}
