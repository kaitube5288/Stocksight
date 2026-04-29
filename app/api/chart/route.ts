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

  // 소스 우선순위: query1 → query2 → Daum → Naver(일봉)
  // src로 시작 순서를 조정하되, 빈 데이터면 나머지 소스를 순차 시도
  const order = buildOrder(src, interval)
  try {
    for (const s of order) {
      const prices = await trySource(ticker, interval, range, from, s)
      if (prices.length > 0) return NextResponse.json({ prices, interval, src: s })
    }
    return NextResponse.json({ prices: [], interval })
  } catch {
    return NextResponse.json({ prices: [], interval })
  }
}

// src에 따라 시도 순서 결정 — query1이 Vercel에서 가장 안정적
function buildOrder(src: number, interval: string): number[] {
  const daily = interval === '1d'
  // 0=query1, 1=query2, 2=Daum, 3=Naver(일봉만)
  const all = daily ? [0, 1, 2, 3] : [0, 1, 2]
  return [src, ...all.filter(s => s !== src)]
}

async function trySource(
  ticker: string,
  interval: string,
  range: string,
  from: string | null,
  src: number,
): Promise<import('@/lib/price-providers').PricePoint[]> {
  try {
    if (src === 0) return await fetchYahoo(ticker, interval, range, from, 'query1')
    if (src === 1) return await fetchYahoo(ticker, interval, range, from, 'query2')
    if (src === 2) return await fetchDaum(ticker, interval, from)
    if (src === 3 && interval === '1d') return await fetchNaver(ticker, from)
    return []
  } catch { return [] }
}
