import { NextResponse } from 'next/server'
import { MAJOR_STOCKS } from '@/lib/major-stocks'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json([])

  const lower = q.toLowerCase()

  // 종목코드 prefix 매칭 우선, 이후 종목명 포함 매칭
  const results = MAJOR_STOCKS
    .filter(s =>
      s.ticker.startsWith(q) ||
      s.name.toLowerCase().includes(lower)
    )
    .sort((a, b) => {
      const aCode = a.ticker.startsWith(q) ? 0 : 1
      const bCode = b.ticker.startsWith(q) ? 0 : 1
      if (aCode !== bCode) return aCode - bCode
      // 이름 앞자리 매칭 우선
      const aFront = a.name.toLowerCase().startsWith(lower) ? 0 : 1
      const bFront = b.name.toLowerCase().startsWith(lower) ? 0 : 1
      return aFront - bFront
    })
    .slice(0, 8)
    .map(s => ({ ticker: s.ticker, name: s.name, sector: s.sector }))

  return NextResponse.json(results)
}
