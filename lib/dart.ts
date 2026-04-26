import axios from 'axios'

const DART_BASE_URL = 'https://opendart.fss.or.kr/api'
const DART_API_KEY = process.env.DART_API_KEY

export type DartDisclosure = {
  rcept_no: string
  corp_name: string
  report_nm: string
  rcept_dt: string
  flr_nm: string
}

export async function getTodayDisclosures(): Promise<DartDisclosure[]> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')

  try {
    const res = await axios.get(`${DART_BASE_URL}/list.json`, {
      params: {
        crtfc_key: DART_API_KEY,
        bgn_de: dateStr,
        end_de: dateStr,
        sort: 'date',
        sort_mth: 'desc',
        page_no: 1,
        page_count: 20,
      },
      timeout: 10000,
    })

    if (res.data.status !== '000') return []
    return res.data.list || []
  } catch {
    console.error('DART API 오류')
    return []
  }
}

export async function getRecentDisclosures(days = 1): Promise<DartDisclosure[]> {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)

  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')

  try {
    const res = await axios.get(`${DART_BASE_URL}/list.json`, {
      params: {
        crtfc_key: DART_API_KEY,
        bgn_de: fmt(start),
        end_de: fmt(end),
        sort: 'date',
        sort_mth: 'desc',
        page_no: 1,
        page_count: 40,
      },
      timeout: 10000,
    })

    if (res.data.status !== '000') return []
    return res.data.list || []
  } catch {
    console.error('DART API 오류')
    return []
  }
}

export function formatDisclosuresForPrompt(disclosures: DartDisclosure[]): string {
  if (!disclosures.length) return '오늘 주요 공시 없음'
  return disclosures
    .slice(0, 15)
    .map(d => `- [${d.corp_name}] ${d.report_nm} (${d.rcept_dt}, 공시자: ${d.flr_nm})`)
    .join('\n')
}
