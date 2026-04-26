import { GoogleGenerativeAI } from '@google/generative-ai'

const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[]

// 기존 GEMINI_API_KEY 변수도 fallback으로 지원
if (API_KEYS.length === 0 && process.env.GEMINI_API_KEY) {
  API_KEYS.push(process.env.GEMINI_API_KEY)
}

async function callGemini(prompt: string): Promise<string> {
  if (API_KEYS.length === 0) throw new Error('Gemini API 키가 설정되지 않았습니다 (.env.local 확인)')

  for (const key of API_KEYS) {
    try {
      const genAI = new GoogleGenerativeAI(key)
      const model = genAI.getGenerativeModel(
        { model: 'gemini-2.5-flash' },
        { apiVersion: 'v1beta' }
      )
      const result = await model.generateContent(prompt)
      return result.response.text()
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e))
      const isQuota =
        err.message.includes('429') ||
        err.message.toLowerCase().includes('quota') ||
        err.message.toLowerCase().includes('too many requests')

      if (isQuota) continue
      throw err
    }
  }

  throw new Error(`모든 Gemini API 키의 할당량이 초과되었습니다 (${API_KEYS.length}개 키 시도)`)
}

export type GeminiRecommendation = {
  name: string
  ticker: string
  buy_price: number
  sell_price: number
  expected_return: number
  probability: number
  reasoning: string
  key_catalyst: string
}

export type GeminiAnalysisResult = {
  recommendations: GeminiRecommendation[]
  market_outlook: string
  risk_factors: string
}

export async function generateRecommendations(params: {
  todayNews: string
  dartDisclosures: string
  historicalPatterns: string
  marketContext: string
  date: string
}): Promise<GeminiAnalysisResult> {
  const prompt = `당신은 한국 주식 시장 전문 AI 애널리스트입니다. 다음 데이터를 분석하여 오늘 상승 가능성이 높은 한국 주식 5종목을 추천해주세요.

## 오늘 날짜
${params.date}

## 오늘 오전 주요 뉴스 (전날 22:00 ~ 오늘 08:40)
${params.todayNews}

## 오늘 DART 공시
${params.dartDisclosures}

## 유사 과거 패턴 (역사적 데이터)
${params.historicalPatterns}

## 현재 시장 지표
${params.marketContext}

## 분석 기준
- 뉴스의 종목별 영향도를 분석하세요
- 과거 유사 사건에서 어떤 종목이 얼마나 올랐는지 참고하세요
- DART 공시가 주가에 미치는 영향을 반영하세요
- 섹터 모멘텀과 테마를 고려하세요
- 매수가는 전일 종가 기준, 매도가는 당일 목표가로 설정하세요

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "recommendations": [
    {
      "name": "종목명",
      "ticker": "6자리 종목코드",
      "buy_price": 매수가격(숫자),
      "sell_price": 목표매도가(숫자),
      "expected_return": 예상수익률(숫자, % 단위),
      "probability": 상승확률(0-100 숫자),
      "reasoning": "추천 이유 (2-3문장, 구체적 근거 포함)",
      "key_catalyst": "핵심 상승 촉매 (한 줄)"
    }
  ],
  "market_outlook": "전반적 시장 전망 (2-3문장)",
  "risk_factors": "주요 하방 위험 요소 (2-3문장)"
}`

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Gemini 응답에서 JSON을 파싱할 수 없습니다')
  return JSON.parse(jsonMatch[0]) as GeminiAnalysisResult
}

export async function analyzeNewsSimilarity(params: {
  currentNews: string
  historicalEvents: string
}): Promise<{ similar_events: string[]; affected_stocks: string[]; analysis: string }> {
  const prompt = `한국 주식 시장 전문가로서 현재 뉴스와 과거 유사 사건을 비교 분석해주세요.

## 현재 뉴스
${params.currentNews}

## 과거 주요 사건 DB
${params.historicalEvents}

현재 뉴스와 유사한 과거 사건을 찾고, 그때 영향받은 종목을 분석해주세요.

JSON 형식으로만 응답:
{
  "similar_events": ["유사 과거 사건 1", "유사 과거 사건 2"],
  "affected_stocks": ["영향받을 종목코드1", "영향받을 종목코드2"],
  "analysis": "상세 분석 내용"
}`

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('JSON 파싱 실패')
  return JSON.parse(jsonMatch[0])
}
