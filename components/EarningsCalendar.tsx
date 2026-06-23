'use client'

import { useEffect, useState, useCallback } from 'react'
import type { CalendarData, EarningsItem, ScheduledItem, RateNewsItem } from '@/app/api/earnings-calendar/route'

type Tab = 'earnings' | 'rate'

function formatDate(str: string) {
  if (!str) return ''
  // YYYYMMDD → MM/DD
  if (/^\d{8}$/.test(str)) return `${str.slice(4, 6)}/${str.slice(6, 8)}`
  // YYYY.MM.DD or YYYY-MM-DD → MM/DD
  const m = str.match(/\d{4}[.\-]\d{1,2}[.\-](\d{1,2}).*/)
  if (m) {
    const parts = str.split(/[.\-]/)
    return `${parts[1]}/${parts[2]}`
  }
  return str
}

function truncateReportName(name: string) {
  // 공시명이 길면 핵심 단어만 표시
  if (name.includes('잠정실적') || name.includes('영업(잠정)실적')) return '잠정실적'
  if (name.includes('분기보고서')) return '분기보고서'
  if (name.includes('반기보고서')) return '반기보고서'
  if (name.includes('매출액또는손익구조')) return '손익구조변동'
  return name.length > 18 ? name.slice(0, 18) + '…' : name
}

function EarningsRow({ item }: { item: EarningsItem }) {
  const reportLabel = truncateReportName(item.report_nm)
  const isProvisional = item.report_nm?.includes('잠정') || item.report_nm?.includes('잠정실적')
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--text-secondary)', maxWidth: '110px' }}>
          {item.corp_name}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
          style={{
            background: isProvisional ? 'rgba(251,146,60,0.12)' : 'rgba(77,166,255,0.1)',
            border: isProvisional ? '1px solid rgba(251,146,60,0.35)' : '1px solid rgba(77,166,255,0.25)',
            color: isProvisional ? '#fb923c' : '#4da6ff',
          }}
        >
          {reportLabel}
        </span>
      </div>
      <span className="mono text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
        {formatDate(item.rcept_dt)}
      </span>
    </div>
  )
}

function ScheduledRow({ item }: { item: ScheduledItem }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', maxWidth: '130px' }}>
          {item.name}
        </span>
        {item.note && (
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.note}</span>
        )}
      </div>
      <span className="mono text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
        {formatDate(item.date)}
      </span>
    </div>
  )
}

function NewsRow({ item }: { item: RateNewsItem }) {
  const isRate = item.category === 'rate'
  const pubShort = item.pubDate
    ? (() => {
        try { return new Date(item.pubDate).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
        catch { return item.pubDate.slice(0, 16) }
      })()
    : ''
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 py-2 px-3 rounded-xl transition-all duration-150 group"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)', textDecoration: 'none' }}
    >
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0 mt-0.5"
        style={{
          background: isRate ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.10)',
          border: isRate ? '1px solid rgba(248,113,113,0.35)' : '1px solid rgba(74,222,128,0.3)',
          color: isRate ? '#f87171' : '#4ade80',
        }}
      >
        {isRate ? '금리' : '정책'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-relaxed line-clamp-2 group-hover:text-white transition-colors"
          style={{ color: 'var(--text-secondary)' }}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.source}</span>
          {pubShort && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>· {pubShort}</span>
          )}
        </div>
      </div>
    </a>
  )
}

export default function EarningsCalendar() {
  const [data, setData] = useState<CalendarData | null>(null)
  const [tab, setTab] = useState<Tab>('earnings')
  const [loading, setLoading] = useState(false)
  const [fetchedAt, setFetchedAt] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/earnings-calendar')
      const json: CalendarData = await res.json()
      setData(json)
      setFetchedAt(json.fetchedAt)
    } catch { /* 실패 무시 */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchData])

  const timeStr = fetchedAt
    ? (() => {
        try { return new Date(fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }
        catch { return '' }
      })()
    : ''

  const hasEarnings    = (data?.todayEarnings?.length ?? 0) > 0
  const hasScheduled   = (data?.scheduledEarnings?.length ?? 0) > 0
  const hasRateNews    = (data?.rateNews?.length ?? 0) > 0
  const hasPolicyNews  = (data?.policyNews?.length ?? 0) > 0
  const allRatePolicy  = [...(data?.rateNews ?? []), ...(data?.policyNews ?? [])]

  return (
    <div className="glass glow-white rounded-2xl p-5 flex flex-col gap-4 mt-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(251,146,60,0.7)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            실적·금리·정책
          </span>
        </div>
        {timeStr && (
          <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {timeStr} 기준
          </span>
        )}
      </div>

      {/* 탭 */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0' }}>
        {([
          { key: 'earnings', label: '실적 발표' },
          { key: 'rate',     label: '금리·정책' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => {
          const active = tab === key
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="text-xs px-3 py-1.5 transition-all"
              style={{
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: active ? '2px solid rgba(255,255,255,0.5)' : '2px solid transparent',
                background: 'none',
                marginBottom: '-1px',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {loading && !data ? (
        <div className="text-center py-6 mono text-xs" style={{ color: 'var(--text-muted)' }}>
          데이터 수집 중...
        </div>
      ) : (
        <>
          {/* ── 실적 탭 ── */}
          {tab === 'earnings' && (
            <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1">
              {/* 최근 실적 공시 */}
              <div>
                <div className="text-[10px] font-semibold mb-1.5 tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>
                  최근 실적 공시 (오늘·어제)
                </div>
                {hasEarnings ? (
                  <div className="flex flex-col gap-1.5">
                    {data!.todayEarnings.map((item, i) => (
                      <EarningsRow key={i} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="text-xs py-3 text-center rounded-xl"
                    style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)' }}>
                    {!process.env.NEXT_PUBLIC_SUPABASE_URL || true
                      ? 'DART 공시 조회 중 (API 키 필요)'
                      : '오늘 실적 공시 없음'}
                  </div>
                )}
              </div>

              {/* 예정 일정 */}
              <div>
                <div className="text-[10px] font-semibold mb-1.5 tracking-wider"
                  style={{ color: 'var(--text-muted)' }}>
                  실적발표 예정 일정
                </div>
                {hasScheduled ? (
                  <div className="flex flex-col gap-1.5">
                    {data!.scheduledEarnings.map((item, i) => (
                      <ScheduledRow key={i} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="text-xs py-3 text-center rounded-xl"
                    style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)' }}>
                    예정 일정 데이터 없음
                    <div className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      네이버 금융 캘린더 연동 시도 중
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 금리·정책 탭 ── */}
          {tab === 'rate' && (
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
              {hasRateNews || hasPolicyNews ? (
                allRatePolicy.map((item, i) => (
                  <NewsRow key={i} item={item} />
                ))
              ) : (
                <div className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                  금리·정책 뉴스 없음
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
