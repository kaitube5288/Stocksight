import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const today = getKSTDate()

  try {
    const { data: allAdvice } = await supabase
      .from('portfolio_advice')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(300)

    const hasToday = (allAdvice ?? []).some((a: { date: string }) => a.date === today)

    return NextResponse.json({ allAdvice: allAdvice ?? [], todayDate: today, hasToday })
  } catch (e) {
    return NextResponse.json({ allAdvice: [], todayDate: today, hasToday: false, error: e instanceof Error ? e.message : String(e) })
  }
}
