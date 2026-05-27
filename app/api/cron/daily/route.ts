import { NextResponse } from 'next/server'
import { generateRecommendations } from '@/lib/gemini'
import { getTodayDisclosures, formatDisclosuresForPrompt } from '@/lib/dart'
import { getMarketIndex, getUSDKRW, getGoldPrice, getSimilarHistoricalPatterns, formatMarketContext, getRealPrices, getFundamentalsMap, fetchTechnicalIndicators, fetchSectorTechnicals, StockFundamentals, TechnicalIndicators } from '@/lib/stock-data'
import { sendTelegramAlert } from '@/lib/telegram'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate, getKSTDateLocale } from '@/lib/date'
import { MAJOR_STOCKS } from '@/lib/major-stocks'
import { isKoreanMarketHoliday } from '@/lib/korean-holidays'
import { buildPerformanceInsights } from '@/lib/performance-analysis'
import { fetchAndAnalyzeNews, formatAnalyzedNewsForPrompt, extractSectorsFromNews } from '@/lib/news'
import { buildMarketFeedbackInsights } from '@/lib/market-feedback'
import { runStrategyImprovementIfNeeded, buildStrategyImprovementContext } from '@/lib/strategy-improvement'

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

  // 토/일 + 한국 공휴일 KST 기준 스킵
  const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstDay = kstDate.getDay() // 0=일, 6=토
  if (kstDay === 0 || kstDay === 6) {
    return NextResponse.json({ skipped: true, reason: '주말 휴장' })
  }
  const todayKST = getKSTDate()
  if (isKoreanMarketHoliday(todayKST)) {
    return NextResponse.json({ skipped: true, reason: `공휴일 휴장 (${todayKST})` })
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
    const todayDate = getKSTDate()
    const today = getKSTDateLocale({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

    // 1. 뉴스 직접 수집 + 임팩트 분석 (08:00 KST 실시간)
    //    기존 news_cache DB 읽기(09:00 크론 의존) 방식을 대체 — 뉴스가 분석 전에 반드시 수집됨을 보장
    const { news: freshNews, analyzed: analyzedNews } = await fetchAndAnalyzeNews()
    const newsText = formatAnalyzedNewsForPrompt(analyzedNews)

    // 수집한 뉴스를 news_cache에 저장 (이력 보관 — 실패해도 분석 계속)
    if (freshNews.length > 0) {
      void (async () => {
        try {
          await supabaseAdmin.from('news_cache').insert({ news: freshNews, fetched_at: new Date().toISOString() })
        } catch { /* ignore */ }
      })()
    }

    // 2. DART 공시 + 시장 지표 + 환율/금시세 병렬 수집
    const [disclosures, { kospi, kosdaq }, usdkrw, goldPrice] = await Promise.all([
      getTodayDisclosures(),
      getMarketIndex(),
      getUSDKRW(),
      getGoldPrice(),
    ])

    const dartText = formatDisclosuresForPrompt(disclosures)
    const marketText = formatMarketContext({ kospi, kosdaq, usdkrw })

    // 3. 섹터 키워드 추출 (분석된 뉴스 임팩트 가중치 기반: high 3점, medium 1점)
    //    과거 유사 패턴 + 섹터 기술적 지표 + 후보 종목 실제 데이터 + 성과 피드백 병렬 조회
    const keywords = extractSectorsFromNews(analyzedNews)
    const candidatePool = buildCandidatePool(keywords)
    const candidateTickers = candidatePool.map(c => c.ticker)

    // 누적 수익률 미달 섹션 자기진단 + 이전 개선 방향 읽기를 병렬 실행
    // runStrategyImprovementIfNeeded: 오늘 분석 결과 저장 (다음 회차 반영)
    // buildStrategyImprovementContext: 이전 회차 결과 읽기 (오늘 즉시 반영)
    const [historicalPatterns, technicalContext, candidateFundamentals, candidateTechRaw, performanceInsights, marketFeedbackInsights, strategyImprovements] = await Promise.all([
      getSimilarHistoricalPatterns(keywords),
      fetchSectorTechnicals(keywords),
      getFundamentalsMap(candidateTickers),
      Promise.all(candidateTickers.map(t => fetchTechnicalIndicators(t))),
      buildPerformanceInsights(),
      buildMarketFeedbackInsights(),
      buildStrategyImprovementContext(),  // 이전 회차 자기진단 결과 읽기
    ])

    const candidateTechMap = Object.fromEntries(candidateTickers.map((t, i) => [t, candidateTechRaw[i]]))
    const candidatesContext = formatCandidatesContext(candidatePool, candidateFundamentals, candidateTechMap)

    // 4. Gemini 분석 (뉴스 임팩트 티어 + 패턴 + 기술지표 + 후보종목 + 과거성과 피드백)
    const result = await generateRecommendations({
      todayNews: newsText,
      dartDisclosures: dartText,
      historicalPatterns,
      marketContext: marketText,
      date: today,
      technicalContext: technicalContext || undefined,
      candidatesContext: candidatesContext || undefined,
      performanceInsights: performanceInsights || undefined,
      marketFeedbackInsights: marketFeedbackInsights || undefined,
      strategyImprovements: strategyImprovements || undefined,
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

    // B: 기술적 지표 필터링 — RSI 극과매수(>85) 또는 MACD 데드크로스 종목 제거
    // 불장에서 주도주는 RSI 75~85 구간을 유지하므로 상한을 85로 완화
    result.recommendations = result.recommendations.filter(r => {
      const tech = techMap[r.ticker]
      if (!tech) return true
      if (tech.rsi14 !== null && tech.rsi14 > 85) {
        console.log(`[필터-RSI] ${r.name}(${r.ticker}) RSI ${tech.rsi14} 극과매수 제거`)
        return false
      }
      if (tech.macdSignal === 'sell') {
        console.log(`[필터-MACD] ${r.name}(${r.ticker}) MACD 데드크로스 제거`)
        return false
      }
      return true
    })

    // 확률 상한 95% 캡핑
    result.recommendations = result.recommendations.map(r => ({
      ...r,
      probability: Math.min(r.probability, 95),
    }))

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

    // 9. 누적 수익률 미달 섹션 자기진단 — 메인 작업 완료 후 실행 (다음 cron 회차에 반영)
    const improvedSections = await runStrategyImprovementIfNeeded()

    return NextResponse.json({
      success: true,
      date: todayDate,
      newsCount: freshNews.length,
      newsHigh: analyzedNews.filter(n => n.impact === 'high').length,
      newsMedium: analyzedNews.filter(n => n.impact === 'medium').length,
      detectedSectors: keywords.slice(0, 8),
      telegramSent: !!process.env.TELEGRAM_BOT_TOKEN,
      strategyImproved: improvedSections,
      data,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('Daily cron 오류:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// 후보 종목 풀 선정 — 뉴스 관련 섹터 + 방어주
const KEYWORD_SECTOR_FOR_CANDIDATE: Record<string, string[]> = {
  '반도체': ['반도체'], 'AI': ['반도체', '로봇', 'IT'], '2차전지': ['2차전지'],
  '바이오': ['바이오', '제약'], '자동차': ['자동차'], '철강': ['철강'],
  '화학': ['화학'], '금융': ['금융', '보험'], '부동산': ['건설'],
  '원자력': ['원자력'], '방산': ['방산'], '인터넷': ['IT'], '게임': ['게임'],
  '조선': ['조선'], '로봇': ['로봇'],
  '전선': ['전선'], '전력기기': ['전력기기'], '레이저': ['레이저'], '수소': ['수소'],
  '반도체소재': ['반도체소재'], '전자부품': ['전자부품'], '전장': ['전장'],
}

function buildCandidatePool(keywords: string[]): { ticker: string; name: string; sector: string }[] {
  const relatedSectors = new Set<string>()
  keywords.forEach(kw => { ;(KEYWORD_SECTOR_FOR_CANDIDATE[kw] ?? []).forEach(s => relatedSectors.add(s)) })

  const related = MAJOR_STOCKS.filter(s => relatedSectors.has(s.sector))
  const defensive = MAJOR_STOCKS.filter(s =>
    ['금융', '보험', '통신', '제약', '유통'].includes(s.sector) &&
    !related.find(r => r.ticker === s.ticker)
  )
  return [...related, ...defensive].slice(0, 22)
}

function formatCandidatesContext(
  candidates: { ticker: string; name: string; sector: string }[],
  fundamentals: Record<string, StockFundamentals>,
  techMap: Record<string, TechnicalIndicators>
): string {
  const lines = ['[추천 가능 후보 종목 실제 데이터 — 이 목록 우선 활용, 외부 종목은 명확한 근거 필요]']
  for (const c of candidates) {
    const f = fundamentals[c.ticker]
    const t = techMap[c.ticker]
    const parts: string[] = [`• ${c.name}(${c.ticker}) [${c.sector}]`]
    if (f?.per != null)  parts.push(`PER ${f.per}`)
    if (f?.pbr != null)  parts.push(`PBR ${f.pbr}`)
    if (f?.roe != null)  parts.push(`ROE ${f.roe}%`)
    if (t?.rsi14 != null) parts.push(`RSI ${t.rsi14}`)
    if (t?.macdSignal)   parts.push(t.macdSignal === 'buy' ? 'MACD↑' : t.macdSignal === 'sell' ? 'MACD↓' : 'MACD-')
    if (t?.trend)        parts.push(t.trend === 'up' ? '추세↑' : t.trend === 'down' ? '추세↓' : '추세-')
    if (t?.volumeSurge != null && t.volumeSurge >= 1.5) parts.push(`거래량${t.volumeSurge.toFixed(1)}x`)
    if (t?.bollingerSignal === 'buy')  parts.push('BB하단근접')
    if (t?.bollingerSignal === 'sell') parts.push('BB상단근접')
    if (t?.supportLevel != null)    parts.push(`지지${t.supportLevel.toLocaleString()}`)
    if (t?.resistanceLevel != null) parts.push(`저항${t.resistanceLevel.toLocaleString()}`)
    if (t?.candlePattern) {
      const cpLabel: Record<string, string> = {
        hammer: '망치형', shooting_star: '유성형', doji: '도지',
        bullish_engulfing: '강세장악형', bearish_engulfing: '약세장악형',
      }
      parts.push(cpLabel[t.candlePattern] ?? t.candlePattern)
    }
    if (t?.foreignNet != null) parts.push(`외국인${t.foreignNet > 0 ? '+' : ''}${Math.round(t.foreignNet / 1000)}K주`)
    if (t?.institutionNet != null) parts.push(`기관${t.institutionNet > 0 ? '+' : ''}${Math.round(t.institutionNet / 1000)}K주`)
    lines.push(parts.join(' | '))
  }
  return lines.join('\n')
}
