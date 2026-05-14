'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'
import type { BuyPriceInstance } from '@/app/api/active-charts/route'

interface PricePoint { time: string; close: number }

interface Props {
  ticker:     string
  name:       string
  instances:  BuyPriceInstance[]
  tradeType:  string
  rank:       number
  from?:      string
  expiresAt?: string
  onDismiss?: () => void
  index?:     number  // 로드 순서 (stagger delay용)
}

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

function formatTooltipTime(iso: string, tradeType: string): string {
  const d = new Date(iso)
  if (tradeType === '중기') {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  const kstH = (d.getUTCHours() + 9) % 24
  const kstM = d.getUTCMinutes()
  const date = new Date(d.getTime() + 9 * 3600 * 1000)
  const dow = ['일','월','화','수','목','금','토'][date.getUTCDay()]
  return `${date.getUTCMonth()+1}/${date.getUTCDate()}(${dow}) ${String(kstH).padStart(2,'0')}:${String(kstM).padStart(2,'0')}`
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

// 커스텀 툴팁: 추천1/추천2 수익률 모두 표시
function CustomTooltip({ active, payload, label, tradeType, instances }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
  tradeType: string
  instances: BuyPriceInstance[]
}) {
  if (!active || !payload?.length || !label) return null
  const v = payload[0].value
  return (
    <div style={{
      background: '#111', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '8px', padding: '8px 10px', fontSize: '11px',
      color: 'rgba(255,255,255,0.85)', lineHeight: '1.6',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontSize: '10px' }}>
        {formatTooltipTime(label, tradeType)}
      </div>
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>
        ₩{v.toLocaleString()}
      </div>
      {instances.map((inst, i) => {
        const ret = ((v - inst.price) / inst.price * 100)
        const color = REF_COLORS[i % REF_COLORS.length]
        return (
          <div key={i} style={{ color: color.text, fontSize: '10px' }}>
            {inst.label || '매수가'} ₩{inst.price.toLocaleString()}
            {' → '}
            <span style={{ color: ret >= 0 ? '#00e5aa' : '#ff6b6b', fontWeight: 700 }}>
              {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function StockChart({ ticker, name, instances, tradeType, rank, from, expiresAt, onDismiss, index = 0 }: Props) {
  const [prices, setPrices]         = useState<PricePoint[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const mountedRef                  = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchData = useCallback(async (isRetry = false) => {
    if (!isRetry) setLoading(true)
    // src: 0=Yahoo query1 / 1=Yahoo query2 / 2=Daum — index % 3 로 분산
    const src = isRetry ? 0 : index % 3
    const url = `/api/chart?ticker=${ticker}&tradeType=${encodeURIComponent(tradeType)}&src=${src}`
      + (from ? `&from=${encodeURIComponent(from)}` : '')
    try {
      const res = await fetch(url)
      const d   = await res.json()
      const data: PricePoint[] = d.prices ?? []
      if (!mountedRef.current) return
      if (data.length === 0 && !isRetry) {
        // 빈 데이터 시 2초 후 1회 자동 재시도 (Yahoo Finance rate-limit 대응)
        await new Promise(r => setTimeout(r, 2000))
        if (mountedRef.current) fetchData(true)
        return
      }
      setPrices(data)
    } catch { /* ignore */ } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [ticker, tradeType, from])

  useEffect(() => {
    // 차트 순서에 따라 로드 시간 엇갈리기 (Yahoo Finance 동시 요청 차단 방지)
    const delay = setTimeout(() => fetchData(), index * 1000)
    return () => clearTimeout(delay)
  }, [fetchData, refreshKey, index])

  const primaryRet = calcReturn(prices, instances[0]?.price ?? 0)
  const isPos = primaryRet != null && primaryRet >= 0

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
      {/* 종목명 + 버튼 */}
      <div className="flex items-center justify-between">
        <div>
          <a
            href={`https://m.stock.naver.com/domestic/stock/${ticker.split('.')[0]}/total`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold mr-2 hover:underline"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            #{rank} {name}
          </a>
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
              onClick={() => onDismiss()}
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

      {/* 인스턴스별 매수가 + 수익률 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {instances.map((inst, i) => {
          const ret = calcReturn(prices, inst.price)
          const pos = ret != null && ret >= 0
          const color = REF_COLORS[i % REF_COLORS.length]
          // YYYY-MM-DD → M/D 형식
          const recDate = inst.dateKey
            ? inst.dateKey.slice(5).replace('-', '/')
            : null
          return (
            <div key={i} className="flex items-center gap-1 flex-wrap">
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
              {recDate && (
                <span
                  className="mono text-[9px] px-1 py-0.5 rounded"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.3)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {recDate}
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
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>데이터 없음</span>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="mono text-[10px] px-2 py-1 rounded transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
              }}
            >
              ↺ 재시도
            </button>
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
                content={(props) => (
                  <CustomTooltip
                    active={props.active}
                    payload={props.payload as unknown as { value: number }[] | undefined}
                    label={props.label as string | undefined}
                    tradeType={tradeType}
                    instances={instances}
                  />
                )}
              />
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
