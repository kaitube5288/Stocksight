import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { fetchAndAnalyzeNews, extractSectorsFromNews, formatAnalyzedNewsForPrompt } from '@/lib/news'
import { getMarketIndex, getUSDKRW, getRealPrices, getFundamentalsMap, fetchDetailedTechnicals, formatMarketContext } from '@/lib/stock-data'
import { MAJOR_STOCKS } from '@/lib/major-stocks'

export const maxDuration = 120

const KEYWORD_SECTOR_MAP: Record<string, string[]> = {
  '반도체': ['반도체'], 'AI': ['반도체', '로봇', 'IT'], '2차전지': ['2차전지'],
  '바이오': ['바이오', '제약'], '자동차': ['자동차'], '철강': ['철강'],
  '화학': ['화학'], '금융': ['금융', '보험'], '부동산': ['건설'],
  '원자력': ['원자력'], '방산': ['방산'], '인터넷': ['IT'], '게임': ['게임'],
  '조선': ['조선'], '로봇': ['로봇'],
}

export type AIStockRecommendation = {
  rank: number
  name: string
  ticker: string
  description: string
  is_best: boolean
  // 기술적 지표 (실제 데이터)
  current_price: number | null
  price_signal: string
  high_52w: number | null
  low_52w: number | null
  range_52w_signal: string
  rsi: number | null
  rsi_signal: string
  supply_signal: string
  supply_detail: string
  // 이동평균선 분석 (실제 데이터)
  ma5: number | null
  ma20: number | null
  ma60: number | null
  price_vs_ma5: string
  ma_alignment: string
  bollinger_status: string
  // 매매 참고가 (AI 생성)
  buy_low: number
  buy_high: number
  target_low: number
  target_high: number
  stop_loss: number
  analyst_target: number | null
  // AI 분석
  reasoning: string
  key_catalyst: string
  // 차트용
  from?: string
}

export type AIAnalysisResult = {
  recommendations: AIStockRecommendation[]
  market_summary: string
  trade_strategy: string
  analysis_date: string
  news_count: number
}

function buildCandidatePool(keywords: string[]) {
  const sectors = new Set<string>()
  keywords.forEach(kw => (KEYWORD_SECTOR_MAP[kw] ?? []).forEach(s => sectors.add(s)))
  const related = MAJOR_STOCKS.filter(s => sectors.has(s.sector))
  const defensive = MAJOR_STOCKS.filter(
    s => ['금융', '보험', '통신', '제약', '유통'].includes(s.sector) && !related.find(r => r.ticker === s.ticker)
  )
  return [...related, ...defensive].slice(0, 18)
}

async function callGeminiForAIAnalysis(prompt: string): Promise<string> {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean) as string[]

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']

  for (const key of keys) {
    const genAI = new GoogleGenerativeAI(key)
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel(
          { model: modelName, generationConfig: { temperature: 0.15 } },
          { apiVersion: 'v1beta' }
        )
        const result = await model.generateContent(prompt)
        return result.response.text()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        const is429 = msg.includes('429') || msg.toLowerCase().includes('quota')
        if (is429) break
        continue
      }
    }
  }
  throw new Error('Gemini API 호출 실패')
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const userQuery: string = body.query ?? ''

    // 1. 뉴스 수집 + 분석
    const { news: freshNews, analyzed: analyzedNews } = await fetchAndAnalyzeNews()
    const newsText = formatAnalyzedNewsForPrompt(analyzedNews)
    const keywords = extractSectorsFromNews(analyzedNews)

    // 2. 시장 지표
    const [{ kospi, kosdaq }, usdkrw] = await Promise.all([
      getMarketIndex(),
      getUSDKRW(),
    ])
    const marketText = formatMarketContext({ kospi, kosdaq, usdkrw })

    // 3. 후보 종목 + 실제 데이터 수집
    const candidates = buildCandidatePool(keywords)
    const tickers = candidates.map(c => c.ticker)

    const [realPrices, fundamentals, detailedTechRaw] = await Promise.all([
      getRealPrices(tickers),
      getFundamentalsMap(tickers),
      Promise.all(tickers.map(t => fetchDetailedTechnicals(t))),
    ])
    const techMap = Object.fromEntries(tickers.map((t, i) => [t, detailedTechRaw[i]]))

    // 후보 종목 컨텍스트
    const candidateLines = candidates.map(c => {
      const f = fundamentals[c.ticker]
      const t = techMap[c.ticker]
      const p = realPrices[c.ticker]
      const parts = [`• ${c.name}(${c.ticker}) [${c.sector}]`]
      if (p?.price) parts.push(`현재가 ${p.price.toLocaleString()}원`)
      if (f?.per != null)  parts.push(`PER ${f.per}`)
      if (f?.pbr != null)  parts.push(`PBR ${f.pbr}`)
      if (f?.roe != null)  parts.push(`ROE ${f.roe}%`)
      if (t?.rsi14 != null) parts.push(`RSI ${t.rsi14}`)
      if (t?.ma5)  parts.push(`MA5 ${t.ma5.toLocaleString()}`)
      if (t?.ma20) parts.push(`MA20 ${t.ma20.toLocaleString()}`)
      if (t?.high52w) parts.push(`52주고 ${t.high52w.toLocaleString()}`)
      if (t?.low52w)  parts.push(`52주저 ${t.low52w.toLocaleString()}`)
      if (t?.macdSignal)  parts.push(t.macdSignal === 'buy' ? 'MACD↑' : t.macdSignal === 'sell' ? 'MACD↓' : '')
      if (t?.trend)       parts.push(t.trend === 'up' ? '추세↑' : t.trend === 'down' ? '추세↓' : '')
      if (t?.bollingerSignal === 'buy') parts.push('BB하단')
      if (t?.volumeSurge != null && t.volumeSurge >= 1.5) parts.push(`거래량${t.volumeSurge.toFixed(1)}x`)
      return parts.filter(Boolean).join(' | ')
    }).join('\n')

    // 4. Gemini AI 분석 프롬프트
    const today = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    })

    const prompt = `당신은 한국 최고 수준의 주식 애널리스트입니다. 오늘의 뉴스·시장 데이터·기술적 지표를 종합 분석하여 내일 가장 상승 가능성이 높은 코스피/코스닥 종목 3개를 선정하세요.
${userQuery ? `\n사용자 요청: ${userQuery}\n` : ''}
## 오늘 날짜
${today}

## 현재 시장 지표
${marketText}

## 수집된 뉴스 (임팩트 티어별)
${newsText}

## 후보 종목 실제 데이터
${candidateLines}

---

## 분석 지침

**종목 선정 기준 (이 모든 조건을 종합적으로 평가):**
1. RSI 30~65 구간 우선 (70 초과 과매수 종목 기피)
2. MACD↑(골든크로스) 또는 거래량 급증 종목 우선
3. MA5 > MA20 > MA60 정배열 유지 종목 우선
4. HIGH 임팩트 뉴스에 직접 언급된 섹터/종목 가중
5. PER 낮고 ROE 높은 저평가 우량주 우선
6. 볼린저밴드 하단 근접(BB하단) 종목 — 반등 가능성 높음

**매매 참고가 산정 원칙:**
- buy_low: MA5 또는 현재가의 -2~5% (지지선 근거)
- buy_high: 현재가 ±2% 이내
- target_low: buy_high × 1.05~1.10 (5~10% 목표)
- target_high: buy_high × 1.10~1.20 (10~20% 목표)
- stop_loss: buy_low × 0.92~0.95 (5~8% 손절)
- analyst_target: 최근 증권사 리포트 기준 (없으면 target_high × 1.1로 추정)

**수급 신호 추정 방법:**
- 거래량 급증(1.5x 이상) + 가격 상승 → "기관↑" 또는 "외국인↑"
- 거래량 급증 + 가격 하락 → "외국인 매도·기관 매수" 또는 반대
- 거래량 보통 + 상승 → "개인 매수 우세"
- 거래량 보통 + 횡보 → "관망세"

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
{
  "recommendations": [
    {
      "rank": 1,
      "name": "종목명",
      "ticker": "6자리종목코드",
      "description": "한 줄 사업 설명 (예: AI 서버 MLB 기판 제조)",
      "is_best": true,
      "price_signal": "현재가 상황 텍스트 (예: 급등 후 조정, 안정적 상승, 눌림목 진입 중)",
      "range_52w_signal": "52주 위치 텍스트 (예: 신고가 부근, 중간 구간, 저점 반등)",
      "rsi_signal": "RSI 상태 텍스트 (예: 적정 구간, 과매수 경계, 과매도 반등 가능)",
      "supply_signal": "수급 요약 (예: 기관↑, 외국인↑, 개인 우세)",
      "supply_detail": "수급 상세 (예: 외인 매도·기관 매수, 기관·외인 동반 매수)",
      "price_vs_ma5": "현재가 vs MA5 분석 (예: 근접 — 눌림목 구간, 상회 — 상승 모멘텀)",
      "ma_alignment": "이평선 배열 상태 (예: 정배열 유지 중, 역배열 → 반전 시도)",
      "bollinger_status": "볼린저밴드 상태 (예: 중심선 수렴 중, 하단 근접 — 반등 가능)",
      "buy_low": 매수하한가(숫자),
      "buy_high": 매수상한가(숫자),
      "target_low": 목표하한가(숫자),
      "target_high": 목표상한가(숫자),
      "stop_loss": 손절가(숫자),
      "analyst_target": 증권사목표가(숫자 또는 null),
      "reasoning": "추천 근거 2-3문장 (실제 수치 포함)",
      "key_catalyst": "핵심 상승 촉매 한 줄"
    }
  ],
  "market_summary": "전반적 시장 흐름 요약 (2-3문장)",
  "trade_strategy": "오늘 매매 전략 핵심 원칙 (공통 적용, 2-3문장)"
}`

    const text = await callGeminiForAIAnalysis(prompt)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Gemini 응답 파싱 실패')
    const parsed = JSON.parse(jsonMatch[0])

    // 실제 데이터로 덮어쓰기
    const enriched: AIStockRecommendation[] = (parsed.recommendations ?? []).map((r: AIStockRecommendation) => {
      const p = realPrices[r.ticker]
      const t = techMap[r.ticker]
      const currentPrice = p?.price ?? p?.previousClose ?? null
      return {
        ...r,
        current_price: currentPrice,
        rsi: t?.rsi14 ?? null,
        ma5:  t?.ma5  ?? null,
        ma20: t?.ma20 ?? null,
        ma60: t?.ma60 ?? null,
        high_52w: t?.high52w ?? null,
        low_52w:  t?.low52w  ?? null,
        // AI 생성 신호가 없으면 실제 데이터 기반 신호 사용
        price_signal:     r.price_signal     || (t?.priceSignal    ?? '데이터 없음'),
        range_52w_signal: r.range_52w_signal || (t?.range52wSignal ?? '데이터 없음'),
        price_vs_ma5:     r.price_vs_ma5     || (t?.ma5Signal      ?? '데이터 없음'),
        ma_alignment:     r.ma_alignment     || (t?.maAlignmentSignal ?? '데이터 없음'),
        bollinger_status: r.bollinger_status || (t?.bollingerStatusText ?? '데이터 없음'),
        from: new Date().toISOString(),
      }
    })

    const result: AIAnalysisResult = {
      recommendations: enriched,
      market_summary: parsed.market_summary ?? '시장 데이터 없음',
      trade_strategy: parsed.trade_strategy ?? '',
      analysis_date: today,
      news_count: freshNews.length,
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('AI 분석 오류:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
