import axios from 'axios'
import { getKSTDate } from './date'

const DART_BASE_URL = 'https://opendart.fss.or.kr/api'
const DART_API_KEY = process.env.DART_API_KEY

export type DartDisclosure = {
  rcept_no: string
  corp_name: string
  report_nm: string
  rcept_dt: string
  flr_nm: string
  stock_code?: string  // 상장 종목만 존재 (6자리 코드)
}

export async function getTodayDisclosures(): Promise<DartDisclosure[]> {
  const dateStr = getKSTDate().replace(/-/g, '')

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

// 주식코드 → DART corp_code 변환 (DART 재무 API 호출에 필요)
async function fetchCorpCode(stockCode: string): Promise<string | null> {
  try {
    const res = await axios.get(`${DART_BASE_URL}/company.json`, {
      params: { crtfc_key: DART_API_KEY, stock_code: stockCode },
      timeout: 8000,
    })
    if (res.data.status !== '000') return null
    return res.data.corp_code ?? null
  } catch { return null }
}

// DART 재무제표에서 ROE 추출 (당기순이익 / 자기자본 × 100)
export async function fetchROEFromDART(ticker: string): Promise<number | null> {
  if (!DART_API_KEY) return null
  const stockCode = ticker.includes('.') ? ticker.split('.')[0] : ticker
  const corpCode = await fetchCorpCode(stockCode)
  if (!corpCode) return null

  // 최근 사업연도 (당해연도 사업보고서 없으면 전년도 시도)
  const currentYear = new Date().getFullYear()
  for (const year of [currentYear - 1, currentYear - 2]) {
    try {
      const res = await axios.get(`${DART_BASE_URL}/fnlttSinglAcntAll.json`, {
        params: {
          crtfc_key: DART_API_KEY,
          corp_code: corpCode,
          bsns_year: String(year),
          reprt_code: '11011', // 사업보고서
          fs_div: 'CFS',       // 연결재무제표
        },
        timeout: 10000,
      })
      if (res.data.status !== '000' || !Array.isArray(res.data.list)) continue

      const list: { account_nm: string; thstrm_amount: string }[] = res.data.list
      const netIncome = list.find(r =>
        r.account_nm?.includes('당기순이익') && !r.account_nm.includes('지배')
      )
      const equity = list.find(r =>
        r.account_nm?.includes('자본총계') || r.account_nm?.includes('자기자본')
      )
      if (!netIncome || !equity) continue

      const net = parseFloat(netIncome.thstrm_amount?.replace(/,/g, '') ?? '')
      const eq  = parseFloat(equity.thstrm_amount?.replace(/,/g, '') ?? '')
      if (isNaN(net) || isNaN(eq) || eq === 0) continue

      const roe = Math.round((net / eq) * 10000) / 100
      if (Math.abs(roe) < 300) return roe
    } catch { continue }
  }
  return null
}
