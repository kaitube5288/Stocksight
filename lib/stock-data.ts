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
  exchangeName?: string  // "KSC"=KOSPI, "KOE"/"KOQ"=KOSDAQ
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
      exchangeName: meta.exchangeName,
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
  if (ks && (ks.price > 0 || ks.previousClose > 0)) { ks.ticker = ticker; return ks }
  const kq = await fetchYahooQuote(`${ticker}.KQ`)
  if (kq && (kq.price > 0 || kq.previousClose > 0)) { kq.ticker = ticker; return kq }
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

export type StockFundamentals = {
  per: number | null
  pbr: number | null
  roe: number | null
  market: 'KOSPI' | 'KOSDAQ' | null
}

const HTML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
}

function parseN(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ''))
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

// invest 페이지: >LABEL< 위치 이후 첫 번째 <em> 값 추출
// >PER< 는 단독 PER 레이블만 매칭 (>업종PER<은 한국어가 앞에 있어 >PER< 로 안 잡힘)
// 첫 번째 <em>이 항상 해당 레이블의 값 셀 — 업종PER보다 먼저 나옴
async function scrapeNaverInvest(code: string): Promise<{ per: number|null; pbr: number|null }> {
  try {
    const res = await axios.get(
      `https://finance.naver.com/item/coinfo.naver?code=${code}&target=invest`,
      { headers: { ...HTML_HEADERS, Referer: `https://finance.naver.com/item/main.naver?code=${code}` }, timeout: 10000, responseType: 'text' }
    )
    const html: string = res.data

    const extractVal = (label: string): number | null => {
      const idx = html.indexOf(`>${label}<`)
      if (idx === -1) return null
      // 레이블 직후 300자 이내 첫 번째 <em> 값 (업종PER보다 먼저 나오는 자기 값)
      const m = html.slice(idx, idx + 300).match(/<em>([^<]+)<\/em>/)
      if (!m) return null
      const val = m[1].trim()
      if (!val || val === '-') return null
      return parseN(val)
    }

    return { per: extractVal('PER'), pbr: extractVal('PBR') }
  } catch { return { per: null, pbr: null } }
}

async function scrapeNaverROE(code: string): Promise<number | null> {
  try {
    const res = await axios.get(
      `https://finance.naver.com/item/coinfo.naver?code=${code}&target=finsum_Y`,
      { headers: { ...HTML_HEADERS, Referer: `https://finance.naver.com/item/main.naver?code=${code}` }, timeout: 10000, responseType: 'text' }
    )
    const html = res.data as string
    const idx = html.indexOf('>ROE')
    if (idx === -1) return null
    const after = html.slice(idx, idx + 600)
    // em 태그 → td 직접 숫자 → span 포함 td 순으로 시도
    const patterns = [
      /<em>(-?[\d,]+\.?\d+)<\/em>/,
      /<td[^>]*>\s*(-?[\d,]+\.?\d+)\s*<\/td>/,
      /<td[^>]*>(-?[\d,]+\.?\d+)<span/,
    ]
    for (const p of patterns) {
      const m = after.match(p)
      if (m) {
        const n = parseN(m[1])
        if (n !== null && Math.abs(n) < 300) return n
      }
    }
    return null
  } catch { return null }
}

export async function getKoreanStockFundamentals(ticker: string): Promise<StockFundamentals> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker

  const [ks, kq, investData, roe] = await Promise.all([
    fetchYahooQuote(`${code}.KS`),
    fetchYahooQuote(`${code}.KQ`),
    scrapeNaverInvest(code),
    scrapeNaverROE(code),
  ])

  // exchangeName으로 정확한 시장 판별: "KSC"=KOSPI, "KOE"/"KOQ"=KOSDAQ
  // Yahoo가 KOSDAQ 종목에도 .KS 심볼 데이터를 반환하는 경우를 차단
  function quoteMarket(q: StockQuote | null): 'KOSPI' | 'KOSDAQ' | null {
    if (!q || (q.price <= 0 && q.previousClose <= 0)) return null
    const ex = (q.exchangeName ?? '').toUpperCase()
    if (ex === 'KSC') return 'KOSPI'
    if (ex === 'KOE' || ex === 'KOQ') return 'KOSDAQ'
    return null
  }
  const market: 'KOSPI' | 'KOSDAQ' | null =
    quoteMarket(ks) ?? quoteMarket(kq) ??
    (ks && (ks.price > 0 || ks.previousClose > 0) ? 'KOSPI' :
     kq && (kq.price > 0 || kq.previousClose > 0) ? 'KOSDAQ' : null)

  return { per: investData.per, pbr: investData.pbr, roe, market }
}

export async function getFundamentalsMap(
  tickers: string[]
): Promise<Record<string, StockFundamentals>> {
  const results = await Promise.all(tickers.map(t => getKoreanStockFundamentals(t)))
  const map: Record<string, StockFundamentals> = {}
  tickers.forEach((t, i) => { map[t] = results[i] })
  return map
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
