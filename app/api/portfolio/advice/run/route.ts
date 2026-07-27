import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { generatePortfolioAdvice } from '@/lib/gemini'
import { fetchTechnicalIndicators, fetchNaverData } from '@/lib/stock-data'

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdmin()
  const todayDate = getKSTDate()

  try {
    const body = await request.json().catch(() => ({}))
    const targetItemId: string | undefined = body.item_id

    // 1. 포트폴리오 종목 조회 (특정 item_id이면 해당 항목만)
    let query = supabaseAdmin.from('portfolio').select('*').order('created_at', { ascending: true })
    if (targetItemId) query = query.eq('id', targetItemId)
    const { data: portfolioItems, error: portErr } = await query
    if (portErr || !portfolioItems || portfolioItems.length === 0) {
      return NextResponse.json({ error: '보유 종목 없음' }, { status: 400 })
    }

    // 2. 계좌 현금 + 계좌명 조회
    const [{ data: cashRow }, { data: accountRows }, { data: latestRec }] = await Promise.all([
      supabaseAdmin.from('portfolio_cash').select('*').eq('id', 1).maybeSingle(),
      supabaseAdmin.from('portfolio_accounts').select('id,name'),
      supabaseAdmin.from('recommendations').select('market_outlook').order('date', { ascending: false }).limit(1).maybeSingle(),
    ])

    const cash = (cashRow as { amount?: number } | null)?.amount ?? 0
    const marketOutlook = (latestRec as { market_outlook?: string } | null)?.market_outlook ?? '시장 전망 정보 없음'
    const accountMap: Record<string, string> = {}
    for (const a of accountRows ?? []) {
      accountMap[(a as { id: string; name: string }).id] = (a as { id: string; name: string }).name
    }

    const allTickers = [...new Set(portfolioItems.map(p => (p as { ticker: string }).ticker))]

    // 3. 기술적 지표 + 현재가 + 이력 병렬 조회
    const [techResults, priceResults, historyData] = await Promise.all([
      Promise.all(portfolioItems.map(p => fetchTechnicalIndicators((p as { ticker: string }).ticker).catch(() => null))),
      Promise.all(portfolioItems.map(p => fetchNaverData((p as { ticker: string }).ticker).catch(() => ({ price: null })))),
      supabaseAdmin
        .from('portfolio_advice')
        .select('ticker,date,advice_type,advice_detail,portfolio_item_id')
        .in('ticker', allTickers)
        .order('date', { ascending: false })
        .limit(14 * portfolioItems.length),
    ])

    const historyMap: Record<string, { date: string; advice_type: string; advice_detail: string }[]> = {}
    for (const h of historyData.data ?? []) {
      const rec = h as { ticker: string; date: string; advice_type: string; advice_detail: string; portfolio_item_id: string | null }
      const key = rec.portfolio_item_id ?? rec.ticker
      if (!historyMap[key]) historyMap[key] = []
      historyMap[key].push({ date: rec.date, advice_type: rec.advice_type, advice_detail: rec.advice_detail })
    }

    const items = portfolioItems.map((p, i) => {
      const item = p as { id: string; ticker: string; name: string; avg_price: number; shares: number; account_id: string | null }
      const currentPrice = (priceResults[i] as { price: number | null })?.price ?? item.avg_price
      const profitPct = item.avg_price > 0 ? ((currentPrice - item.avg_price) / item.avg_price) * 100 : 0
      const tech = techResults[i]
      return {
        item_key: String(i),
        account_name: item.account_id ? accountMap[item.account_id] : undefined,
        ticker: item.ticker,
        name: item.name,
        avg_price: item.avg_price,
        shares: item.shares,
        current_price: currentPrice,
        profit_pct: profitPct,
        tech: {
          rsi14: tech?.rsi14 ?? null,
          macdSignal: tech?.macdSignal ?? null,
          trend: tech?.trend ?? null,
          volumeSurge: tech?.volumeSurge ?? null,
          bollingerSignal: tech?.bollingerSignal ?? null,
          prevDayChangePct: tech?.prevDayChangePct ?? null,
        },
        history: (historyMap[item.id] ?? historyMap[item.ticker] ?? []).slice(0, 14),
      }
    })

    // 4. Gemini 조언 생성
    const advice = await generatePortfolioAdvice({ items, cash, marketOutlook, date: todayDate })

    // 5. DB 저장 (DELETE → INSERT로 partial index 충돌 우회)
    for (const a of advice) {
      const itemIndex = parseInt(a.item_key)
      const rawItem = portfolioItems[itemIndex] as { id: string }
      const item = items[itemIndex]
      if (!item || !rawItem) continue
      await supabaseAdmin.from('portfolio_advice')
        .delete()
        .eq('date', todayDate)
        .eq('portfolio_item_id', rawItem.id)
      await supabaseAdmin.from('portfolio_advice').insert({
        date: todayDate,
        portfolio_item_id: rawItem.id,
        ticker: item.ticker,
        name: item.name,
        advice_type: a.advice_type,
        advice_detail: a.advice_detail,
        current_price: item.current_price ?? null,
        avg_price: item.avg_price ?? null,
        profit_pct: item.profit_pct ?? null,
        source: 'manual',
      })
    }

    return NextResponse.json({ success: true, count: advice.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
