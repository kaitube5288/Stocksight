import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'
import { generateAccountAdvice, AccountAdviceInput } from '@/lib/gemini'
import { fetchNaverData } from '@/lib/stock-data'
import { STOCK_MAP } from '@/lib/major-stocks'

export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdmin()
  const todayDate = getKSTDate()

  try {
    const body = await request.json().catch(() => ({}))
    const source: 'auto' | 'manual' = body.source === 'auto' ? 'auto' : 'manual'

    // 1. 계좌·종목·현금 조회
    const [{ data: accounts }, { data: portfolio }, { data: latestRec }] = await Promise.all([
      supabaseAdmin.from('portfolio_accounts').select('*'),
      supabaseAdmin.from('portfolio').select('*'),
      supabaseAdmin.from('recommendations').select('market_outlook').order('date', { ascending: false }).limit(1).maybeSingle(),
    ])

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ error: '계좌 없음' }, { status: 400 })
    }

    const marketOutlook = (latestRec as { market_outlook?: string } | null)?.market_outlook ?? '시장 전망 정보 없음'

    // 2. 현재가 병렬 조회 (unique ticker)
    const allTickers = [...new Set((portfolio ?? []).map(p => (p as { ticker: string }).ticker))]
    const priceMap: Record<string, number> = {}
    if (allTickers.length > 0) {
      const priceResults = await Promise.all(allTickers.map(t => fetchNaverData(t).catch(() => ({ price: null }))))
      allTickers.forEach((t, i) => {
        const p = (priceResults[i] as { price: number | null }).price
        if (p != null) priceMap[t] = p
      })
    }

    // 3. 계좌별 그룹핑
    const accountInputs: AccountAdviceInput[] = accounts.map(acc => {
      const a = acc as { id: string; name: string; cash: number; current_investment: number; additional_investment: number }
      const items = (portfolio ?? [])
        .filter(p => (p as { account_id: string | null }).account_id === a.id)
        .map(p => {
          const item = p as { ticker: string; name: string; avg_price: number; shares: number }
          const currentPrice = priceMap[item.ticker] ?? item.avg_price
          const evalAmount = currentPrice * item.shares
          const profitPct = item.avg_price > 0 ? ((currentPrice - item.avg_price) / item.avg_price) * 100 : 0
          return {
            ticker: item.ticker,
            name: item.name,
            sector: STOCK_MAP[item.ticker]?.sector ?? null,
            eval_amount: evalAmount,
            profit_pct: profitPct,
          }
        })
      const evalTotal = items.reduce((s, i) => s + i.eval_amount, 0)
      const totalAsset = evalTotal + (a.cash ?? 0)
      const totalCost = (a.current_investment ?? 0) + (a.additional_investment ?? 0)
      const profitPct = totalCost > 0 ? ((evalTotal - totalCost) / totalCost) * 100 : 0

      return {
        account_id: a.id,
        account_name: a.name,
        cash: a.cash ?? 0,
        total_asset: totalAsset,
        profit_pct: profitPct,
        items,
      }
    })

    // 4. Gemini 호출
    const advice = await generateAccountAdvice({
      accounts: accountInputs,
      marketOutlook,
      date: todayDate,
    })

    // 5. DB 저장 (계좌별 upsert)
    for (const a of advice) {
      await supabaseAdmin.from('portfolio_account_advice')
        .delete()
        .eq('date', todayDate)
        .eq('account_id', a.account_id)
      await supabaseAdmin.from('portfolio_account_advice').insert({
        date: todayDate,
        account_id: a.account_id,
        advice_summary: a.advice_summary,
        risk_level: a.risk_level,
        sector_concentration: a.sector_concentration,
        source,
      })
    }

    return NextResponse.json({ success: true, count: advice.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
