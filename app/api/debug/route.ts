import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKSTDate } from '@/lib/date'

export async function GET() {
  const todayDate = getKSTDate()

  const { data, error } = await supabaseAdmin
    .from('recommendations')
    .select('*')
    .eq('date', todayDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return NextResponse.json({
    date: todayDate,
    error: error?.message ?? null,
    hasData: !!data,
    stocksCount: data?.stocks?.length ?? 0,
    stocksSample: data?.stocks?.slice(0, 2) ?? [],
    market_outlook: data?.market_outlook?.slice(0, 80) ?? null,
  })
}
