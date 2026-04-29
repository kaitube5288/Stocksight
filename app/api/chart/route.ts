import { NextRequest, NextResponse } from 'next/server'
import { fetchYahoo, fetchDaum, fetchNaver } from '@/lib/price-providers'

export const dynamic = 'force-dynamic'

const TRADE_CONFIG = {
  '단타': { interval: '5m',  range: '2d'  },
  '스윙': { interval: '30m', range: '5d'  },
  '중기': { interval: '1d',  range: '35d' },
} as const

// src 값별 데이터 소스
// 0 = Yahoo query1 | 1 = Yahoo query2 | 2 = Daum | 3 = Naver(일봉 전용)
// 클라이언트에서 index % 3 으로 분산 (0·1·2 순환)

export async function GET(request: NextRequest) {
  const ticker    = request.nextUrl.searchParams.get('ticker') ?? ''
  const tradeType = request.nextUrl.searchParams.get('tradeType') ?? ''
  const from      = request.nextUrl.searchParams.get('from') // ISO
  const src       = parseInt(request.nextUrl.searchParams.get('src') ?? '1', 10)

  if (!ticker || !(tradeType in TRADE_CONFIG)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
  }

  const { interval, range } = TRADE_CONFIG[tradeType as keyof typeof TRADE_CONFIG]

  try {
    let prices = await fetchPrimary(ticker, interval, range, from, src)

    // 빈 데이터 시 Yahoo query2 로 fallback
    if (!prices.length) {
      prices = await fetchYahoo(ticker, interval, range, from, 'query2')
    }

    return NextResponse.json({ prices, interval, src })
  } catch {
    return NextResponse.json({ prices: [], interval })
  }
}

async function fetchPrimary(
  ticker: string,
  interval: string,
  range: string,
  from: string | null,
  src: number,
) {
  try {
    if (src === 0) return await fetchYahoo(ticker, interval, range, from, 'query1')
    if (src === 2) return await fetchDaum(ticker, interval, from)
    if (src === 3 && interval === '1d') return await fetchNaver(ticker, from)
    return await fetchYahoo(ticker, interval, range, from, 'query2')
  } catch {
    return []
  }
}
