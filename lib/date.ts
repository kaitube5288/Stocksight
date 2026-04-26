/** KST(UTC+9) 기준 오늘 날짜를 YYYY-MM-DD 형식으로 반환 */
export function getKSTDate(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/** KST 기준 오늘 날짜를 한국어 로케일 문자열로 반환 */
export function getKSTDateLocale(options?: Intl.DateTimeFormatOptions): string {
  const now = new Date(new Date().getTime() + 9 * 60 * 60 * 1000)
  return now.toLocaleDateString('ko-KR', options)
}
