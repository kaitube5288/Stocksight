import { NextResponse } from 'next/server'
import { generateRecommendations } from '@/lib/gemini'
import { getTodayDisclosures, formatDisclosuresForPrompt } from '@/lib/dart'
import { fetchOvernightNews, formatNewsForPrompt } from '@/lib/news'
import { getMarketIndex, getUSDKRW, getSimilarHistoricalPatterns, formatMarketContext } from '@/lib/stock-data'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  try {
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

    // Supabase에 저장 (오늘 날짜 기존 데이터 삭제 후 새로 삽입)
    const todayDate = new Date().toISOString().slice(0, 10)
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
