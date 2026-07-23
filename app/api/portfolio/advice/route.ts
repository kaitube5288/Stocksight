import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const today = getKSTDate()

  try {
    // 오늘 조언 먼저 조회
    const { data: todayData } = await supabase
      .from('portfolio_advice')
      .select('*')
      .eq('date', today)
      .order('created_at', { ascending: true })

    if (todayData && todayData.length > 0) {
      return NextResponse.json({ advice: todayData, date: today, isToday: true })
    }

    // 없으면 가장 최근 날짜 조언 반환
    const { data: latest } = await supabase
      .from('portfolio_advice')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latest) return NextResponse.json({ advice: [], date: null, isToday: false })

    const { data: latestData } = await supabase
      .from('portfolio_advice')
      .select('*')
      .eq('date', (latest as { date: string }).date)
      .order('created_at', { ascending: true })

    return NextResponse.json({
      advice: latestData ?? [],
      date: (latest as { date: string }).date,
      isToday: false,
    })
  } catch (e) {
    return NextResponse.json({ advice: [], date: null, isToday: false, error: e instanceof Error ? e.message : String(e) })
  }
}
