import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseAdmin()
  try {
    const { data } = await supabase
      .from('portfolio_snapshots')
      .select('date, total_eval, total_cost, total_cash')
      .order('date', { ascending: true })
      .limit(90)
    return NextResponse.json({ snapshots: data ?? [] })
  } catch {
    return NextResponse.json({ snapshots: [] })
  }
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin()
  try {
    const { total_eval, total_cost, total_cash } = await request.json()
    const today = new Date().toISOString().slice(0, 10)
    await supabase.from('portfolio_snapshots').upsert(
      { date: today, total_eval, total_cost, total_cash },
      { onConflict: 'date' }
    )
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false })
  }
}
