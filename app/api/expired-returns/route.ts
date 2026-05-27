import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { addTradingDays } from '@/lib/trading-days'
import axios from 'axios'

export const dynamic = 'force-dynamic'

// 5월 4일부터 추적 시작
const START_DATE = '2026-05-04'

// 섹션별 만료 거래일 수
const TRADING_DAYS = { '단타': 1, '스윙': 5, '중기': 20 } as const
type TT = keyof typeof TRADING_DAYS

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

// 만기일 이전 가장 가까운 거래일 종가 조회
async function getPriceNearDate(ticker: string, targetDate: Date): Promise<number | null> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  const targetTs = Math.floor(targetDate.getTime() / 1000)

  for (const suffix of ['.KS', '.KQ']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=90d&interval=1d`
      const res = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 })
      const result = res.data?.chart?.result?.[0]
      if (!result) continue
      const timestamps: number[] = result.timestamp ?? []
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []

      // 만기 timestamp 이하인 것 중 가장 최신 거래일
      let bestIdx = -1
      let bestTs = -Infinity
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i]
        if (closes[i] == null || isNaN(closes[i]!)) continue
        if (ts <= targetTs + 86400 && ts > bestTs) {
          bestTs = ts
          bestIdx = i
        }
      }
      if (bestIdx >= 0) return closes[bestIdx]!
    } catch { continue }
  }
  return null
}

type StockRecord = { ticker: string; name: string; buy_price: number; trade_type: string }
// latestBuyPrice: 재추천 시 최신 추천가로 갱신 → 최신 추천 기준 수익률 측정
type Group = { ticker: string; name: string; firstBuyPrice: number; latestBuyPrice: number; latestRecDate: Date }

export async function GET() {
  const supabase = getSupabase()
  const now = new Date()

  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, date, stocks, created_at')
    .gte('date', START_DATE)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 거래유형별로 ticker 기준 그룹핑
  const groups: Record<TT, Map<string, Group>> = {
    '단타': new Map(), '스윙': new Map(), '중기': new Map(),
  }

  for (const rec of recs ?? []) {
    const recDate = new Date(rec.created_at)
    for (const stock of (rec.stocks ?? []) as StockRecord[]) {
      const tt = stock.trade_type as TT
      if (!groups[tt]) continue
      const existing = groups[tt].get(stock.ticker)
      if (!existing) {
        groups[tt].set(stock.ticker, {
          ticker: stock.ticker, name: stock.name,
          firstBuyPrice: stock.buy_price,
          latestBuyPrice: stock.buy_price,
          latestRecDate: recDate,
        })
      } else if (recDate > existing.latestRecDate) {
        existing.latestRecDate = recDate
        existing.latestBuyPrice = stock.buy_price  // 재추천 시 최신 추천가로 갱신
      }
    }
  }

  // 만료된 종목 목록 수집
  type ExpiredItem = { tt: TT; group: Group; expiresAt: Date }
  const expiredItems: ExpiredItem[] = []

  for (const tt of ['단타', '스윙', '중기'] as TT[]) {
    for (const group of groups[tt].values()) {
      const expiresAt = addTradingDays(group.latestRecDate, TRADING_DAYS[tt])
      if (now <= expiresAt) continue  // 아직 활성
      expiredItems.push({ tt, group, expiresAt })
    }
  }

  // 만기 시점 가격 병렬 조회
  const exitPrices = await Promise.all(
    expiredItems.map(({ group, expiresAt }) => getPriceNearDate(group.ticker, expiresAt))
  )

  // 섹션별 수익률 집계 — 최신 추천가(latestBuyPrice) 기준
  const returnsByTT: Record<TT, number[]> = { '단타': [], '스윙': [], '중기': [] }
  expiredItems.forEach(({ tt, group }, i) => {
    const exitPrice = exitPrices[i]
    if (exitPrice == null || !group.latestBuyPrice) return
    const returnPct = ((exitPrice - group.latestBuyPrice) / group.latestBuyPrice) * 100
    returnsByTT[tt].push(returnPct)
  })

  type Stats = { cumulative: number | null; average: number | null; winRate: number | null; count: number }
  const stats: Record<TT, Stats> = {
    '단타': { cumulative: null, average: null, winRate: null, count: 0 },
    '스윙': { cumulative: null, average: null, winRate: null, count: 0 },
    '중기': { cumulative: null, average: null, winRate: null, count: 0 },
  }

  for (const tt of ['단타', '스윙', '중기'] as TT[]) {
    const arr = returnsByTT[tt]
    if (arr.length === 0) continue
    const sum = arr.reduce((a, b) => a + b, 0)
    const wins = arr.filter(r => r >= 0).length
    stats[tt] = {
      cumulative: sum,                          // 단순합산 (기존 호환)
      average: sum / arr.length,               // 평균 수익률
      winRate: (wins / arr.length) * 100,      // 승률 (%)
      count: arr.length,
    }
  }

  // 기존 필드 호환 유지
  const cumulative: Record<TT, number | null> = {
    '단타': stats['단타'].cumulative,
    '스윙': stats['스윙'].cumulative,
    '중기': stats['중기'].cumulative,
  }

  return NextResponse.json({
    cumulative,
    stats,
    expiredCount: expiredItems.length,
  })
}
