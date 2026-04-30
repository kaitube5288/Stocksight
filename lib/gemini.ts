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
  // 503 서버 과부하만 내부 재시도 (429는 같은 키로 재시도해도 의미 없으므로 즉시 throw)
  const delays = [4000, 10000]
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
      const is503 =
        lastErr.message.includes('503') ||
        lastErr.message.toLowerCase().includes('service unavailable') ||
        lastErr.message.toLowerCase().includes('high demand')
      if (is503 && i < delays.length) {
        await new Promise(r => setTimeout(r, delays[i]))
        continue
      }
      throw lastErr
    }
  }
  throw lastErr
}

// 모델 우선순위: 2.5-flash → 1.5-flash → 1.5-pro (2.0-flash는 신규 사용자 비활성화)
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]

async function callGemini(prompt: string): Promise<string> {
  if (API_KEYS.length === 0) throw new Error('Gemini API 키가 설정되지 않았습니다 (.env.local 확인)')

  for (let ki = 0; ki < API_KEYS.length; ki++) {
    const genAI = new GoogleGenerativeAI(API_KEYS[ki])
    let keyRateLimited = false

    for (const modelName of FALLBACK_MODELS) {
      if (keyRateLimited) break
      try {
        return await callModel(genAI, modelName, prompt)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // 전체 에러 메시지 로그 (잘리면 503 등이 숨어 디버깅 불가)
        console.warn(`[Gemini] 키${ki + 1}/${modelName} 실패: ${msg.slice(0, 300)}`)

        // 429/할당량: 같은 키의 다른 모델도 실패하므로 즉시 다음 키로
        const is429 =
          msg.includes('429') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('too many requests')
        if (is429) { keyRateLimited = true; break }

        // 그 외 모든 에러(503, 404, 네트워크, fetch 오류 등):
        // throw 하지 않고 다음 모델 시도 → 모든 키/모델 소진 후에만 최종 에러
        continue
      }
    }

    // 키 전환 시 0.5초 대기
    if (ki < API_KEYS.length - 1) await new Promise(r => setTimeout(r, 500))
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
  technicalContext?: string
  candidatesContext?: string
}): Promise<GeminiAnalysisResult> {
  const prompt = `당신은 한국 주식 전문 애널리스트입니다. 아래 수집된 데이터를 4가지 분석 기준으로 종합 평가하여, 오늘 주식시장이 열렸을 때 상승 가능성이 가장 높은 코스피/코스닥 종목을 추천하세요.

⚠️ 핵심 필터 규칙 (반드시 준수):
1. RSI > 70 종목은 과매수 구간 — 절대 추천 금지
2. MACD↓(데드크로스) 종목은 하락 모멘텀 — 추천 금지
3. 추세↓(하락추세) 종목은 중기 추천 금지
4. PBR > 5 이상 고평가 종목은 중기 추천 금지

⚠️ 하락장 대응 규칙:
- KOSPI/KOSDAQ이 하락 중이거나 외부 악재가 크면 market_outlook 앞에 "[하락장 위험]" 명시
- 하락장에서는 단타/스윙을 방어주(금융·통신·제약·필수소비재) 위주로 선택
- 하락장에서 단타 expected_return 목표를 +2~3%로 낮춰 현실적으로 설정

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
${params.technicalContext ? `\n## 뉴스 관련 섹터 기술적 지표 (실시간)\n${params.technicalContext}` : ''}
${params.candidatesContext ? `\n## 후보 종목 실제 데이터 (PER·PBR·ROE·RSI·MACD·추세)\n${params.candidatesContext}` : ''}

---

## 분석 기준 (4가지 종합 → probability 점수)

### 1. 재무 지표 (0~25점)
- PER 낮을수록 저평가 / PBR 1 이하 자산 저평가 / ROE 15% 이상 우수
- 후보 종목 실제 데이터의 수치를 반드시 참고할 것

### 2. 기업 본질 (0~20점)
- 경쟁 우위(Moat) 유무 / 시장 점유율 / 경영진 신뢰도

### 3. 기술적 분석 (0~25점) — 핵심 필터 적용
- RSI: 30~65 구간이 최적 (70↑ 추천 금지)
- MACD: 골든크로스(MACD↑)만 매수 신호로 인정
- 추세: 상승추세(추세↑) 우선, 하락추세(추세↓) 기피

### 4. 거시경제 & 시장 (0~30점)
- 뉴스 직접 언급 / DART 공시 호재 / 섹터 로테이션 / 기관·외국인 수급

---

## 투자 유형별 추천 (총 9종목)
- 단타 (1일 목표): RSI 40~65 + MACD↑ 또는 강한 뉴스 모멘텀, 매수가 = 당일 시가 예상
- 스윙 (3~5일 목표): 추세↑ + MACD↑, 매수가 = 전일 종가
- 중기 (2~4주 목표): ROE 10%↑ + PBR 3 이하 + 추세↑, 매수가 = 전일 종가

각 유형별 3종목씩, probability 높은 순. 동일 종목 중복 금지.
후보 종목 데이터에 없는 종목을 추천할 경우 reasoning에 이유를 명시.

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
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
      "reasoning": "추천 이유 (2-3문장, 실제 PER·RSI·MACD 수치 근거 포함)",
      "key_catalyst": "핵심 상승 촉매 (한 줄)"
    }
  ],
  "market_outlook": "전반적 시장 전망 — 하락장 예상 시 [하락장 위험] 으로 시작",
  "risk_factors": "주요 하방 위험 요소 (2-3문장)"
}`

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Gemini 응답에서 JSON을 파싱할 수 없습니다')
  const parsed = JSON.parse(jsonMatch[0]) as GeminiAnalysisResult
  // 필수 필드 누락 방어
  if (!Array.isArray(parsed.recommendations)) parsed.recommendations = []
  if (!parsed.market_outlook) parsed.market_outlook = '시장 전망 데이터 없음'
  if (!parsed.risk_factors)   parsed.risk_factors   = '위험 요소 데이터 없음'
  return parsed
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
