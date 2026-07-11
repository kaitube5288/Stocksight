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
  bond: DayPoint[]    // 미국 10년물 국채 금리 (%)
  fedRate: DayPoint[] // 연준 기준금리 추종 (3개월 단기채)
  oil: DayPoint[]     // WTI 원유 선물 (USD/배럴)
}

function shortDate(d: string) {
  const parts = d.split('-')
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

function tickInterval(count: number) {
  if (count <= 20) return 0
  if (count <= 45) return Math.floor(count / 6)
  return Math.floor(count / 8)
}

// gold(USD/oz) → KRW/돈 (telegram.ts와 동일 공식)
function toKrwPerDon(goldUsd: number, krwPerUsd: number): number {
  return Math.round((goldUsd * krwPerUsd * 3.75) / 31.1035)
}

function ChartBlock({
  title,
  unit,
  data,
  color,
  decimals = 0,
  badge,
  rawData,
  rawUnit,
}: {
  title: string
  unit: string
  data: DayPoint[]
  color: string
  decimals?: number
  badge?: string       // 헤더 우측 가격 옆 부가 표시 (예: "71.51 USD/배럴")
  rawData?: DayPoint[] // tooltip 보조 데이터 (날짜별 원본 값)
  rawUnit?: string     // rawData 단위
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
    decimals > 0
      ? v.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })

  const rawMap: Record<string, number> = {}
  if (rawData) for (const p of rawData) rawMap[p.date] = p.value

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
            {fmt(last.value)}
            <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--text-muted)' }}>{unit}</span>
          </span>
          {badge && (
            <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{badge}</span>
          )}
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
      <div style={{ height: '110px', minHeight: '110px', minWidth: 0 }}>
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
              tickFormatter={fmt}
              tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.28)' }}
              axisLine={false}
              tickLine={false}
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '8px',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.85)',
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const krwVal = payload[0]?.value as number
                const barrelVal = rawMap[label as string]
                return (
                  <div style={{
                    background: '#111', border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: '8px', padding: '6px 10px', fontSize: '11px',
                    color: 'rgba(255,255,255,0.85)',
                  }}>
                    <div style={{ marginBottom: '4px', color: 'rgba(255,255,255,0.45)', fontSize: '10px' }}>
                      {shortDate(String(label))}
                    </div>
                    {barrelVal != null && rawUnit && (
                      <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '2px' }}>
                        {barrelVal.toFixed(2)} {rawUnit}
                      </div>
                    )}
                    <div>{title} : {fmt(krwVal)} {unit}</div>
                  </div>
                )
              }}
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
  const [usdkrwData, setUsdkrwData] = useState<DayPoint[]>([])
  const [goldData,   setGoldData]   = useState<DayPoint[]>([])
  const [bondData,   setBondData]   = useState<DayPoint[]>([])
  const [fedData,    setFedData]    = useState<DayPoint[]>([])
  const [oilData,    setOilData]    = useState<DayPoint[]>([])
  const [oilRawData, setOilRawData] = useState<DayPoint[]>([])
  const [oilBarrel,  setOilBarrel]  = useState<number | null>(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    fetch('/api/macro-chart')
      .then(r => r.json())
      .then((d: MacroData) => {
        setUsdkrwData(d.usdkrw ?? [])
        setBondData(d.bond ?? [])

        const krwMap: Record<string, number> = {}
        for (const p of d.usdkrw ?? []) krwMap[p.date] = p.value

        const sortedKrwDates = Object.keys(krwMap).sort()
        function getNearestKrw(date: string): number {
          if (krwMap[date]) return krwMap[date]
          const before = sortedKrwDates.filter(d => d <= date)
          if (before.length) return krwMap[before[before.length - 1]]
          return krwMap[sortedKrwDates[0]] ?? 1400
        }

        const converted = (d.gold ?? []).map(p => ({
          date:  p.date,
          value: toKrwPerDon(p.value, getNearestKrw(p.date)),
        }))
        setGoldData(converted)
        setFedData(d.fedRate ?? [])
        const rawOil = d.oil ?? []
        const oilConverted = rawOil.map(p => ({
          date:  p.date,
          value: Math.round((p.value * getNearestKrw(p.date)) / 158.987),
        }))
        setOilData(oilConverted)
        setOilRawData(rawOil)
        if (rawOil.length) setOilBarrel(rawOil[rawOil.length - 1].value)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="py-6 text-center" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
      환율·금시세·채권금리·유가 로딩 중...
    </div>
  )

  if (!usdkrwData.length && !goldData.length && !bondData.length && !fedData.length && !oilData.length) return null

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="section-line" />
      <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
        환율·금시세·채권금리·유가 (90일)
      </h2>
      <ChartBlock
        title="USD/KRW 환율"
        unit="원"
        data={usdkrwData}
        color="rgba(255,160,80,0.85)"
      />
      <ChartBlock
        title="국제 금시세"
        unit="원/돈"
        data={goldData}
        color="rgba(255,215,0,0.85)"
      />
      <ChartBlock
        title="미국 10년물 국채금리"
        unit="%"
        data={bondData}
        color="rgba(130,180,255,0.85)"
        decimals={2}
      />
      <ChartBlock
        title="연준금리 (3개월 단기채)"
        unit="%"
        data={fedData}
        color="rgba(180,130,255,0.85)"
        decimals={2}
      />
      <ChartBlock
        title="WTI 원유 선물"
        unit="원/L"
        data={oilData}
        color="rgba(255,120,50,0.85)"
        badge={oilBarrel != null ? `${oilBarrel.toFixed(2)} USD/배럴` : undefined}
        rawData={oilRawData}
        rawUnit="USD/배럴"
      />
    </div>
  )
}
