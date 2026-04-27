import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { getKoreanStockFundamentals } from '@/lib/stock-data'
import axios from 'axios'

const HTML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
}
const NAVER_API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Referer': 'https://m.stock.naver.com/',
  'Accept': 'application/json, text/plain, */*',
}

export async function GET(request: Request) {
  const todayDate = getKSTDate()
  const { searchParams } = new URL(request.url)
  const testTicker = searchParams.get('ticker')

  if (testTicker) {
    const code = testTicker.includes('.') ? testTicker.split('.')[0] : testTicker
    const fund = await getKoreanStockFundamentals(testTicker)

    // Naver API 원본 응답 확인
    let naverApiRaw: unknown = null
    try {
      const r = await axios.get(`https://m.stock.naver.com/api/stock/${code}/basic`, { headers: NAVER_API_HEADERS, timeout: 8000 })
      naverApiRaw = r.data
    } catch (e) { naverApiRaw = { error: String(e) } }

    // invest 페이지 HTML 스니펫 확인 (>PBR< 전후 300자)
    let investHtmlSnippet: string | null = null
    try {
      const r = await axios.get(`https://finance.naver.com/item/coinfo.naver?code=${code}&target=invest`, { headers: HTML_HEADERS, timeout: 10000, responseType: 'text' })
      const html: string = r.data
      const idx = html.indexOf('>PBR<')
      investHtmlSnippet = idx !== -1
        ? html.slice(Math.max(0, idx - 20), idx + 300)
        : `>PBR< NOT FOUND. First 500 chars: ${html.slice(0, 500)}`
    } catch (e) { investHtmlSnippet = String(e) }

    return NextResponse.json({ ticker: testTicker, fundamentals: fund, naverApiRaw, investHtmlSnippet })
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
