import { NextRequest, NextResponse } from 'next/server'
import { fetchYahoo, fetchDaum, fetchNaver, fetchNaverIntraday, PricePoint } from '@/lib/price-providers'

export const dynamic = 'force-dynamic'

function getKSTNow(): Date {
  return new Date(new Date().getTime() + 9 * 3_600_000)
}

const TRADE_CONFIG = {
  '단타': { interval: '5m',  range: '5d'  },  // 3거래일 커버 (range 방식 사용)
  '스윙': { interval: '30m', range: '10d' },  // 5거래일 커버
  '중기': { interval: '1d',  range: '45d' },  // 25거래일(~35일) + 여유
} as const

// 분봉을 일봉으로 변환 (각 날짜의 마지막 분봉을 종가로 사용)
function convertIntraDayToDaily(prices: PricePoint[]): PricePoint[] {
  if (prices.length === 0) return []

  const daily: Record<string, PricePoint> = {}
  for (const p of prices) {
    const date = p.time.split('T')[0] // YYYY-MM-DD 추출
    daily[date] = p // 나중 데이터가 덮어씀 (각 날의 마지막 값)
  }

  return Object.values(daily).sort((a, b) => a.time.localeCompare(b.time))
}

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
    const now = getKSTNow()
    const daysDiff = Math.ceil((now.getTime() - fromDate.getTime()) / (24 * 3600000))
    // 여유 있게 daysDiff + 10일 이상 가져오기
    const requiredDays = Math.max(daysDiff + 10, parseInt(range))
    range = `${requiredDays}d` as any
  }

  // 소스 우선순위: query1 → query2 → Daum → Naver(일봉)
  // 모든 소스에서 데이터를 받아서 가장 최신 날짜까지 있는 것을 선택
  const order = buildOrder(src, interval)
  const isIntraday = interval !== '1d'
  try {
    const results: { prices: import('@/lib/price-providers').PricePoint[]; src: number }[] = []

    for (const s of order) {
      const prices = await trySource(ticker, interval, range, from, s)
      const ok = isIntraday ? prices.length >= 2 : prices.length > 0
      if (ok) {
        results.push({ prices, src: s })
      }
    }

    if (results.length === 0) {
      // 일봉 데이터가 모두 없으면 분봉으로 보충 시도
      if (interval === '1d') {
        try {
          const intraDayPrices = await fetchNaverIntraday(ticker, '30m', from)
          const dailyFromIntraday = convertIntraDayToDaily(intraDayPrices)
          if (dailyFromIntraday.length > 0) {
            return NextResponse.json({ prices: dailyFromIntraday, interval, src: 5 }) // src=5: intraday fallback
          }
        } catch { /* fallback 실패 */ }
      }
      return NextResponse.json({ prices: [], interval })
    }

    // 가장 최신 날짜까지 있는 소스를 선택
    const best = results.reduce((max, curr) => {
      const currLast = curr.prices[curr.prices.length - 1]?.time
      const maxLast = max.prices[max.prices.length - 1]?.time
      return (currLast ?? '') > (maxLast ?? '') ? curr : max
    })

    // 일봉 데이터가 오늘 날짜를 포함하지 않으면 분봉으로 보충
    if (interval === '1d' && best.prices.length > 0) {
      const lastDailyDate = best.prices[best.prices.length - 1].time.split('T')[0]
      const today = getKSTNow().toISOString().split('T')[0]

      if (lastDailyDate < today) {
        try {
          const intraDayPrices = await fetchNaverIntraday(ticker, '30m', from)
          const dailyFromIntraday = convertIntraDayToDaily(intraDayPrices)

          // 분봉에서 오늘 데이터를 찾으면 추가
          const todayIntraday = dailyFromIntraday.find(p => p.time.split('T')[0] === today)
          if (todayIntraday) {
            best.prices = [...best.prices, todayIntraday]
          }
        } catch { /* 보충 실패해도 계속 진행 */ }
      }
    }

    return NextResponse.json({ prices: best.prices, interval, src: best.src })
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
    if (src === 2) return await fetchDaum(ticker, interval, from, range)
    if (src === 3 && interval === '1d') return await fetchNaver(ticker, from, range)
    if (src === 4 && interval !== '1d') return await fetchNaverIntraday(ticker, interval, from)
    return []
  } catch { return [] }
}
