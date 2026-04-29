'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'
import type { BuyPriceInstance } from '@/app/api/active-charts/route'

interface PricePoint { time: string; close: number }

interface Props {
  ticker:     string
  name:       string
  instances:  BuyPriceInstance[]  // 1개 이상; 중복 추천 시 추천1/추천2...
  tradeType:  string
  rank:       number
  from?:      string      // 첫 추천 시점 ISO (차트 시작점)
  expiresAt?: string      // 추적 만료 시점 ISO
  onDismiss?: () => void  // 수동 삭제
}

// 인스턴스별 색상 (추천1=금, 추천2=파랑, 추천3=초록)
const REF_COLORS = [
  { line: 'rgba(255,201,77,0.75)',  text: 'rgba(255,201,77,0.9)'  },
  { line: 'rgba(77,166,255,0.75)', text: 'rgba(77,166,255,0.9)'  },
  { line: 'rgba(0,229,170,0.75)',  text: 'rgba(0,229,170,0.9)'   },
]

function formatXLabel(iso: string, tradeType: string): string {
  const d = new Date(iso)
  if (tradeType === '중기') return `${d.getMonth() + 1}/${d.getDate()}`
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

function getTickInterval(count: number): number {
  if (count <= 30) return 0
  if (count <= 80) return Math.floor(count / 8)
  return Math.floor(count / 10)
}

function calcReturn(prices: PricePoint[], buyPrice: number): number | null {
  if (!prices.length || !buyPrice) return null
  return ((prices[prices.length - 1].close - buyPrice) / buyPrice) * 100
}

function formatExpiryRemaining(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return '만료'
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays > 0) return `${diffDays}일 남음`
  return `${Math.floor(diffMs / 3600000)}시간 남음`
}

export default function StockChart({ ticker, name, instances, tradeType, rank, from, expiresAt, onDismiss }: Props) {
  const [prices, setPrices]         = useState<PricePoint[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchData = useCallback(() => {
    setLoading(true)
    let url = `/api/chart?ticker=${ticker}&tradeType=${encodeURIComponent(tradeType)}`
    if (from) url += `&from=${encodeURIComponent(from)}`
    fetch(url)
      .then(r => r.json())
      .then(d => setPrices(d.prices ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ticker, tradeType, from])

  useEffect(() => { fetchData() }, [fetchData, refreshKey])

  // 첫 번째 인스턴스(추천1) 기준으로 차트 라인 색상 결정
  const primaryRet = calcReturn(prices, instances[0]?.price ?? 0)
  const isPos = primaryRet != null && primaryRet >= 0

  // Y축 범위: 모든 인스턴스 매수가 포함
  const allPrices = prices.map(p => p.close).concat(instances.map(inst => inst.price))
  const minP = Math.min(...allPrices)
  const maxP = Math.max(...allPrices)
  const pad  = (maxP - minP) * 0.1 || (instances[0]?.price ?? 1) * 0.03
  const yMin = Math.floor((minP - pad) / 100) * 100
  const yMax = Math.ceil((maxP + pad) / 100) * 100

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* 종목명 + 새로고침 */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold mr-2" style={{ color: 'var(--text-primary)' }}>
            #{rank} {name}
          </span>
          <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{ticker}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            title="새로고침"
            className="mono text-[11px] px-1.5 py-0.5 rounded transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: loading ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.4)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '···' : '↺'}
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              title="차트 숨기기"
              className="mono text-[11px] px-1.5 py-0.5 rounded transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 인스턴스별 매수가 + 수익률 (나란히 표시) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {instances.map((inst, i) => {
          const ret = calcReturn(prices, inst.price)
          const pos = ret != null && ret >= 0
          const color = REF_COLORS[i % REF_COLORS.length]
          return (
            <div key={i} className="flex items-center gap-1">
              {inst.label && (
                <span className="mono text-[9px] font-bold" style={{ color: color.text }}>
                  {inst.label}
                </span>
              )}
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>매수</span>
              <span className="mono text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                ₩{inst.price.toLocaleString()}
              </span>
              {ret != null && (
                <span
                  className="mono text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: pos ? 'rgba(0,229,170,0.15)' : 'rgba(255,107,107,0.15)',
                    color:      pos ? '#00e5aa' : '#ff6b6b',
                  }}
                >
                  {pos ? '+' : ''}{ret.toFixed(2)}%
                </span>
              )}
            </div>
          )
        })}
        {expiresAt && (
          <span className="mono text-[9px] ml-auto" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {formatExpiryRemaining(expiresAt)}
          </span>
        )}
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
                interval={getTickInterval(prices.length)}
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
                  const primary = instances[0]?.price ?? 0
                  return [`₩${v.toLocaleString()} (${((v - primary) / primary * 100).toFixed(2)}%)`, '가격']
                }}
              />
              {/* 인스턴스별 매수가 기준선 */}
              {instances.map((inst, i) => {
                const color = REF_COLORS[i % REF_COLORS.length]
                return (
                  <ReferenceLine
                    key={i}
                    y={inst.price}
                    stroke={color.line}
                    strokeDasharray="4 3"
                    label={{
                      value: inst.label || '매수가',
                      position: i % 2 === 0 ? 'insideTopRight' : 'insideBottomRight',
                      fontSize: 9,
                      fill: color.line,
                    }}
                  />
                )
              })}
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
