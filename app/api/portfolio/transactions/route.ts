import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseAdmin()
  try {
    const { data } = await supabase
      .from('portfolio_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    return NextResponse.json({ transactions: data ?? [] })
  } catch {
    return NextResponse.json({ transactions: [] })
  }
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin()
  try {
    const { account_id, ticker, name, type, price, quantity, amount } = await request.json()
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('portfolio_transactions').insert({
      date: today,
      account_id: account_id ?? null,
      ticker: ticker ?? null,
      name: name ?? null,
      type,
      price: price ?? null,
      quantity: quantity ?? null,
      amount: Number(amount) || 0,
    })
    if (error) return NextResponse.json({ success: false, error: error.message })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) })
  }
}
