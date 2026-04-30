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

async function fetchYahooSymbol(
  symbol: string,
  interval: string,
  range: string,
  from: string | null,
  host: 'query1' | 'query2',
): Promise<PricePoint[]> {
  const base = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}`
  // period1/period2 방식은 한국 주식 인트라데이에서 1개 봉만 반환하는 버그가 있어
  // 항상 range 방식을 사용하고 from 필터를 후처리로 적용
  const url = `${base}?interval=${interval}&range=${range}`

  const res = await axios.get(url, { headers: YF_HEADERS, timeout: 12000 })
  const result = res.data?.chart?.result?.[0]
  if (!result) return []

  const timestamps: number[] = result.timestamp ?? []
  const closes: number[]     = result.indicators?.quote?.[0]?.close ?? []
  const isIntraday = interval !== '1d'
  const fromMs = from ? new Date(from).getTime() : 0

  return timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter(p => p.close != null && (!isIntraday || isMarketHours(p.ts)))
    .filter(p => !from || p.ts * 1000 >= fromMs)
    .map(p => ({ time: new Date(p.ts * 1000).toISOString(), close: Math.round(p.close) }))
}

// KOSPI(.KS) 시도 후 실패하면 KOSDAQ(.KQ) 자동 재시도
export async function fetchYahoo(
  ticker: string,
  interval: string,
  range: string,
  from: string | null,
  host: 'query1' | 'query2' = 'query2',
): Promise<PricePoint[]> {
  if (ticker.includes('.')) {
    return fetchYahooSymbol(ticker, interval, range, from, host)
  }
  const ks = await fetchYahooSymbol(`${ticker}.KS`, interval, range, from, host).catch(() => [] as PricePoint[])
  if (ks.length > 0) return ks
  return fetchYahooSymbol(`${ticker}.KQ`, interval, range, from, host).catch(() => [] as PricePoint[])
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
  range?: string,
): Promise<PricePoint[]> {
  const code = `${prefix}${ticker}`
  const isIntraday = interval !== '1d'
  const fromTs = from ? new Date(from).getTime() : 0
  const nowMs = getKSTNow().getTime()

  let url: string
  if (interval === '1d') {
    const baseDays = range ? parseInt(range) : 45
    const limit = from ? Math.min(Math.ceil((nowMs - fromTs) / 86400000) + 10, baseDays) : baseDays
    url = `https://finance.daum.net/api/charts/${code}/days?limit=${limit}&adjusted=false`
  } else if (interval === '30m') {
    const baseDays = range ? parseInt(range) : 10
    const baseLimit = baseDays * 16 // 30분 봉: 하루 ~16개
    const limit = from ? Math.min(Math.ceil((nowMs - fromTs) / 1800000) + 20, baseLimit) : baseLimit
    url = `https://finance.daum.net/api/charts/${code}/minutes/30?limit=${limit}&adjusted=false`
  } else {
    // 5m
    const baseDays = range ? parseInt(range) : 5
    const baseLimit = baseDays * 80 // 5분 봉: 하루 ~80개
    const limit = from ? Math.min(Math.ceil((nowMs - fromTs) / 300000) + 20, baseLimit) : baseLimit
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

function getKSTNow(): Date {
  return new Date(new Date().getTime() + 9 * 3_600_000)
}

export async function fetchDaum(
  ticker: string,
  interval: string,
  from: string | null,
  range?: string,
): Promise<PricePoint[]> {
  // KOSPI(A) 먼저 시도, 실패하면 KOSDAQ(Q)
  for (const prefix of ['A', 'Q'] as const) {
    try {
      const prices = await fetchDaumWithPrefix(ticker, interval, from, prefix, range)
      if (prices.length > 0) return prices
    } catch { /* try next */ }
  }
  return []
}

// ── Naver Mobile API (분봉: 5m / 30m) ───────────────────────────────────────
const NAVER_MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  Referer: 'https://m.stock.naver.com/',
  Accept:  'application/json',
}

// KST Date (UTC+9h timestamp)를 YYYYMMDDHHMM 형식으로 변환
function toNaverKST(kstDate: Date): string {
  return `${kstDate.getUTCFullYear()}${String(kstDate.getUTCMonth() + 1).padStart(2, '0')}${String(kstDate.getUTCDate()).padStart(2, '0')}${String(kstDate.getUTCHours()).padStart(2, '0')}${String(kstDate.getUTCMinutes()).padStart(2, '0')}00`
}

export async function fetchNaverIntraday(
  ticker: string,
  interval: string,  // '5m' | '30m'
  from: string | null,
): Promise<PricePoint[]> {
  const timeframe = interval === '30m' ? 'minute30' : 'minute5'
  const days = interval === '30m' ? 12 : 7
  const now = getKSTNow()
  const startDate = from ? new Date(from) : new Date(now.getTime() - days * 86_400_000)
  const url = `https://api.stock.naver.com/chart/domestic/item/${ticker}/${timeframe}` +
    `?startDateTime=${toNaverKST(startDate)}&endDateTime=${toNaverKST(now)}`

  const res = await axios.get(url, { headers: NAVER_MOBILE_HEADERS, timeout: 12000 })
  const items: { localDateTime?: string; currentPrice?: number }[] = res.data ?? []

  const fromMs = from ? new Date(from).getTime() : 0
  return items
    .filter(item => item.localDateTime && item.currentPrice != null)
    .map(item => {
      const dt = item.localDateTime!
      const iso = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${dt.slice(8,10)}:${dt.slice(10,12)}:${dt.slice(12,14)}+09:00`
      return { time: new Date(iso).toISOString(), close: Math.round(item.currentPrice!) }
    })
    .filter(p => {
      const ts = Math.floor(new Date(p.time).getTime() / 1000)
      return isMarketHours(ts) && (!from || new Date(p.time).getTime() >= fromMs)
    })
    .sort((a, b) => a.time.localeCompare(b.time))
}

// ── Naver Finance (일봉 전용) ─────────────────────────────────────────────────
const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.naver.com',
  Accept:  'text/html,application/json,*/*',
}

export async function fetchNaver(ticker: string, from: string | null, range?: string): Promise<PricePoint[]> {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

  const now       = getKSTNow()
  const endTime   = fmt(now)
  const baseDays = range ? parseInt(range) : 40
  const startDate = from ? new Date(from) : new Date(now.getTime() - baseDays * 86400000)
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
