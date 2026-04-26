import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'

export async function GET() {
  try {
    const today = getKSTDate()

    const { data, error } = await supabase
      .from('recommendations')
      .select('*')
      .eq('date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      // 오늘 데이터 없으면 가장 최근 것 반환
      const { data: latest } = await supabase
        .from('recommendations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      return NextResponse.json({ data: latest || null, isToday: false })
    }

    return NextResponse.json({ data, isToday: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
