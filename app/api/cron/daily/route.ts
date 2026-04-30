import { NextResponse } from 'next/server'
import { generateRecommendations } from '@/lib/gemini'
import { getTodayDisclosures, formatDisclosuresForPrompt } from '@/lib/dart'
import { getMarketIndex, getUSDKRW, getGoldPrice, getSimilarHistoricalPatterns, formatMarketContext, getRealPrices, getFundamentalsMap, fetchTechnicalIndicators, fetchSectorTechnicals } from '@/lib/stock-data'
import { sendTelegramAlert } from '@/lib/telegram'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate, getKSTDateLocale } from '@/lib/date'

export const maxDuration = 300

// Vercel Cron 또는 수동 호출 (GET)
export async function GET(request: Request) {
  // Vercel Cron 보안 헤더 검증
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (
    process.env.NODE_ENV === 'production' &&
    cronSecret &&
    authHeader !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 토/일 KST 기준 스킵
  const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstDay = kstDate.getDay() // 0=일, 6=토
  if (kstDay === 0 || kstDay === 6) {
    return NextResponse.json({ skipped: true, reason: '주말 휴장' })
  }

  return runDailyAnalysis()
}

// Admin 페이지에서 수동 트리거 (POST)
export async function POST() {
  return runDailyAnalysis()
}

async function runDailyAnalysis() {
  const supabaseAdmin = getSupabaseAdmin()

  try {
    const now = new Date()
    const todayDate = getKSTDate()
    const today = getKSTDateLocale({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

    // 1. 전날 09:00 ~ 당일 08:40 뉴스 읽기
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - 1)
    cutoff.setHours(0, 0, 0, 0) // 전날 09:00 KST = 00:00 UTC (Vercel 서버는 UTC)

    const { data: newsCacheRows } = await supabaseAdmin
      .from('news_cache')
      .select('news, fetched_at')
      .gte('fetched_at', cutoff.toISOString())
      .order('fetched_at', { ascending: true })

    const allNews = (newsCacheRows ?? []).flatMap(row =>
      Array.isArray(row.news) ? row.news : []
    )

    // 중복 제거
    const seen = new Set<string>()
    const uniqueNews = allNews.filter(n => {
      if (seen.has(n.title)) return false
      seen.add(n.title)
      return true
    })

    const newsText = uniqueNews.length
      ? uniqueNews.slice(0, 30).map(n => `- [${n.source}] ${n.title} (${n.pubDate})`).join('\n')
      : '수집된 뉴스 없음'

    // 2. DART 공시 + 시장 지표 + 환율/금시세 병렬 수집
    const [disclosures, { kospi, kosdaq }, usdkrw, goldPrice] = await Promise.all([
      getTodayDisclosures(),
      getMarketIndex(),
      getUSDKRW(),
      getGoldPrice(),
    ])

    const dartText = formatDisclosuresForPrompt(disclosures)
    const marketText = formatMarketContext({ kospi, kosdaq, usdkrw })

    // 3. 과거 유사 패턴 + 섹터 기술적 지표 병렬 조회
    const keywords = extractKeywords(newsText)
    const [historicalPatterns, technicalContext] = await Promise.all([
      getSimilarHistoricalPatterns(keywords),
      fetchSectorTechnicals(keywords),
    ])

    // 4. Gemini 분석 (뉴스 + 패턴 + 실시간 기술적 지표 주입)
    const result = await generateRecommendations({
      todayNews: newsText,
      dartDisclosures: dartText,
      historicalPatterns,
      marketContext: marketText,
      date: today,
      technicalContext: technicalContext || undefined,
    })

    // 4-1. trade_type 강제 할당 (순서 기반: 0~2=단타, 3~5=스윙, 6~8=중기)
    const TRADE_TYPES = ['단타', '스윙', '중기'] as const
    const HOLD_PERIODS: Record<string, string> = { '단타': '1일 목표', '스윙': '3~5일 목표', '중기': '2~4주 목표' }
    result.recommendations = result.recommendations.map((r, i) => {
      const trade_type = TRADE_TYPES[Math.floor(i / 3) % 3]
      return { ...r, trade_type, hold_period: HOLD_PERIODS[trade_type] }
    })

    // 4-2. 현재가 + 펀더멘털 + 기술적 지표 병렬 조회
    const tickers = result.recommendations.map(r => r.ticker)
    const [realPrices, fundamentals, technicals] = await Promise.all([
      getRealPrices(tickers),
      getFundamentalsMap(tickers),
      Promise.all(tickers.map(t => fetchTechnicalIndicators(t))),
    ])
    const techMap = Object.fromEntries(tickers.map((t, i) => [t, technicals[i]]))

    // 거래중단/상폐 종목 제거
    result.recommendations = result.recommendations.filter(r => !!realPrices[r.ticker])

    result.recommendations = result.recommendations.map(r => {
      const real = realPrices[r.ticker]
      const fund = fundamentals[r.ticker]
      const tech = techMap[r.ticker]
      const buyPrice = real
        ? (real.price > 0 ? real.price : real.previousClose)
        : r.buy_price
      const sellPrice = real
        ? Math.round(buyPrice * (1 + r.expected_return / 100))
        : r.sell_price
      return {
        ...r,
        current_price: real?.price ?? buyPrice,
        buy_price: buyPrice,
        sell_price: sellPrice,
        per: fund?.per ?? null,
        pbr: fund?.pbr ?? null,
        roe: fund?.roe ?? null,
        market: fund?.market ?? null,
        rsi14: tech?.rsi14 ?? null,
        macd_signal: tech?.macdSignal ?? null,
        trend: tech?.trend ?? null,
      }
    })

    // 5. Supabase 저장
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

    // 6. 텔레그램 알림
    await sendTelegramAlert({
      stocks: result.recommendations,
      marketOutlook: result.market_outlook,
      date: todayDate,
      usdkrw,
      goldPrice,
    })

    // 7. 분석 성공 시각 sentinel 갱신 (수집+분석 모두 성공했을 때만)
    await supabaseAdmin
      .from('market_events')
      .upsert({
        event_date: '1900-01-01',
        event_type: 'geopolitical',
        description: '__2026_collection__',
        affected_sectors: [new Date().toISOString()],
        affected_tickers: [],
        impact_direction: 'positive',
        impact_magnitude: 0,
        source: 'system',
      }, { onConflict: 'event_date,description' })

    // 8. 오래된 뉴스 캐시 정리 (7일 초과)
    const cleanupDate = new Date()
    cleanupDate.setDate(cleanupDate.getDate() - 7)
    await supabaseAdmin
      .from('news_cache')
      .delete()
      .lt('fetched_at', cleanupDate.toISOString())

    return NextResponse.json({
      success: true,
      date: todayDate,
      newsCount: uniqueNews.length,
      telegramSent: !!process.env.TELEGRAM_BOT_TOKEN,
      data,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('Daily cron 오류:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function extractKeywords(text: string): string[] {
  const keywords = ['반도체', 'AI', '2차전지', '바이오', '자동차', '철강', '화학', '금융', '부동산', '원자력', '방산', '인터넷', '게임', '조선', '로봇']
  return keywords.filter(k => text.includes(k))
}
