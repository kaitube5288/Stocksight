import axios from 'axios'

export interface PricePoint { time: string; close: number }

// KRX 장중 필터: 09:00–15:30 KST = 00:00–06:30 UTC, 평일만
function isMarketHours(ts: number): boolean {
  const d = new Date(ts * 1000)
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return false
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes()
  return mins >= 0 && mins <= 390
}

// ── Yahoo Finance ─────────────────────────────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

export async function fetchYahoo(
  ticker: string,
  interval: string,
  range: string,
  from: string | null,
  host: 'query1' | 'query2' = 'query2',
): Promise<PricePoint[]> {
  const symbol = ticker.includes('.') ? ticker : `${ticker}.KS`
  const base = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}`
  const url = from
    ? `${base}?interval=${interval}&period1=${Math.floor(new Date(from).getTime() / 1000)}&period2=${Math.floor(Date.now() / 1000)}`
    : `${base}?interval=${interval}&range=${range}`

  const res = await axios.get(url, { headers: YF_HEADERS, timeout: 12000 })
  const result = res.data?.chart?.result?.[0]
  if (!result) return []

  const timestamps: number[] = result.timestamp ?? []
  const closes: number[]     = result.indicators?.quote?.[0]?.close ?? []
  const isIntraday = interval !== '1d'

  return timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter(p => p.close != null && (!isIntraday || isMarketHours(p.ts)))
    .map(p => ({ time: new Date(p.ts * 1000).toISOString(), close: Math.round(p.close) }))
}

// ── Daum Finance ──────────────────────────────────────────────────────────────
// KOSPI: A{ticker}, KOSDAQ: Q{ticker}
// 일봉: /days, 5분봉: /minutes/5, 30분봉: /minutes/30
const DAUM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.daum.net',
  Origin:  'https://finance.daum.net',
  Accept:  'application/json, text/plain, */*',
}

interface DaumItem { date?: string; tradePrice?: number }

async function fetchDaumWithPrefix(
  ticker: string,
  interval: string,
  from: string | null,
  prefix: 'A' | 'Q',
): Promise<PricePoint[]> {
  const code = `${prefix}${ticker}`
  const isIntraday = interval !== '1d'
  const fromTs = from ? new Date(from).getTime() : 0

  let url: string
  if (interval === '1d') {
    const limit = from ? Math.min(Math.ceil((Date.now() - fromTs) / 86400000) + 10, 100) : 45
    url = `https://finance.daum.net/api/charts/${code}/days?limit=${limit}&adjusted=false`
  } else if (interval === '30m') {
    const limit = from ? Math.min(Math.ceil((Date.now() - fromTs) / 1800000) + 20, 400) : 200
    url = `https://finance.daum.net/api/charts/${code}/minutes/30?limit=${limit}&adjusted=false`
  } else {
    // 5m
    const limit = from ? Math.min(Math.ceil((Date.now() - fromTs) / 300000) + 20, 800) : 600
    url = `https://finance.daum.net/api/charts/${code}/minutes/5?limit=${limit}&adjusted=false`
  }

  const res = await axios.get(url, { headers: DAUM_HEADERS, timeout: 12000 })
  const items: DaumItem[] = res.data?.data ?? []

  return items
    .filter(item => item.tradePrice != null && item.date)
    .map(item => ({
      time:  new Date(item.date!).toISOString(),
      close: Math.round(item.tradePrice!),
    }))
    .filter(p => {
      if (isIntraday) {
        const ts = Math.floor(new Date(p.time).getTime() / 1000)
        if (!isMarketHours(ts)) return false
      }
      return !from || new Date(p.time).getTime() >= fromTs
    })
    .sort((a, b) => a.time.localeCompare(b.time))
}

export async function fetchDaum(
  ticker: string,
  interval: string,
  from: string | null,
): Promise<PricePoint[]> {
  // KOSPI(A) 먼저 시도, 실패하면 KOSDAQ(Q)
  for (const prefix of ['A', 'Q'] as const) {
    try {
      const prices = await fetchDaumWithPrefix(ticker, interval, from, prefix)
      if (prices.length > 0) return prices
    } catch { /* try next */ }
  }
  return []
}

// ── Naver Finance (일봉 전용) ─────────────────────────────────────────────────
const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.naver.com',
  Accept:  'text/html,application/json,*/*',
}

export async function fetchNaver(ticker: string, from: string | null): Promise<PricePoint[]> {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

  const now       = new Date()
  const endTime   = fmt(now)
  const startDate = from ? new Date(from) : new Date(now.getTime() - 40 * 86400000)
  const startTime = fmt(startDate)

  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${ticker}&requestType=1&startTime=${startTime}&endTime=${endTime}&timeframe=day&count=200`
  const res = await axios.get(url, { headers: NAVER_HEADERS, timeout: 10000, responseType: 'text' })

  // 응답은 JSONP 또는 JSON 배열
  let text: string = String(res.data).trim()
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1)

  let parsed: unknown[][]
  try { parsed = JSON.parse(text) as unknown[][] }
  catch { return [] }

  const prices: PricePoint[] = []
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length < 5) continue
    const dateRaw = String(row[0]).replace(/\./g, '-') // "2026.04.29" → "2026-04-29"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) continue
    const closeRaw = row[4]
    const close = typeof closeRaw === 'string'
      ? parseInt(closeRaw.replace(/,/g, ''), 10)
      : Number(closeRaw)
    if (!close || isNaN(close)) continue
    prices.push({ time: new Date(`${dateRaw}T00:00:00+09:00`).toISOString(), close })
  }

  const fromTs = from ? new Date(from).getTime() : 0
  return prices
    .filter(p => !from || new Date(p.time).getTime() >= fromTs)
    .sort((a, b) => a.time.localeCompare(b.time))
}
