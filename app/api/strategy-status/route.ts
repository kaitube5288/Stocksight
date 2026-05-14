import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { runStrategyImprovementVerbose, debugExpiredReturns } from '@/lib/strategy-improvement'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const supabase = getSupabase()

  const { data: records, error: tableError } = await supabase
    .from('strategy_improvements')
    .select('id, created_at, trade_type, cumulative_return, failed_count, total_count')
    .order('created_at', { ascending: false })
    .limit(10)

  if (tableError) {
    return NextResponse.json({
      status: 'error',
      message: '⚠️ strategy_improvements 테이블이 존재하지 않습니다.',
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
      : '⚠️ 테이블은 있지만 기록이 없음',
  })
}

// POST: 수동으로 자기진단 즉시 실행 (상세 사유 포함)
export async function POST() {
  const [result, debug] = await Promise.all([
    runStrategyImprovementVerbose(),
    debugExpiredReturns(),
  ])

  const supabase = getSupabase()
  const { data: latest } = await supabase
    .from('strategy_improvements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)

  return NextResponse.json({
    triggered_sections: result.triggered,
    reasons: result.reasons,
    message: result.triggered.length
      ? `✅ ${result.triggered.join(', ')} 섹션 자기진단 완료`
      : '스킵됨 — reasons 필드 확인',
    latest_records: latest ?? [],
    debug,
  })
}
