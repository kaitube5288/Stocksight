import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseAdmin()
  try {
    const [{ data: items, error: e1 }, { data: cashData, error: e2 }] = await Promise.all([
      supabase.from('portfolio').select('*').order('created_at', { ascending: true }),
      supabase.from('portfolio_cash').select('*').eq('id', 1).maybeSingle(),
    ])
    if (e1) console.error('[portfolio GET] items 조회 오류:', e1.message)
    if (e2) console.error('[portfolio GET] cash 조회 오류:', e2.message)
    const cd = cashData as { amount?: number; current_investment?: number; additional_investment?: number } | null
    return NextResponse.json({
      items: items ?? [],
      cash: cd?.amount ?? 0,
      current_investment: cd?.current_investment ?? 0,
      additional_investment: cd?.additional_investment ?? 0,
    })
  } catch (e) {
    return NextResponse.json({ items: [], cash: 0, error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin()
  const body = await request.json()

  // 현금 / 투자금 저장
  if (body.type === 'cash' || body.type === 'investment') {
    const { data: existing } = await supabase.from('portfolio_cash').select('*').eq('id', 1).maybeSingle()
    const prev = existing as { amount?: number; current_investment?: number; additional_investment?: number } | null
    const { error } = await supabase.from('portfolio_cash').upsert(
      {
        id: 1,
        amount: body.type === 'cash' ? Number(body.amount) : (prev?.amount ?? 0),
        current_investment: body.current_investment != null ? Number(body.current_investment) : (prev?.current_investment ?? 0),
        additional_investment: body.additional_investment != null ? Number(body.additional_investment) : (prev?.additional_investment ?? 0),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // 종목 저장 (추가/수정)
  const { ticker, name, avg_price, shares } = body
  if (!ticker || !name || avg_price == null || shares == null) {
    return NextResponse.json({ error: '필수 항목 누락: ticker, name, avg_price, shares' }, { status: 400 })
  }
  const { error } = await supabase.from('portfolio').upsert(
    { ticker, name, avg_price: Number(avg_price), shares: Number(shares), updated_at: new Date().toISOString() },
    { onConflict: 'ticker' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = getSupabaseAdmin()
  const { ticker } = await request.json()
  if (!ticker) return NextResponse.json({ error: 'ticker 필요' }, { status: 400 })
  const { error } = await supabase.from('portfolio').delete().eq('ticker', ticker)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
