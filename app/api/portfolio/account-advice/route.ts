import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseAdmin()

  try {
    const { data } = await supabase
      .from('portfolio_account_advice')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)

    return NextResponse.json({ advice: data ?? [] })
  } catch (e) {
    return NextResponse.json({ advice: [], error: e instanceof Error ? e.message : String(e) })
  }
}
