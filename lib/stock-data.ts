import axios from 'axios'
import { supabaseAdmin } from './supabase'

export type StockQuote = {
  ticker: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  previousClose: number
}

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

async function fetchYahooQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await axios.get(url, { headers: YF_HEADERS, timeout: 8000 })
    const meta = res.data?.chart?.result?.[0]?.meta
    if (!meta) return null

    return {
      ticker: symbol,
      name: meta.shortName || meta.symbol || symbol,
      price: meta.regularMarketPrice || 0,
      change: (meta.regularMarketPrice || 0) - (meta.previousClose || 0),
      changePercent: meta.regularMarketPrice && meta.previousClose
        ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100
        : 0,
      volume: meta.regularMarketVolume || 0,
      previousClose: meta.previousClose || 0,
    }
  } catch {
    return null
  }
}

// 한국 주식 시세 조회 (ticker: 005930 → 005930.KS, 실패 시 005930.KQ 시도)
export async function getKoreanStockQuote(ticker: string): Promise<StockQuote | null> {
  if (ticker.includes('.')) {
    const result = await fetchYahooQuote(ticker)
    if (result) result.ticker = ticker
    return result
  }
  const ks = await fetchYahooQuote(`${ticker}.KS`)
  if (ks) { ks.ticker = ticker; return ks }
  const kq = await fetchYahooQuote(`${ticker}.KQ`)
  if (kq) { kq.ticker = ticker; return kq }
  return null
}

// 여러 종목 실제 현재가 일괄 조회
export async function getRealPrices(
  tickers: string[]
): Promise<Record<string, { price: number; previousClose: number }>> {
  const results = await Promise.all(tickers.map(t => getKoreanStockQuote(t)))
  const map: Record<string, { price: number; previousClose: number }> = {}
  results.forEach((q, i) => {
    if (q && (q.price > 0 || q.previousClose > 0)) {
      map[tickers[i]] = {
        price: q.price || q.previousClose,
        previousClose: q.previousClose || q.price,
      }
    }
  })
  return map
}

// KOSPI/KOSDAQ 지수
export async function getMarketIndex(): Promise<{
  kospi: StockQuote | null
  kosdaq: StockQuote | null
}> {
  const [kospi, kosdaq] = await Promise.all([
    fetchYahooQuote('%5EKS11'),
    fetchYahooQuote('%5EKQ11'),
  ])
  return { kospi, kosdaq }
}

// USD/KRW 환율
export async function getUSDKRW(): Promise<number | null> {
  try {
    const res = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX?interval=1d&range=1d',
      { headers: YF_HEADERS, timeout: 8000 }
    )
    return res.data?.chart?.result?.[0]?.meta?.regularMarketPrice || null
  } catch {
    return null
  }
}

// 과거 유사 패턴 조회 (Supabase)
export async function getSimilarHistoricalPatterns(keywords: string[]): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('market_events')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(50)

    if (!data || !data.length) return '과거 패턴 데이터 없음 (scripts/collect_historical.py 실행 필요)'

    const relevant = data.filter((event) =>
      keywords.some(
        (kw) =>
          event.description?.includes(kw) ||
          event.affected_sectors?.some((s: string) => s.includes(kw))
      )
    )

    const source = relevant.length ? relevant : data.slice(0, 10)

    return source
      .slice(0, 10)
      .map(
        (e) =>
          `- [${e.event_date}] ${e.description} → 영향종목: ${e.affected_tickers?.join(', ') || '없음'} (${e.impact_direction}, ${e.impact_magnitude}%)`
      )
      .join('\n')
  } catch {
    return '과거 패턴 조회 실패'
  }
}

export function formatMarketContext(params: {
  kospi: StockQuote | null
  kosdaq: StockQuote | null
  usdkrw: number | null
}): string {
  const lines: string[] = []
  if (params.kospi) {
    lines.push(
      `- KOSPI: ${params.kospi.price.toLocaleString()} (${params.kospi.changePercent.toFixed(2)}%)`
    )
  }
  if (params.kosdaq) {
    lines.push(
      `- KOSDAQ: ${params.kosdaq.price.toLocaleString()} (${params.kosdaq.changePercent.toFixed(2)}%)`
    )
  }
  if (params.usdkrw) {
    lines.push(`- USD/KRW: ${params.usdkrw.toFixed(2)}원`)
  }
  return lines.join('\n') || '시장 데이터 없음'
}
