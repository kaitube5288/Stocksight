import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { runStrategyImprovementIfNeeded } from '@/lib/strategy-improvement'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const supabase = getSupabase()

  // 1. 테이블 존재 여부 + 저장된 데이터 확인
  const { data: records, error: tableError } = await supabase
    .from('strategy_improvements')
    .select('id, created_at, trade_type, cumulative_return, failed_count, total_count')
    .order('created_at', { ascending: false })
    .limit(10)

  if (tableError) {
    return NextResponse.json({
      status: 'error',
      message: '⚠️ strategy_improvements 테이블이 존재하지 않습니다. Supabase SQL Editor에서 테이블을 생성하세요.',
      sql_needed: true,
      error: tableError.message,
    })
  }

  return NextResponse.json({
    status: 'ok',
    table_exists: true,
    record_count: records?.length ?? 0,
    records: records ?? [],
    message: records?.length
      ? `✅ 정상 작동 중 — ${records.length}개 자기진단 기록 있음`
      : '⚠️ 테이블은 있지만 기록이 없음 — 아직 cron이 실행되지 않았거나 만료 종목 3개 미만',
  })
}

// POST: 수동으로 자기진단 즉시 실행
export async function POST() {
  const triggered = await runStrategyImprovementIfNeeded()

  const supabase = getSupabase()
  const { data: latest } = await supabase
    .from('strategy_improvements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)

  return NextResponse.json({
    triggered_sections: triggered,
    message: triggered.length
      ? `✅ ${triggered.join(', ')} 섹션 자기진단 완료`
      : '스킵 — 모든 섹션이 15% 이상이거나 만료 종목 3개 미만',
    latest_records: latest ?? [],
  })
}
