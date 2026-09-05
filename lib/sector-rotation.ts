// 섹터 로테이션 감지 (옵션 8)
// 최근 5일 급등 섹터를 추적하여 지속 상승 vs 조정 임박 판단
// historical_patterns 테이블 활용 (당일 급등 종목 저장되어 있음)

import { getSupabaseAdmin } from './supabase'
import { STOCK_MAP } from './major-stocks'

export type SectorRotationSignal = {
  hot_sectors: Array<{ sector: string; days: number; avg_gain_pct: number }>  // 상승 지속 섹터
  cooling_sectors: string[]  // 급등 후 감소 추세 (로테이션 후보)
  emerging_sectors: string[] // 최근 1~2일 신규 부상 섹터 (초입)
  summary: string  // 프롬프트용 한국어 요약
}

type GainerRow = { ticker: string; name: string; change_pct?: number }

/**
 * 최근 N일 historical_patterns 조회 후 섹터별 부상 통계 계산
 */
export async function detectSectorRotation(daysBack: number = 5): Promise<SectorRotationSignal> {
  const supabase = getSupabaseAdmin()
  const empty: SectorRotationSignal = {
    hot_sectors: [],
    cooling_sectors: [],
    emerging_sectors: [],
    summary: '',
  }

  try {
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    const dates: string[] = []
    for (let i = 1; i <= daysBack; i++) {
      const d = new Date(kst)
      d.setDate(d.getDate() - i)
      dates.push(d.toISOString().slice(0, 10))
    }

    const { data } = await supabase
      .from('historical_patterns')
      .select('trade_date, top_gainers')
      .in('trade_date', dates)
      .order('trade_date', { ascending: false })

    if (!data || data.length === 0) return empty

    // 날짜별 → 섹터별 급등 종목 집계
    const sectorAppearances: Record<string, { dates: Set<string>; totalGain: number; count: number }> = {}
    for (const row of data) {
      const r = row as { trade_date: string; top_gainers?: GainerRow[] }
      const gainers = r.top_gainers ?? []
      for (const g of gainers.slice(0, 10)) {
        const sector = STOCK_MAP[g.ticker]?.sector
        if (!sector) continue
        if (!sectorAppearances[sector]) {
          sectorAppearances[sector] = { dates: new Set(), totalGain: 0, count: 0 }
        }
        sectorAppearances[sector].dates.add(r.trade_date)
        sectorAppearances[sector].totalGain += g.change_pct ?? 0
        sectorAppearances[sector].count++
      }
    }

    // 최근 3일 이상 부상 = hot / 최근 1일만 부상 = emerging / 4~5일 전만 부상 = cooling
    const hot: SectorRotationSignal['hot_sectors'] = []
    const emerging: string[] = []
    const cooling: string[] = []
    const recentDates = new Set(dates.slice(0, 3))
    const olderDates = new Set(dates.slice(3))

    for (const [sector, info] of Object.entries(sectorAppearances)) {
      const days = info.dates.size
      const recentHit = [...info.dates].filter(d => recentDates.has(d)).length
      const olderHit = [...info.dates].filter(d => olderDates.has(d)).length
      const avgGain = info.count > 0 ? info.totalGain / info.count : 0

      if (days >= 3) {
        hot.push({ sector, days, avg_gain_pct: avgGain })
      } else if (recentHit === 1 && olderHit === 0) {
        emerging.push(sector)
      } else if (olderHit >= 2 && recentHit === 0) {
        cooling.push(sector)
      }
    }

    hot.sort((a, b) => b.days - a.days)

    const summaryParts: string[] = []
    if (hot.length > 0) {
      summaryParts.push(`[🔥 지속 상승 섹터] ${hot.slice(0, 4).map(h => `${h.sector}(${h.days}일 부상, 평균 ${h.avg_gain_pct.toFixed(1)}%)`).join(' / ')}`)
    }
    if (emerging.length > 0) {
      summaryParts.push(`[🌱 신규 부상 섹터] ${emerging.slice(0, 4).join(' / ')} — 초입 진입 가능성`)
    }
    if (cooling.length > 0) {
      summaryParts.push(`[❄️ 조정 임박 섹터] ${cooling.slice(0, 4).join(' / ')} — 다음 로테이션 대상, 신규 진입 신중`)
    }

    // 예측 규칙 추가
    if (hot.length > 0 && hot[0].days >= 4) {
      summaryParts.push(`⚠️ ${hot[0].sector} 섹터 ${hot[0].days}일 연속 부상 — 단기 조정 임박, 신규 단타 진입 신중 (스윙/중기는 유효)`)
    }

    return {
      hot_sectors: hot,
      cooling_sectors: cooling,
      emerging_sectors: emerging,
      summary: summaryParts.join('\n'),
    }
  } catch (e) {
    console.error('[섹터로테이션] 감지 실패:', e instanceof Error ? e.message : e)
    return empty
  }
}
