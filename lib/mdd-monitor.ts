// 옵션 13: 최대낙폭(MDD) 모니터링
// 매일 장마감 후 계좌 총 자산 확인 → 최근 30일 최고값 대비 낙폭 계산
// 5% 초과 시 경고, 10% 초과 시 위험 알림 전송

import { getSupabaseAdmin } from './supabase'
import { fetchNaverData } from './stock-data'
import { sendTelegramSimple } from './telegram'

type PortfolioHolding = { ticker: string; name: string; avg_price: number; shares: number; account_id: string | null }
type PortfolioSnapshot = { date: string; total_eval: number; total_cash: number }

/**
 * 오늘 계좌 총 자산 계산 (실시간 현재가 기준)
 */
async function calculateTodayTotalAsset(): Promise<number> {
  const supabase = getSupabaseAdmin()

  const [{ data: portfolio }, { data: cashRow }] = await Promise.all([
    supabase.from('portfolio').select('*'),
    supabase.from('portfolio_cash').select('amount').eq('id', 1).maybeSingle(),
  ])

  const holdings = (portfolio ?? []) as PortfolioHolding[]
  const cash = (cashRow as { amount?: number } | null)?.amount ?? 0

  if (holdings.length === 0) return cash

  const uniqueTickers = [...new Set(holdings.map(h => h.ticker))]
  const priceResults = await Promise.all(uniqueTickers.map(t => fetchNaverData(t).catch(() => ({ price: null }))))
  const priceMap: Record<string, number> = {}
  uniqueTickers.forEach((t, i) => {
    const p = (priceResults[i] as { price: number | null }).price
    if (p != null) priceMap[t] = p
  })

  let evalTotal = 0
  for (const h of holdings) {
    const currentPrice = priceMap[h.ticker] ?? h.avg_price
    evalTotal += currentPrice * h.shares
  }

  return evalTotal + cash
}

/**
 * 최근 N일 portfolio_snapshots 중 최고 총자산(total_eval + total_cash) 조회
 */
async function getPeakAssetInLastDays(daysBack: number = 30): Promise<{ peak: number; peakDate: string } | null> {
  const supabase = getSupabaseAdmin()
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const from = new Date(kst); from.setDate(from.getDate() - daysBack)
  const fromDate = from.toISOString().slice(0, 10)

  const { data } = await supabase
    .from('portfolio_snapshots')
    .select('date, total_eval, total_cash')
    .gte('date', fromDate)
    .order('date', { ascending: false })

  if (!data || data.length === 0) return null

  let peak = 0
  let peakDate = ''
  for (const row of data as PortfolioSnapshot[]) {
    const totalAsset = (row.total_eval ?? 0) + (row.total_cash ?? 0)
    if (totalAsset > peak) {
      peak = totalAsset
      peakDate = row.date
    }
  }

  if (peak === 0) return null
  return { peak, peakDate }
}

/**
 * MDD 체크 및 텔레그램 알림
 * market-close 스크립트에서 호출
 */
export async function checkMDDAndAlert(): Promise<{
  checked: boolean
  drawdown_pct: number
  peak: number
  today: number
  alerted: boolean
  level?: '경고' | '위험'
}> {
  try {
    const [today, peakInfo] = await Promise.all([
      calculateTodayTotalAsset(),
      getPeakAssetInLastDays(30),
    ])

    if (today === 0) {
      console.log('[MDD] 총 자산 0원 (보유 종목 없음) — 스킵')
      return { checked: false, drawdown_pct: 0, peak: 0, today: 0, alerted: false }
    }

    if (!peakInfo || peakInfo.peak === 0) {
      console.log('[MDD] portfolio_snapshots 이력 없음 — 첫 실행이거나 데이터 부족')
      return { checked: false, drawdown_pct: 0, peak: 0, today, alerted: false }
    }

    const drawdownPct = ((peakInfo.peak - today) / peakInfo.peak) * 100

    console.log(`[MDD] 오늘 ${today.toLocaleString('ko-KR')}원 / 30일 최고 ${peakInfo.peak.toLocaleString('ko-KR')}원 (${peakInfo.peakDate}) / 낙폭 ${drawdownPct.toFixed(2)}%`)

    // 5% 미만: 정상
    if (drawdownPct < 5) {
      return { checked: true, drawdown_pct: drawdownPct, peak: peakInfo.peak, today, alerted: false }
    }

    // 5% ~ 10%: 경고
    // 10% 이상: 위험
    const level = drawdownPct >= 10 ? '위험' : '경고'
    const emoji = level === '위험' ? '🚨' : '⚠️'
    const lines = [
      `${emoji} <b>계좌 낙폭 ${level}</b> — ${drawdownPct.toFixed(1)}% 하락`,
      '',
      `📊 오늘 총 자산: ${today.toLocaleString('ko-KR')}원`,
      `📈 30일 최고: ${peakInfo.peak.toLocaleString('ko-KR')}원 (${peakInfo.peakDate})`,
      `📉 낙폭: -${(peakInfo.peak - today).toLocaleString('ko-KR')}원 (-${drawdownPct.toFixed(2)}%)`,
      '',
    ]

    if (level === '위험') {
      lines.push('🔴 <b>10% 이상 낙폭 도달</b>')
      lines.push('  → 신규 진입 전면 중단 권장')
      lines.push('  → 현금 비중 확대 (30%↑ 목표)')
      lines.push('  → 손절 규칙 엄격 준수, 물타기 자제')
    } else {
      lines.push('🟡 <b>5~10% 낙폭</b>')
      lines.push('  → 신규 단타 진입 신중')
      lines.push('  → 손실 종목 지지선 이탈 시 손절 원칙 준수')
      lines.push('  → 확신도 70% 미만 종목 진입 자제')
    }

    lines.push('')
    lines.push('🔗 <a href="https://stocksight-pied.vercel.app">포트폴리오 확인</a>')

    await sendTelegramSimple(lines.join('\n'))
    console.log(`[MDD] ${level} 알림 전송 완료`)

    return { checked: true, drawdown_pct: drawdownPct, peak: peakInfo.peak, today, alerted: true, level }
  } catch (e) {
    console.error('[MDD] 체크 실패:', e instanceof Error ? e.message : e)
    return { checked: false, drawdown_pct: 0, peak: 0, today: 0, alerted: false }
  }
}
