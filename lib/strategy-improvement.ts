import { getSupabase, getSupabaseAdmin } from './supabase'
import { addTradingDays } from './trading-days'
import { callGemini } from './gemini'
import axios from 'axios'

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

  const stocks: StockReturn[] = []   // Gemini 분석용 (가격 없으면 0%로 포함)
  let realSum = 0
  let realCount = 0
  expired.forEach(({ group }, i) => {
    const exitPrice = exitPrices[i]
    if (!group.firstBuyPrice) return
    const ep = exitPrice ?? group.firstBuyPrice
    const returnPct = exitPrice != null
      ? ((exitPrice - group.firstBuyPrice) / group.firstBuyPrice) * 100
      : 0
    if (exitPrice != null) { realSum += returnPct; realCount++ }
    stocks.push({ ticker: group.ticker, name: group.name, buyPrice: group.firstBuyPrice, exitPrice: ep, returnPct })
  })

  // 누적은 실제 가격 조회된 종목만 — 조회 실패 시 0으로 처리해 트리거 보장
  const cumulative = realCount > 0 ? realSum : 0
  return { stocks, cumulative }
}

async function analyzeWithGemini(tt: TT, cumulative: number, stocks: StockReturn[]): Promise<string | null> {
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
    return (await callGemini(prompt)).trim()
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

      const supabase = getSupabaseAdmin()
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

      const supabase = getSupabaseAdmin()
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

// ===== 옵션 15: 실패 패턴 자동 학습 강화 =====
// 최근 30일 손실 종목(추천 후 -5% 이하)의 공통 특성을 자동 분석하여
// 다음 분석 프롬프트에 회피 규칙으로 반영

type LossRecord = {
  ticker: string
  name: string
  loss_pct: number
  sector: string | null
  rsi14: number | null
  macd_signal: string | null
  trend: string | null
  source_tag: string | null
  trade_type: string | null
}

export async function analyzeLossPatterns(): Promise<string> {
  try {
    const supabase = getSupabaseAdmin()
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    const from = new Date(kst); from.setDate(from.getDate() - 30)
    const fromDate = from.toISOString().slice(0, 10)

    // 최근 30일 추천 조회
    const { data: recs } = await supabase
      .from('recommendations')
      .select('date, stocks')
      .gte('date', fromDate)
      .order('date', { ascending: false })

    if (!recs || recs.length === 0) return ''

    const losses: LossRecord[] = []

    for (const rec of recs) {
      const r = rec as { date: string; stocks?: unknown[] }
      const stocks = (r.stocks ?? []) as Array<{
        ticker: string; name: string; buy_price?: number; expected_return?: number; probability?: number
        sector?: string; rsi14?: number; macd_signal?: string; trend?: string;
        trade_type?: string; source_tag?: string
      }>

      for (const s of stocks) {
        if (!s.ticker || s.ticker === '000000') continue
        if (!s.buy_price || s.buy_price === 0) continue

        // 추천일로부터 5거래일 후 가격 조회 (스윙 기준)
        const recDate = new Date(`${r.date}T00:00:00+09:00`)
        const targetDate = addTradingDays(recDate, 5)
        const finalPrice = await getPriceNearDate(s.ticker, targetDate)
        if (finalPrice == null) continue

        const returnPct = ((finalPrice - s.buy_price) / s.buy_price) * 100
        if (returnPct <= -5) {
          losses.push({
            ticker: s.ticker,
            name: s.name,
            loss_pct: returnPct,
            sector: s.sector ?? null,
            rsi14: s.rsi14 ?? null,
            macd_signal: s.macd_signal ?? null,
            trend: s.trend ?? null,
            source_tag: s.source_tag ?? null,
            trade_type: s.trade_type ?? null,
          })
        }
      }
    }

    if (losses.length < 5) return ''  // 표본 부족 시 스킵

    // 패턴 집계
    const sectorCounts: Record<string, number> = {}
    const rsiRanges: Record<string, number> = { '<30': 0, '30-45': 0, '45-55': 0, '55-65': 0, '>65': 0 }
    const macdCounts: Record<string, number> = {}
    const trendCounts: Record<string, number> = {}
    const sourceCounts: Record<string, number> = {}
    const tradeTypeCounts: Record<string, number> = {}

    for (const l of losses) {
      if (l.sector) sectorCounts[l.sector] = (sectorCounts[l.sector] ?? 0) + 1
      if (l.rsi14 != null) {
        const key = l.rsi14 < 30 ? '<30' : l.rsi14 < 45 ? '30-45' : l.rsi14 < 55 ? '45-55' : l.rsi14 < 65 ? '55-65' : '>65'
        rsiRanges[key]++
      }
      if (l.macd_signal) macdCounts[l.macd_signal] = (macdCounts[l.macd_signal] ?? 0) + 1
      if (l.trend) trendCounts[l.trend] = (trendCounts[l.trend] ?? 0) + 1
      if (l.source_tag) sourceCounts[l.source_tag] = (sourceCounts[l.source_tag] ?? 0) + 1
      if (l.trade_type) tradeTypeCounts[l.trade_type] = (tradeTypeCounts[l.trade_type] ?? 0) + 1
    }

    const total = losses.length
    const avgLoss = losses.reduce((s, l) => s + l.loss_pct, 0) / total

    // 30% 이상 반복되는 패턴만 위험 신호로 표시
    const dangerousSectors = Object.entries(sectorCounts).filter(([, c]) => c / total >= 0.3).map(([s]) => s)
    const dangerousRsi = Object.entries(rsiRanges).filter(([, c]) => c / total >= 0.3).map(([r]) => r)
    const dangerousMacd = Object.entries(macdCounts).filter(([, c]) => c / total >= 0.4).map(([m]) => m)
    const dangerousTrend = Object.entries(trendCounts).filter(([, c]) => c / total >= 0.4).map(([t]) => t)
    const dangerousSource = Object.entries(sourceCounts).filter(([, c]) => c / total >= 0.3).map(([s]) => s)
    const dangerousType = Object.entries(tradeTypeCounts).filter(([, c]) => c / total >= 0.4).map(([t]) => t)

    const warnings: string[] = []
    if (dangerousSectors.length > 0) warnings.push(`섹터: ${dangerousSectors.join(', ')} (손실 종목 30%↑ 차지)`)
    if (dangerousRsi.length > 0) warnings.push(`RSI 구간: ${dangerousRsi.join(', ')} (손실 종목 30%↑)`)
    if (dangerousMacd.length > 0) warnings.push(`MACD 상태: ${dangerousMacd.join(', ')} (손실 종목 40%↑)`)
    if (dangerousTrend.length > 0) warnings.push(`추세: ${dangerousTrend.join(', ')} (손실 종목 40%↑)`)
    if (dangerousSource.length > 0) warnings.push(`진입 경로: ${dangerousSource.join(', ')} (손실 종목 30%↑)`)
    if (dangerousType.length > 0) warnings.push(`거래 유형: ${dangerousType.join(', ')} (손실 종목 40%↑)`)

    if (warnings.length === 0) return ''

    return `## 🔴 최근 30일 실패 패턴 자동 분석 (표본 ${total}건, 평균 손실 ${avgLoss.toFixed(1)}%)

아래 패턴을 가진 종목은 손실 확률이 높으니 추천 시 반드시 신중 판단:
${warnings.map(w => `- ${w}`).join('\n')}

→ 위 패턴 다수 해당 종목은 확신도 -10 감점 or 제외 검토 필수`
  } catch (e) {
    console.error('[실패패턴] 분석 실패:', e instanceof Error ? e.message : e)
    return ''
  }
}
