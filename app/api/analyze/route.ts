import { NextResponse } from 'next/server'
import { generateRecommendations } from '@/lib/gemini'
import { getTodayDisclosures, formatDisclosuresForPrompt } from '@/lib/dart'
import { fetchOvernightNews, formatNewsForPrompt } from '@/lib/news'
import { getMarketIndex, getUSDKRW, getSimilarHistoricalPatterns, formatMarketContext, getRealPrices } from '@/lib/stock-data'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  try {
    const todayDate = new Date().toISOString().slice(0, 10)

    // 오늘 분석이 이미 있으면 재사용 (Gemini 재호출 없이 동일 결과 반환)
    const { data: existing } = await supabaseAdmin
      .from('recommendations')
      .select('*')
      .eq('date', todayDate)
      .single()

    const hasValidStocks = Array.isArray(existing?.stocks) &&
      existing.stocks.length > 0 &&
      existing.stocks.some((s: Record<string, unknown>) => s.trade_type)
    if (hasValidStocks) {
      return NextResponse.json({ success: true, data: existing, cached: true })
    }

    const today = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    })

    // 병렬로 데이터 수집
    const [news, disclosures, { kospi, kosdaq }, usdkrw] = await Promise.all([
      fetchOvernightNews(),
      getTodayDisclosures(),
      getMarketIndex(),
      getUSDKRW(),
    ])

    const newsText = formatNewsForPrompt(news)
    const dartText = formatDisclosuresForPrompt(disclosures)
    const marketText = formatMarketContext({ kospi, kosdaq, usdkrw })

    // 뉴스 키워드 추출하여 유사 패턴 검색
    const keywords = extractKeywords(newsText)
    const historicalPatterns = await getSimilarHistoricalPatterns(keywords)

    // Gemini로 추천 생성
    const result = await generateRecommendations({
      todayNews: newsText,
      dartDisclosures: dartText,
      historicalPatterns,
      marketContext: marketText,
      date: today,
    })

    // trade_type 정규화 (Gemini가 다른 문자열 반환할 경우 대비)
    const TRADE_TYPES = ['단타', '스윙', '중기'] as const
    const HOLD_PERIODS: Record<string, string> = { '단타': '1일 목표', '스윙': '3~5일 목표', '중기': '2~4주 목표' }
    result.recommendations = result.recommendations.map((r, i) => {
      let trade_type = r.trade_type
      if (!TRADE_TYPES.includes(trade_type as typeof TRADE_TYPES[number])) {
        trade_type = TRADE_TYPES[Math.floor(i / 3) % 3]
      }
      return { ...r, trade_type, hold_period: HOLD_PERIODS[trade_type] }
    })

    // 실제 현재가로 매수가/목표가 보정
    const tickers = result.recommendations.map(r => r.ticker)
    const realPrices = await getRealPrices(tickers)
    result.recommendations = result.recommendations.map(r => {
      const real = realPrices[r.ticker]
      if (!real) return r
      const buyPrice = real.previousClose > 0 ? real.previousClose : real.price
      const sellPrice = Math.round(buyPrice * (1 + r.expected_return / 100))
      return { ...r, buy_price: buyPrice, sell_price: sellPrice }
    })

    // Supabase에 저장
    await supabaseAdmin.from('recommendations').delete().eq('date', todayDate)

    const { data, error } = await supabaseAdmin
      .from('recommendations')
      .insert({
        date: todayDate,
        stocks: result.recommendations,
        market_outlook: result.market_outlook,
        risk_factors: result.risk_factors,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('분석 오류:', error)
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : JSON.stringify(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

function extractKeywords(text: string): string[] {
  const keywords = ['반도체', 'AI', '2차전지', '바이오', '자동차', '철강', '화학', '금융', '부동산', '원자력', '방산', '인터넷', '게임']
  return keywords.filter(k => text.includes(k))
}
