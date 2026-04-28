import { NextResponse } from 'next/server'
import { fetchNaverData } from '@/lib/stock-data'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tickers = (searchParams.get('tickers') || '').split(',').filter(Boolean)
  if (!tickers.length) return NextResponse.json([])

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      const code = ticker.split('.')[0]
      const data = await fetchNaverData(code)
      return { ticker, price: data.price || null, per: data.per, pbr: data.pbr, roe: data.roe }
    })
  )
  return NextResponse.json(results)
}
