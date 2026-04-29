'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'

interface PricePoint { time: string; close: number }

interface Props {
  ticker:    string
  name:      string
  buyPrice:  number
  tradeType: string
  rank:      number
}

function formatXLabel(iso: string, tradeType: string): string {
  const d = new Date(iso)
  if (tradeType === '중기') {
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  // intraday: KST = UTC+9
  const kstH = (d.getUTCHours() + 9) % 24
  const kstM = d.getUTCMinutes()
  return `${String(kstH).padStart(2, '0')}:${String(kstM).padStart(2, '0')}`
}

function formatTooltipLabel(iso: string, tradeType: string): string {
  const d = new Date(iso)
  if (tradeType === '중기') {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  const kstH = (d.getUTCHours() + 9) % 24
  const kstM = d.getUTCMinutes()
  const date = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${date.getUTCMonth()+1}/${date.getUTCDate()} ${String(kstH).padStart(2,'0')}:${String(kstM).padStart(2,'0')}`
}

// 틱 간격: 데이터 포인트 수에 따라 X축 레이블 수 조정
function getTickInterval(count: number): number {
  if (count <= 30) return 0
  if (count <= 80) return Math.floor(count / 8)
  return Math.floor(count / 10)
}

// 매수가 대비 마지막 가격 변화율
function calcReturn(prices: PricePoint[], buyPrice: number): number | null {
  if (!prices.length || !buyPrice) return null
  const last = prices[prices.length - 1].close
  return ((last - buyPrice) / buyPrice) * 100
}

export default function StockChart({ ticker, name, buyPrice, tradeType, rank }: Props) {
  const [prices, setPrices]   = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/chart?ticker=${ticker}&tradeType=${encodeURIComponent(tradeType)}`)
      .then(r => r.json())
      .then(d => setPrices(d.prices ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ticker, tradeType])

  const ret   = calcReturn(prices, buyPrice)
  const isPos = ret != null && ret >= 0

  // Y축 범위: 매수가 ±8% 이상 확보
  const allPrices = prices.map(p => p.close).concat(buyPrice)
  const minP = Math.min(...allPrices)
  const maxP = Math.max(...allPrices)
  const pad  = (maxP - minP) * 0.1 || buyPrice * 0.03
  const yMin = Math.floor((minP - pad) / 100) * 100
  const yMax = Math.ceil((maxP + pad) / 100) * 100

  const tickInterval = getTickInterval(prices.length)

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* 종목 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold mr-2" style={{ color: 'var(--text-primary)' }}>
            #{rank} {name}
          </span>
          <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{ticker}</span>
        </div>
        {ret != null && (
          <span
            className="mono text-xs font-bold px-2 py-0.5 rounded-lg"
            style={{
              background: isPos ? 'rgba(0,229,170,0.15)' : 'rgba(255,107,107,0.15)',
              color:      isPos ? '#00e5aa' : '#ff6b6b',
            }}
          >
            {isPos ? '+' : ''}{ret.toFixed(2)}%
          </span>
        )}
      </div>

      {/* 매수가 */}
      <div className="flex items-center gap-2">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>매수가</span>
        <span className="mono text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          ₩{buyPrice.toLocaleString()}
        </span>
      </div>

      {/* 차트 */}
      <div style={{ height: '160px' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>로딩 중...</span>
          </div>
        ) : prices.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>데이터 없음</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={prices} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="time"
                tickFormatter={iso => formatXLabel(iso, tradeType)}
                interval={tickInterval}
                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: '#111',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.85)',
                }}
                labelFormatter={iso => formatTooltipLabel(iso as string, tradeType)}
                formatter={(value: unknown) => {
                  const v = value as number
                  return [`₩${v.toLocaleString()} (${((v - buyPrice) / buyPrice * 100).toFixed(2)}%)`, '가격']
                }}
              />
              <ReferenceLine
                y={buyPrice}
                stroke="rgba(255,201,77,0.7)"
                strokeDasharray="4 3"
                label={{
                  value: '매수가',
                  position: 'insideTopRight',
                  fontSize: 9,
                  fill: 'rgba(255,201,77,0.7)',
                }}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke={isPos ? '#00e5aa' : '#ff6b6b'}
                dot={false}
                strokeWidth={1.5}
                activeDot={{ r: 3, fill: isPos ? '#00e5aa' : '#ff6b6b' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
