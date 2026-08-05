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
  stop_loss: number
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
  eventBeneficiaryContext?: string
  interestRates?: string   // 미국 국채 금리 + 장단기 역전 여부
  ratePolicyNews?: string  // 금리·정책 관련 뉴스 필터링 결과
  bounceContext?: string   // 전일 급락 + 과매도 반등 후보 (단타 최우선 검토)
  kospiMA20Warning?: string // KOSPI 20일선 하회 경고
}): Promise<GeminiAnalysisResult> {
  const prompt = `당신은 한국 주식 전문 애널리스트입니다. 아래 수집된 데이터를 4가지 분석 기준으로 종합 평가하여, 오늘 주식시장이 열렸을 때 상승 가능성이 가장 높은 코스피/코스닥 종목을 추천하세요.

⚠️ 핵심 필터 규칙 (반드시 준수 — 위반 시 추천 불가):
1. RSI > 60 종목은 단타 추천 금지 / RSI > 75 종목은 스윙·중기 추천 금지 (강세장 불장에서는 단타 RSI 65, 스윙 RSI 80까지 예외 허용)
2. MACD↓(데드크로스) 종목은 원칙적으로 추천 금지. 단, 불장(KOSPI/KOSDAQ +0.5% 이상, 마켓 컨텍스트에 "[🚀 불장 감지]" 또는 "[⚡ 단기 반등]" 표시) 이고 RSI 28~48(과매도 회복 구간) + 거래량 1.5배 이상인 종목은 단타에 한해 예외 허용. 이 경우 reasoning에 "MACD 후행 지표 — 거래량 기반 순환 반등 포착, 단타 목표 +2~3%" 명시 필수
3. 추세↓(하락추세) 종목은 스윙·중기 추천 금지. 단타는 불장(2번과 동일 조건)에서 RSI 28~48 + 거래량 1.5배 이상이면 예외 허용 — 순환 반등 첫날은 추세 지표가 아직 'down'을 유지하므로 거래량이 신뢰 근거
4. PBR > 5 이상 고평가 종목은 중기 추천 금지
5. 오늘 수집된 뉴스에서 처음 언급된 종목/섹터는 단타 추천 금지 — 뉴스 선반영으로 당일 이미 주가 반응 완료, 다음날 시가 매수 시 고점 진입 위험
6. BB상단근접(볼린저밴드 상단 근접) 종목은 단타·스윙 추천 금지 — 과열 구간으로 조정 가능성 높음
7. 외국인+기관 동반 순매도(foreignNet < 0 AND institutionNet < 0) 종목은 단타 추천 금지 — 수급 역풍으로 당일 하락 압력 강함
8. 단타는 MA5 > MA20 정배열 미확인 종목 추천 금지 — 단기 상승 흐름 없으면 당일 반등 기대 불가
9. 전일 변동률(전일+X.X%) 기준 규칙:
   - 전일 +10% 이상: 단타 추천 금지 (갭상승 이후 되돌림 위험) — 해당 종목 추천 시 reasoning에 "전일 N% 급등 — 단기 반락 위험 주의" 반드시 명시
   - 전일 -10% 이상: 스윙·중기 추천 금지 (추가 하락 가능성) — 해당 종목 추천 시 reasoning에 "전일 N% 급락 — 추가 하락 위험 주의" 반드시 명시
   - 전일 +5~10%: reasoning에 "전일 N% 급등 — 단기 반락 주의" 포함
   - 전일 -5~10%: reasoning에 "전일 N% 급락 — 기술적 반등 기대" 포함
   - 전일 ±5% 미만: 변동률 별도 언급 불필요
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
- 단타 추천은 3개에서 1개로 축소 (나머지 2슬롯: name="현금보유", ticker="000000", buy_price=0, sell_price=0, stop_loss=0, expected_return=0, probability=0, reasoning="하락장 위험 — 현금 보유 권고", key_catalyst="시장 하락 위험")
- 단타/스윙은 방어주(금융·통신·제약·필수소비재) 위주, 추세↑ 필수
- 단타 expected_return 목표를 +2~3%로 낮춰 현실적으로 설정
- 중기 추천 비중 축소 (3개→2개), 손절 기준을 더 타이트하게 설정

---

## 오늘 날짜
${params.date}
${params.performanceInsights ? `\n## 🔄 과거 추천 성과 피드백 (자동 학습 — 최우선 반영)\n${params.performanceInsights}\n` : ''}${params.marketFeedbackInsights ? `\n## 📈 전일 장마감 급등 패턴 분석 (수혜주 우선 반영)\n${params.marketFeedbackInsights}\n` : ''}
${params.eventBeneficiaryContext ? `## 🎯 이벤트 수혜주 사전 분석 (시장 기대감 반영 — 최우선 참고)\n${params.eventBeneficiaryContext}\n` : ''}## 수집된 뉴스 (당일 08:40 KST 실시간 수집 — 임팩트 티어별 분류)
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
${params.interestRates ? `
## 금리 현황 (장단기 역전 = 하락장 [1. 거시 경제 지표] 직접 반영)
${params.interestRates}
` : ''}${params.ratePolicyNews ? `
## 금리·정책 뉴스 (거시 환경 판단 — 하락장 기준 [1][3] 영역 체크)
${params.ratePolicyNews}
` : ''}
## 유사 과거 패턴
${params.historicalPatterns}
${params.technicalContext ? `\n## 뉴스 관련 섹터 기술적 지표 (실시간)\n${params.technicalContext}` : ''}
${params.candidatesContext ? `\n## 후보 종목 실제 데이터 (PER·PBR·ROE·RSI·MACD·추세)\n${params.candidatesContext}` : ''}
${params.bounceContext ? `\n${params.bounceContext}\n` : ''}${params.kospiMA20Warning ? `\n## ⚠️ 시장 구조 경고\n${params.kospiMA20Warning}\n` : ''}
---

## 분석 기준 (4가지 종합 → probability 점수)

### 1. 재무 지표 (0~25점)
- PER 낮을수록 저평가 / PBR 1 이하 자산 저평가 / ROE 15% 이상 우수
- 후보 종목 실제 데이터의 수치를 반드시 참고할 것

### 2. 기업 본질 (0~20점)
- 경쟁 우위(Moat) 유무 / 시장 점유율 / 경영진 신뢰도

### 3. 기술적 분석 (0~25점) — 핵심 필터 적용
- RSI: 단타 35~55 / 스윙 35~65 / 중기 <60 구간이 유효 (상한 초과·28 미만 극단 과매도 추천 금지 — 불장 예외 있음)
- MACD: 골든크로스(MACD↑) 우선, 상승추세이면 중립도 허용. 데드크로스(MACD↓) 절대 금지
- 추세: 상승추세(추세↑) 우선, 하락추세(추세↓) 기피
- 볼린저밴드: 하단 근접(BB하단근접) 매수 신호 우선 / 상단 근접(BB상단근접) 단타·스윙 금지
- 수급: 외국인+기관 동반 순매수 종목 우선 / 동반 순매도 종목 단타 금지

### 4. 거시경제 & 시장 (0~30점)
- 뉴스 직접 언급 / DART 공시 호재 / 섹터 로테이션 / 기관·외국인 수급

---

## 추천 품질 기준 — 다중 조건 동시 만족 종목 우선

[강력 신호 = 단타 1순위]
아래 5개 조건 중 3개 이상 동시 만족 시에만 단타 추천:
① RSI 30~50 (과매도 회복 구간)
② MACD 골든크로스 (MACD↑)
③ 볼린저밴드 하단 근접 (BB하단근접)
④ 거래량 1.5배 이상 급증
⑤ 추세↑ 또는 추세- (횡보)

→ 조건 충족 개수를 reasoning 첫 줄에 반드시 명시
   예: "신호강도 4/5 — RSI 38 + MACD↑ + BB하단 + 거래량2.1x 동시 만족"

[보통 신호 = 스윙/중기만]
3개 미만 만족 → 단타 금지, 스윙·중기만 검토

## 규칙 기반 진입 전략 (AI 예측보다 이 규칙 우선)

[단타 진입 규칙]
- 반등형: 전일 -7% 이상 급락 + RSI < 40 + 추세 횡보/상승 → 기술적 반등 단타 (🔄반등후보 섹션 최우선 활용)
- 돌파형: 🚀신고가돌파 + 거래량 2배↑ + 추세↑ → 모멘텀 단타 (불장 한정)
- 눌림형: RSI 35~50 + BB하단근접 + MACD↑ + 추세↑ → 눌림목 단타

[스윙 진입 규칙]
- 지지선 반등: 지지선근접 + RSI 40 이하 + MACD↑ + 거래량 증가 → 지지선 반등 스윙

[중기 진입 규칙]
- 저평가 우량주: ROE 10%↑ + PBR 1.5 이하 + RSI 50 이하 + 추세↑ → 저평가 우량주 중기

→ 위 규칙에 해당하는 패턴명을 key_catalyst에 반드시 포함
   예: "반등형 단타", "눌림목 단타", "지지선 반등 스윙", "저평가 우량주 중기"

## 투자 유형별 추천 (총 9종목)
- 단타 (1일 목표): 추세↑ 필수 + MA5>MA20 정배열 필수 + RSI 35~55 (상한 강화) + MACD↑ 필수 + (BB하단근접 OR 거래량급증1.5x↑ OR hammer·doji 패턴) 중 1개 이상, 매수가 = 당일 시가 예상
  * 볼린저밴드 하단 근접(buy) 종목 최우선 / 외국인+기관 동반 순매도 종목 단타 금지
  * 오늘 뉴스에 직접 언급된 종목 단타 금지 (이미 선반영) — 뉴스 미언급 기술적 신호 종목 발굴
  * 추세↓ 종목 단타 절대 금지 / RSI 55 초과 종목 단타 절대 금지 (강세장 불장 시 65까지 예외)
  * BB상단근접 종목 단타 금지 — 과열 구간, 당일 조정 위험
- 스윙 (3~5일 목표): 추세↑ 필수 + RSI 35~65 (상한 강화) + MACD↑ AND (거래량급증 OR BB하단근접 OR 지지선근접) 이중 확인, 매수가 = 전일 종가
  * 추세↓ 종목 스윙 금지 / BB상단근접 종목 스윙 금지 / 불장 강세장에서만 RSI 80까지 예외 허용
- 중기 (2~4주 목표): 추세↑ 필수 + ROE 10%↑ (기준 상향) + PBR 2 이하 (기준 강화) + RSI 60 미만 (기준 강화), 매수가 = 전일 종가
  * 추세↓ 종목 중기 금지 / PER 낮고 PBR 1 이하면 가산점 / 외국인 순매수(foreignNet > 0) 종목 우선

각 유형별 3종목씩, probability 높은 순. 동일 종목 중복 금지.
probability 최대값은 95로 제한. 100은 절대 사용 금지.
후보 종목 데이터에 없는 종목을 추천할 경우 reasoning에 이유를 명시.

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
- recommendations 배열 9개: 인덱스 0~2 단타, 3~5 스윙, 6~8 중기
- stop_loss: 단타는 매수가×0.95(-5%), 스윙은 매수가×0.96(-4%), 중기는 매수가×0.94(-6%)
{
  "recommendations": [
    {
      "name": "종목명",
      "ticker": "6자리 종목코드",
      "buy_price": 매수가격(숫자),
      "sell_price": 목표매도가(숫자),
      "stop_loss": 손절가(숫자 — 단타 -5%, 스윙 -4%, 중기 -6%),
      "expected_return": 예상수익률(숫자, % 단위),
      "probability": 상승확률(0-100 숫자),
      "reasoning": "추천 이유 (2-3문장, 실제 RSI·MACD·추세 수치 근거 포함 + 뉴스 미언급 기술적 근거 강조)",
      "key_catalyst": "핵심 상승 촉매 (한 줄)"
    }
  ],
  "market_outlook": "전반적 시장 전망 — 하락장 예상 시 [하락장 위험] 으로 시작",
  "risk_factors": "주요 하방 위험 요소 (2-3문장)"
}`

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('[Gemini] JSON 파싱 실패 — 응답 앞 200자:', text.slice(0, 200))
    // throw 대신 빈 결과 반환 → 텔레그램 에러 알림으로 이어짐
    return {
      recommendations: [],
      market_outlook: '[분석 실패] Gemini 응답 JSON 파싱 오류 — 오늘 추천 생략',
      risk_factors: 'Gemini 응답 형식 오류로 분석 불가',
    }
  }
  let parsed: GeminiAnalysisResult
  try {
    parsed = JSON.parse(jsonMatch[0]) as GeminiAnalysisResult
  } catch (e) {
    console.error('[Gemini] JSON.parse 실패:', e instanceof Error ? e.message : e)
    return {
      recommendations: [],
      market_outlook: '[분석 실패] Gemini 응답 JSON 파싱 오류 — 오늘 추천 생략',
      risk_factors: 'Gemini 응답 형식 오류로 분석 불가',
    }
  }
  // 필수 필드 누락 방어
  if (!Array.isArray(parsed.recommendations)) parsed.recommendations = []
  if (!parsed.market_outlook) parsed.market_outlook = '시장 전망 데이터 없음'
  if (!parsed.risk_factors)   parsed.risk_factors   = '위험 요소 데이터 없음'
  return parsed
}

export type EventBeneficiaryResult = {
  additionalTickers: Array<{ ticker: string; name: string; reason: string }>
  analysisText: string
}

export async function analyzeEventBeneficiaries(highImpactNewsText: string): Promise<EventBeneficiaryResult> {
  const empty: EventBeneficiaryResult = { additionalTickers: [], analysisText: '' }
  if (!highImpactNewsText.trim()) return empty

  const prompt = `당신은 한국 주식시장 이벤트 분석 전문가입니다.
아래 HIGH 임팩트 뉴스를 읽고, 시장이 "기대감"으로 선반영할 수혜주를 추론하세요.

핵심 원칙:
1. 주식시장은 "현실"보다 "기대"를 먼저 삼는다. 계약이 없어도 협력 가능성만으로 주가가 선행한다.
2. 직접 수혜(뉴스에 직접 언급된 기업)와 생태계 간접 수혜(공급망·파트너·유사 섹터)를 모두 분석하라.
3. CEO 방한/면담: 면담 당사자 기업 + 해당 기술 생태계 연관 기업
4. 정책 발표: 수혜 섹터 기업
5. 기술 발표/협력: 부품·소재·소프트웨어 연관 기업

HIGH 임팩트 뉴스:
${highImpactNewsText}

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
{
  "events": [
    {
      "summary": "이벤트 1줄 요약",
      "scenario": "왜 이 기업들이 수혜받는지 시나리오 (2문장 이내)",
      "direct": [{"ticker": "6자리 종목코드", "name": "종목명", "reason": "직접 수혜 이유 한 줄"}],
      "indirect": [{"ticker": "6자리 종목코드", "name": "종목명", "reason": "간접 수혜 이유 한 줄"}]
    }
  ],
  "market_expectation_note": "시장이 이 이벤트들을 어떻게 해석하는지 1-2문장"
}

규칙:
- ticker는 반드시 6자리 숫자 코드 (예: 035420)
- 전체 종목 수 최대 8개 (direct + indirect 합산)
- 확실한 수혜 근거가 없으면 포함 금지
- 모르는 종목코드는 추측 금지`

  try {
    const text = await callGemini(prompt)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return empty

    const parsed = JSON.parse(jsonMatch[0]) as {
      events: Array<{
        summary: string
        scenario: string
        direct: Array<{ ticker: string; name: string; reason: string }>
        indirect: Array<{ ticker: string; name: string; reason: string }>
      }>
      market_expectation_note: string
    }

    if (!parsed.events || !Array.isArray(parsed.events)) return empty

    // 6자리 숫자 종목코드만 유효
    const allTickers: Array<{ ticker: string; name: string; reason: string }> = []
    const seen = new Set<string>()
    for (const ev of parsed.events) {
      for (const item of [...(ev.direct ?? []), ...(ev.indirect ?? [])]) {
        if (/^\d{6}$/.test(item.ticker) && !seen.has(item.ticker)) {
          seen.add(item.ticker)
          allTickers.push({ ticker: item.ticker, name: item.name, reason: item.reason })
        }
      }
    }

    // analysisText 생성 (메인 Gemini 프롬프트 주입용)
    const lines: string[] = ['🎯 이벤트 수혜주 사전 분석 (시장 기대감 선반영 — 최우선 참고):']
    for (const ev of parsed.events) {
      lines.push(`• ${ev.summary}`)
      lines.push(`  시나리오: ${ev.scenario}`)
      if (ev.direct?.length) {
        lines.push(`  직접 수혜: ${ev.direct.map(d => `${d.name}(${d.ticker}): ${d.reason}`).join(' / ')}`)
      }
      if (ev.indirect?.length) {
        lines.push(`  간접 수혜: ${ev.indirect.map(d => `${d.name}(${d.ticker}): ${d.reason}`).join(' / ')}`)
      }
    }
    if (parsed.market_expectation_note) {
      lines.push(`💡 시장 해석: ${parsed.market_expectation_note}`)
    }
    lines.push('→ 직접 수혜주는 기술적 지표에 관계없이 단타/스윙 우선 후보로 검토하라.')

    return { additionalTickers: allTickers.slice(0, 8), analysisText: lines.join('\n') }
  } catch {
    return empty
  }
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

// ─── 포트폴리오 대처 조언 ───────────────────────────────────────────────────

export type PortfolioAdviceInput = {
  item_key: string
  account_name?: string
  ticker: string
  name: string
  avg_price: number
  shares: number
  current_price: number
  profit_pct: number
  tech: {
    rsi14: number | null
    macdSignal: string | null
    trend: string | null
    volumeSurge: number | null
    bollingerSignal: string | null
    prevDayChangePct: number | null
  }
  history: Array<{ date: string; advice_type: string; advice_detail: string }>
}

export type PortfolioAdviceResult = {
  item_key: string
  ticker: string
  name: string
  advice_type: '보유유지' | '물타기' | '추매' | '분할매수' | '분할매도' | '손절고려'
  advice_detail: string
}

export async function generatePortfolioAdvice(params: {
  items: PortfolioAdviceInput[]
  cash: number
  marketOutlook: string
  date: string
}): Promise<PortfolioAdviceResult[]> {
  if (params.items.length === 0) return []

  const itemsText = params.items.map(item => {
    const pl = item.profit_pct >= 0 ? `+${item.profit_pct.toFixed(1)}%` : `${item.profit_pct.toFixed(1)}%`
    const evalAmt = (item.current_price * item.shares).toLocaleString('ko-KR')
    const histText = item.history.length > 0
      ? item.history.slice(-14).reverse().map(h => `  ${h.date}: [${h.advice_type}] ${h.advice_detail.slice(0, 80)}`).join('\n')
      : '  (이력 없음)'
    const acctLabel = item.account_name ? ` — ${item.account_name}` : ''
    return `### [${item.item_key}] ${item.name} (${item.ticker})${acctLabel}
- 평균단가: ${item.avg_price.toLocaleString('ko-KR')}원 / 현재가: ${item.current_price.toLocaleString('ko-KR')}원 / 수익률: ${pl}
- 보유수량: ${item.shares.toLocaleString()}주 / 평가금액: ${evalAmt}원
- RSI14: ${item.tech.rsi14?.toFixed(0) ?? 'N/A'} | MACD: ${item.tech.macdSignal ?? 'N/A'} | 추세: ${item.tech.trend ?? 'N/A'}
- 볼린저: ${item.tech.bollingerSignal ?? 'N/A'} | 거래량배율: ${item.tech.volumeSurge?.toFixed(1) ?? 'N/A'}x | 전일등락: ${item.tech.prevDayChangePct != null ? `${item.tech.prevDayChangePct.toFixed(1)}%` : 'N/A'}
- 과거 조언 이력 (최근 14일, 최신순):
${histText}`
  }).join('\n\n')

  const prompt = `당신은 한국 주식 포트폴리오 관리 전문가입니다.
투자자의 보유 종목 현황, 기술적 지표, 과거 조언 이력을 종합하여 각 종목의 오늘 최적 대처 방안을 제시하세요.

## 오늘 날짜: ${params.date}

## 오늘 시장 전망
${params.marketOutlook}

## 보유 현금
${params.cash.toLocaleString('ko-KR')}원

## 보유 종목 현황
${itemsText}

## 조언 기준
- 수익률 -15% 이상 하락 + 하락추세 지속: 손절고려 (과거 이력에 물타기 권유 반복 시 특히 강조)
- 수익률 -5%~-15% + RSI ≤ 40 + 지지선 근접: 물타기 (현금 보유량 고려)
- RSI ≤ 35 + 거래량 증가 + 손실 미미: 추매 검토
- RSI ≥ 65 + 볼린저 상단 근접: 분할매도 권고
- 수익률 +20% 이상: 분할매도 검토 (절반 이상 실현 권고)
- 과거 이력 패턴 반드시 반영: 예) "3일 연속 물타기 권유 후 계속 하락 → 이번엔 손절 또는 보유만 유지"
- 매수 금액은 반드시 보유 현금 기준 비율로 제시 (예: "현금의 30% 추매")
- 매도는 보유 주수 기준 비율로 제시 (예: "보유 주수의 50% 분할매도")
- advice_detail은 2~3문장, 구체적 행동(가격·비율·이유) 포함
- 손절고려 시: 반드시 "XX,XXX원 하회 시 손절 검토" 형식으로 구체적 손절 가격 제시
- 분할매도 시: "XX,XXX원 이상에서 N주(보유의 N%) 매도" 형식으로 목표가 명시
- 물타기/추매 시: "XX,XXX원 이하 도달 시 현금의 N% 추가매수" 형식으로 매수 기준가 명시

## 응답 형식 (JSON만, 다른 텍스트 없음)
\`\`\`json
{
  "advice": [
    {
      "item_key": "헤더의 [숫자] 그대로",
      "ticker": "종목코드",
      "name": "종목명",
      "advice_type": "보유유지|물타기|추매|분할매수|분할매도|손절고려",
      "advice_detail": "구체적 대처 방안 (2~3문장, 가격/비율/이유 포함)"
    }
  ]
}
\`\`\``

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? [null, text.match(/\{[\s\S]*\}/)?.[0]]
  const raw = jsonMatch[1] ?? jsonMatch[0]
  if (!raw) {
    console.error('[Gemini portfolio advice] JSON 파싱 실패 — 응답 앞 200자:', text.slice(0, 200))
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return (parsed.advice ?? []) as PortfolioAdviceResult[]
  } catch {
    return []
  }
}

// ===== 동적 키워드 자동 학습 =====

export type KeywordSuggestion = {
  keyword: string
  sector: string | null
  related_tickers: string[]
  is_high_impact: boolean
}

export async function suggestKeywordsFromNews(params: {
  newsTitles: string[]
  existingKeywords: string[]
  trackedSectors: string[]
}): Promise<KeywordSuggestion[]> {
  if (params.newsTitles.length === 0) return []

  const prompt = `당신은 한국 주식시장 뉴스 모니터링 전문가입니다.
오늘 수집된 뉴스 헤드라인을 분석하여, 향후 한국 주식(특히 반도체·배터리·AI·바이오 섹터)에 중요한 영향을 줄 수 있는 키워드 중 아직 감시 목록에 없는 것들을 추천하세요.

## 현재 감시 중인 키워드 (중복 제안 금지)
${params.existingKeywords.slice(0, 100).join(', ')}

## 오늘 뉴스 헤드라인
${params.newsTitles.slice(0, 60).map((t, i) => `${i + 1}. ${t}`).join('\n')}

## 추가 기준
- 한국 주요 기업에 직접 영향을 주는 외국 기업명·기술명·규제명
- 경쟁사 이름 (중국 반도체·배터리·전기차 기업 포함)
- 글로벌 주요 고객사 (애플·구글·아마존·테슬라 등)
- 새로운 산업 트렌드 용어, 정책/제재 신조어
- 관련 종목코드(6자리 숫자 또는 ETF코드)를 알면 포함

## 응답 형식 (JSON만, 다른 텍스트 없음)
\`\`\`json
{
  "keywords": [
    {
      "keyword": "추가할 키워드",
      "sector": "반도체|AI|2차전지|바이오|자동차|방산|조선|기타 중 하나",
      "related_tickers": ["005930"],
      "is_high_impact": true
    }
  ]
}
\`\`\`
최대 10개 제안. 이미 감시 중인 키워드와 동일하거나 너무 일반적인 단어는 제외하세요.`

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? [null, text.match(/\{[\s\S]*\}/)?.[0]]
  const raw = jsonMatch[1] ?? jsonMatch[0]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return ((parsed.keywords ?? []) as KeywordSuggestion[])
      .filter(k => k.keyword && !params.existingKeywords.includes(k.keyword))
      .slice(0, 10)
  } catch {
    return []
  }
}
