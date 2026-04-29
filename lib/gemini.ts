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

// 503/429 시 같은 모델 backoff 재시도 (최대 3회)
async function callModel(genAI: GoogleGenerativeAI, modelName: string, prompt: string): Promise<string> {
  const delays = [4000, 8000, 15000]
  let lastErr: Error = new Error('unknown')
  for (let i = 0; i <= delays.length; i++) {
    try {
      const model = genAI.getGenerativeModel(
        { model: modelName, generationConfig: { temperature: 0.1 } },
        { apiVersion: 'v1beta' }
      )
      const result = await model.generateContent(prompt)
      return result.response.text()
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      const isTransient =
        lastErr.message.includes('503') ||
        lastErr.message.includes('429') ||
        lastErr.message.toLowerCase().includes('service unavailable') ||
        lastErr.message.toLowerCase().includes('high demand') ||
        lastErr.message.toLowerCase().includes('too many requests') ||
        lastErr.message.toLowerCase().includes('quota')
      if (isTransient && i < delays.length) {
        await new Promise(r => setTimeout(r, delays[i]))
        continue
      }
      throw lastErr
    }
  }
  throw lastErr
}

// 모델 우선순위: 2.0-flash(가장 안정) → 2.5-flash → 1.5-flash → 1.5-pro
const FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]

async function callGemini(prompt: string): Promise<string> {
  if (API_KEYS.length === 0) throw new Error('Gemini API 키가 설정되지 않았습니다 (.env.local 확인)')

  for (let ki = 0; ki < API_KEYS.length; ki++) {
    const genAI = new GoogleGenerativeAI(API_KEYS[ki])
    for (const modelName of FALLBACK_MODELS) {
      try {
        return await callModel(genAI, modelName, prompt)
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e))
        const msg = err.message
        console.warn(`[Gemini] 키${ki + 1}/${modelName} 실패: ${msg.slice(0, 120)}`)
        const isRetryable =
          msg.includes('429') || msg.includes('503') || msg.includes('404') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('too many requests') ||
          msg.toLowerCase().includes('service unavailable') ||
          msg.toLowerCase().includes('high demand') ||
          msg.toLowerCase().includes('not found')
        if (isRetryable) continue
        throw err
      }
    }
    // 키 전환 시 1초 대기 (연속 rate limit 방지)
    if (ki < API_KEYS.length - 1) await new Promise(r => setTimeout(r, 1000))
  }

  throw new Error(`모든 Gemini API 키/모델 시도 실패 (키 ${API_KEYS.length}개, 모델 ${FALLBACK_MODELS.length}개)`)
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
  const prompt = `당신은 한국 주식 전문 애널리스트입니다. 아래 수집된 데이터를 4가지 분석 기준으로 종합 평가하여, 오늘 주식시장이 열렸을 때 상승 가능성이 가장 높은 코스피/코스닥 종목을 추천하세요. 각 추천 종목의 매수가·목표 매도가도 함께 제시하세요.

⚠️ 만약 뉴스·시장 지표 분석 결과 오늘 하락장이 예상된다면 market_outlook 앞에 반드시 "[하락장 위험]" 을 명시하고 투자 자제를 권고하세요.

---

## 오늘 날짜
${params.date}

## 수집된 뉴스 (전날 09:00 KST ~ 오늘 08:40 KST)
${params.todayNews}

## 오늘 DART 공시
${params.dartDisclosures}

## 현재 시장 지표 (KOSPI / KOSDAQ / USD-KRW)
${params.marketContext}

## 유사 과거 패턴
${params.historicalPatterns}

---

## 분석 기준 (아래 4가지를 종합하여 probability 점수 산정)

### 1. 재무제표 핵심 지표 (0~25점)
- PER: 낮을수록 저평가 가능성
- PBR: 1 이하면 자산 대비 저평가
- ROE: 15% 이상 선호 (높을수록 수익성 우수)
- 부채비율: 낮을수록 재무 안정성 높음
- 영업이익률 / 순이익률: 지속 성장 여부
- EPS 성장률: 꾸준히 증가하는지

### 2. 기업 본질 분석 (0~20점)
- 사업 모델의 이해 가능성 (버핏의 "이해할 수 있는 기업")
- 경쟁 우위(해자, Moat) 유무
- 시장 점유율 및 업종 내 위치
- 경영진 능력 및 주주 친화 정책

### 3. 기술적 분석 (0~25점)
- 이동평균선 (5·20·60·120일): 추세 파악
- 거래량: 가격 변동과 함께 분석 (거래량 없는 상승은 신뢰도 낮음)
- RSI: 70 이상 과매수 주의, 30 이하 과매도 반등 기대
- MACD: 골든크로스(매수 신호) / 데드크로스(매도 신호)
- 볼린저밴드: 가격 변동성 및 지지·저항 구간
- 지지선 / 저항선: 과거 가격 흐름 분석

### 4. 거시경제 & 시장 환경 (0~30점)
- 뉴스 직접 언급 및 긍정적 내용
- DART 공시 호재 (실적 서프라이즈, 수주, 계약 등)
- 금리 동향 (금리↑ → 성장주 불리)
- 환율 변화 (수출 기업에 큰 영향)
- 섹터 로테이션 (어느 업종이 유망한지)
- 기관·외국인 수급 동향

---

## 투자 유형별 추천 (총 9종목, 코스피·코스닥 혼합 추천)
- 단타 (hold_period: "1일 목표"): 당일 상승 모멘텀 강한 종목, 매수가 = 당일 시가 예상
- 스윙 (hold_period: "3~5일 목표"): 단기 추세 형성 중, 매수가 = 전일 종가
- 중기 (hold_period: "2~4주 목표"): 펀더멘털 이벤트(실적·수주) 기반, 매수가 = 전일 종가

각 유형별 probability 높은 순 3종목씩. 동일 종목 중복 금지.

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
- recommendations 배열 9개: 인덱스 0~2 단타, 3~5 스윙, 6~8 중기
{
  "recommendations": [
    {
      "name": "종목명",
      "ticker": "6자리 종목코드",
      "buy_price": 매수가격(숫자),
      "sell_price": 목표매도가(숫자),
      "expected_return": 예상수익률(숫자, % 단위),
      "probability": 상승확률(0-100 숫자),
      "reasoning": "추천 이유 (2-3문장, 재무·기술·거시 근거 포함)",
      "key_catalyst": "핵심 상승 촉매 (한 줄)"
    }
  ],
  "market_outlook": "전반적 시장 전망 — 하락장 예상 시 [하락장 위험] 으로 시작",
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
