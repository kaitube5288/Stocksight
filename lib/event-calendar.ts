// 시장 이벤트 캘린더 — FOMC, 옵션만기, 한은 금통위 등
// D-1 시 프롬프트에 경고로 반영하여 신규 진입 자제 권장

export type MarketEvent = {
  date: string
  type: 'FOMC' | 'OPTION_EXPIRY' | 'BOK' | 'QUAD_WITCHING'
  description: string
  impact: 'high' | 'medium'
}

// FOMC 정례회의 (연 8회) — 2026, 2027년
const FOMC_DATES = [
  // 2026
  '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-16',
  // 2027 (잠정)
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-16',
  '2027-07-28', '2027-09-22', '2027-11-03', '2027-12-15',
]

// 한국은행 금통위 (연 8회) — 2026년
const BOK_DATES = [
  '2026-01-15', '2026-02-26', '2026-04-09', '2026-05-28',
  '2026-07-09', '2026-08-27', '2026-10-15', '2026-11-26',
]

// 옵션 만기일: 매월 두번째 목요일 (자동 계산)
function getOptionExpiryDates(year: number): string[] {
  const dates: string[] = []
  for (let month = 1; month <= 12; month++) {
    let thursdayCount = 0
    for (let day = 1; day <= 14; day++) {
      const d = new Date(year, month - 1, day)
      if (d.getDay() === 4) {
        thursdayCount++
        if (thursdayCount === 2) {
          dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
          break
        }
      }
    }
  }
  return dates
}

// 쿼드러플 위칭데이 (3, 6, 9, 12월 두번째 목요일 — 옵션+선물 동시만기)
function getQuadWitchingDates(year: number): string[] {
  const expiries = getOptionExpiryDates(year)
  return expiries.filter(d => {
    const month = parseInt(d.slice(5, 7))
    return [3, 6, 9, 12].includes(month)
  })
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24
  const fromMid = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const toMid = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.floor((toMid.getTime() - fromMid.getTime()) / msPerDay)
}

/**
 * 오늘 기준 D-daysAhead 이내의 이벤트 반환
 * @param daysAhead 몇일 이내 이벤트를 확인할지 (기본 1일 = 내일)
 */
export function getUpcomingEvents(daysAhead: number = 1): MarketEvent[] {
  const events: MarketEvent[] = []
  const todayKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))

  const checkDate = (dateStr: string, type: MarketEvent['type'], description: string, impact: MarketEvent['impact']) => {
    const eventDate = new Date(`${dateStr}T00:00:00+09:00`)
    const diff = daysBetween(todayKST, eventDate)
    if (diff >= 0 && diff <= daysAhead) {
      events.push({ date: dateStr, type, description: `${description}${diff === 0 ? ' (오늘)' : ` (D-${diff})`}`, impact })
    }
  }

  for (const d of FOMC_DATES) {
    checkDate(d, 'FOMC', `${d} 미국 FOMC 정례회의`, 'high')
  }

  for (const d of BOK_DATES) {
    checkDate(d, 'BOK', `${d} 한국은행 금통위`, 'high')
  }

  const currentYear = todayKST.getFullYear()
  const expiries = [...getOptionExpiryDates(currentYear), ...getOptionExpiryDates(currentYear + 1)]
  const quadWitching = new Set([...getQuadWitchingDates(currentYear), ...getQuadWitchingDates(currentYear + 1)])
  for (const d of expiries) {
    if (quadWitching.has(d)) {
      checkDate(d, 'QUAD_WITCHING', `${d} 쿼드러플 위칭데이 (옵션+선물 동시만기)`, 'high')
    } else {
      checkDate(d, 'OPTION_EXPIRY', `${d} 코스피200 옵션 만기일`, 'medium')
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * 프롬프트에 삽입할 이벤트 경고 문자열 생성
 */
export function formatEventWarnings(events: MarketEvent[]): string {
  if (events.length === 0) return ''
  const lines = ['⚠️ 임박 이벤트 경고 (신규 단타 진입 자제 권장):']
  for (const ev of events) {
    const emoji = ev.impact === 'high' ? '🚨' : '⚠️'
    lines.push(`${emoji} ${ev.description}`)
  }
  lines.push('→ 이벤트 D-1 ~ 당일은 시장 변동성 급증. 단타 확신도 임계값 상향 + 신규 진입 최소화 권장.')
  return lines.join('\n')
}
