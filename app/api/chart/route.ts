import { NextRequest, NextResponse } from 'next/server'
import { fetchYahoo, fetchDaum, fetchNaver, fetchNaverIntraday } from '@/lib/price-providers'

export const dynamic = 'force-dynamic'

const TRADE_CONFIG = {
  '단타': { interval: '5m',  range: '5d'  },  // 3거래일 커버 (range 방식 사용)
  '스윙': { interval: '30m', range: '10d' },  // 5거래일 커버
  '중기': { interval: '1d',  range: '45d' },  // 25거래일(~35일) + 여유
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

  let { interval } = TRADE_CONFIG[tradeType as keyof typeof TRADE_CONFIG]
  let { range } = TRADE_CONFIG[tradeType as keyof typeof TRADE_CONFIG]

  // from이 지정되면, from 날짜부터 오늘까지 충분히 가져오도록 range 동적 조정
  if (from) {
    const fromDate = new Date(from)
    const now = new Date()
    const daysDiff = Math.ceil((now.getTime() - fromDate.getTime()) / (24 * 3600000))
    // 여유 있게 daysDiff + 10일 이상 가져오기
    const requiredDays = Math.max(daysDiff + 10, parseInt(range))
    range = `${requiredDays}d` as any
  }

  // 소스 우선순위: query1 → query2 → Daum → Naver(일봉)
  // src로 시작 순서를 조정하되, 빈 데이터면 나머지 소스를 순차 시도
  const order = buildOrder(src, interval)
  const isIntraday = interval !== '1d'
  try {
    for (const s of order) {
      const prices = await trySource(ticker, interval, range, from, s)
      // 인트라데이: Yahoo가 일봉 스텁(1개) 반환하는 경우 건너뜀 → 최소 2개 필요
      const ok = isIntraday ? prices.length >= 2 : prices.length > 0
      if (ok) return NextResponse.json({ prices, interval, src: s })
    }
    return NextResponse.json({ prices: [], interval })
  } catch {
    return NextResponse.json({ prices: [], interval })
  }
}

// src에 따라 시도 순서 결정
// 0=Yahoo query1 | 1=Yahoo query2 | 2=Daum | 3=Naver 일봉 | 4=Naver 분봉(단타/스윙)
function buildOrder(src: number, interval: string): number[] {
  const daily = interval === '1d'
  const all = daily ? [0, 1, 2, 3] : [0, 1, 2, 4]
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
    if (src === 4 && interval !== '1d') return await fetchNaverIntraday(ticker, interval, from)
    return []
  } catch { return [] }
}
