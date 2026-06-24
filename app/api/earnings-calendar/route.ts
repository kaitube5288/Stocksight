import { NextResponse } from 'next/server'
import axios from 'axios'
import Parser from 'rss-parser'
import { getKSTDate } from '@/lib/date'
import { scrapeNaverQuarterlyEarnings } from '@/lib/stock-data'

const rssParser = new Parser({ timeout: 10000 })

const DART_BASE = 'https://opendart.fss.or.kr/api'
const DART_KEY  = process.env.DART_API_KEY

const EARNINGS_KW = [
  '잠정실적', '잠정공시', '영업(잠정)실적', '연결재무제표기준영업',
  '매출액또는손익구조', '분기보고서', '반기보고서', '영업실적',
  '실적발표', '손익구조',
]

const RATE_KW = [
  '금리', '기준금리', 'FOMC', '연준', '한국은행', '금통위',
  'Fed', '통화정책', '국채금리', '채권금리', '금리인상', '금리인하',
]
const POLICY_KW = [
  '정책발표', '경제정책', '기재부', '산업부', '정부발표', '규제완화',
  '세제', '부양책', '재정정책', '정책금리', '추경', '무역정책',
]

export type EarningsItem = {
  corp_name: string
  report_nm: string
  rcept_dt: string
  rcept_no?: string
  stock_code?: string
  // 네이버 분기 실적 (scrapeNaverQuarterlyEarnings로 보강)
  quarter?: string
  revenue?: number | null        // 매출액 (억원)
  operatingProfit?: number | null // 영업이익 (억원)
  netIncome?: number | null      // 당기순이익 (억원)
}

export type ScheduledItem = {
  name: string
  date: string
  note?: string
  ticker?: string
}

export type RateNewsItem = {
  title: string
  link: string
  pubDate: string
  source: string
  category: 'rate' | 'policy'
}

export type CalendarData = {
  todayEarnings: EarningsItem[]
  scheduledEarnings: ScheduledItem[]
  rateNews: RateNewsItem[]
  policyNews: RateNewsItem[]
  fetchedAt: string
}

// 30분 서버 캐시
let _cache: { data: CalendarData; ts: number } | null = null
const TTL = 30 * 60 * 1000

function kstDateOffset(days: number): string {
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

// DART 공시 목록 → 실적 키워드 필터 (stock_code 포함)
async function dartEarnings(dateStr: string): Promise<EarningsItem[]> {
  if (!DART_KEY) return []
  try {
    const res = await axios.get(`${DART_BASE}/list.json`, {
      params: {
        crtfc_key: DART_KEY,
        bgn_de: dateStr,
        end_de: dateStr,
        sort: 'date',
        sort_mth: 'desc',
        page_no: 1,
        page_count: 100,
      },
      timeout: 10000,
    })
    if (res.data.status !== '000') return []
    const list: EarningsItem[] = res.data.list || []
    return list.filter(d => EARNINGS_KW.some(kw => d.report_nm?.includes(kw)))
  } catch { return [] }
}

// 네이버 분기 실적으로 DART 항목 보강 (최대 8개 병렬 처리)
async function enrichWithNaverEarnings(items: EarningsItem[]): Promise<EarningsItem[]> {
  const targets = items.filter(d => d.stock_code && /^\d{6}$/.test(d.stock_code)).slice(0, 8)
  if (targets.length === 0) return items

  const results = await Promise.all(
    targets.map(async item => {
      const q = await scrapeNaverQuarterlyEarnings(item.stock_code!).catch(() => null)
      if (!q) return item
      return {
        ...item,
        quarter: q.quarter,
        revenue: q.revenue,
        operatingProfit: q.operatingProfit,
        netIncome: q.netIncome,
      }
    })
  )

  // targets 외 항목은 그대로 유지
  const enrichedSet = new Set(targets.map(t => t.rcept_no ?? t.corp_name))
  return items.map(item => {
    const enriched = results.find(r => (r.rcept_no ?? r.corp_name) === (item.rcept_no ?? item.corp_name))
    return enrichedSet.has(item.rcept_no ?? item.corp_name) && enriched ? enriched : item
  })
}

// 네이버 금융 모바일 API — 실적발표 일정
async function naverEarningsSchedule(): Promise<ScheduledItem[]> {
  const kstToday    = getKSTDate()
  const kstTomorrow = (() => {
    const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000)
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })()

  for (const url of [
    `https://m.stock.naver.com/api/market/earning/schedule?date=${kstToday}`,
    `https://m.stock.naver.com/api/market/earning/schedule?date=${kstTomorrow}`,
    `https://m.stock.naver.com/api/market/earning`,
  ]) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          Referer: 'https://m.stock.naver.com/',
          Accept: 'application/json',
        },
        timeout: 6000,
      })
      const data = res.data
      const items: unknown[] = Array.isArray(data) ? data
        : Array.isArray(data?.items) ? data.items
        : Array.isArray(data?.list)  ? data.list
        : []

      if (items.length > 0) {
        return items.slice(0, 20).map((item: unknown) => {
          const i = item as Record<string, unknown>
          const ticker = String(i.stockCode ?? i.stock_code ?? i.code ?? i.symbolCode ?? '')
          return {
            name: String(i.stockName ?? i.name ?? i.corp_name ?? i.corpName ?? ''),
            date: String(i.date ?? i.expectedDate ?? i.rcept_dt ?? ''),
            note: i.eps ? `EPS: ${i.eps}` : undefined,
            ticker: /^\d{6}$/.test(ticker) ? ticker : undefined,
          }
        }).filter(s => s.name.length > 0)
      }
    } catch { /* 다음 시도 */ }
  }
  return []
}

// 네이버 금융 실적발표 캘린더 HTML 스크래핑
async function scrapeNaverEarningCalendar(): Promise<ScheduledItem[]> {
  try {
    const res = await axios.get('https://finance.naver.com/market/earning.naver', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Charset': 'euc-kr',
        Referer: 'https://finance.naver.com/',
      },
      responseType: 'arraybuffer',
      timeout: 8000,
    })
    const html = new TextDecoder('euc-kr').decode(res.data as ArrayBuffer)
    const results: ScheduledItem[] = []
    const seen = new Set<string>()

    for (const rowM of html.matchAll(/<tr[^>]*class="[^"]*type_1[^"]*"[^>]*>([\s\S]*?)<\/tr>|<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const row = rowM[1] ?? rowM[2]
      if (!row) continue
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      if (cells.length < 2) continue

      const codeM = cells[0][1].match(/code=(\d{6})/)
      const nameM = cells[0][1].match(/code=\d{6}[^"]*"[^>]*>([^<]{2,20})<\/a>/)
        ?? cells[0][1].match(/>\s*([가-힣A-Za-z][가-힣A-Za-z0-9\s]{1,18})\s*<\/a>/)
      const dateM = cells[1][1].match(/(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/)
        ?? cells[1][1].match(/(\d{1,2}[/]\d{1,2})/)
      if (!nameM || !dateM) continue

      const name = nameM[1].trim()
      if (!seen.has(name)) {
        seen.add(name)
        results.push({ name, date: dateM[1].trim(), ticker: codeM?.[1] })
      }
      if (results.length >= 20) break
    }
    return results
  } catch { return [] }
}

// 타이틀 끝 " - 언론사명" 추출 (Google News RSS 포맷)
function extractSource(title: string, fallback: string): string {
  const m = title.match(/ - ([^-]{2,30})$/)
  return m ? m[1].trim() : fallback
}

// Google News RSS — 금리/정책 뉴스 (최근 7일 이내만)
async function fetchRateAndPolicyNews(): Promise<{ rate: RateNewsItem[]; policy: RateNewsItem[] }> {
  const rateItems: RateNewsItem[] = []
  const policyItems: RateNewsItem[] = []
  const seen = new Set<string>()
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000  // 7일 전

  await Promise.all([
    { q: '금리 기준금리 FOMC 연준 when:7d',    type: 'rate'   as const },
    { q: '한국은행 금통위 통화정책 when:7d',    type: 'rate'   as const },
    { q: '경제정책 기재부 재정정책 when:7d',    type: 'policy' as const },
  ].map(async ({ q, type }) => {
    try {
      const feed = await rssParser.parseURL(
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`
      )
      for (const item of (feed.items ?? []).slice(0, 10)) {
        const title = item.title ?? ''
        if (!title || seen.has(title)) continue

        // 7일 이내 기사만 허용
        const pub = item.pubDate ? new Date(item.pubDate).getTime() : 0
        if (pub > 0 && pub < cutoff) continue

        const isRate   = RATE_KW.some(k => title.includes(k))
        const isPolicy = POLICY_KW.some(k => title.includes(k))
        if (!isRate && !isPolicy) continue
        seen.add(title)

        // 타이틀에서 " - 언론사" 분리해서 실제 source 추출
        const cleanTitle = title.replace(/ - [^-]{2,30}$/, '').trim()
        const source = extractSource(title, 'Google 뉴스')

        const entry: RateNewsItem = {
          title: cleanTitle,
          link: item.link ?? '',
          pubDate: item.pubDate ?? '',
          source,
          category: type === 'rate' && isRate ? 'rate' : 'policy',
        }
        if (entry.category === 'rate') rateItems.push(entry)
        else policyItems.push(entry)
      }
    } catch { /* 무시 */ }
  }))

  // pubDate 최신순 정렬
  const sortByDate = (arr: RateNewsItem[]) =>
    arr.sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime())

  return { rate: sortByDate(rateItems).slice(0, 8), policy: sortByDate(policyItems).slice(0, 8) }
}

export async function GET() {
  const now = Date.now()
  if (_cache && now - _cache.ts < TTL) {
    return NextResponse.json(_cache.data)
  }

  const today     = kstDateOffset(0)
  const yesterday = kstDateOffset(-1)

  const [todayDart, yesterdayDart, scheduled1, scheduled2, { rate, policy }] = await Promise.all([
    dartEarnings(today),
    dartEarnings(yesterday),
    naverEarningsSchedule(),
    scrapeNaverEarningCalendar(),
    fetchRateAndPolicyNews(),
  ])

  // 오늘+어제 병합 (중복 제거)
  const seenCorp = new Set<string>()
  const merged: EarningsItem[] = []
  for (const item of [...todayDart, ...yesterdayDart]) {
    if (!seenCorp.has(item.corp_name)) {
      seenCorp.add(item.corp_name)
      merged.push(item)
    }
  }

  // 네이버 분기 실적으로 보강
  const todayEarnings = await enrichWithNaverEarnings(merged.slice(0, 20))

  // 예정 일정 병합
  const seenSched = new Set<string>()
  const scheduledEarnings: ScheduledItem[] = []
  for (const item of [...scheduled1, ...scheduled2]) {
    if (!seenSched.has(item.name)) {
      seenSched.add(item.name)
      scheduledEarnings.push(item)
    }
  }

  const data: CalendarData = {
    todayEarnings,
    scheduledEarnings: scheduledEarnings.slice(0, 20),
    rateNews: rate,
    policyNews: policy,
    fetchedAt: new Date().toISOString(),
  }

  _cache = { data, ts: now }
  return NextResponse.json(data)
}
