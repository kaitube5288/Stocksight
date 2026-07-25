import { NextResponse } from 'next/server'
import { generateRecommendations, analyzeEventBeneficiaries, generatePortfolioAdvice, suggestKeywordsFromNews } from '@/lib/gemini'
import { getTodayDisclosures, formatDisclosuresForPrompt } from '@/lib/dart'
import { getMarketIndex, getUSDKRW, getGoldPrice, getSimilarHistoricalPatterns, formatMarketContext, getRealPrices, getFundamentalsMap, fetchTechnicalIndicators, fetchSectorTechnicals, fetchVolumeTopStocks, fetchInterestRates, formatInterestRatesForPrompt, fetchKospiMA20, fetchNaverData, StockFundamentals, TechnicalIndicators } from '@/lib/stock-data'
import { sendTelegramAlert, sendTelegramSimple } from '@/lib/telegram'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate, getKSTDateLocale } from '@/lib/date'
import { MAJOR_STOCKS } from '@/lib/major-stocks'
import { isKoreanMarketHoliday } from '@/lib/korean-holidays'
import { buildPerformanceInsights } from '@/lib/performance-analysis'
import { getNewsFromCacheOrFetch, formatAnalyzedNewsForPrompt, extractSectorsFromNews, setDynamicKeywords } from '@/lib/news'
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
    const [disclosures, { kospi, kosdaq }, usdkrw, goldPrice, volumeTopStocks, interestRatesRaw, kospiMA20] = await Promise.all([
      getTodayDisclosures(),
      getMarketIndex(),
      getUSDKRW(),
      getGoldPrice(),
      fetchVolumeTopStocks(15).catch(() => [] as { ticker: string; name: string }[]),
      fetchInterestRates().catch(() => ({ us10Y: null, us3M: null, yieldSpread: null, isInverted: false })),
      fetchKospiMA20().catch(() => null),
    ])
    const interestRatesText = formatInterestRatesForPrompt(interestRatesRaw)

    const dartText = formatDisclosuresForPrompt(disclosures)

    // 불장 여부를 Gemini 호출 전에 먼저 판단 (마켓 컨텍스트에 주입)
    const kospiChangePct = (kospi && kospi.previousClose > 0) ? (kospi.price - kospi.previousClose) / kospi.previousClose * 100 : 0
    const kosdaqChangePct = (kosdaq && kosdaq.previousClose > 0) ? (kosdaq.price - kosdaq.previousClose) / kosdaq.previousClose * 100 : 0
    const isBullMarket = kospiChangePct >= 1 || kosdaqChangePct >= 1
    const isKospiBelowMA20 = kospiMA20 != null && kospiMA20.price < kospiMA20.ma20
    // 단기 반등: 당일 급등이지만 MA20 하회 중 (약세장 속 기술적 반등)
    // 진정한 불장: 당일 급등 + MA20 위 (상승 구조 확인된 강세장)
    const isShortTermBounce = isBullMarket && isKospiBelowMA20
    const isTrueBullMarket  = isBullMarket && !isKospiBelowMA20
    const bullMarketNote = isTrueBullMarket
      ? `\n[🚀 불장 감지] KOSPI ${kospiChangePct.toFixed(2)}% / KOSDAQ ${kosdaqChangePct.toFixed(2)}% — 강세장 모멘텀 전략 적용: 신고가 돌파 종목 우선, RSI 상한 80까지 예외 허용`
      : isShortTermBounce
      ? `\n[⚡ 단기 반등] KOSPI ${kospiChangePct.toFixed(2)}% 급등이나 MA20 하회 중 — 과매도 반등 전략 적용, 리스크 관리 강화`
      : ''
    const marketText = formatMarketContext({ kospi, kosdaq, usdkrw }) + bullMarketNote

    // 3. 섹터 키워드 추출 (분석된 뉴스 임팩트 가중치 기반: high 3점, medium 1점)
    //    과거 유사 패턴 + 섹터 기술적 지표 + 후보 종목 실제 데이터 + 성과 피드백 병렬 조회
    const keywords = extractSectorsFromNews(analyzedNews)
    const candidatePool = buildCandidatePool(keywords)

    // 거래량 상위 종목 병합 (MAJOR_STOCKS에 없는 당일 급등 종목 최대 5개 추가)
    const poolTickerSet = new Set(candidatePool.map(c => c.ticker))
    const volumeCandidates = volumeTopStocks
      .filter(s => !poolTickerSet.has(s.ticker))
      .slice(0, 10)
      .map(s => ({ ...s, sector: '거래량상위' }))
    const mergedCandidatePool = [...candidatePool, ...volumeCandidates]
    const candidateTickers = mergedCandidatePool.map(c => c.ticker)

    // HIGH 임팩트 뉴스 텍스트 (이벤트 수혜주 사전 분석용)
    const highImpactNewsText = analyzedNews
      .filter(n => n.impact === 'high')
      .slice(0, 6)
      .map(n => `• ${n.title}`)
      .join('\n')

    // 누적 수익률 미달 섹션 자기진단 + 이전 개선 방향 읽기를 병렬 실행
    // runStrategyImprovementIfNeeded: 오늘 분석 결과 저장 (다음 회차 반영)
    // buildStrategyImprovementContext: 이전 회차 결과 읽기 (오늘 즉시 반영)
    const [historicalPatterns, technicalContext, candidateFundamentals, candidateTechRaw, performanceInsights, marketFeedbackInsights, strategyImprovements, eventBeneficiary] = await Promise.all([
      getSimilarHistoricalPatterns(keywords),
      fetchSectorTechnicals(keywords),
      getFundamentalsMap(candidateTickers),
      Promise.all(candidateTickers.map(t => fetchTechnicalIndicators(t))),
      buildPerformanceInsights(),
      buildMarketFeedbackInsights(),
      buildStrategyImprovementContext(),  // 이전 회차 자기진단 결과 읽기
      highImpactNewsText
        ? analyzeEventBeneficiaries(highImpactNewsText).catch(() => ({ additionalTickers: [], analysisText: '' }))
        : Promise.resolve({ additionalTickers: [], analysisText: '' }),
    ])

    // 이벤트 수혜주 추가 종목 — 기존 후보풀에 없는 것만 병렬 조회 후 합산
    const existingTickerSet = new Set(candidateTickers)
    const extraTickers = eventBeneficiary.additionalTickers
      .filter(t => /^\d{6}$/.test(t.ticker) && !existingTickerSet.has(t.ticker))
      .map(t => t.ticker)

    const [extraFundamentals, extraTechRaw] = extraTickers.length > 0
      ? await Promise.all([
          getFundamentalsMap(extraTickers),
          Promise.all(extraTickers.map(t => fetchTechnicalIndicators(t))),
        ])
      : [{} as Record<string, StockFundamentals>, [] as TechnicalIndicators[]]

    const extraTechMap = Object.fromEntries(extraTickers.map((t, i) => [t, extraTechRaw[i]]))

    // 후보 풀 확장: 이벤트 수혜 종목 추가 (MAJOR_STOCKS에 없는 경우 sector='이벤트수혜'로 표시)
    const extraCandidatePool = eventBeneficiary.additionalTickers
      .filter(t => !existingTickerSet.has(t.ticker))
      .map(t => ({ ticker: t.ticker, name: t.name, sector: '이벤트수혜' }))

    const fullCandidatePool = [...mergedCandidatePool, ...extraCandidatePool]
    const fullCandidateFundamentals = { ...candidateFundamentals, ...extraFundamentals }
    const candidateTechMap = Object.fromEntries(candidateTickers.map((t, i) => [t, candidateTechRaw[i]]))
    const fullCandidateTechMap = { ...candidateTechMap, ...extraTechMap }

    const candidatesContext = formatCandidatesContext(fullCandidatePool, fullCandidateFundamentals, fullCandidateTechMap)

    // 반등 후보 식별: 전일 -7% 이하 + RSI ≤ 35 + 추세 횡보/상승 → 단타 최우선 검토
    const bounceCandidates = fullCandidatePool.filter(c => {
      const t = fullCandidateTechMap[c.ticker]
      // trend 조건 제외: 반등후보는 하락추세에서 과매도된 종목을 찾는 것이므로
      // 반등 초기에는 추세가 여전히 'down'으로 분류됨
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

    // KOSPI MA20 기반 시장 구조 경고 (isKospiBelowMA20은 위에서 이미 계산됨)
    const kospiMA20Warning = isKospiBelowMA20
      ? isShortTermBounce
        // 단기 반등 국면: 과매도 반등 1종목 허용, 극보수 지시 해제
        ? `⚠️ KOSPI 20일선 하회 중이나 당일 ${kospiChangePct.toFixed(1)}% 급반등 (단기 반등 국면)\n→ 과매도(RSI≤35) 종목 중 기술적 반등 가능성 있는 종목 단타 1개 이내 허용. 손절 -5% 엄수. 스윙·중기는 여전히 신중하게.`
        // 순수 하락장: 극보수 유지
        : `⚠️ KOSPI 20일선 하회 중 (현재 ${kospiMA20!.price.toFixed(0)} / MA20 ${kospiMA20!.ma20.toFixed(0)})\n→ 시장 전체 하락 구조. 단타·스윙 추천 종목 수를 최소화하고, 방어주·현금보유 비중 확대. 확신도 90% 이상 종목만 추천.`
      : undefined
    if (isKospiBelowMA20) {
      console.log(`[KOSPI-MA20] KOSPI ${kospiMA20!.price.toFixed(0)} < MA20 ${kospiMA20!.ma20.toFixed(0)} — 단타 최대 1종목 제한 적용`)
    }

    // 금리·정책 뉴스: 기존 analyzedNews에서 키워드 필터링 (추가 API 호출 없음)
    const RATE_POLICY_KW = [
      '금리', '기준금리', 'FOMC', '연준', '한국은행', '금통위',
      'Fed', '통화정책', '기재부', '경제정책', '재정정책', '정책발표',
    ]
    const ratePolicyNewsText = analyzedNews
      .filter(n => RATE_POLICY_KW.some(k => n.title.includes(k)))
      .slice(0, 8)
      .map(n => `• [${n.source}] ${n.title}`)
      .join('\n')

    // 4. Gemini 분석 (뉴스 임팩트 티어 + 패턴 + 기술지표 + 후보종목 + 과거성과 피드백 + 이벤트수혜주 + 금리 컨텍스트)
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
    })

    // 4-1. trade_type 강제 할당 (순서 기반: 0~2=단타, 3~5=스윙, 6~8=중기)
    const TRADE_TYPES = ['단타', '스윙', '중기'] as const
    const HOLD_PERIODS: Record<string, string> = { '단타': '1일 목표', '스윙': '3~5일 목표', '중기': '2~4주 목표' }
    result.recommendations = result.recommendations.map((r, i) => {
      const trade_type = TRADE_TYPES[Math.floor(i / 3) % 3]
      return { ...r, trade_type, hold_period: HOLD_PERIODS[trade_type] }
    })

    // 4-2. 현재가 + 펀더멘털 + 기술적 지표 + 전일 급등 종목 병렬 조회
    const tickers = result.recommendations.map(r => r.ticker)
    // 전일 KST 날짜 계산
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

    // 거래중단/상폐 종목 제거
    result.recommendations = result.recommendations.filter(r => !!realPrices[r.ticker])

    // isBullMarket은 Gemini 호출 전에 이미 계산됨 (marketText에 주입됨)
    // 하락장 판단: 어제 KOSPI·KOSDAQ 모두 하락했으면 하락장
    const isBearMarket = kospiChangePct <= -0.5 && kosdaqChangePct <= -0.5
    // 거래유형별 RSI 상한 — 프롬프트 규칙을 코드 레벨에서 강제 적용 (단타 55, 스윙 65, 중기 60으로 강화)
    const rsiMaxByType: Record<string, number> = {
      '단타': isBullMarket ? 65 : 55,  // 단타: RSI 55 초과 금지 (불장 시 65까지)
      '스윙': isBullMarket ? 80 : 65,  // 스윙: RSI 65 초과 금지 (불장 시 80까지)
      '중기': isBullMarket ? 70 : 60,  // 중기: RSI 60 초과 금지 (불장 시 70까지)
    }
    console.log(`[불장판단] KOSPI ${kospiChangePct.toFixed(2)}% / KOSDAQ ${kosdaqChangePct.toFixed(2)}% → 단타RSI≤${rsiMaxByType['단타']} / 스윙RSI≤${rsiMaxByType['스윙']} / 중기RSI≤${rsiMaxByType['중기']} (불장: ${isBullMarket} / 하락장: ${isBearMarket})`)

    // B: 기술적 지표 필터링 — RSI 상한 초과 / MACD 데드크로스 / 하락추세 종목 제거
    result.recommendations = result.recommendations.filter(r => {
      // 하락장 현금보유 슬롯 (ticker=000000) 은 필터 통과
      if (r.ticker === '000000') return true
      const tech = techMap[r.ticker]
      if (!tech) return true
      const maxRsi = rsiMaxByType[r.trade_type ?? '단타'] ?? 75
      if (tech.rsi14 !== null && tech.rsi14 > maxRsi) {
        console.log(`[필터-RSI] ${r.name}(${r.ticker}) RSI ${tech.rsi14} 제거 (${r.trade_type} 상한: ${maxRsi})`)
        return false
      }
      // RSI 하한: 28 미만 극단적 과매도 = 추가 하락 위험
      if (tech.rsi14 !== null && tech.rsi14 < 28) {
        console.log(`[필터-RSI하한] ${r.name}(${r.ticker}) RSI ${tech.rsi14} 극단 과매도 제거`)
        return false
      }
      if (tech.macdSignal === 'sell') {
        console.log(`[필터-MACD] ${r.name}(${r.ticker}) MACD 데드크로스 제거`)
        return false
      }
      // 하락추세 종목: 단타·스윙 코드 레벨 강제 제거
      if (tech.trend === 'down' && (r.trade_type === '단타' || r.trade_type === '스윙')) {
        console.log(`[필터-추세] ${r.name}(${r.ticker}) 하락추세 제거 (${r.trade_type})`)
        return false
      }
      // 볼린저밴드 상단 근접 종목: 단타·스윙 과열 구간 제거
      if (tech.bollingerSignal === 'sell' && (r.trade_type === '단타' || r.trade_type === '스윙')) {
        console.log(`[필터-BB상단] ${r.name}(${r.ticker}) 볼린저 상단 근접 제거 (${r.trade_type})`)
        return false
      }
      // 외국인+기관 동반 순매도 종목: 단타 수급 역풍 제거
      if (r.trade_type === '단타' && tech.foreignNet !== null && tech.institutionNet !== null &&
          tech.foreignNet < 0 && tech.institutionNet < 0) {
        console.log(`[필터-수급동반매도] ${r.name}(${r.ticker}) 외국인+기관 동반매도 단타 제거`)
        return false
      }
      return true
    })

    // C: 전일 급등 종목 단타 제외 (갭상승 고점 진입 방지 — 이미 시장에 뉴스 반영됨)
    if (prevDayGainerTickers.size > 0) {
      result.recommendations = result.recommendations.filter(r => {
        if (r.trade_type === '단타' && prevDayGainerTickers.has(r.ticker)) {
          console.log(`[필터-전일급등] ${r.name}(${r.ticker}) 전일 급등 단타 제외`)
          return false
        }
        return true
      })
    }

    // D: 강력 신호 점수 필터 — 단타는 5개 조건 중 3개 이상 만족 필수
    function calcSignalScore(tech: TechnicalIndicators): number {
      let score = 0
      // RSI: [20,50] — 과매도 반등 잠재력(20~30) + 회복 진행(30~50) 모두 인정
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
      if (score < 3) {
        console.log(`[필터-신호점수] ${r.name}(${r.ticker}) 신호강도 ${score}/5 — 단타 기준 미달 (3점↑ 필요) 제거`)
        return false
      }
      console.log(`[신호강도] ${r.name}(${r.ticker}) ${score}/5 통과`)
      return true
    })

    // E: KOSPI MA20 하회 시 단타 최대 1종목으로 제한 (나머지 슬롯 현금보유로 채움)
    if (isKospiBelowMA20) {
      const dantas = result.recommendations.filter(r => r.trade_type === '단타' && r.ticker !== '000000')
      if (dantas.length > 1) {
        const keepTicker = dantas[0].ticker
        result.recommendations = result.recommendations.filter(r =>
          r.trade_type !== '단타' || r.ticker === '000000' || r.ticker === keepTicker
        )
        const cashSlotCount = 2 - (result.recommendations.filter(r => r.trade_type === '단타' && r.ticker === '000000').length)
        for (let i = 0; i < cashSlotCount; i++) {
          result.recommendations.splice(1 + i, 0, {
            name: '현금보유', ticker: '000000', buy_price: 0, sell_price: 0, stop_loss: 0,
            expected_return: 0, probability: 0, trade_type: '단타', hold_period: '1일 목표',
            reasoning: 'KOSPI 20일선 하회 — 시장 전체 하락 구조, 현금 보유 권고',
            key_catalyst: 'KOSPI MA20 하회', per: null, pbr: null, roe: null,
          })
        }
        console.log(`[KOSPI-MA20] 단타 ${dantas.length}개→1개 축소, 현금보유 ${cashSlotCount}개 추가`)
      }
    }

    // 확률 상한 95% 캡핑
    result.recommendations = result.recommendations.map(r => ({
      ...r,
      probability: Math.min(r.probability, 95),
    }))

    // 거래유형별 기본 손절 비율 — 단타 -5%, 스윙 -4%, 중기 -6%
    const stopLossPct: Record<string, number> = { '단타': 0.95, '스윙': 0.96, '중기': 0.94 }

    result.recommendations = result.recommendations.map(r => {
      // 하락장 현금보유 슬롯은 그대로 통과
      if (r.ticker === '000000') return r
      const real = realPrices[r.ticker]
      const fund = fundamentals[r.ticker]
      const tech = techMap[r.ticker]
      const buyPrice = real
        ? (real.price > 0 ? real.price : real.previousClose)
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

    // 시장 구조 태그 삽입 (Gemini 표현에 의존하지 않고 확정적으로 붙임)
    if (isTrueBullMarket && !result.market_outlook.startsWith('[불장 감지]')) {
      result.market_outlook = `[불장 감지] ${result.market_outlook}`
    } else if (isShortTermBounce && !result.market_outlook.startsWith('[단기 반등]')) {
      result.market_outlook = `[단기 반등] ${result.market_outlook}`
    }

    // 5. Supabase 저장 (실패해도 텔레그램 전송은 반드시 진행)
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

    // 6. 텔레그램 + 포트폴리오 조언 동시 실행 (병렬 — 둘 중 하나 실패해도 나머지 진행)
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
            prevDayChangePct: tech?.prevDayChangePct ?? null,
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

      await Promise.all(advice.map(a => {
        const itemIndex = parseInt(a.item_key)
        const item = items[itemIndex]
        if (!item) return Promise.resolve()
        const rawItem = portfolioItems[itemIndex] as { id: string }
        return supabaseAdmin.from('portfolio_advice').upsert({
          date: todayDate,
          portfolio_item_id: rawItem.id,
          ticker: item.ticker,
          name: item.name,
          advice_type: a.advice_type,
          advice_detail: a.advice_detail,
          current_price: item.current_price ?? null,
          avg_price: item.avg_price ?? null,
          profit_pct: item.profit_pct ?? null,
        }, { onConflict: 'date,portfolio_item_id' })
      }))

      console.log(`[포트폴리오] ${advice.length}개 종목 조언 생성 완료`)
    }

    const [telegramResult, portfolioResult] = await Promise.allSettled([
      sendTelegramAlert({
        stocks: result.recommendations,
        marketOutlook: result.market_outlook,
        date: todayDate,
        usdkrw,
        goldPrice,
      }),
      runPortfolioAdvice(),
    ])
    if (telegramResult.status === 'rejected') console.error('[텔레그램] 전송 실패:', telegramResult.reason)
    if (portfolioResult.status === 'rejected') console.error('[포트폴리오] 조언 생성 실패:', portfolioResult.reason)

    // 6-b. 키워드 자동 학습 — 오늘 뉴스에서 Gemini가 새 키워드 제안 → DB 누적
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

    // 10. 누적 수익률 미달 섹션 자기진단 — 메인 작업 완료 후 실행 (다음 cron 회차에 반영)
    // 60초 타임아웃: 이 단계가 길어져도 전체 함수가 멈추지 않도록 보호
    const improvedSections = await Promise.race([
      runStrategyImprovementIfNeeded(),
      new Promise<string[]>(resolve => setTimeout(() => { console.warn('[전략개선] 60초 타임아웃 — 스킵'); resolve([]) }, 60000)),
    ])

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
    // 에러 내용을 텔레그램으로 즉시 알림 (원인 파악용)
    await sendTelegramSimple(
      `⚠️ <b>StockSight 분석 오류</b> (${todayDate})\n\n${message.slice(0, 500)}\n\n🔗 <a href="https://stocksight-pied.vercel.app">상세 확인</a>`
    )
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// 후보 종목 풀 선정 — 뉴스 관련 섹터 + 방어주
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
