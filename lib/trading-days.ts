// KRX 휴장일 (평일 공휴일만 — 주말은 getUTCDay()로 별도 처리)
const KR_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01', // 신정
  '2025-01-28', '2025-01-29', '2025-01-30', // 설날 연휴
  '2025-03-01', // 삼일절
  '2025-05-05', // 어린이날
  '2025-05-06', // 어린이날 대체
  '2025-05-15', // 부처님오신날
  '2025-06-06', // 현충일
  '2025-08-15', // 광복절
  '2025-10-03', // 개천절
  '2025-10-05', '2025-10-06', '2025-10-07', // 추석 연휴
  '2025-10-08', // 추석 대체
  '2025-10-09', // 한글날
  '2025-12-25', // 성탄절
  // 2026
  '2026-01-01', // 신정 (목)
  '2026-02-16', '2026-02-17', '2026-02-18', // 설날 연휴 (월~수)
  '2026-03-02', // 삼일절 대체 (3/1=일)
  '2026-05-01', // 근로자의 날 (금)
  '2026-05-05', // 어린이날 (화)
  '2026-05-25', // 부처님오신날 대체 (5/24=일)
  '2026-08-17', // 광복절 대체 (8/15=일)
  '2026-09-24', '2026-09-25', '2026-09-28', // 추석 연휴 + 대체 (9/26=토)
  '2026-10-05', // 개천절 대체 (10/3=토)
  '2026-10-09', // 한글날 (금)
  '2026-12-25', // 성탄절 (금)
])

// UTC 기준 Date를 받아 KST YYYY-MM-DD 반환
function kstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().split('T')[0]
}

export function isTradingDay(d: Date): boolean {
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return false       // 주말
  if (KR_HOLIDAYS.has(kstDateKey(d))) return false // 한국 공휴일
  return true
}

/** from 이후 N 거래일째 종료 시점(KST 장마감 15:30 = UTC 06:30)을 반환 */
export function addTradingDays(from: Date, days: number): Date {
  const d = new Date(from)
  let count = 0
  while (count < days) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isTradingDay(d)) count++
  }
  // 해당 날 장마감 시점: 15:30 KST = 06:30 UTC
  d.setUTCHours(6, 30, 0, 0)
  return d
}
