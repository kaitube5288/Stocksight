'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts'
import type { AIStockRecommendation } from '@/app/api/ai-analyze/route'

interface PricePoint { time: string; close: number }

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function MetricBox({ label, value, sub, subColor }: {
  label: string; value: string; sub?: string; subColor?: string
}) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      <span className="text-sm font-bold mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
      {sub && (
        <span className="text-[10px] font-medium" style={{ color: subColor ?? 'rgba(255,107,107,0.85)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

function TableRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
      <span className="text-xs font-semibold mono" style={{ color: valueColor ?? 'var(--text-secondary)' }}>
        {value}
      </span>
    </div>
  )
}

export default function AIStockCard({ rec, index = 0 }: {
  rec: AIStockRecommendation
  index?: number
}) {
  const [prices, setPrices]   = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(index === 0)

  const fetchChart = useCallback(async () => {
    setLoading(true)
    try {
      const tradeType = encodeURIComponent('스윙')
      const url = `/api/chart?ticker=${rec.ticker}&tradeType=${tradeType}&src=${index % 3}`
        + (rec.from ? `&from=${encodeURIComponent(rec.from)}` : '')
      const res = await fetch(url)
      const d = await res.json()
      setPrices(d.prices ?? [])
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [rec.ticker, rec.from, index])

  useEffect(() => {
    const t = setTimeout(() => fetchChart(), index * 800)
    return () => clearTimeout(t)
  }, [fetchChart, index])

  const current = rec.current_price
  const allPrices = prices.map(p => p.close).concat(current ? [current] : [])
  const minP = allPrices.length ? Math.min(...allPrices) : 0
  const maxP = allPrices.length ? Math.max(...allPrices) : 0
  const pad  = (maxP - minP) * 0.12 || (current ?? 10000) * 0.05
  const yMin = Math.floor((minP - pad) / 100) * 100
  const yMax = Math.ceil((maxP + pad) / 100) * 100

  const chartColor = '#4d94ff'

  const fmt = (n: number | null | undefined) => n ? n.toLocaleString() : '-'
  const fmtRange = (lo: number | null, hi: number | null) =>
    lo == null || hi == null ? '-' : lo === hi ? lo.toLocaleString() : `${lo.toLocaleString()}~${hi.toLocaleString()}`

  const rsiColor = rec.rsi
    ? rec.rsi >= 70 ? '#ff6b6b' : rec.rsi <= 30 ? '#00e5aa' : 'rgba(255,255,255,0.7)'
    : 'rgba(255,255,255,0.5)'

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* ── 헤더 ── */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="mono text-xs font-black w-5 h-5 flex items-center justify-center rounded-md"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-primary)' }}
          >
            {rec.rank}
          </span>
          <a
            href={`https://m.stock.naver.com/domestic/stock/${rec.ticker.split('.')[0]}/total`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-bold hover:underline"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {rec.name}
          </a>
          <span className="mono text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ({rec.ticker})
          </span>
          {rec.is_best && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,200,0,0.15)', color: '#ffc800', border: '1px solid rgba(255,200,0,0.3)' }}
            >
              ★ 오늘 최선호
            </span>
          )}
        </div>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {rec.ticker} · {rec.description}
        </p>
      </div>

      {/* ── 기술적 지표 그리드 ── */}
      <div className="px-4 pb-3">
        <p className="text-[10px] mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
          기술적 지표 (실시간 데이터 기반)
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricBox
            label="현재가"
            value={current ? `${current.toLocaleString()}원` : '조회 중'}
            sub={rec.price_signal}
          />
          <MetricBox
            label="52주 범위"
            value={rec.low_52w && rec.high_52w
              ? `${Math.round(rec.low_52w / 1000)}K~${Math.round(rec.high_52w / 1000)}K원`
              : '데이터 없음'}
            sub={rec.range_52w_signal}
            subColor="rgba(255,200,100,0.85)"
          />
          <MetricBox
            label="RSI"
            value={rec.rsi != null ? String(rec.rsi) : '-'}
            sub={rec.rsi_signal}
            subColor={rsiColor}
          />
          <MetricBox
            label="수급"
            value={rec.supply_signal}
            sub={rec.supply_detail}
            subColor="rgba(77,200,255,0.85)"
          />
        </div>
      </div>

      {/* ── 차트 ── */}
      <div className="px-4 pb-3">
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between text-xs mb-2"
          style={{ color: 'rgba(255,255,255,0.35)' }}
        >
          <span>차트</span>
          <span>{open ? '▲ 접기' : '▼ 펼치기'}</span>
        </button>

        {open && (
          <div style={{ height: '160px' }}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs animate-pulse" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  차트 로딩 중...
                </span>
              </div>
            ) : prices.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>차트 데이터 없음</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={prices} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={formatDate}
                    interval={Math.floor(prices.length / 5)}
                    tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tickFormatter={v => `${Math.round(v / 1000)}K`}
                    tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
                    axisLine={false} tickLine={false} width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#111', border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.85)',
                    }}
                    formatter={(v: unknown) => [`₩${Number(v).toLocaleString()}`, '종가']}
                    labelFormatter={(label: unknown) => typeof label === 'string' ? formatDate(label) : String(label)}
                  />
                  {rec.ma20 && (
                    <ReferenceLine
                      y={rec.ma20}
                      stroke="rgba(255,100,100,0.5)"
                      strokeDasharray="4 3"
                      label={{ value: '20일선', position: 'insideTopRight', fontSize: 9, fill: 'rgba(255,100,100,0.7)' }}
                    />
                  )}
                  {rec.buy_low && (
                    <ReferenceLine
                      y={rec.buy_low}
                      stroke="rgba(0,229,170,0.4)"
                      strokeDasharray="4 3"
                      label={{ value: '매수하단', position: 'insideBottomRight', fontSize: 9, fill: 'rgba(0,229,170,0.6)' }}
                    />
                  )}
                  <Line
                    type="monotone" dataKey="close"
                    stroke={chartColor} dot={false} strokeWidth={1.5}
                    activeDot={{ r: 3, fill: chartColor }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── 이동평균선 분석 ── */}
      <div className="px-4 pb-3">
        <p className="text-[10px] mb-1.5 font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>
          이동평균선 분석
        </p>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <TableRow
            label="5일 이평선"
            value={rec.ma5 ? `${rec.ma5.toLocaleString()}원` : '데이터 없음'}
          />
          <TableRow
            label="20일 이평선"
            value={rec.ma20 ? `${rec.ma20.toLocaleString()}원` : '데이터 없음'}
          />
          {rec.ma60 && (
            <TableRow label="60일 이평선" value={`${rec.ma60.toLocaleString()}원`} />
          )}
          <TableRow label="현재가 vs 5일선" value={rec.price_vs_ma5} />
          <TableRow label="이평선 배열" value={rec.ma_alignment} />
          <TableRow label="볼린저밴드" value={rec.bollinger_status} />
        </div>
      </div>

      {/* ── 매매 참고가 ── */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div
            className="rounded-xl p-3 flex flex-col gap-1"
            style={{ background: 'rgba(77,148,255,0.08)', border: '1px solid rgba(77,148,255,0.2)' }}
          >
            <span className="text-[10px]" style={{ color: 'rgba(77,148,255,0.7)' }}>매수 참고가</span>
            <span className="text-sm font-bold mono" style={{ color: '#4d94ff' }}>
              {fmtRange(rec.buy_low, rec.buy_high)}
            </span>
          </div>
          <div
            className="rounded-xl p-3 flex flex-col gap-1"
            style={{ background: 'rgba(0,180,100,0.08)', border: '1px solid rgba(0,180,100,0.2)' }}
          >
            <span className="text-[10px]" style={{ color: 'rgba(0,200,120,0.7)' }}>1차 목표가</span>
            <span className="text-sm font-bold mono" style={{ color: '#00c878' }}>
              {fmtRange(rec.target_low, rec.target_high)}
            </span>
          </div>
          <div
            className="rounded-xl p-3 flex flex-col gap-1"
            style={{ background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)' }}
          >
            <span className="text-[10px]" style={{ color: 'rgba(255,100,100,0.7)' }}>손절 기준</span>
            <span className="text-sm font-bold mono" style={{ color: '#ff6464' }}>
              {fmt(rec.stop_loss)} 하회시
            </span>
          </div>
          {(() => {
            const returnPct = rec.buy_low > 0
              ? ((rec.target_high - rec.buy_low) / rec.buy_low * 100).toFixed(1)
              : null
            return (
              <div
                className="rounded-xl p-3 flex flex-col gap-1"
                style={{ background: 'rgba(255,200,0,0.06)', border: '1px solid rgba(255,200,0,0.2)' }}
              >
                <span className="text-[10px]" style={{ color: 'rgba(255,200,0,0.6)' }}>목표 수익률</span>
                <span className="text-sm font-bold mono" style={{ color: '#ffc800' }}>
                  {returnPct ? `+${returnPct}%` : '-'}
                </span>
              </div>
            )
          })()}
          <div
            className="rounded-xl p-3 flex flex-col gap-1"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>증권사 목표</span>
            <span className="text-sm font-bold mono" style={{ color: 'var(--text-primary)' }}>
              {rec.analyst_target ? `${rec.analyst_target.toLocaleString()}원` : '리포트 없음'}
            </span>
          </div>
        </div>
      </div>

      {/* ── AI 분석 이유 ── */}
      <div
        className="mx-4 mb-4 rounded-xl p-3"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <p className="text-[10px] mb-1.5 font-semibold" style={{ color: 'rgba(255,255,255,0.35)' }}>
          AI 분석 근거
        </p>
        <p className="text-xs leading-relaxed mb-2" style={{ color: 'rgba(255,255,255,0.65)' }}>
          {rec.reasoning}
        </p>
        <div
          className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.2)' }}
        >
          <span className="text-[10px]" style={{ color: 'rgba(255,200,0,0.5)' }}>⚡</span>
          <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,200,0,0.8)' }}>
            {rec.key_catalyst}
          </span>
        </div>
      </div>
    </div>
  )
}
