import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { isKoreanMarketHoliday } from '@/lib/korean-holidays'
import {
  scrapeNaverTopGainers,
  fetchStockNewsHeadlines,
  analyzeTopGainersWithGemini,
  storeMarketFeedback,
} from '@/lib/market-feedback'
import { checkMDDAndAlert } from '@/lib/mdd-monitor'

async function runMarketCloseAnalysis(): Promise<void> {
  // 주말 체크
  const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstDay = kstDate.getDay()
  if (kstDay === 0 || kstDay === 6) {
    console.log('[SKIP] 주말 휴장')
    return
  }

  // 공휴일 체크
  const todayKST = getKSTDate()
  if (isKoreanMarketHoliday(todayKST)) {
    console.log(`[SKIP] 공휴일 휴장 (${todayKST})`)
    return
  }

  const supabaseAdmin = getSupabaseAdmin()

  // 1. 당일 상위 급등 종목 수집
  const gainers = await scrapeNaverTopGainers(15)
  if (gainers.length === 0) {
    console.log('[SKIP] 급등 종목 수집 실패 (장 마감 전이거나 네이버 응답 없음)')
    return
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

  // 6. 옵션 13: MDD (최대낙폭) 모니터링 — 계좌 낙폭 5% 초과 시 텔레그램 알림
  const mddResult = await checkMDDAndAlert()

  console.log(JSON.stringify({
    success: true,
    date: todayKST,
    gainers_count: gainers.length,
    market_theme,
    missed_themes,
    tomorrow_hints,
    top5: gainers.slice(0, 5).map(g => `${g.name} +${g.change_pct.toFixed(1)}%`),
    mdd: mddResult.checked ? {
      drawdown_pct: mddResult.drawdown_pct.toFixed(2),
      alerted: mddResult.alerted,
      level: mddResult.level,
    } : null,
  }))
}

;(async () => {
  try {
    await runMarketCloseAnalysis()
    process.exit(0)
  } catch (err) {
    console.error('[치명 오류]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
})()
