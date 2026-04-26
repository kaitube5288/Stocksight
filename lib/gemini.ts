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
        { model: 'gemini-2.5-flash', generationConfig: { temperature: 0.1 } },
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
  trade_type: '단타' | '스윙' | '중기'
  hold_period: string
  per: number | null
  pbr: number | null
  roe: number | null
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
  const prompt = `당신은 10년 경력의 한국 주식 퀀트 애널리스트입니다. 아래 데이터를 분석하여 3가지 투자 유형별로 각 3종목씩, 총 9종목을 추천하세요.

## 오늘 날짜
${params.date}

## 오늘 오전 주요 뉴스 (전날 09:00 ~ 오늘 08:40)
${params.todayNews}

## 오늘 DART 공시
${params.dartDisclosures}

## 유사 과거 패턴 (역사적 데이터)
${params.historicalPatterns}

## 현재 시장 지표
${params.marketContext}

## 투자 유형 정의
- 단타 (trade_type: "단타", hold_period: "1일 목표"): 당일 장중 매수 → 당일 고점 매도. 당일 상승 모멘텀이 강한 종목.
- 스윙 (trade_type: "스윙", hold_period: "3~5일 목표"): 전일 종가 매수 → 3~5 영업일 내 목표가 달성. 단기 추세가 형성 중인 종목.
- 중기 (trade_type: "중기", hold_period: "2~4주 목표"): 전일 종가 매수 → 2~4주 내 목표가 달성. 펀더멘털 이벤트(실적, 수주) 기반 종목.

## 확률 산정 기준 (합산 점수 = probability, 100점 만점)
각 종목을 아래 6가지 항목으로 평가하여 점수를 합산하세요:

1. 뉴스 직접 언급 및 긍정적 내용: 0~20점
2. DART 공시 호재(실적 서프라이즈, 수주, 계약 등): 0~20점
3. 과거 동일 패턴에서 상승 기록: 0~15점
4. 섹터/테마 강세 모멘텀: 0~10점
5. 시장 지표 우호적(코스피 상승, 환율 안정): 0~10점
6. 펀더멘털 지표 (아래 세부 기준, 합산 0~25점):
   - PER: 업종 평균 대비 낮을수록 저평가 (+0~5점)
   - PBR: 1 이하면 자산 대비 저평가 (+0~5점)
   - ROE: 15% 이상이면 수익성 우수 (+0~5점)
   - 부채비율: 100% 이하면 재무 안정 (+0~5점)
   - 영업이익률 / EPS 성장률: 전년 대비 지속 증가 여부 (+0~5점)

각 유형별로 합산 점수 높은 순으로 3종목씩 반드시 채우세요. 동일 종목이 여러 유형에 중복되지 않도록 하세요.

## 가격 기준
- 단타: 매수가 = 당일 시가 예상, 목표가 = 당일 예상 고점
- 스윙: 매수가 = 전일 종가, 목표가 = 3~5일 내 예상 고점
- 중기: 매수가 = 전일 종가, 목표가 = 2~4주 내 목표가

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
- recommendations 배열은 반드시 9개 항목: 인덱스 0~2는 단타 종목, 3~5는 스윙 종목, 6~8은 중기 종목 순서로 작성
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
