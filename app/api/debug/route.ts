import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { getKoreanStockFundamentals } from '@/lib/stock-data'

export async function GET(request: Request) {
  const todayDate = getKSTDate()
  const { searchParams } = new URL(request.url)
  const testTicker = searchParams.get('ticker')

  // 펀더멘털 직접 테스트
  if (testTicker) {
    const fund = await getKoreanStockFundamentals(testTicker)
    return NextResponse.json({ ticker: testTicker, fundamentals: fund })
  }

  const { data, error } = await supabaseAdmin
    .from('recommendations')
    .select('*')
    .eq('date', todayDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return NextResponse.json({
    date: todayDate,
    error: error?.message ?? null,
    hasData: !!data,
    stocksCount: data?.stocks?.length ?? 0,
    stocksSample: data?.stocks?.slice(0, 3).map((s: Record<string, unknown>) => ({
      name: s.name, ticker: s.ticker, trade_type: s.trade_type,
      per: s.per, pbr: s.pbr, roe: s.roe, market: s.market,
    })) ?? [],
  })
}
