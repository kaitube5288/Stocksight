import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { isKoreanMarketHoliday } from '@/lib/korean-holidays'
import {
  scrapeNaverTopGainers,
  fetchStockNewsHeadlines,
  analyzeTopGainersWithGemini,
  storeMarketFeedback,
} from '@/lib/market-feedback'

export const maxDuration = 120

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (
    process.env.NODE_ENV === 'production' &&
    cronSecret &&
    authHeader !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstDay = kstDate.getDay()
  if (kstDay === 0 || kstDay === 6) {
    return NextResponse.json({ skipped: true, reason: '주말 휴장' })
  }
  const todayKST = getKSTDate()
  if (isKoreanMarketHoliday(todayKST)) {
    return NextResponse.json({ skipped: true, reason: `공휴일 휴장 (${todayKST})` })
  }

  return runMarketCloseAnalysis()
}

export async function POST() {
  return runMarketCloseAnalysis()
}

async function runMarketCloseAnalysis() {
  const supabaseAdmin = getSupabaseAdmin()
  const todayKST = getKSTDate()

  try {
    // 1. 당일 상위 급등 종목 수집
    const gainers = await scrapeNaverTopGainers(15)
    if (gainers.length === 0) {
      return NextResponse.json({ skipped: true, reason: '급등 종목 수집 실패 (장 마감 전이거나 네이버 응답 없음)' })
    }

    // 2. 각 종목 뉴스 병렬 수집
    const newsEntries = await Promise.all(
      gainers.map(g => fetchStockNewsHeadlines(g.ticker, g.name))
    )
    const newsMap: Record<string, string[]> = {}
    gainers.forEach((g, i) => { newsMap[g.ticker] = newsEntries[i] })

    // 3. Gemini 일괄 분석 — 원인 + 수혜주
    const { analyses, market_theme, missed_themes, tomorrow_hints } =
      await analyzeTopGainersWithGemini(gainers, newsMap)

    // 4. Supabase 저장
    await storeMarketFeedback(todayKST, analyses, { market_theme, missed_themes, tomorrow_hints })

    // 5. historical_patterns에도 당일 급등 종목 기록
    void (async () => {
      try {
        await supabaseAdmin.from('historical_patterns').upsert({
          trade_date: todayKST,
          top_gainers: gainers,
          market_events: analyses.map(a => ({
            ticker: a.ticker,
            name: a.name,
            theme: a.theme,
            beneficiary_tickers: a.beneficiary_tickers,
          })),
          news_summary: market_theme,
        }, { onConflict: 'trade_date' })
      } catch { /* ignore */ }
    })()

    return NextResponse.json({
      success: true,
      date: todayKST,
      gainers_count: gainers.length,
      market_theme,
      missed_themes,
      tomorrow_hints,
      top5: gainers.slice(0, 5).map(g => `${g.name} +${g.change_pct.toFixed(1)}%`),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('Market-close cron 오류:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
