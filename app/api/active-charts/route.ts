import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const TRADING_DAYS = { '단타': 3, '스윙': 5, '중기': 25 } as const
type TT = keyof typeof TRADING_DAYS

function addTradingDays(from: Date, days: number): Date {
  const d = new Date(from)
  let count = 0
  while (count < days) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) count++
  }
  d.setHours(23, 59, 59, 999)
  return d
}

export interface BuyPriceInstance {
  label: string  // "" if only one instance, "추천1"/"추천2" if multiple
  price: number
}

export interface ActiveChartEntry {
  ticker:    string
  name:      string
  instances: BuyPriceInstance[]  // 1개 이상; 중복 추천 시 여러 개
  startAt:   string              // 첫 추천 시점 ISO (차트 시작점)
  expiresAt: string              // 최신 추천일 + N거래일
  rank:      number
}

type Meta = {
  ticker: string
  name: string
  buyPrices: { price: number; dateKey: string }[]  // dateKey: YYYY-MM-DD
  firstRecDate: Date
  latestRecDate: Date
}

function buildSection(
  recs: { stocks?: { ticker: string; name: string; buy_price: number; trade_type: string }[]; created_at: string }[],
  tt: TT,
  now: Date,
): ActiveChartEntry[] {
  const map = new Map<string, Meta>()

  for (const rec of recs) {
    const recDate = new Date(rec.created_at)
    const dateKey = recDate.toISOString().split('T')[0]
    for (const stock of rec.stocks ?? []) {
      if (stock.trade_type !== tt) continue
      const ex = map.get(stock.ticker)
      if (!ex) {
        map.set(stock.ticker, {
          ticker: stock.ticker,
          name: stock.name,
          buyPrices: [{ price: stock.buy_price, dateKey }],
          firstRecDate: recDate,
          latestRecDate: recDate,
        })
      } else {
        // 같은 날 중복 추천은 무시, 다른 날이면 새 인스턴스 추가
        const alreadyToday = ex.buyPrices.some(bp => bp.dateKey === dateKey)
        if (!alreadyToday) {
          ex.buyPrices.push({ price: stock.buy_price, dateKey })
        }
        if (recDate > ex.latestRecDate) ex.latestRecDate = recDate
      }
    }
  }

  const result: ActiveChartEntry[] = []
  let rank = 1
  for (const m of map.values()) {
    const expiresAt = addTradingDays(m.latestRecDate, TRADING_DAYS[tt])
    if (now > expiresAt) continue

    const multi = m.buyPrices.length > 1
    result.push({
      ticker: m.ticker,
      name: m.name,
      instances: m.buyPrices.map((bp, i) => ({
        label: multi ? `추천${i + 1}` : '',
        price: bp.price,
      })),
      startAt: m.firstRecDate.toISOString(),
      expiresAt: expiresAt.toISOString(),
      rank: rank++,
    })
  }
  return result
}

export async function GET() {
  const supabase = getSupabase()
  const now = new Date()

  const since = new Date(now)
  since.setDate(since.getDate() - 36)

  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, date, stocks, created_at')
    .gte('date', since.toISOString().split('T')[0])
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sections = {
    '단타': buildSection(recs ?? [], '단타', now),
    '스윙': buildSection(recs ?? [], '스윙', now),
    '중기': buildSection(recs ?? [], '중기', now),
  }

  return NextResponse.json({ sections })
}
