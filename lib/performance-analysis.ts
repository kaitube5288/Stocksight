import axios from 'axios'
import { getSupabase } from './supabase'
import { addTradingDays } from './trading-days'
import { MAJOR_STOCKS } from './major-stocks'

const START_DATE = '2026-05-04'
const PERIOD: Record<TT, number> = { '단타': 1, '스윙': 5, '중기': 20 }
type TT = '단타' | '스윙' | '중기'

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

const TICKER_SECTOR = new Map(MAJOR_STOCKS.map(s => [s.ticker, s.sector]))

// 만기일 직전 가장 가까운 거래일 종가
async function getPriceNearDate(ticker: string, targetDate: Date): Promise<number | null> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  const targetTs = Math.floor(targetDate.getTime() / 1000)
  for (const suffix of ['.KS', '.KQ']) {
    try {
      const res = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=90d&interval=1d`,
        { headers: YF_HEADERS, timeout: 10000 }
      )
      const result = res.data?.chart?.result?.[0]
      if (!result) continue
      const timestamps: number[] = result.timestamp ?? []
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
      let bestIdx = -1, bestTs = -Infinity
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i]
        if (closes[i] == null || isNaN(closes[i]!)) continue
        if (ts <= targetTs + 86400 && ts > bestTs) { bestTs = ts; bestIdx = i }
      }
      if (bestIdx >= 0) return closes[bestIdx]!
    } catch { continue }
  }
  return null
}

interface ExpiredStock {
  ticker: string
  name: string
  tradeType: TT
  sector: string | null
  buyPrice: number
  returnPct: number
  rsi14: number | null
  macdSignal: string | null
  trend: string | null
}

type StatsMap = Map<string, { wins: number; total: number; sumReturn: number }>

function addStat(map: StatsMap, key: string, returnPct: number) {
  const s = map.get(key) ?? { wins: 0, total: 0, sumReturn: 0 }
  s.total++
  s.sumReturn += returnPct
  if (returnPct > 0) s.wins++
  map.set(key, s)
}

/**
 * 2026-05-04 이후 만료 종목의 성과를 분석해 Gemini 프롬프트용 텍스트를 반환.
 * 만료 종목이 없거나 데이터 부족 시 빈 문자열 반환.
 */
export async function buildPerformanceInsights(): Promise<string> {
  try {
    const supabase = getSupabase()
    const { data: recs } = await supabase
      .from('recommendations')
      .select('stocks, created_at')
      .gte('date', START_DATE)
      .order('created_at', { ascending: true })

    if (!recs?.length) return ''

    // ticker+tradeType 기준 dedup (최신 추천일 기준 만기 및 기준가 계산)
    type Group = {
      ticker: string; name: string; tradeType: TT
      latestBuyPrice: number; latestRecDate: Date
      rsi14: number | null; macdSignal: string | null; trend: string | null
    }
    const groups = new Map<string, Group>()

    for (const rec of recs) {
      const recDate = new Date(rec.created_at)
      for (const s of rec.stocks ?? []) {
        const tt = s.trade_type as TT
        if (!PERIOD[tt]) continue
        const key = `${s.ticker}:${tt}`
        const ex = groups.get(key)
        if (!ex) {
          groups.set(key, {
            ticker: s.ticker, name: s.name, tradeType: tt,
            latestBuyPrice: s.buy_price, latestRecDate: recDate,
            rsi14: s.rsi14 ?? null, macdSignal: s.macd_signal ?? null, trend: s.trend ?? null,
          })
        } else if (recDate > ex.latestRecDate) {
          ex.latestRecDate = recDate
          ex.latestBuyPrice = s.buy_price  // 재추천 시 최신 추천가로 갱신
          ex.rsi14 = s.rsi14 ?? ex.rsi14
          ex.macdSignal = s.macd_signal ?? ex.macdSignal
          ex.trend = s.trend ?? ex.trend
        }
      }
    }

    const now = new Date()
    const expiredGroups = [...groups.values()].filter(g => {
      const exp = addTradingDays(g.latestRecDate, PERIOD[g.tradeType])
      return now > exp
    })

    if (!expiredGroups.length) return ''

    // 만기 가격 병렬 조회
    const exitPrices = await Promise.all(
      expiredGroups.map(g => getPriceNearDate(g.ticker, addTradingDays(g.latestRecDate, PERIOD[g.tradeType])))
    )

    const expired: ExpiredStock[] = []
    expiredGroups.forEach((g, i) => {
      const exitPrice = exitPrices[i]
      if (!exitPrice || !g.latestBuyPrice) return
      expired.push({
        ticker: g.ticker, name: g.name, tradeType: g.tradeType,
        sector: TICKER_SECTOR.get(g.ticker) ?? null,
        buyPrice: g.latestBuyPrice,
        returnPct: ((exitPrice - g.latestBuyPrice) / g.latestBuyPrice) * 100,
        rsi14: g.rsi14, macdSignal: g.macdSignal, trend: g.trend,
      })
    })

    if (expired.length < 3) return '' // 데이터 부족 시 인사이트 생략

    // ── 통계 집계 ──
    const typeStats: StatsMap = new Map()
    const sectorStats: StatsMap = new Map()
    const winners = expired.filter(e => e.returnPct > 0)
    const losers  = expired.filter(e => e.returnPct <= 0)

    for (const e of expired) {
      addStat(typeStats, e.tradeType, e.returnPct)
      if (e.sector) addStat(sectorStats, e.sector, e.returnPct)
    }

    const avgRsi = (arr: ExpiredStock[]) => {
      const v = arr.filter(e => e.rsi14 != null)
      return v.length ? v.reduce((s, e) => s + e.rsi14!, 0) / v.length : null
    }
    const winnersRsi = avgRsi(winners)
    const losersRsi  = avgRsi(losers)

    const macdBuys = expired.filter(e => e.macdSignal === 'buy')
    const macdBuyWR = macdBuys.length >= 3
      ? macdBuys.filter(e => e.returnPct > 0).length / macdBuys.length * 100 : null

    const trendUps = expired.filter(e => e.trend === 'up')
    const trendUpWR = trendUps.length >= 3
      ? trendUps.filter(e => e.returnPct > 0).length / trendUps.length * 100 : null

    // ── 텍스트 생성 ──
    const L: string[] = []
    L.push(`[과거 추천 성과 피드백 — 총 ${expired.length}개 만료 종목 분석 (2026-05-04~)]`)
    L.push('이 데이터를 반드시 반영해 오늘 종목 선정 조건을 자동 조정하세요.')
    L.push('')

    // 거래유형별 성과
    L.push('▶ 거래유형별 성과')
    for (const [tt, s] of typeStats) {
      const wr  = Math.round(s.wins / s.total * 100)
      const avg = (s.sumReturn / s.total).toFixed(2)
      L.push(`  ${tt}: 승률 ${wr}% (${s.wins}/${s.total}건) | 평균 ${Number(avg) >= 0 ? '+' : ''}${avg}%`)
    }

    // 섹터 성과 (2건 이상만)
    const sectorArr = [...sectorStats.entries()]
      .filter(([, s]) => s.total >= 2)
      .sort((a, b) => (b[1].sumReturn / b[1].total) - (a[1].sumReturn / a[1].total))

    if (sectorArr.length >= 2) {
      L.push('')
      L.push('▶ 섹터 성과 (상위 → 하위)')
      sectorArr.forEach(([sec, s]) => {
        const avg = (s.sumReturn / s.total).toFixed(2)
        const wr  = Math.round(s.wins / s.total * 100)
        const mark = Number(avg) >= 0 ? '✓' : '✗'
        L.push(`  ${mark} ${sec}: 평균 ${Number(avg) >= 0 ? '+' : ''}${avg}% | 승률 ${wr}%`)
      })
    }

    // RSI 분석
    if (winnersRsi != null || losersRsi != null) {
      L.push('')
      L.push('▶ RSI 패턴')
      if (winnersRsi != null) L.push(`  수익 종목 평균 RSI: ${winnersRsi.toFixed(1)}`)
      if (losersRsi  != null) L.push(`  손실 종목 평균 RSI: ${losersRsi.toFixed(1)}`)
    }

    // MACD / 추세 분석
    if (macdBuyWR != null || trendUpWR != null) {
      L.push('')
      L.push('▶ 기술 지표 승률')
      if (macdBuyWR != null) L.push(`  MACD↑ 신호 승률: ${macdBuyWR.toFixed(0)}% (${macdBuys.length}건)`)
      if (trendUpWR != null) L.push(`  추세↑ 신호 승률: ${trendUpWR.toFixed(0)}% (${trendUps.length}건)`)
    }

    // ── 자동 조정 지시 ──
    L.push('')
    L.push('▶ 오늘 추천 자동 조정 지시 (반드시 적용)')

    // 섹터 가중치 조정
    if (sectorArr.length >= 2) {
      const top = sectorArr.slice(0, 3).filter(([, s]) => s.sumReturn / s.total > 0).map(([n]) => n)
      const bot = sectorArr.slice(-3).filter(([, s]) => s.sumReturn / s.total < 0).map(([n]) => n)
      if (top.length) L.push(`  • 성과 우수 섹터 우선 선정: ${top.join(', ')}`)
      if (bot.length) L.push(`  • 성과 부진 섹터 기피 (부득이 추천 시 reasoning에 명시): ${bot.join(', ')}`)
    }

    // 거래유형별 조건 조정 — RSI 범위를 과도하게 좁히지 않음 (불장 악순환 방지)
    for (const [tt, s] of typeStats) {
      const wr  = s.wins / s.total * 100
      const avg = s.sumReturn / s.total
      if (wr < 35) {
        // 승률 위험 시에도 RSI를 40~55로 제한하지 않음 — 대신 모멘텀/뉴스 기준 강화
        L.push(`  • [${tt}] 승률 위험(${Math.round(wr)}%) — MACD↑ 필수, BB하단 근접 우선, 뉴스/공시 모멘텀 필수 (RSI 범위는 유지)`)
      } else if (wr < 50) {
        L.push(`  • [${tt}] 승률 저조(${Math.round(wr)}%) — MACD↑ 우선, 추세↑ 필수, 기관/외국인 수급 확인`)
      } else if (wr >= 65 && avg > 1.5) {
        L.push(`  • [${tt}] 고성과(승률 ${Math.round(wr)}%, 평균 +${avg.toFixed(1)}%) — 현재 조건 유지`)
      }
    }

    // RSI 상한 — 불장 주도주 배제 방지: 하한은 75 이상 유지
    if (winnersRsi != null && losersRsi != null && losersRsi > winnersRsi + 5) {
      const optCap = Math.max(75, Math.round(winnersRsi) + 10)  // 최소 75 이상 유지
      L.push(`  • RSI 상한 참고값 ${optCap} (수익 평균 ${winnersRsi.toFixed(1)} vs 손실 평균 ${losersRsi.toFixed(1)}) — 85 초과만 배제`)
    }

    // MACD 필터 조정
    if (macdBuyWR != null && macdBuyWR >= 65) {
      L.push(`  • MACD↑ 신호 적중률 높음(${macdBuyWR.toFixed(0)}%) — 단타/스윙에서 MACD↑ 없으면 순위 하락`)
    } else if (macdBuyWR != null && macdBuyWR < 45) {
      L.push(`  • MACD↑ 신호 신뢰도 낮음(${macdBuyWR.toFixed(0)}%) — MACD만으로 선정하지 말고 뉴스/거래량 병행`)
    }

    return L.join('\n')
  } catch (e) {
    console.error('[성과분석] 오류:', e instanceof Error ? e.message : e)
    return ''
  }
}
