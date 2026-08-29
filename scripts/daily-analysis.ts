import { generateRecommendations, analyzeEventBeneficiaries, generatePortfolioAdvice, suggestKeywordsFromNews } from '@/lib/gemini'
import { getTodayDisclosures, formatDisclosuresForPrompt } from '@/lib/dart'
import { getMarketIndex, getUSDKRW, getGoldPrice, getSimilarHistoricalPatterns, formatMarketContext, getRealPrices, getFundamentalsMap, fetchTechnicalIndicators, fetchSectorTechnicals, fetchVolumeTopStocks, fetchInterestRates, formatInterestRatesForPrompt, fetchKospiMA20, fetchNaverData, fetchOverseasMarketSignals, StockFundamentals, TechnicalIndicators } from '@/lib/stock-data'
import { sendTelegramAlert, sendTelegramSimple } from '@/lib/telegram'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate, getKSTDateLocale } from '@/lib/date'
import { MAJOR_STOCKS } from '@/lib/major-stocks'
import { buildPerformanceInsights } from '@/lib/performance-analysis'
import { getNewsFromCacheOrFetch, formatAnalyzedNewsForPrompt, extractSectorsFromNews, setDynamicKeywords } from '@/lib/news'
import { buildMarketFeedbackInsights, getSectorMomentumCandidates } from '@/lib/market-feedback'
import { runStrategyImprovementIfNeeded, buildStrategyImprovementContext } from '@/lib/strategy-improvement'

// 주말 체크 — route.ts GET 핸들러에는 있으나 독립 스크립트에 누락되어 추가
const _kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
if (_kstNow.getDay() === 0 || _kstNow.getDay() === 6) {
  console.log('[스킵] 주말 휴장 — 분석 생략')
  process.exit(0)
}

async function runDailyAnalysis() {
  const supabaseAdmin = getSupabaseAdmin()
  const todayDate = getKSTDate()  // try 밖에 선언 — catch 블록에서도 참조 가능

  try {
    const today = getKSTDateLocale({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

    // 0. 동적 키워드 로드 — keyword_watchlist DB → HIGH_IMPACT·섹터맵·추가쿼리 반영
    const { data: kwRows } = await supabaseAdmin
      .from('keyword_watchlist')
      .select('keyword, sector, is_high_impact, related_tickers')
    const _kwList = (kwRows ?? []) as { keyword: string; sector: string | null; is_high_impact: boolean }[]
    const dynHighImpact = _kwList.filter(k => k.is_high_impact).map(k => k.keyword)
    const dynSectorMap: Record<string, string[]> = {}
    const allKwTexts = _kwList.map(k => k.keyword)
    for (const k of _kwList) {
      if (k.sector) {
        if (!dynSectorMap[k.sector]) dynSectorMap[k.sector] = []
        dynSectorMap[k.sector].push(k.keyword)
      }
    }
    setDynamicKeywords({
      highImpact: dynHighImpact,
      sectorMap: dynSectorMap,
      extraQueries: [
        '중국 반도체 삼성 SK하이닉스',
        '반도체 수출 규제 한국',
        '애플 반도체 공급업체',
        'YMTC CXMT 낸드 DRAM',
      ],
    })
    console.log(`[키워드] 동적 키워드 ${_kwList.length}개 로드 (high:${dynHighImpact.length})`)

    // 1. 뉴스 수집: 07:30 크론이 채운 news_cache DB를 우선 읽고, 없으면 직접 수집 fallback
    const { news: freshNews, analyzed: analyzedNews } = await getNewsFromCacheOrFetch()
    const newsText = formatAnalyzedNewsForPrompt(analyzedNews)

    // 2. DART 공시 + 시장 지표 + 환율/금시세 + 거래량 상위 + 미국 국채 금리 + KOSPI MA20 병렬 수집
    const [disclosures, { kospi, kosdaq }, usdkrw, goldPrice, volumeTopStocks, interestRatesRaw, kospiMA20, overseasSignals] = await Promise.all([
      getTodayDisclosures(),
      getMarketIndex(),
      getUSDKRW(),
      getGoldPrice(),
      fetchVolumeTopStocks(15).catch(() => [] as { ticker: string; name: string }[]),
      fetchInterestRates().catch(() => ({ us10Y: null, us3M: null, yieldSpread: null, isInverted: false })),
      fetchKospiMA20().catch(() => null),
      fetchOverseasMarketSignals().catch(() => ({ sox: { price: null, changePct: null }, nasdaq: { price: null, changePct: null }, nikkei: { price: null, changePct: null }, vix: { price: null } })),
    ])
    const interestRatesText = formatInterestRatesForPrompt(interestRatesRaw)

    // 거래량 지속 추적: 오늘 거래량 상위 → volume_watchlist 저장 (쿼리보다 먼저 완료)
    const kstToday = getKSTDate()
    if (volumeTopStocks.length > 0) {
      const { error: vwErr } = await supabaseAdmin.from('volume_watchlist').upsert(
        volumeTopStocks.map(s => ({ date: kstToday, ticker: s.ticker, name: s.name })),
        { onConflict: 'date,ticker' }
      )
      if (vwErr) console.error('[거래량추적] upsert 오류:', vwErr.message)
    }

    const dartText = formatDisclosuresForPrompt(disclosures)

    // 불장 여부를 Gemini 호출 전에 먼저 판단 (마켓 컨텍스트에 주입)
    const kospiChangePct = (kospi && kospi.previousClose > 0) ? (kospi.price - kospi.previousClose) / kospi.previousClose * 100 : 0
    const kosdaqChangePct = (kosdaq && kosdaq.previousClose > 0) ? (kosdaq.price - kosdaq.previousClose) / kosdaq.previousClose * 100 : 0
    const isBullMarket = kospiChangePct >= 0.5 || kosdaqChangePct >= 0.5
    const isKospiBelowMA20 = kospiMA20 != null && kospiMA20.price < kospiMA20.ma20
    const isShortTermBounce = isBullMarket && isKospiBelowMA20
    const isTrueBullMarket  = isBullMarket && !isKospiBelowMA20
    const bullMarketNote = isTrueBullMarket
      ? `\n[🚀 불장 감지] KOSPI ${kospiChangePct.toFixed(2)}% / KOSDAQ ${kosdaqChangePct.toFixed(2)}% — 강세장 모멘텀 전략 적용: 신고가 돌파 종목 우선, RSI 상한 80까지 예외 허용`
      : isShortTermBounce
      ? `\n[⚡ 단기 반등] KOSPI ${kospiChangePct.toFixed(2)}% 급등이나 MA20 하회 중 — 과매도 반등 전략 적용, 리스크 관리 강화`
      : ''
    const soxStrong    = overseasSignals.sox.changePct    != null && overseasSignals.sox.changePct    >= 1
    const nasdaqStrong = overseasSignals.nasdaq.changePct != null && overseasSignals.nasdaq.changePct >= 1
    const overseasNote = (() => {
      const parts: string[] = []
      if (overseasSignals.sox.changePct    != null) parts.push(`SOX ${overseasSignals.sox.changePct    >= 0 ? '+' : ''}${overseasSignals.sox.changePct.toFixed(2)}%`)
      if (overseasSignals.nasdaq.changePct != null) parts.push(`NASDAQ ${overseasSignals.nasdaq.changePct >= 0 ? '+' : ''}${overseasSignals.nasdaq.changePct.toFixed(2)}%`)
      if (overseasSignals.nikkei.changePct != null) parts.push(`닛케이 ${overseasSignals.nikkei.changePct >= 0 ? '+' : ''}${overseasSignals.nikkei.changePct.toFixed(2)}%`)
      if (parts.length === 0) return ''
      const boostLabel = [soxStrong ? '반도체' : '', nasdaqStrong ? 'IT/AI' : ''].filter(Boolean).join('/')
      const boostNote  = boostLabel ? ` — [📡 해외모멘텀] ${boostLabel} 섹터 국내 연동 반등 기대` : ''
      return `\n[전일 해외시장] ${parts.join(' / ')}${boostNote}`
    })()
    const marketText = formatMarketContext({ kospi, kosdaq, usdkrw }) + bullMarketNote + overseasNote

    // 3. 섹터 키워드 추출 + 후보풀 구성
    const keywords = extractSectorsFromNews(analyzedNews)
    const candidatePool = buildCandidatePool(keywords)

    const poolTickerSet = new Set(candidatePool.map(c => c.ticker))
    const volumeCandidates = volumeTopStocks
      .filter(s => !poolTickerSet.has(s.ticker))
      .slice(0, 10)
      .map(s => ({ ...s, sector: '거래량상위' }))
    const mergedCandidatePool = [...candidatePool, ...volumeCandidates]

    const mergedTickerSetForOverseas = new Set(mergedCandidatePool.map(c => c.ticker))
    const overseasPool: { ticker: string; name: string; sector: string }[] = []
    if (soxStrong || nasdaqStrong) {
      const targetSectors = new Set<string>()
      if (soxStrong)    ['반도체', '반도체소재', '전자부품'].forEach(s => targetSectors.add(s))
      if (nasdaqStrong) ['IT', 'AI', '게임'].forEach(s => targetSectors.add(s))
      MAJOR_STOCKS
        .filter(s => targetSectors.has(s.sector) && !mergedTickerSetForOverseas.has(s.ticker))
        .slice(0, 8)
        .forEach(s => overseasPool.push({ ticker: s.ticker, name: s.name, sector: '해외모멘텀' }))
      if (overseasPool.length > 0)
        console.log(`[해외모멘텀] SOX ${overseasSignals.sox.changePct?.toFixed(2) ?? '-'}% / NASDAQ ${overseasSignals.nasdaq.changePct?.toFixed(2) ?? '-'}% → ${[...targetSectors].join('/')} 후보 ${overseasPool.length}개 추가: ${overseasPool.map(c => c.ticker).join(', ')}`)
    }
    const extendedCandidatePool = [...mergedCandidatePool, ...overseasPool]
    const candidateTickers = extendedCandidatePool.map(c => c.ticker)

    const mergedTickerSet = new Set(candidateTickers)
    const techScanTickers = MAJOR_STOCKS
      .filter(s => !mergedTickerSet.has(s.ticker))
      .slice(0, 20)
      .map(s => s.ticker)

    const highImpactNewsText = analyzedNews
      .filter(n => n.impact === 'high')
      .slice(0, 6)
      .map(n => `• ${n.title}`)
      .join('\n')

    const [historicalPatterns, technicalContext, candidateFundamentals, candidateTechRaw, performanceInsights, marketFeedbackInsights, strategyImprovements, eventBeneficiary, sectorMomentumCandidates, volumeRecurringRaw, volumeFrequentRaw] = await Promise.all([
      getSimilarHistoricalPatterns(keywords),
      fetchSectorTechnicals(keywords),
      getFundamentalsMap(candidateTickers),
      Promise.all(candidateTickers.map(t => fetchTechnicalIndicators(t))),
      buildPerformanceInsights(),
      buildMarketFeedbackInsights(),
      buildStrategyImprovementContext(),
      highImpactNewsText
        ? analyzeEventBeneficiaries(highImpactNewsText).catch(() => ({ additionalTickers: [], analysisText: '' }))
        : Promise.resolve({ additionalTickers: [], analysisText: '' }),
      getSectorMomentumCandidates(new Set(candidateTickers)),
      (async () => {
        const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
        const dates = [0, 1, 2].map(d => {
          const dd = new Date(kst); dd.setDate(dd.getDate() - d); return dd.toISOString().slice(0, 10)
        })
        const { data } = await supabaseAdmin
          .from('volume_watchlist')
          .select('ticker, name, date')
          .in('date', dates)
        const tickerDates = new Map<string, { name: string; dates: Set<string> }>()
        for (const row of (data ?? [])) {
          if (!tickerDates.has(row.ticker)) tickerDates.set(row.ticker, { name: row.name, dates: new Set() })
          tickerDates.get(row.ticker)!.dates.add(row.date)
        }
        return [...tickerDates.entries()]
          .filter(([, v]) => v.dates.size >= 2)
          .map(([ticker, v]) => ({ ticker, name: v.name }))
      })().catch(() => [] as { ticker: string; name: string }[]),
      (async () => {
        const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
        const dates30 = Array.from({ length: 30 }, (_, d) => {
          const dd = new Date(kst); dd.setDate(dd.getDate() - d); return dd.toISOString().slice(0, 10)
        })
        const { data } = await supabaseAdmin
          .from('volume_watchlist')
          .select('ticker, name, date')
          .in('date', dates30)
        const majorTickerSet = new Set(MAJOR_STOCKS.map(s => s.ticker))
        const tickerCount = new Map<string, { name: string; count: number }>()
        for (const row of (data ?? [])) {
          if (!tickerCount.has(row.ticker)) tickerCount.set(row.ticker, { name: row.name, count: 0 })
          tickerCount.get(row.ticker)!.count++
        }
        return [...tickerCount.entries()]
          .filter(([ticker, v]) => v.count >= 5 && !majorTickerSet.has(ticker))
          .map(([ticker, v]) => ({ ticker, name: v.name }))
      })().catch(() => [] as { ticker: string; name: string }[]),
    ])

    const existingTickerSet = new Set(candidateTickers)
    const extraTickers = eventBeneficiary.additionalTickers
      .filter(t => /^\d{6}$/.test(t.ticker) && !existingTickerSet.has(t.ticker))
      .map(t => t.ticker)

    const extraTickerSet = new Set(extraTickers)
    const sectorOnlyTickers = sectorMomentumCandidates
      .map(c => c.ticker)
      .filter(t => !existingTickerSet.has(t) && !extraTickerSet.has(t))

    const accumulatedSet = new Set([...existingTickerSet, ...extraTickerSet, ...sectorOnlyTickers])
    const volumeRecurringTickers = volumeRecurringRaw
      .map(c => c.ticker)
      .filter(t => !accumulatedSet.has(t))

    const accumulatedSetFull = new Set([...accumulatedSet, ...volumeRecurringTickers])
    const techScanFiltered = techScanTickers.filter(t => !accumulatedSetFull.has(t))

    const allExtraTickers = [...new Set([...extraTickers, ...sectorOnlyTickers, ...volumeRecurringTickers, ...techScanFiltered, ...volumeFrequentRaw.map(c => c.ticker)])]

    const [extraFundamentals, extraTechRaw] = allExtraTickers.length > 0
      ? await Promise.all([
          getFundamentalsMap(allExtraTickers),
          Promise.all(allExtraTickers.map(t => fetchTechnicalIndicators(t))),
        ])
      : [{} as Record<string, StockFundamentals>, [] as TechnicalIndicators[]]

    const extraTechMap = Object.fromEntries(allExtraTickers.map((t, i) => [t, extraTechRaw[i]]))

    const extraCandidatePool = eventBeneficiary.additionalTickers
      .filter(t => !existingTickerSet.has(t.ticker))
      .map(t => ({ ticker: t.ticker, name: t.name, sector: '이벤트수혜' }))

    const extraCandidateTickerSet = new Set(extraCandidatePool.map(c => c.ticker))
    const sectorCandidatePool = sectorMomentumCandidates
      .filter(c => !existingTickerSet.has(c.ticker) && !extraCandidateTickerSet.has(c.ticker))

    const preSectorSet = new Set([...existingTickerSet, ...extraCandidateTickerSet, ...sectorCandidatePool.map(c => c.ticker)])
    const volumeRecurringPool = volumeRecurringRaw
      .filter(c => !preSectorSet.has(c.ticker))
      .map(c => ({ ticker: c.ticker, name: c.name, sector: '거래량지속' }))
    if (volumeRecurringPool.length > 0) {
      console.log(`[거래량지속] 연속 등장 후보 ${volumeRecurringPool.length}개: ${volumeRecurringPool.map(c => c.ticker).join(', ')}`)
    }

    const preFrequentSet = new Set([...preSectorSet, ...volumeRecurringPool.map(c => c.ticker)])
    const volumeFrequentPool = volumeFrequentRaw
      .filter(c => !preFrequentSet.has(c.ticker))
      .map(c => ({ ticker: c.ticker, name: c.name, sector: '신규편입' }))
    if (volumeFrequentPool.length > 0) {
      console.log(`[신규편입] 30일 5회+ 거래량 후보 ${volumeFrequentPool.length}개: ${volumeFrequentPool.map(c => c.ticker).join(', ')}`)
    }

    const majorStockNameMap = Object.fromEntries(MAJOR_STOCKS.map(s => [s.ticker, s.name]))
    const preScreenSet = new Set([...preSectorSet, ...volumeRecurringPool.map(c => c.ticker)])
    const techScreeningPool: { ticker: string; name: string; sector: string }[] = []
    for (const ticker of techScanFiltered) {
      if (preScreenSet.has(ticker)) continue
      const tech = extraTechMap[ticker]
      if (!tech || tech.rsi14 == null) continue
      if (tech.rsi14 < 35 || tech.rsi14 > 55) continue
      if (tech.macdSignal === 'sell') continue
      if (tech.trend === 'down') continue
      if (tech.bollingerSignal === 'sell') continue
      techScreeningPool.push({ ticker, name: majorStockNameMap[ticker] ?? ticker, sector: '기술스크리닝' })
      if (techScreeningPool.length >= 5) break
    }
    if (techScreeningPool.length > 0) {
      console.log(`[기술스크리닝] "충전완료" 패턴 ${techScreeningPool.length}개: ${techScreeningPool.map(c => c.ticker).join(', ')}`)
    }

    const fullCandidatePool = [...extendedCandidatePool, ...extraCandidatePool, ...sectorCandidatePool, ...volumeRecurringPool, ...volumeFrequentPool, ...techScreeningPool]
    const fullCandidateFundamentals = { ...candidateFundamentals, ...extraFundamentals }
    const candidateTechMap = Object.fromEntries(candidateTickers.map((t, i) => [t, candidateTechRaw[i]]))
    const fullCandidateTechMap = { ...candidateTechMap, ...extraTechMap }

    const candidatesContext = formatCandidatesContext(fullCandidatePool, fullCandidateFundamentals, fullCandidateTechMap)

    const bounceCandidates = fullCandidatePool.filter(c => {
      const t = fullCandidateTechMap[c.ticker]
      return t?.prevDayChangePct != null && t.prevDayChangePct <= -7
        && t.rsi14 != null && t.rsi14 <= 35
    })
    const bounceContext = bounceCandidates.length > 0
      ? [
          '## 🔄 단타 반등 최우선 후보 (전일 급락 + 과매도 + 추세 유지)',
          '→ 아래 종목은 전일 -7% 이상 급락했으나 RSI 과매도 + 추세 횡보/상승 유지 중',
          '→ 기술적 반등 가능성 높음 — 단타 추천 시 최우선 검토 필수',
          ...bounceCandidates.map(c => {
            const t = fullCandidateTechMap[c.ticker]
            const trendLabel = t?.trend === 'up' ? '추세↑' : '추세-'
            return `• ${c.name}(${c.ticker}) 전일${t!.prevDayChangePct!.toFixed(1)}% | RSI ${t?.rsi14?.toFixed(0)} | ${trendLabel}`
          }),
        ].join('\n')
      : undefined
    if (bounceCandidates.length > 0) {
      console.log(`[반등후보] ${bounceCandidates.length}개 감지: ${bounceCandidates.map(c => c.ticker).join(', ')}`)
    }

    const kospiMA20Warning = isKospiBelowMA20
      ? isShortTermBounce
        ? `⚠️ KOSPI 20일선 하회 중이나 당일 ${kospiChangePct.toFixed(1)}% 급반등 (단기 반등 국면)\n→ 과매도(RSI≤35) 종목 중 기술적 반등 가능성 있는 종목 단타 1개 이내 허용. 손절 -5% 엄수. 스윙·중기는 여전히 신중하게.`
        : `⚠️ KOSPI 20일선 하회 중 (현재 ${kospiMA20!.price.toFixed(0)} / MA20 ${kospiMA20!.ma20.toFixed(0)})\n→ 시장 전체 하락 구조. 단타·스윙 추천 종목 수를 최소화하고, 방어주·현금보유 비중 확대. 확신도 90% 이상 종목만 추천.`
      : undefined
    if (isKospiBelowMA20) {
      console.log(`[KOSPI-MA20] KOSPI ${kospiMA20!.price.toFixed(0)} < MA20 ${kospiMA20!.ma20.toFixed(0)} — 단타 최대 1종목 제한 적용`)
    }

    const RATE_POLICY_KW = [
      '금리', '기준금리', 'FOMC', '연준', '한국은행', '금통위',
      'Fed', '통화정책', '기재부', '경제정책', '재정정책', '정책발표',
    ]
    const ratePolicyNewsText = analyzedNews
      .filter(n => RATE_POLICY_KW.some(k => n.title.includes(k)))
      .slice(0, 8)
      .map(n => `• [${n.source}] ${n.title}`)
      .join('\n')

    // 4. Gemini 분석
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
      eventBeneficiaryContext: eventBeneficiary.analysisText || undefined,
      interestRates: interestRatesText || undefined,
      ratePolicyNews: ratePolicyNewsText || undefined,
      bounceContext: bounceContext || undefined,
      kospiMA20Warning: kospiMA20Warning || undefined,
      overseasSignalContext: overseasNote || undefined,
    })

    // 4-1. trade_type 강제 할당
    const SLOT_TYPES: ('단타' | '스윙' | '중기')[] = ['단타', '단타', '단타', '스윙', '스윙', '스윙', '중기', '중기', '중기']
    const HOLD_PERIODS: Record<string, string> = { '단타': '1일 목표', '스윙': '3~5일 목표', '중기': '2~4주 목표' }
    result.recommendations = result.recommendations.map((r, i) => {
      const trade_type = SLOT_TYPES[i] ?? '중기'
      return { ...r, trade_type, hold_period: HOLD_PERIODS[trade_type] }
    })

    const sourceTagMap = new Map<string, string>()
    for (const c of volumeRecurringPool)  sourceTagMap.set(c.ticker, '거래량지속')
    for (const c of volumeFrequentPool)   sourceTagMap.set(c.ticker, '신규편입')
    for (const c of techScreeningPool)   sourceTagMap.set(c.ticker, '기술스크리닝')
    for (const c of sectorCandidatePool) sourceTagMap.set(c.ticker, '섹터연동')
    result.recommendations = result.recommendations.map(r => ({
      ...r,
      source_tag: sourceTagMap.get(r.ticker) ?? undefined,
    }))

    // 4-2. 현재가 + 펀더멘털 + 기술적 지표 + 전일 급등 종목 병렬 조회
    const tickers = result.recommendations.map(r => r.ticker)
    const kstYesterday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    kstYesterday.setDate(kstYesterday.getDate() - 1)
    const yesterdayStr = kstYesterday.toISOString().slice(0, 10)
    const [realPrices, fundamentals, technicals, prevDayFeedbackRes] = await Promise.all([
      getRealPrices(tickers),
      getFundamentalsMap(tickers),
      Promise.all(tickers.map(t => fetchTechnicalIndicators(t))),
      supabaseAdmin.from('market_feedback').select('ticker').eq('date', yesterdayStr),
    ])
    const prevDayGainerTickers = new Set((prevDayFeedbackRes.data ?? []).map((f: { ticker: string }) => f.ticker))
    const techMap = Object.fromEntries(tickers.map((t, i) => [t, technicals[i]]))

    result.recommendations = result.recommendations.filter(r => !!realPrices[r.ticker])

    const isVixHigh = overseasSignals.vix?.price != null && overseasSignals.vix.price >= 30
    const isBearMarket = (kospiChangePct <= -0.5 && kosdaqChangePct <= -0.5) || isVixHigh
    if (isVixHigh) console.log(`[VIX] 공포지수 ${overseasSignals.vix!.price!.toFixed(1)} ≥ 30 → 하락장 신호 추가 감지`)
    const rsiMaxByType: Record<string, number> = {
      '단타': isBullMarket ? 65 : 55,
      '스윙': isBullMarket ? 80 : 65,
      '중기': isBullMarket ? 70 : 60,
    }
    console.log(`[불장판단] KOSPI ${kospiChangePct.toFixed(2)}% / KOSDAQ ${kosdaqChangePct.toFixed(2)}% → 단타RSI≤${rsiMaxByType['단타']} / 스윙RSI≤${rsiMaxByType['스윙']} / 중기RSI≤${rsiMaxByType['중기']} (불장: ${isBullMarket} / 하락장: ${isBearMarket})`)

    // B: 기술적 지표 필터링
    result.recommendations = result.recommendations.filter(r => {
      if (r.ticker === '000000') return true
      const tech = techMap[r.ticker]
      if (!tech) return true
      const maxRsi = rsiMaxByType[r.trade_type ?? '단타'] ?? 75
      if (tech.rsi14 !== null && tech.rsi14 > maxRsi) {
        console.log(`[필터-RSI] ${r.name}(${r.ticker}) RSI ${tech.rsi14} 제거 (${r.trade_type} 상한: ${maxRsi})`)
        return false
      }
      if (tech.rsi14 !== null && tech.rsi14 < 28) {
        console.log(`[필터-RSI하한] ${r.name}(${r.ticker}) RSI ${tech.rsi14} 극단 과매도 제거`)
        return false
      }
      const isReversalException =
        isBullMarket &&
        tech.rsi14 != null && tech.rsi14 >= 28 && tech.rsi14 <= 48 &&
        tech.volumeSurge != null && tech.volumeSurge >= 1.5
      if (tech.macdSignal === 'sell' && !isReversalException) {
        console.log(`[필터-MACD] ${r.name}(${r.ticker}) MACD 데드크로스 제거`)
        return false
      }
      if (tech.macdSignal === 'sell' && isReversalException) {
        console.log(`[필터-MACD예외] ${r.name}(${r.ticker}) 불장+회복구간(RSI ${tech.rsi14})+거래량(${tech.volumeSurge?.toFixed(1)}x) → MACD 예외 허용`)
      }
      if (tech.trend === 'down') {
        if (r.trade_type === '스윙') {
          console.log(`[필터-추세] ${r.name}(${r.ticker}) 하락추세 제거 (스윙)`)
          return false
        }
        if (r.trade_type === '단타' && !isReversalException) {
          console.log(`[필터-추세] ${r.name}(${r.ticker}) 하락추세 제거 (단타)`)
          return false
        }
        if (r.trade_type === '단타' && isReversalException) {
          console.log(`[필터-추세예외] ${r.name}(${r.ticker}) 불장+회복구간+거래량 → 하락추세 단타 예외 허용`)
        }
      }
      if (tech.bollingerSignal === 'sell' && (r.trade_type === '단타' || r.trade_type === '스윙')) {
        console.log(`[필터-BB상단] ${r.name}(${r.ticker}) 볼린저 상단 근접 제거 (${r.trade_type})`)
        return false
      }
      if (r.trade_type === '단타' && tech.foreignNet !== null && tech.institutionNet !== null &&
          tech.foreignNet < 0 && tech.institutionNet < 0) {
        console.log(`[필터-수급동반매도] ${r.name}(${r.ticker}) 외국인+기관 동반매도 단타 제거`)
        return false
      }
      return true
    })

    // C: 전일 급등 종목 단타 제외
    if (prevDayGainerTickers.size > 0) {
      result.recommendations = result.recommendations.filter(r => {
        if (r.trade_type === '단타' && prevDayGainerTickers.has(r.ticker)) {
          console.log(`[필터-전일급등] ${r.name}(${r.ticker}) 전일 급등 단타 제외`)
          return false
        }
        return true
      })
    }

    // D: 강력 신호 점수 필터
    function calcSignalScore(tech: TechnicalIndicators): number {
      let score = 0
      if (tech.rsi14 != null && tech.rsi14 >= 20 && tech.rsi14 <= 50) score++
      if (tech.macdSignal === 'buy') score++
      if (tech.bollingerSignal === 'buy') score++
      if (tech.volumeSurge != null && tech.volumeSurge >= 1.5) score++
      if (tech.trend === 'up' || tech.trend === 'sideways') score++
      return score
    }
    result.recommendations = result.recommendations.filter(r => {
      if (r.ticker === '000000') return true
      if (r.trade_type !== '단타') return true
      const tech = techMap[r.ticker]
      if (!tech) return true
      const score = calcSignalScore(tech)
      const minScore = isBullMarket ? 2 : 3
      if (score < minScore) {
        console.log(`[필터-신호점수] ${r.name}(${r.ticker}) 신호강도 ${score}/5 — 단타 기준 미달 (${minScore}점↑ 필요) 제거`)
        return false
      }
      console.log(`[신호강도] ${r.name}(${r.ticker}) ${score}/5 통과`)
      return true
    })

    // E: KOSPI MA20 하회 시 단타 처리
    if (isKospiBelowMA20) {
      const dantas = result.recommendations.filter(r => r.trade_type === '단타' && r.ticker !== '000000')
      if (dantas.length > 0 && !isShortTermBounce) {
        result.recommendations = result.recommendations.filter(r => r.trade_type !== '단타' || r.ticker === '000000')
        if (!result.recommendations.some(r => r.trade_type === '단타' && r.ticker === '000000')) {
          result.recommendations.unshift({
            name: '현금보유', ticker: '000000', buy_price: 0, sell_price: 0, stop_loss: 0,
            expected_return: 0, probability: 0, trade_type: '단타', hold_period: '1일 목표',
            reasoning: 'KOSPI 20일선 하회 — 시장 전체 하락 구조, 현금 보유 권고',
            key_catalyst: 'KOSPI MA20 하회', per: null, pbr: null, roe: null,
          })
        }
        console.log(`[KOSPI-MA20] 순수 하락장: 단타 ${dantas.length}개 → 현금보유로 대체`)
      } else if (isShortTermBounce) {
        console.log(`[KOSPI-MA20] 단기 반등 국면: 단타 유지`)
      }
    }

    // 확률 상한 95% 캡핑
    result.recommendations = result.recommendations.map(r => ({
      ...r,
      probability: Math.min(r.probability, 95),
    }))

    const stopLossPct: Record<string, number> = { '단타': 0.95, '스윙': 0.96, '중기': 0.94 }

    result.recommendations = result.recommendations.map(r => {
      if (r.ticker === '000000') return r
      const real = realPrices[r.ticker]
      const fund = fundamentals[r.ticker]
      const tech = techMap[r.ticker]
      const buyPrice = real
        ? (real.previousClose > 0 ? real.previousClose : real.price)
        : r.buy_price
      const sellPrice = real
        ? Math.round(buyPrice * (1 + r.expected_return / 100))
        : r.sell_price
      const stopLoss = (r.stop_loss && r.stop_loss > 0)
        ? r.stop_loss
        : Math.round(buyPrice * (stopLossPct[r.trade_type] ?? 0.95))
      return {
        ...r,
        current_price: real?.price ?? buyPrice,
        buy_price: buyPrice,
        sell_price: sellPrice,
        stop_loss: stopLoss,
        per: fund?.per ?? null,
        pbr: fund?.pbr ?? null,
        roe: fund?.roe ?? null,
        market: fund?.market ?? null,
        rsi14: tech?.rsi14 ?? null,
        macd_signal: tech?.macdSignal ?? null,
        trend: tech?.trend ?? null,
      }
    })

    // F: probability 기반 확신도 필터
    const probMin = isBullMarket ? 60 : isBearMarket ? 80 : 70
    result.recommendations = result.recommendations.map(r => {
      if (r.ticker === '000000') return r
      if ((r.probability ?? 0) < probMin) {
        console.log(`[필터-확률] ${r.name}(${r.ticker}) probability ${r.probability}% < ${probMin}% → 현금보유`)
        return {
          ...r,
          name: '현금보유', ticker: '000000', buy_price: 0, sell_price: 0, stop_loss: 0,
          expected_return: 0, probability: 0,
          reasoning: `확신도 ${r.probability}% — 진입 기준(${probMin}%) 미달, 현금 보유 권고`,
          key_catalyst: '확신도 미달',
        }
      }
      return r
    })

    // Method D: probability 기반 최종 선택 — 코드가 결정적으로 각 유형별 top N 선택
    {
      const finalRecs: typeof result.recommendations = []
      for (const [type, quota] of [['단타', 1], ['스윙', 2], ['중기', 2]] as [string, number][]) {
        const tradeType = type as '단타' | '스윙' | '중기'
        const typeRecs = result.recommendations
          .filter(r => r.trade_type === tradeType)
          .sort((a, b) => {
            if (a.ticker === '000000' && b.ticker !== '000000') return 1
            if (b.ticker === '000000' && a.ticker !== '000000') return -1
            return (b.probability ?? 0) - (a.probability ?? 0)
          })
          .slice(0, quota)
        finalRecs.push(...typeRecs)
        for (let i = typeRecs.length; i < quota; i++) {
          finalRecs.push({
            name: '현금보유', ticker: '000000', buy_price: 0, sell_price: 0, stop_loss: 0,
            expected_return: 0, probability: 0, trade_type: tradeType,
            hold_period: tradeType === '단타' ? '1일 목표' : tradeType === '스윙' ? '3~5일 목표' : '2~4주 목표',
            reasoning: '유효한 후보 없음 — 현금 보유 권고',
            key_catalyst: '조건 미달', per: null, pbr: null, roe: null,
          })
        }
      }
      result.recommendations = finalRecs
    }

    if (isTrueBullMarket && !result.market_outlook.startsWith('[불장 감지]')) {
      result.market_outlook = `[불장 감지] ${result.market_outlook}`
    } else if (isShortTermBounce && !result.market_outlook.startsWith('[단기 반등]')) {
      result.market_outlook = `[단기 반등] ${result.market_outlook}`
    }

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

    if (error) console.error('[Supabase 저장 실패]', error.message)

    // 6. 텔레그램 + 포트폴리오 조언 동시 실행
    const runPortfolioAdvice = async () => {
      const [{ data: portfolioItems }, { data: cashRow }, { data: accountRows }] = await Promise.all([
        supabaseAdmin.from('portfolio').select('*').order('created_at', { ascending: true }),
        supabaseAdmin.from('portfolio_cash').select('*').eq('id', 1).maybeSingle(),
        supabaseAdmin.from('portfolio_accounts').select('id,name'),
      ])
      if (!portfolioItems || portfolioItems.length === 0) return

      const cash = (cashRow as { amount?: number } | null)?.amount ?? 0
      const accountMap: Record<string, string> = {}
      for (const a of accountRows ?? []) {
        accountMap[(a as { id: string; name: string }).id] = (a as { id: string; name: string }).name
      }

      const allTickers = [...new Set(portfolioItems.map(p => (p as { ticker: string }).ticker))]

      const [techResults, priceResults, historyData] = await Promise.all([
        Promise.all(portfolioItems.map(p => fetchTechnicalIndicators((p as { ticker: string }).ticker).catch(() => null))),
        Promise.all(portfolioItems.map(p => fetchNaverData((p as { ticker: string }).ticker).catch(() => ({ price: null })))),
        supabaseAdmin
          .from('portfolio_advice')
          .select('ticker,date,advice_type,advice_detail,portfolio_item_id')
          .in('ticker', allTickers)
          .order('date', { ascending: false })
          .limit(14 * portfolioItems.length),
      ])

      const historyMap: Record<string, { date: string; advice_type: string; advice_detail: string }[]> = {}
      for (const h of historyData.data ?? []) {
        const rec = h as { ticker: string; date: string; advice_type: string; advice_detail: string; portfolio_item_id: string | null }
        const key = rec.portfolio_item_id ?? rec.ticker
        if (!historyMap[key]) historyMap[key] = []
        historyMap[key].push({ date: rec.date, advice_type: rec.advice_type, advice_detail: rec.advice_detail })
      }

      const items = portfolioItems.map((p, i) => {
        const item = p as { id: string; ticker: string; name: string; avg_price: number; shares: number; account_id: string | null }
        const currentPrice = (priceResults[i] as { price: number | null })?.price ?? item.avg_price
        const profitPct = item.avg_price > 0 ? ((currentPrice - item.avg_price) / item.avg_price) * 100 : 0
        const tech = techResults[i]
        return {
          item_key: String(i),
          account_name: item.account_id ? accountMap[item.account_id] : undefined,
          ticker: item.ticker,
          name: item.name,
          avg_price: item.avg_price,
          shares: item.shares,
          current_price: currentPrice,
          profit_pct: profitPct,
          tech: {
            rsi14: tech?.rsi14 ?? null,
            macdSignal: tech?.macdSignal ?? null,
            trend: tech?.trend ?? null,
            volumeSurge: tech?.volumeSurge ?? null,
            bollingerSignal: tech?.bollingerSignal ?? null,
            bollingerWidth: tech?.bollingerWidth ?? null,
            prevDayChangePct: tech?.prevDayChangePct ?? null,
            supportLevel: tech?.supportLevel ?? null,
            resistanceLevel: tech?.resistanceLevel ?? null,
            isNearHighBreakout: tech?.isNearHighBreakout ?? false,
            candlePattern: tech?.candlePattern ?? null,
            foreignNet: tech?.foreignNet ?? null,
            institutionNet: tech?.institutionNet ?? null,
          },
          history: (historyMap[item.id] ?? historyMap[item.ticker] ?? []).slice(0, 14),
        }
      })

      const advice = await generatePortfolioAdvice({
        items,
        cash,
        marketOutlook: result.market_outlook,
        date: todayDate,
      })

      for (const a of advice) {
        const itemIndex = parseInt(a.item_key)
        const item = items[itemIndex]
        if (!item) continue
        const rawItem = portfolioItems[itemIndex] as { id: string }
        await supabaseAdmin.from('portfolio_advice')
          .delete()
          .eq('date', todayDate)
          .eq('portfolio_item_id', rawItem.id)
        await supabaseAdmin.from('portfolio_advice').insert({
          date: todayDate,
          portfolio_item_id: rawItem.id,
          ticker: item.ticker,
          name: item.name,
          advice_type: a.advice_type,
          advice_detail: a.advice_detail,
          current_price: item.current_price ?? null,
          avg_price: item.avg_price ?? null,
          profit_pct: item.profit_pct ?? null,
          source: 'auto',
        })
      }

      console.log(`[포트폴리오] ${advice.length}개 종목 조언 생성 완료`)
    }

    const tasks: Promise<unknown>[] = [
      sendTelegramAlert({
        stocks: result.recommendations,
        marketOutlook: result.market_outlook,
        date: todayDate,
        usdkrw,
        goldPrice,
      }),
      runPortfolioAdvice(),
    ]
    const settled = await Promise.allSettled(tasks)
    if (settled[0].status === 'rejected') console.error('[텔레그램] 전송 실패:', (settled[0] as PromiseRejectedResult).reason)
    if (settled[1].status === 'rejected') console.error('[포트폴리오] 조언 생성 실패:', (settled[1] as PromiseRejectedResult).reason)

    // 6-b. 키워드 자동 학습
    try {
      const suggestions = await suggestKeywordsFromNews({
        newsTitles: analyzedNews.slice(0, 60).map(n => n.title),
        existingKeywords: allKwTexts,
        trackedSectors: Object.keys(dynSectorMap),
      })
      if (suggestions.length > 0) {
        await supabaseAdmin.from('keyword_watchlist').upsert(
          suggestions.map(s => ({
            keyword: s.keyword,
            sector: s.sector ?? null,
            related_tickers: s.related_tickers ?? [],
            is_high_impact: s.is_high_impact,
            source: 'ai',
          })),
          { onConflict: 'keyword', ignoreDuplicates: true }
        )
        console.log(`[키워드] AI 신규 제안 ${suggestions.length}개 누적`)
      }
    } catch (e) {
      console.error('[키워드] 자동 학습 실패 (비치명):', e instanceof Error ? e.message : e)
    }

    // 7. 분석 성공 시각 sentinel 갱신
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

    // 8. 오래된 뉴스 캐시 정리
    const cleanupDate = new Date()
    cleanupDate.setDate(cleanupDate.getDate() - 7)
    await supabaseAdmin
      .from('news_cache')
      .delete()
      .lt('fetched_at', cleanupDate.toISOString())

    // 9. 누적 수익률 미달 섹션 자기진단
    const improvedSections = await Promise.race([
      runStrategyImprovementIfNeeded(),
      new Promise<string[]>(resolve => setTimeout(() => { console.warn('[전략개선] 60초 타임아웃 — 스킵'); resolve([]) }, 60000)),
    ])

    console.log('[완료]', JSON.stringify({
      success: true,
      date: todayDate,
      newsCount: freshNews.length,
      newsHigh: analyzedNews.filter(n => n.impact === 'high').length,
      newsMedium: analyzedNews.filter(n => n.impact === 'medium').length,
      detectedSectors: keywords.slice(0, 8),
      telegramSent: !!process.env.TELEGRAM_BOT_TOKEN,
      strategyImproved: improvedSections,
      savedId: data?.id ?? null,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('Daily cron 오류:', message)
    await sendTelegramSimple(
      `⚠️ <b>StockSight 분석 오류</b> (${todayDate})\n\n${message.slice(0, 500)}\n\n🔗 <a href="https://stocksight-pied.vercel.app">상세 확인</a>`
    )
    throw new Error(message)
  }
}

const KEYWORD_SECTOR_FOR_CANDIDATE: Record<string, string[]> = {
  '반도체': ['반도체', '반도체소재'], 'AI': ['반도체', '로봇', 'IT', 'AI', '통신'], '2차전지': ['2차전지'],
  '바이오': ['바이오', '제약'], '자동차': ['자동차'], '철강': ['철강'],
  '화학': ['화학'], '금융': ['금융', '보험', '증권'], '부동산': ['건설'],
  '원자력': ['원자력'], '방산': ['방산'], '인터넷': ['IT', 'AI', '통신'], '게임': ['게임'],
  '조선': ['조선'], '로봇': ['로봇'],
  '전선': ['전선'], '전력기기': ['전력기기'], '레이저': ['레이저'], '수소': ['수소'],
  '반도체소재': ['반도체소재'], '전자부품': ['전자부품'], '전장': ['전장'],
  '화장품': ['화장품'], 'K뷰티': ['화장품'], '뷰티': ['화장품'],
  '엔터': ['엔터'], '아이돌': ['엔터'], 'K팝': ['엔터'], '드라마': ['엔터'], '음악': ['엔터'],
  '음식료': ['음식료'], '식품': ['음식료'], '라면': ['음식료'], '주류': ['음식료'],
  '항공': ['항공해운'], '해운': ['항공해운'], '물류': ['항공해운'],
  '의료기기': ['의료기기'], '헬스케어': ['의료기기', '바이오'],
  '핀테크': ['핀테크'], '인터넷은행': ['핀테크'],
  '클라우드': ['AI', 'IT'], 'SaaS': ['AI', 'IT'],
  '신재생': ['신재생'], '풍력': ['신재생'], '태양광': ['태양광', '신재생'],
  '증권': ['증권', '금융'],
}

function buildCandidatePool(keywords: string[]): { ticker: string; name: string; sector: string }[] {
  const relatedSectors = new Set<string>()
  keywords.forEach(kw => { ;(KEYWORD_SECTOR_FOR_CANDIDATE[kw] ?? []).forEach(s => relatedSectors.add(s)) })

  const related = MAJOR_STOCKS.filter(s => relatedSectors.has(s.sector))
  const defensive = MAJOR_STOCKS.filter(s =>
    ['금융', '보험', '통신', '제약', '유통'].includes(s.sector) &&
    !related.find(r => r.ticker === s.ticker)
  )
  return [...related, ...defensive].slice(0, 25)
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
    if (t?.isNearHighBreakout) parts.push('🚀신고가돌파')
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
    if (t?.prevDayChangePct != null) {
      const sign = t.prevDayChangePct >= 0 ? '+' : ''
      parts.push(`전일${sign}${t.prevDayChangePct.toFixed(1)}%`)
    }
    lines.push(parts.join(' | '))
  }
  return lines.join('\n')
}

;(async () => {
  try {
    await runDailyAnalysis()
    process.exit(0)
  } catch (err) {
    console.error('[치명 오류]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
})()
