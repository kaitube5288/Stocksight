'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

interface DayPoint { date: string; value: number }

interface MacroData {
  usdkrw: DayPoint[]
  gold: DayPoint[]
}

function shortDate(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(m)}/${parseInt(day)}`
}

function tickInterval(count: number) {
  if (count <= 20) return 0
  if (count <= 45) return Math.floor(count / 6)
  return Math.floor(count / 8)
}

function ChartBlock({
  title,
  unit,
  data,
  color,
  decimals = 0,
}: {
  title: string
  unit: string
  data: DayPoint[]
  color: string
  decimals?: number
}) {
  if (!data.length) return null

  const last  = data[data.length - 1]
  const prev  = data.length > 1 ? data[data.length - 2] : null
  const chg   = prev ? ((last.value - prev.value) / prev.value) * 100 : null
  const isPos = chg != null && chg >= 0

  const values = data.map(d => d.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const pad  = (maxV - minV) * 0.08 || last.value * 0.02
  const yMin = minV - pad
  const yMax = maxV + pad

  const fmt = (v: number) =>
    decimals > 0 ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
                 : v.toLocaleString()

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</span>
        <div className="flex items-center gap-2">
          <span className="mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {fmt(last.value)} <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>{unit}</span>
          </span>
          {chg != null && (
            <span
              className="mono text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: isPos ? 'rgba(255,107,107,0.15)' : 'rgba(0,229,170,0.15)',
                color:      isPos ? '#ff6b6b' : '#00e5aa',
              }}
            >
              {isPos ? '+' : ''}{chg.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {/* 차트 */}
      <div style={{ height: '110px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              interval={tickInterval(data.length)}
              tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.28)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={v => fmt(v)}
              tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.28)' }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '8px',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.85)',
              }}
              formatter={(v: number) => [`${fmt(v)} ${unit}`, title]}
              labelFormatter={shortDate}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              dot={false}
              strokeWidth={1.5}
              activeDot={{ r: 3, fill: color }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function MacroCharts() {
  const [data, setData]       = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/macro-chart')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="py-6 text-center" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
      환율·금시세 로딩 중...
    </div>
  )

  if (!data) return null

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="section-line" />
      <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
        환율·금시세 (90일)
      </h2>
      {/* 환율: 오를수록 원화약세 → 빨강 */}
      <ChartBlock
        title="USD/KRW 환율"
        unit="원"
        data={data.usdkrw}
        color="rgba(255,160,80,0.85)"
      />
      {/* 금시세: 오를수록 좋음 → 초록 */}
      <ChartBlock
        title="금 선물 (GC=F)"
        unit="USD/oz"
        data={data.gold}
        color="rgba(255,215,0,0.85)"
        decimals={1}
      />
    </div>
  )
}
