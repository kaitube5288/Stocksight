import { NextRequest, NextResponse } from 'next/server'
import { fetchYahoo, fetchDaum, fetchNaver } from '@/lib/price-providers'

export const dynamic = 'force-dynamic'

interface SourceResult {
  count?: number
  ms: number
  first?: unknown
  last?: unknown
  error?: string
}

export async function GET(request: NextRequest) {
  const ticker   = request.nextUrl.searchParams.get('ticker')   ?? '005930'
  const interval = request.nextUrl.searchParams.get('interval') ?? '5m'
  const range    = interval === '1d' ? '35d' : interval === '30m' ? '5d' : '2d'

  const results: Record<string, SourceResult> = {}

  const tests: { name: string; fn: () => Promise<{ time: string; close: number }[]> }[] = [
    { name: 'yahoo-query1', fn: () => fetchYahoo(ticker, interval, range, null, 'query1') },
    { name: 'yahoo-query2', fn: () => fetchYahoo(ticker, interval, range, null, 'query2') },
    { name: 'daum',         fn: () => fetchDaum(ticker, interval, null) },
  ]
  if (interval === '1d') {
    tests.push({ name: 'naver', fn: () => fetchNaver(ticker, null) })
  }

  for (const t of tests) {
    const start = Date.now()
    try {
      const prices = await t.fn()
      results[t.name] = {
        count: prices.length,
        ms:    Date.now() - start,
        first: prices[0]  ?? null,
        last:  prices[prices.length - 1] ?? null,
      }
    } catch (e) {
      results[t.name] = { error: String(e), ms: Date.now() - start }
    }
  }

  return NextResponse.json({ ticker, interval, range, results })
}
