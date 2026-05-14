'use client'

import { StockRecommendation } from '@/lib/supabase'

interface Props {
  stock: StockRecommendation
  rank: number
  animate?: boolean
}

const RANK_LABELS = ['', '🥇', '🥈', '🥉']
const RANK_COLORS = ['', 'var(--accent-gold)', 'var(--accent-blue)', 'var(--accent-green)']

const TRADE_TYPE_STYLE: Record<string, { background: string; color: string }> = {
  '단타': { background: 'rgba(255,92,92,0.12)', color: 'var(--accent-red)' },
  '스윙': { background: 'rgba(77,166,255,0.12)', color: 'var(--accent-blue)' },
  '중기': { background: 'rgba(0,229,170,0.12)', color: 'var(--accent-green)' },
}

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
        <span className="mono text-sm font-bold" style={{ color: rankColor }}>{value}%</span>
      </div>
      <div className="prob-bar">
        <div className="prob-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

function FundamentalBadge({ label, value, unit = '' }: { label: string; value: number | null | undefined; unit?: string }) {
  return (
    <div className="flex flex-col items-center py-1.5 px-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <span className="text-[9px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="mono text-xs font-semibold" style={{ color: value != null ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
        {value != null ? `${value}${unit}` : 'N/A'}
      </span>
    </div>
  )
}

function RsiBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null
  const color = value >= 70 ? '#ff6b6b' : value <= 30 ? '#00e5aa' : 'var(--text-muted)'
  const label = value >= 70 ? '과매수' : value <= 30 ? '과매도' : '중립'
  return (
    <div className="flex flex-col items-center py-1 px-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <span className="text-[9px] mb-0.5" style={{ color: 'var(--text-muted)' }}>RSI</span>
      <span className="mono text-[10px] font-bold" style={{ color }}>{value} <span style={{ fontSize: '8px' }}>{label}</span></span>
    </div>
  )
}

function TrendBadge({ value }: { value: 'up' | 'down' | 'sideways' | null | undefined }) {
  if (value == null) return null
  const cfg = {
    up:       { label: '상승추세', color: '#00e5aa', bg: 'rgba(0,229,170,0.1)' },
    down:     { label: '하락추세', color: '#ff6b6b', bg: 'rgba(255,107,107,0.1)' },
    sideways: { label: '횡보',    color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.04)' },
  }[value]
  return (
    <div className="flex flex-col items-center py-1 px-2 rounded-lg" style={{ background: cfg.bg }}>
      <span className="text-[9px] mb-0.5" style={{ color: 'var(--text-muted)' }}>추세</span>
      <span className="text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  )
}

function MacdBadge({ value }: { value: 'buy' | 'sell' | 'neutral' | null | undefined }) {
  if (value == null || value === 'neutral') return null
  const cfg = {
    buy:  { label: '골든크로스', color: '#00e5aa', bg: 'rgba(0,229,170,0.1)' },
    sell: { label: '데드크로스', color: '#ff6b6b', bg: 'rgba(255,107,107,0.1)' },
  }[value]
  return (
    <div className="flex flex-col items-center py-1 px-2 rounded-lg" style={{ background: cfg.bg }}>
      <span className="text-[9px] mb-0.5" style={{ color: 'var(--text-muted)' }}>MACD</span>
      <span className="text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  )
}

export default function RecommendationCard({ stock, rank, animate }: Props) {
  const rankClass = rank <= 3 ? `rank-${rank}` : ''

  return (
    <div
      className={`glass glass-hover ${rankClass} relative rounded-2xl p-5 flex flex-col gap-3 transition-all duration-300 ${animate ? 'animate-slide-up' : ''}`}
      style={{ animationDelay: `${rank * 100}ms` }}
    >
      {/* 순위 뱃지 */}
      <div className="absolute top-4 right-4 text-lg">
        {rank <= 3 ? RANK_LABELS[rank] : `#${rank}`}
      </div>

      {/* 투자유형 + 종목명 + 코드 */}
      <div>
        {stock.trade_type && (
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-md"
              style={TRADE_TYPE_STYLE[stock.trade_type]}
            >
              {stock.trade_type}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {stock.hold_period}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 mb-2 pr-8">
          <a
            href={`https://m.stock.naver.com/domestic/stock/${stock.ticker.split('.')[0]}/total`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-lg leading-tight hover:underline"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {stock.name}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge">{stock.ticker}</span>
          {stock.market && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: stock.market === 'KOSPI' ? 'rgba(255,201,77,0.15)' : 'rgba(77,166,255,0.15)',
                color: stock.market === 'KOSPI' ? 'var(--accent-gold)' : 'var(--accent-blue)',
                border: `1px solid ${stock.market === 'KOSPI' ? 'rgba(255,201,77,0.3)' : 'rgba(77,166,255,0.3)'}`,
              }}
            >
              {stock.market}
            </span>
          )}
        </div>
      </div>

      {/* 가격 정보: 2×2 그리드 — 현재가/매수가(행1) | 목표가/예상수익(행2) */}
      <div className="grid grid-cols-2 gap-2">
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>현재가</div>
          <div className="mono text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {stock.current_price != null ? `₩${stock.current_price.toLocaleString()}` : '-'}
          </div>
        </div>
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>매수가</div>
          <div className="mono text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            ₩{stock.buy_price.toLocaleString()}
          </div>
        </div>
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(0,229,170,0.07)', border: '1px solid rgba(0,229,170,0.15)' }}>
          <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>목표가</div>
          <div className="mono text-sm font-bold up">₩{stock.sell_price.toLocaleString()}</div>
        </div>
        <div className="text-center p-2 rounded-xl" style={{ background: 'rgba(220,38,38,0.18)' }}>
          <div className="text-[10px] mb-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>예상 수익</div>
          <div className="mono text-lg font-bold" style={{ color: '#ff6b6b' }}>+{stock.expected_return.toFixed(1)}%</div>
        </div>
      </div>

      {/* PER / PBR / ROE */}
      <div className="grid grid-cols-3 gap-2">
        <FundamentalBadge label="PER" value={stock.per} />
        <FundamentalBadge label="PBR" value={stock.pbr} />
        <FundamentalBadge label="ROE" value={stock.roe} unit="%" />
      </div>

      {/* 기술적 지표 — 단타/스윙만 표시 */}
      {(stock.trade_type === '단타' || stock.trade_type === '스윙') &&
        (stock.rsi14 != null || stock.trend != null || stock.macd_signal != null) && (
        <div>
          <div className="text-[9px] mb-1.5" style={{ color: 'var(--text-muted)' }}>기술적 지표</div>
          <div className="flex gap-1.5 flex-wrap">
            <RsiBadge value={stock.rsi14} />
            <TrendBadge value={stock.trend} />
            <MacdBadge value={stock.macd_signal} />
          </div>
        </div>
      )}

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
