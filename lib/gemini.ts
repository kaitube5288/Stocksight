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

export async function callGemini(prompt: string): Promise<string> {
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
  performanceInsights?: string
  marketFeedbackInsights?: string
  strategyImprovements?: string
}): Promise<GeminiAnalysisResult> {
  const prompt = `당신은 한국 주식 전문 애널리스트입니다. 아래 수집된 데이터를 4가지 분석 기준으로 종합 평가하여, 오늘 주식시장이 열렸을 때 상승 가능성이 가장 높은 코스피/코스닥 종목을 추천하세요.

⚠️ 핵심 필터 규칙 (반드시 준수):
1. RSI > 75 종목은 과매수 구간 — 추천 금지 (KOSPI/KOSDAQ 당일 +1%↑ 강세장에서는 RSI 80까지 예외 허용)
2. MACD↓(데드크로스) 종목은 하락 모멘텀 — 추천 금지
3. 추세↓(하락추세) 종목은 중기 추천 금지
4. PBR > 5 이상 고평가 종목은 중기 추천 금지
${params.strategyImprovements ? `\n⚠️ 전략 보완 규칙 (이전 손실 자기진단 기반 — 위 핵심 필터와 동일 수준으로 반드시 준수):\n${params.strategyImprovements}\n` : ''}
⚠️ 하락장 판단 기준 및 대응 규칙:

아래 4개 영역 중 2개 이상 해당하거나 1개라도 강도가 강하면 "[하락장 위험]"으로 판단한다.

[1. 거시 경제 지표]
- 장단기 금리 역전: 미국 10년물 금리 < 2년물 금리 (경기 침체 선행 신호)
- 급격한 금리 인상: 연준·한은이 단기간 큰 폭 인상 예고 또는 실행
- 경기 선행 지수(CLI) 6개월 이상 하락 추세 (제조업 PMI 50 하회 포함)

[2. 기술적 분석 지표]
- 데드크로스: KOSPI·KOSDAQ 50일선이 200일선을 하향 돌파
- 거래량 동반 급락: 지수 하락 시 평균 대비 150% 이상 거래량 수반 (투매 신호)
- 시장 폭(Breadth) 악화: 지수 상승에도 상승 종목 수가 감소 (소수 대형주만 견인)

[3. 시장 심리·과열 지표]
- VIX(공포 지수) 30 초과 또는 단기간 급등 (20→30+ 이상)
- 신용융자 잔고 사상 최고치 경신 (반대매매 연쇄 폭락 위험)
- 버핏 지수(시가총액/GDP) 역사적 평균 대비 과도하게 높음

[4. 외부 충격·블랙스완]
- 지정학적 리스크 현실화: 전쟁 확전, 원자재·공급망 붕괴
- 주도 대형주(빅테크·삼성전자 등) 실적 쇼크 (시장 전체 투자심리 냉각)
- 환율 급등(원화 급락), 외국인 대규모 순매도 지속

[하락장 확인 시 행동 규칙]
- market_outlook 앞에 반드시 "[하락장 위험]" 명시
- 단타/스윙은 방어주(금융·통신·제약·필수소비재) 위주로 선택
- 단타 expected_return 목표를 +2~3%로 낮춰 현실적으로 설정
- 중기 추천 비중 축소, 손절 기준을 더 타이트하게 설정

---

## 오늘 날짜
${params.date}
${params.performanceInsights ? `\n## 🔄 과거 추천 성과 피드백 (자동 학습 — 최우선 반영)\n${params.performanceInsights}\n` : ''}${params.marketFeedbackInsights ? `\n## 📈 전일 장마감 급등 패턴 분석 (수혜주 우선 반영)\n${params.marketFeedbackInsights}\n` : ''}
## 수집된 뉴스 (당일 08:40 KST 실시간 수집 — 임팩트 티어별 분류)
★ HIGH: 실적·수주·수급·정책 → 섹터/종목 즉각 반영 필수
• MEDIUM: 일반 뉴스 → 참고 반영  ○ LOW: 전망·우려 → 배경 참고
${params.todayNews}

## 오늘 DART 공시
${params.dartDisclosures}

## 현재 시장 지표 (KOSPI / KOSDAQ / USD-KRW)
${params.marketContext}
${params.marketContext.includes('[🚀 불장 감지]') ? `
⚠️ 불장 모멘텀 전략 (강세장 전용 — 위 필터보다 우선 적용):
- 🚀신고가돌파 태그 종목을 단타/스윙 우선 후보로 선택
- RSI 75 초과여도 추세↑ + 거래량급증 + 신고가 돌파이면 단타/스윙 추천 가능 (RSI 80 상한)
- 저점매수(볼린저 하단) 전략 대신 고점돌파 모멘텀 전략 우선 적용
- AI/IT 플랫폼 뉴스 기반 수혜주(NAVER·LG전자·통신사 등)는 RSI 무관하게 단타 우선 검토
- expected_return 목표를 +3~5%로 상향 가능 (강세장 모멘텀은 더 크게 움직임)
` : ''}

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
- RSI: 30~75 구간이 유효 (75↑만 추천 금지 — 불장 강세장에서는 RSI 80까지 예외 허용)
- MACD: 골든크로스(MACD↑) 우선, 상승추세이면 중립도 허용
- 추세: 상승추세(추세↑) 우선, 하락추세(추세↓) 기피

### 4. 거시경제 & 시장 (0~30점)
- 뉴스 직접 언급 / DART 공시 호재 / 섹터 로테이션 / 기관·외국인 수급

---

## 투자 유형별 추천 (총 9종목)
- 단타 (1일 목표): RSI 35~65 + (MACD↑ 우선 또는 거래량급증↑) + 강한 뉴스/공시 모멘텀, 매수가 = 당일 시가 예상
  * 볼린저밴드 하단 근접(buy) 종목 우선 / 캔들패턴 hammer·doji 우선
  * 추세↓ 종목 단타도 금지
  * RSI 65 초과 종목은 단타 절대 금지 — 이미 오른 종목 고점 진입 위험
- 스윙 (3~5일 목표): 추세↑ + RSI 45~75 + MACD↑ 또는 거래량급증, 매수가 = 전일 종가
  * 지지선 근접 종목 우선 / 불장 강세장에서만 RSI 80까지 예외 허용
- 중기 (2~4주 목표): ROE 8%↑ + PBR 3 이하 + 추세↑ + RSI 70 미만, 매수가 = 전일 종가
  * PER 낮고 PBR 1 이하면 가산점

각 유형별 3종목씩, probability 높은 순. 동일 종목 중복 금지.
probability 최대값은 95로 제한. 100은 절대 사용 금지.
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
