'use client'

import { StockRecommendation } from '@/lib/supabase'

interface Props {
  stock: StockRecommendation
  rank: number
  animate?: boolean
}

export default function RecommendationCard({ stock, rank, animate }: Props) {
  const returnColor =
    stock.expected_return > 5
      ? 'up'
      : stock.expected_return > 2
      ? 'neutral'
      : 'neutral'

  return (
    <div
      className={`glass glow-white glass-hover relative rounded-2xl p-5 flex flex-col gap-4 transition-all duration-300 ${animate ? 'animate-slide-up' : ''}`}
      style={{ animationDelay: `${rank * 80}ms` }}
    >
      {/* 순위 */}
      <div className="absolute top-4 right-4 mono text-xs" style={{ color: 'var(--text-muted)' }}>
        #{rank}
      </div>

      {/* 종목 이름 + 코드 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-base" style={{ color: 'var(--text-primary)' }}>
            {stock.name}
          </span>
        </div>
        <span className="badge">{stock.ticker}</span>
      </div>

      {/* 가격 정보 */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>매수가</div>
          <div className="mono text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            ₩{stock.buy_price.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>목표가</div>
          <div className="mono text-sm font-medium up">
            ₩{stock.sell_price.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>예상수익</div>
          <div className={`mono text-sm font-semibold ${returnColor}`}>
            +{stock.expected_return.toFixed(1)}%
          </div>
        </div>
      </div>

      <hr className="separator" />

      {/* 확률 바 */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>상승 확률</span>
          <span className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>
            {stock.probability}%
          </span>
        </div>
        <div className="prob-bar">
          <div
            className="prob-bar-fill"
            style={{ width: `${stock.probability}%`, opacity: 0.4 + stock.probability / 200 }}
          />
        </div>
      </div>

      {/* 핵심 촉매 */}
      <div className="flex items-start gap-2">
        <span className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>▶</span>
        <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {stock.key_catalyst}
        </span>
      </div>

      {/* 추천 이유 */}
      <div
        className="text-xs leading-relaxed p-3 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--text-muted)' }}
      >
        {stock.reasoning}
      </div>
    </div>
  )
}
