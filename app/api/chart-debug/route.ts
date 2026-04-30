import { NextRequest, NextResponse } from 'next/server'
import { fetchYahoo, fetchDaum, fetchNaver } from '@/lib/price-providers'
import axios from 'axios'

export const dynamic = 'force-dynamic'

interface SourceResult {
  count?: number
  ms: number
  first?: unknown
  last?: unknown
  error?: string
  httpStatus?: number
  rawPreview?: string
}

const DAUM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://finance.daum.net',
  Origin:  'https://finance.daum.net',
  Accept:  'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9',
}

const KAKAO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://finance.kakao.com',
  Origin:  'https://finance.kakao.com',
  Accept:  'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9',
}

export async function GET(request: NextRequest) {
  const ticker   = request.nextUrl.searchParams.get('ticker')   ?? '005930'
  const interval = request.nextUrl.searchParams.get('interval') ?? '5m'
  const from     = request.nextUrl.searchParams.get('from')     ?? null
  const range    = interval === '1d' ? '45d' : interval === '30m' ? '10d' : '5d'

  const results: Record<string, SourceResult> = {}

  // ── 기존 소스 ─────────────────────────────────────────────────────
  const tests: { name: string; fn: () => Promise<{ time: string; close: number }[]> }[] = [
    { name: 'yahoo-query1', fn: () => fetchYahoo(ticker, interval, range, from, 'query1') },
    { name: 'daum',         fn: () => fetchDaum(ticker, interval, from) },
  ]
  if (interval === '1d') {
    tests.push({ name: 'naver', fn: () => fetchNaver(ticker, from) })
  }

  for (const t of tests) {
    const start = Date.now()
    try {
      const prices = await t.fn()
      results[t.name] = { count: prices.length, ms: Date.now() - start, first: prices[0] ?? null, last: prices[prices.length - 1] ?? null }
    } catch (e) {
      results[t.name] = { error: String(e), ms: Date.now() - start }
    }
  }

  // ── Daum 원본 응답 직접 확인 ──────────────────────────────────────
  const daumStart = Date.now()
  try {
    const minuteEp = interval === '30m' ? 'minutes/30' : interval === '5m' ? 'minutes/5' : 'days'
    const limit = interval === '1d' ? 45 : interval === '30m' ? 200 : 600
    const r = await axios.get(
      `https://finance.daum.net/api/charts/A${ticker}/${minuteEp}?limit=${limit}&adjusted=false`,
      { headers: DAUM_HEADERS, timeout: 10000, validateStatus: () => true }
    )
    results['daum-raw-A'] = {
      httpStatus: r.status,
      ms: Date.now() - daumStart,
      rawPreview: JSON.stringify(r.data).slice(0, 300),
    }
  } catch (e) {
    results['daum-raw-A'] = { error: String(e), ms: Date.now() - daumStart }
  }

  // ── Kakao 증권 API 테스트 ─────────────────────────────────────────
  // Kakao Finance = finance.kakao.com (카카오페이 증권과 별도)
  const kakaoStart = Date.now()
  try {
    // Kakao Finance chart API (Daum과 동일 백엔드일 가능성 있음)
    const r = await axios.get(
      `https://finance.kakao.com/api/quotes/stocks/${ticker}?format=json`,
      { headers: KAKAO_HEADERS, timeout: 10000, validateStatus: () => true }
    )
    results['kakao-stock'] = {
      httpStatus: r.status,
      ms: Date.now() - kakaoStart,
      rawPreview: JSON.stringify(r.data).slice(0, 300),
    }
  } catch (e) {
    results['kakao-stock'] = { error: String(e), ms: Date.now() - kakaoStart }
  }

  // ── Naver Mobile API (분봉) ───────────────────────────────────────
  const naverMinStart = Date.now()
  try {
    const timeframe = interval === '5m' ? 'minute' : interval === '30m' ? 'minute30' : 'day'
    const r = await axios.get(
      `https://api.stock.naver.com/chart/domestic/item/${ticker}/${timeframe}?startDateTime=20260429090000&endDateTime=20260430160000`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          Referer: 'https://m.stock.naver.com/',
          Accept: 'application/json',
        },
        timeout: 10000, validateStatus: () => true,
      }
    )
    results['naver-mobile-min'] = {
      httpStatus: r.status,
      ms: Date.now() - naverMinStart,
      rawPreview: JSON.stringify(r.data).slice(0, 300),
    }
  } catch (e) {
    results['naver-mobile-min'] = { error: String(e), ms: Date.now() - naverMinStart }
  }

  return NextResponse.json({ ticker, interval, range, results })
}
