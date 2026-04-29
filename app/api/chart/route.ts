import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'

export const dynamic = 'force-dynamic'

const TRADE_CONFIG = {
  '단타': { interval: '5m',  range: '2d'  },
  '스윙': { interval: '30m', range: '5d'  },
  '중기': { interval: '1d',  range: '35d' },
} as const

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

// KRX 장중 필터: 09:00–15:30 KST = 00:00–06:30 UTC
function isMarketHours(ts: number): boolean {
  const d = new Date(ts * 1000)
  const day = d.getUTCDay() // 0=일, 6=토
  if (day === 0 || day === 6) return false
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes()
  return mins >= 0 && mins <= 390
}

export async function GET(request: NextRequest) {
  const ticker    = request.nextUrl.searchParams.get('ticker') ?? ''
  const tradeType = request.nextUrl.searchParams.get('tradeType') ?? ''
  const from      = request.nextUrl.searchParams.get('from') // ISO — 추천 시점부터 데이터 요청

  if (!ticker || !(tradeType in TRADE_CONFIG)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
  }

  const { interval, range } = TRADE_CONFIG[tradeType as keyof typeof TRADE_CONFIG]
  const symbol = ticker.includes('.') ? ticker : `${ticker}.KS`

  try {
    let url: string
    if (from) {
      const p1 = Math.floor(new Date(from).getTime() / 1000)
      const p2 = Math.floor(Date.now() / 1000)
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&period1=${p1}&period2=${p2}`
    } else {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`
    }
    const res = await axios.get(url, { headers: YF_HEADERS, timeout: 12000 })

    const result = res.data?.chart?.result?.[0]
    if (!result) return NextResponse.json({ prices: [], interval })

    const timestamps: number[] = result.timestamp ?? []
    const closes: number[]     = result.indicators?.quote?.[0]?.close ?? []

    const isIntraday = interval !== '1d'
    const prices = timestamps
      .map((ts, i) => ({ ts, close: closes[i] }))
      .filter(p => p.close != null && (!isIntraday || isMarketHours(p.ts)))
      .map(p => ({
        time:  new Date(p.ts * 1000).toISOString(),
        close: Math.round(p.close),
      }))

    return NextResponse.json({ prices, interval })
  } catch {
    return NextResponse.json({ prices: [], interval })
  }
}
