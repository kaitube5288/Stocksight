// 오후 체크 스크립트 (13:00 및 14:30 실행)
// 오늘의 추천 종목 5개의 현재 상태를 확인하고 카테고리별 대응법 텔레그램 전송
// 액션 필요 신호가 있을 때만 발송 (정상 범위면 조용히 스킵)

import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { isKoreanMarketHoliday } from '@/lib/korean-holidays'
import { fetchNaverData } from '@/lib/stock-data'
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
}

type Category = '눌림목재진입' | '안정매수' | '매수부적정' | '손절선임박' | '목표도달' | '정상범위'

async function runAfternoonCheck(): Promise<void> {
  const forceRun = process.env.FORCE_RUN === 'true'
  const kstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstDay = kstDate.getDay()
  const kstHour = kstDate.getHours()
  const kstMinute = kstDate.getMinutes()
  const timeLabel = `${String(kstHour).padStart(2, '0')}:${String(kstMinute).padStart(2, '0')}`

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

  const { data: rec } = await supabase
    .from('recommendations')
    .select('date, stocks')
    .eq('date', todayKST)
    .maybeSingle()

  if (!rec) {
    console.log('[SKIP] 오늘 추천 데이터 없음 — daily-analysis 먼저 실행 필요')
    return
  }

  const stocks = (rec.stocks as StockRecommendation[]) ?? []
  const realStocks = stocks.filter(s => s.ticker && s.ticker !== '000000' && s.buy_price && s.buy_price > 0)

  if (realStocks.length === 0) {
    console.log('[SKIP] 실제 추천 종목 없음 (모두 현금보유)')
    return
  }

  console.log(`[체크] ${realStocks.length}개 종목 오후 상황 확인 중 (${timeLabel})...`)
  const prices = await Promise.all(realStocks.map(s => fetchNaverData(s.ticker).catch(() => ({ price: null }))))

  type Signal = {
    stock: StockRecommendation
    currentPrice: number
    changeFromBuy: number
    changeFromTarget: number
    changeFromStopLoss: number
    category: Category
  }

  const signals: Signal[] = realStocks.map((s, i) => {
    const currentPrice = (prices[i] as { price: number | null }).price ?? 0
    const buyPrice = s.buy_price ?? 0
    const targetPrice = s.sell_price ?? 0
    const stopLoss = s.stop_loss ?? 0

    const changeFromBuy = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0
    const changeFromTarget = targetPrice > 0 ? ((currentPrice - targetPrice) / targetPrice) * 100 : 0
    const changeFromStopLoss = stopLoss > 0 ? ((currentPrice - stopLoss) / stopLoss) * 100 : 0

    let category: Category = '정상범위'

    // 우선순위: 목표도달 > 손절선임박 > 매수부적정 > 눌림목재진입 > 안정매수
    if (targetPrice > 0 && changeFromTarget >= -0.5) {
      category = '목표도달'
    } else if (stopLoss > 0 && changeFromStopLoss <= 1 && changeFromBuy <= -3) {
      category = '손절선임박'
    } else if (changeFromBuy >= 3) {
      category = '매수부적정'
    } else if (changeFromBuy <= -1 && changeFromBuy >= -3) {
      category = '눌림목재진입'
    } else if (Math.abs(changeFromBuy) <= 1) {
      category = '안정매수'
    }

    return { stock: s, currentPrice, changeFromBuy, changeFromTarget, changeFromStopLoss, category }
  })

  // 액션 필요 카테고리: 정상범위·안정매수 제외 나머지
  const actionableSignals = signals.filter(s =>
    s.category === '눌림목재진입' ||
    s.category === '매수부적정' ||
    s.category === '손절선임박' ||
    s.category === '목표도달'
  )

  if (actionableSignals.length === 0) {
    console.log('[SKIP] 액션 필요 신호 없음 (모두 정상 범위/안정 매수)')
    return
  }

  const lines: string[] = [`🕐 <b>오후 상황 체크</b> (${todayKST} ${timeLabel} 기준)\n`]

  const byCategory: Record<Category, Signal[]> = {
    '눌림목재진입': [], '안정매수': [], '매수부적정': [], '손절선임박': [], '목표도달': [], '정상범위': [],
  }
  for (const s of signals) byCategory[s.category].push(s)

  if (byCategory['눌림목재진입'].length > 0) {
    lines.push('🎯 <b>눌림목 재진입 기회</b>')
    for (const s of byCategory['눌림목재진입']) {
      lines.push(`  • ${s.stock.name}(${s.stock.ticker}) ${s.currentPrice.toLocaleString('ko-KR')}원 (매수가 대비 ${s.changeFromBuy.toFixed(1)}%)`)
      lines.push(`    → 지금 매수 적정 (원래 추천가 ${(s.stock.buy_price ?? 0).toLocaleString('ko-KR')}원 근접)`)
    }
    lines.push('')
  }

  if (byCategory['목표도달'].length > 0) {
    lines.push('💰 <b>목표가 근접/도달</b>')
    for (const s of byCategory['목표도달']) {
      lines.push(`  • ${s.stock.name}(${s.stock.ticker}) ${s.currentPrice.toLocaleString('ko-KR')}원 (목표가 대비 ${s.changeFromTarget >= 0 ? '+' : ''}${s.changeFromTarget.toFixed(1)}%)`)
      lines.push(`    → 이미 목표 도달, 신규 매수 X. 보유자는 부분 실현 검토`)
    }
    lines.push('')
  }

  if (byCategory['매수부적정'].length > 0) {
    lines.push('❌ <b>매수 시점 아님 (이미 상승)</b>')
    for (const s of byCategory['매수부적정']) {
      lines.push(`  • ${s.stock.name}(${s.stock.ticker}) ${s.currentPrice.toLocaleString('ko-KR')}원 (매수가 대비 +${s.changeFromBuy.toFixed(1)}%)`)
      lines.push(`    → 이미 +${s.changeFromBuy.toFixed(1)}% 상승, 신규 진입 자제`)
    }
    lines.push('')
  }

  if (byCategory['손절선임박'].length > 0) {
    lines.push('🔴 <b>손절선 임박 (신규 진입 금지)</b>')
    for (const s of byCategory['손절선임박']) {
      lines.push(`  • ${s.stock.name}(${s.stock.ticker}) ${s.currentPrice.toLocaleString('ko-KR')}원 (매수가 대비 ${s.changeFromBuy.toFixed(1)}%)`)
      lines.push(`    → 손절가 ${(s.stock.stop_loss ?? 0).toLocaleString('ko-KR')}원 근접, 반등 대기 후 판단`)
    }
    lines.push('')
  }

  // 정상/안정 종목 간단히 언급
  const normalStocks = [...byCategory['안정매수'], ...byCategory['정상범위']]
  if (normalStocks.length > 0) {
    lines.push(`✅ <b>정상 범위 (원래 계획대로)</b>: ${normalStocks.map(s => s.stock.name).join(', ')}`)
    lines.push('')
  }

  lines.push('🔗 <a href="https://stocksight-pied.vercel.app">전체 추천 보기</a>')

  await sendTelegramSimple(lines.join('\n'))
  console.log(`[완료] 텔레그램 알림 전송 (${actionableSignals.length}개 액션 신호)`)
}

;(async () => {
  try {
    await runAfternoonCheck()
    process.exit(0)
  } catch (err) {
    console.error('[치명 오류]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
})()
