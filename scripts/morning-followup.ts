// 옵션 9: 오전 눌림목 진입 확인 스크립트
// KST 09:15 실행 — 07:45 추천 종목의 개장 후 실제 가격 확인
// 눌림목 조건 (전일종가 대비 -1% ~ -3% 조정 중) 감지 시 텔레그램 알림

import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { isKoreanMarketHoliday } from '@/lib/korean-holidays'
import { fetchNaverData, fetchTechnicalIndicators } from '@/lib/stock-data'
import { sendTelegramSimple } from '@/lib/telegram'

type StockRecommendation = {
  name: string
  ticker: string
  buy_price?: number
  sell_price?: number
  stop_loss?: number
  expected_return?: number
  probability?: number
  trade_type?: string
  reasoning?: string
  key_catalyst?: string
}

async function runMorningFollowup(): Promise<void> {
  const forceRun = process.env.FORCE_RUN === 'true'
  const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstDay = kstDate.getDay()

  if (!forceRun && (kstDay === 0 || kstDay === 6)) {
    console.log('[SKIP] 주말 휴장 (FORCE_RUN=true로 우회 가능)')
    return
  }
  if (forceRun) console.log('[FORCE_RUN] 주말/공휴일 우회 실행')

  const todayKST = getKSTDate()
  if (!forceRun && isKoreanMarketHoliday(todayKST)) {
    console.log(`[SKIP] 공휴일 휴장 (${todayKST})`)
    return
  }

  const supabase = getSupabaseAdmin()

  // 1. 오늘의 07:45 추천 조회
  const { data: rec, error } = await supabase
    .from('recommendations')
    .select('date, stocks, market_outlook')
    .eq('date', todayKST)
    .maybeSingle()

  if (error || !rec) {
    console.log('[SKIP] 오늘 07:45 추천 데이터 없음 — 먼저 daily-analysis 실행 필요')
    return
  }

  const stocks: StockRecommendation[] = (rec.stocks as StockRecommendation[]) ?? []
  const realStocks = stocks.filter(s => s.ticker && s.ticker !== '000000' && s.buy_price && s.buy_price > 0)

  if (realStocks.length === 0) {
    console.log('[SKIP] 실제 추천 종목 없음 (모두 현금보유)')
    return
  }

  // 2. 각 종목 실시간 가격 + 기술지표 병렬 조회
  console.log(`[체크] ${realStocks.length}개 종목 개장 후 상태 확인 중...`)
  const [prices, techs] = await Promise.all([
    Promise.all(realStocks.map(s => fetchNaverData(s.ticker).catch(() => ({ price: null })))),
    Promise.all(realStocks.map(s => fetchTechnicalIndicators(s.ticker).catch(() => null))),
  ])

  // 3. 눌림목 조건 분석
  type PullbackSignal = {
    stock: StockRecommendation
    currentPrice: number
    changePct: number
    rsi: number | null
    isPullback: boolean
    isBreakout: boolean
    signalType: '눌림목진입' | '갭상승주의' | '정상범위'
  }

  const signals: PullbackSignal[] = realStocks.map((s, i) => {
    const currentPrice = (prices[i] as { price: number | null }).price ?? s.buy_price ?? 0
    const buyPrice = s.buy_price ?? currentPrice
    const changePct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0
    const rsi = techs[i]?.rsi14 ?? null

    // 눌림목 진입 조건: 전일종가 대비 -1% ~ -3% 조정 + RSI 65 미만
    const isPullback = changePct <= -1 && changePct >= -3 && (rsi === null || rsi < 65)
    // 갭상승 위험: 전일종가 대비 +2% 이상 상승 (추천가보다 훨씬 위 진입 위험)
    const isBreakout = changePct >= 2

    const signalType: PullbackSignal['signalType'] =
      isPullback ? '눌림목진입' : isBreakout ? '갭상승주의' : '정상범위'

    return { stock: s, currentPrice, changePct, rsi, isPullback, isBreakout, signalType }
  })

  const pullbacks = signals.filter(s => s.isPullback)
  const breakouts = signals.filter(s => s.isBreakout)

  console.log(`[결과] 눌림목 진입 후보 ${pullbacks.length}개, 갭상승 주의 ${breakouts.length}개`)

  // 4. 텔레그램 메시지 생성 (신호가 있을 때만)
  if (pullbacks.length === 0 && breakouts.length === 0) {
    console.log('[SKIP] 특별한 신호 없음 (모두 정상 범위) — 텔레그램 미전송')
    return
  }

  const lines: string[] = [`📊 <b>오전 눌림목 체크</b> (${todayKST} 09:15 기준)\n`]

  if (pullbacks.length > 0) {
    lines.push('🎯 <b>눌림목 진입 신호</b> (전일종가 -1~-3% 조정 + RSI 65 미만)')
    for (const p of pullbacks) {
      const gap = p.changePct >= 0 ? `+${p.changePct.toFixed(1)}%` : `${p.changePct.toFixed(1)}%`
      const rsiText = p.rsi != null ? ` | RSI ${p.rsi.toFixed(0)}` : ''
      lines.push(`  • ${p.stock.name}(${p.stock.ticker}) ${p.stock.trade_type ?? ''}`)
      lines.push(`    현재 ${p.currentPrice.toLocaleString('ko-KR')}원 (추천가 대비 ${gap})${rsiText}`)
      lines.push(`    → 지금이 진입 타이밍 (추천 매수가 ${(p.stock.buy_price ?? 0).toLocaleString('ko-KR')}원보다 유리)`)
    }
    lines.push('')
  }

  if (breakouts.length > 0) {
    lines.push('⚠️ <b>갭상승 주의</b> (전일종가 +2% 이상 급등)')
    for (const b of breakouts) {
      lines.push(`  • ${b.stock.name}(${b.stock.ticker}) 현재 ${b.currentPrice.toLocaleString('ko-KR')}원 (추천가 대비 +${b.changePct.toFixed(1)}%)`)
      lines.push(`    → 갭상승 후 되돌림 위험, 오후 눌림목까지 대기 권장`)
    }
    lines.push('')
  }

  lines.push('🔗 <a href="https://stocksight-pied.vercel.app">전체 추천 보기</a>')

  await sendTelegramSimple(lines.join('\n'))
  console.log('[완료] 텔레그램 알림 전송')
}

;(async () => {
  try {
    await runMorningFollowup()
    process.exit(0)
  } catch (err) {
    console.error('[치명 오류]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
})()
