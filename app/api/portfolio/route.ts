import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseAdmin()
  try {
    const [{ data: items, error: e1 }, { data: accounts, error: e2 }] = await Promise.all([
      supabase.from('portfolio').select('*').order('created_at', { ascending: true }),
      supabase.from('portfolio_accounts').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ])
    if (e1) console.error('[portfolio GET] items 오류:', e1.message)
    if (e2) console.error('[portfolio GET] accounts 오류:', e2.message)
    return NextResponse.json({ items: items ?? [], accounts: accounts ?? [] })
  } catch (e) {
    return NextResponse.json({ items: [], accounts: [], error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin()
  const body = await request.json()

  // 계좌 추가/수정
  if (body.type === 'account') {
    const { id, name, current_investment, additional_investment, cash, commission_rate, brokerage } = body
    if (id) {
      // 수정 (특정 필드만 업데이트)
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (name != null) update.name = name
      if (current_investment != null) update.current_investment = Number(current_investment)
      if (additional_investment != null) update.additional_investment = Number(additional_investment)
      if (cash != null) update.cash = Number(cash)
      if (commission_rate != null) update.commission_rate = Number(commission_rate)
      if (brokerage != null) update.brokerage = String(brokerage)
      const { error } = await supabase.from('portfolio_accounts').update(update).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // 신규 추가
      const { data: last } = await supabase.from('portfolio_accounts').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
      const nextOrder = ((last as { sort_order?: number } | null)?.sort_order ?? -1) + 1
      const { error } = await supabase.from('portfolio_accounts').insert({
        name: name ?? '신규 계좌',
        current_investment: Number(current_investment ?? 0),
        additional_investment: Number(additional_investment ?? 0),
        cash: Number(cash ?? 0),
        commission_rate: Number(commission_rate ?? 0.015),
        brokerage: String(brokerage ?? 'etc'),
        sort_order: nextOrder,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  // 보유 종목 추가/수정
  const { id, ticker, name, avg_price, shares, account_id } = body
  if (!ticker || !name || avg_price == null || shares == null) {
    return NextResponse.json({ error: '필수 항목 누락: ticker, name, avg_price, shares' }, { status: 400 })
  }

  if (id) {
    // 기존 종목 수정: id 기반 update (ticker 변경 불가)
    const { error } = await supabase.from('portfolio').update(
      { name, avg_price: Number(avg_price), shares: Number(shares), account_id: account_id ?? null, updated_at: new Date().toISOString() }
    ).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // 신규 종목 추가: insert
    const { error } = await supabase.from('portfolio').insert(
      { ticker, name, avg_price: Number(avg_price), shares: Number(shares), account_id: account_id ?? null }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = getSupabaseAdmin()
  const body = await request.json()

  // 계좌 삭제
  if (body.type === 'account') {
    if (!body.id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
    const { error } = await supabase.from('portfolio_accounts').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // 종목 삭제 (id 우선, 없으면 ticker)
  if (body.id) {
    const { error } = await supabase.from('portfolio').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (body.ticker) {
    const { error } = await supabase.from('portfolio').delete().eq('ticker', body.ticker)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    return NextResponse.json({ error: 'id 또는 ticker 필요' }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
