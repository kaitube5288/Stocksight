import { getSupabase } from './supabase'
import { addTradingDays } from './trading-days'
import axios from 'axios'
import { GoogleGenerativeAI } from '@google/generative-ai'

const START_DATE = '2026-05-04'
const TRADING_DAYS_MAP = { '단타': 1, '스윙': 5, '중기': 20 } as const
type TT = keyof typeof TRADING_DAYS_MAP

// 15% 미달 시 자기진단 트리거
const IMPROVEMENT_THRESHOLD = 15

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

async function getPriceNearDate(ticker: string, targetDate: Date): Promise<number | null> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  const targetTs = Math.floor(targetDate.getTime() / 1000)
  for (const suffix of ['.KS', '.KQ']) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=90d&interval=1d`
        const res = await axios.get(url, { headers: YF_HEADERS, timeout: 15000 })
        const result = res.data?.chart?.result?.[0]
        if (!result) break
        const timestamps: number[] = result.timestamp ?? []
        const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
        let bestIdx = -1, bestTs = -Infinity
        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i]
          if (closes[i] == null || isNaN(closes[i]!)) continue
          if (ts <= targetTs + 86400 && ts > bestTs) { bestTs = ts; bestIdx = i }
        }
        if (bestIdx >= 0) return closes[bestIdx]!
        break
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('429') || msg.includes('Too Many')) {
          if (attempt < 2) continue
        }
        break
      }
    }
  }
  return null
}

interface StockReturn {
  ticker: string
  name: string
  buyPrice: number
  exitPrice: number
  returnPct: number
}

type StockRecord = { ticker: string; name: string; buy_price: number; trade_type: string }
type Group = { ticker: string; name: string; firstBuyPrice: number; latestRecDate: Date }

async function getExpiredReturns(tt: TT): Promise<{ stocks: StockReturn[]; cumulative: number }> {
  const supabase = getSupabase()
  const now = new Date()

  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, date, stocks, created_at')
    .gte('date', START_DATE)
    .order('created_at', { ascending: true })

  if (error || !recs) return { stocks: [], cumulative: 0 }

  const groups = new Map<string, Group>()
  for (const rec of recs) {
    const recDate = new Date(rec.created_at)
    for (const stock of (rec.stocks ?? []) as StockRecord[]) {
      if (stock.trade_type !== tt) continue
      const ex = groups.get(stock.ticker)
      if (!ex) {
        groups.set(stock.ticker, {
          ticker: stock.ticker, name: stock.name,
          firstBuyPrice: stock.buy_price, latestRecDate: recDate,
        })
      } else if (recDate > ex.latestRecDate) {
        ex.latestRecDate = recDate
      }
    }
  }

  const expired: { group: Group; expiresAt: Date }[] = []
  for (const group of groups.values()) {
    const expiresAt = addTradingDays(group.latestRecDate, TRADING_DAYS_MAP[tt])
    if (now <= expiresAt) continue
    expired.push({ group, expiresAt })
  }
  if (expired.length === 0) return { stocks: [], cumulative: 0 }

  // 순차 요청 — Yahoo Finance rate limit 방지
  const exitPrices: (number | null)[] = []
  for (let i = 0; i < expired.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000))
    exitPrices.push(await getPriceNearDate(expired[i].group.ticker, expired[i].expiresAt))
  }

  const stocks: StockReturn[] = []
  let sum = 0
  expired.forEach(({ group }, i) => {
    const exitPrice = exitPrices[i]
    if (!group.firstBuyPrice) return
    // 가격 미조회 시 buyPrice 그대로 사용 (0% 수익률로 보수적 집계)
    const ep = exitPrice ?? group.firstBuyPrice
    const returnPct = ((ep - group.firstBuyPrice) / group.firstBuyPrice) * 100
    sum += returnPct
    stocks.push({ ticker: group.ticker, name: group.name, buyPrice: group.firstBuyPrice, exitPrice: ep, returnPct })
  })

  return { stocks, cumulative: stocks.length > 0 ? sum : 0 }
}

function getGeminiKey(): string | null {
  return ([
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean) as string[])[0] ?? null
}

async function analyzeWithGemini(tt: TT, cumulative: number, stocks: StockReturn[]): Promise<string | null> {
  const key = getGeminiKey()
  if (!key) return null

  const wins   = stocks.filter(s => s.returnPct >= 0)
  const losses = stocks.filter(s => s.returnPct < 0)

  const stockLines = stocks
    .sort((a, b) => a.returnPct - b.returnPct)
    .map(s => `- ${s.name}(${s.ticker}): 매수 ${s.buyPrice.toLocaleString()}원 → 만기 ${s.exitPrice.toLocaleString()}원 (${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)}%)`)
    .join('\n')

  const prompt = `당신은 한국 주식 AI 추천 시스템의 전략 자동 개선 엔진입니다.

아래는 [${tt}] 섹션의 추천 성과 데이터입니다. 누적 수익률이 목표치(+${IMPROVEMENT_THRESHOLD}%)에 미치지 못했습니다.

## 성과 현황
- 누적 수익률: ${cumulative >= 0 ? '+' : ''}${cumulative.toFixed(2)}% (목표: +${IMPROVEMENT_THRESHOLD}%)
- 총 종목: ${stocks.length}개 | 이익: ${wins.length}개 | 손실: ${losses.length}개

## 종목별 결과 (손실순 정렬)
${stockLines}

## 분석 및 개선 요청

다음 두 섹션을 작성하세요:

### 실패 원인 분석
손실 종목들의 공통 패턴, 실패 원인을 3~4줄로 분석하세요.

### 다음 추천 적용 규칙
${tt} 섹션의 다음 추천에 즉시 적용할 구체적 기준 3~5개를 작성하세요.
(예: "RSI 65 초과 ${tt} 종목 배제", "거래량 5일 평균 미달 시 ${tt} 제외")

JSON 형식 없이 자연어로, 간결하게 작성하세요.`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel(
      { model: 'gemini-1.5-flash', generationConfig: { temperature: 0 } },
      { apiVersion: 'v1beta' }
    )
    const result = await model.generateContent(prompt)
    return result.response.text().trim()
  } catch (e) {
    console.error('[StrategyImprovement] Gemini 실패:', e instanceof Error ? e.message : e)
    return null
  }
}

// 디버그용: 각 섹션의 만료 종목 수집 현황 반환
export async function debugExpiredReturns(): Promise<Record<string, unknown>> {
  const supabase = getSupabase()
  const now = new Date()
  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, date, stocks, created_at')
    .gte('date', START_DATE)
    .order('created_at', { ascending: true })

  if (error || !recs) return { error: error?.message ?? 'no data', recCount: 0 }

  const result: Record<string, unknown> = {
    now: now.toISOString(),
    recCount: recs.length,
    sections: {} as Record<string, unknown>,
  }

  for (const tt of ['단타', '스윙', '중기'] as TT[]) {
    const groups = new Map<string, Group>()
    for (const rec of recs) {
      const recDate = new Date(rec.created_at)
      for (const stock of (rec.stocks ?? []) as StockRecord[]) {
        if (stock.trade_type !== tt) continue
        const ex = groups.get(stock.ticker)
        if (!ex) {
          groups.set(stock.ticker, { ticker: stock.ticker, name: stock.name, firstBuyPrice: stock.buy_price, latestRecDate: recDate })
        } else if (recDate > ex.latestRecDate) {
          ex.latestRecDate = recDate
        }
      }
    }

    const allGroups = Array.from(groups.values()).map(g => {
      const expiresAt = addTradingDays(g.latestRecDate, TRADING_DAYS_MAP[tt])
      return {
        ticker: g.ticker, name: g.name,
        latestRecDate: g.latestRecDate.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expired: now > expiresAt,
      }
    })

    ;(result.sections as Record<string, unknown>)[tt] = {
      groupCount: groups.size,
      expiredCount: allGroups.filter(g => g.expired).length,
      groups: allGroups.slice(0, 5),
    }
  }
  return result
}

// 15% 미달 섹션 자동 진단 후 DB 저장 — cron에서 호출
export async function runStrategyImprovementIfNeeded(): Promise<string[]> {
  const triggered: string[] = []
  for (const tt of ['단타', '스윙', '중기'] as TT[]) {
    try {
      const { stocks, cumulative } = await getExpiredReturns(tt)
      if (stocks.length < 1) continue
      if (cumulative >= IMPROVEMENT_THRESHOLD) continue

      const analysis = await analyzeWithGemini(tt, cumulative, stocks)
      if (!analysis) continue

      const supabase = getSupabase()
      const { error } = await supabase.from('strategy_improvements').insert({
        trade_type: tt,
        cumulative_return: Math.round(cumulative * 100) / 100,
        failed_count: stocks.filter(s => s.returnPct < 0).length,
        total_count: stocks.length,
        analysis,
      })
      if (!error) triggered.push(tt)
    } catch (e) {
      console.error(`[StrategyImprovement] ${tt}:`, e instanceof Error ? e.message : e)
    }
  }
  return triggered
}

// 진단용: 각 섹션별 스킵 사유 포함한 상세 실행
export async function runStrategyImprovementVerbose(): Promise<{
  triggered: string[]
  reasons: Record<string, string>
}> {
  const triggered: string[] = []
  const reasons: Record<string, string> = {}

  const geminiKey = getGeminiKey()
  if (!geminiKey) {
    return { triggered, reasons: { error: 'Gemini API 키 없음' } }
  }

  for (const tt of ['단타', '스윙', '중기'] as TT[]) {
    try {
      const { stocks, cumulative } = await getExpiredReturns(tt)
      if (stocks.length < 1) {
        reasons[tt] = `스킵: 만료 종목 0개`
        continue
      }
      if (cumulative >= IMPROVEMENT_THRESHOLD) {
        reasons[tt] = `스킵: 누적 ${cumulative.toFixed(2)}% ≥ ${IMPROVEMENT_THRESHOLD}%`
        continue
      }

      reasons[tt] = `분석 시작 — 종목 ${stocks.length}개, 누적 ${cumulative.toFixed(2)}%`

      const analysis = await analyzeWithGemini(tt, cumulative, stocks)
      if (!analysis) {
        reasons[tt] += ` → Gemini 분석 실패(null)`
        continue
      }

      const supabase = getSupabase()
      const { error } = await supabase.from('strategy_improvements').insert({
        trade_type: tt,
        cumulative_return: Math.round(cumulative * 100) / 100,
        failed_count: stocks.filter(s => s.returnPct < 0).length,
        total_count: stocks.length,
        analysis,
      })
      if (error) {
        reasons[tt] += ` → DB 저장 오류: ${error.message}`
      } else {
        triggered.push(tt)
        reasons[tt] += ` → DB 저장 성공 ✅`
      }
    } catch (e) {
      reasons[tt] = `예외: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return { triggered, reasons }
}

// 최근 자기진단 결과를 Gemini 프롬프트 주입용 텍스트로 반환
export async function buildStrategyImprovementContext(): Promise<string> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('strategy_improvements')
      .select('trade_type, cumulative_return, analysis, created_at')
      .order('created_at', { ascending: false })
      .limit(9)  // 섹션당 최신 3개 후보

    if (!data || data.length === 0) return ''

    // 섹션별 가장 최신 1개만
    const seen = new Set<string>()
    const latest = data.filter(d => {
      if (seen.has(d.trade_type)) return false
      seen.add(d.trade_type)
      return true
    })

    const lines = latest.map(d => {
      const pct = `${Number(d.cumulative_return) >= 0 ? '+' : ''}${Number(d.cumulative_return).toFixed(1)}%`
      return `[${d.trade_type} 자동 전략 보완 — 누적 ${pct} 미달 분석]\n${d.analysis}`
    })

    return lines.join('\n\n---\n\n')
  } catch {
    return ''
  }
}
