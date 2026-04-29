import axios from 'axios'
import { supabaseAdmin } from './supabase'
import { MAJOR_STOCKS } from './major-stocks'

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

// 여러 종목 실제 현재가 일괄 조회 (Naver 우선, Yahoo fallback)
export async function getRealPrices(
  tickers: string[]
): Promise<Record<string, { price: number; previousClose: number }>> {
  const results = await Promise.all(tickers.map(async (ticker) => {
    const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
    const naver = await fetchNaverData(code)
    if (naver.price > 0) return { ticker, price: naver.price, previousClose: naver.price }
    const q = await getKoreanStockQuote(ticker)
    if (q && (q.price > 0 || q.previousClose > 0))
      return { ticker, price: q.price || q.previousClose, previousClose: q.previousClose || q.price }
    return null
  }))
  const map: Record<string, { price: number; previousClose: number }> = {}
  results.forEach(r => { if (r) map[r.ticker] = { price: r.price, previousClose: r.previousClose } })
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

const NAVER_API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Referer': 'https://m.stock.naver.com/',
  'Accept': 'application/json, text/plain, */*',
}

interface NaverBasic {
  price: number
  per: number | null
  pbr: number | null
  roe: number | null
  market: 'KOSPI' | 'KOSDAQ' | null
}

export async function fetchNaverData(code: string): Promise<NaverBasic> {
  try {
    const res = await axios.get(
      `https://m.stock.naver.com/api/stock/${code}/basic`,
      { headers: NAVER_API_HEADERS, timeout: 8000 }
    )
    const d = res.data
    const toNum = (v: unknown): number | null => {
      if (v == null || v === '' || v === '-') return null
      const n = parseFloat(String(v).replace(/,/g, ''))
      return isNaN(n) ? null : Math.round(n * 100) / 100
    }
    const price = toNum(d.closePrice) ?? toNum(d.stockPrice) ?? toNum(d.currentPrice) ?? 0
    const nameKor: string = d.stockExchangeType?.nameKor ?? ''
    // ROE: basic API 필드명이 종목마다 다를 수 있어 여러 이름 시도
    const roe = toNum(d.roe) ?? toNum(d.roeRate) ?? toNum(d.returnOnEquity) ?? toNum(d.roe12M)
    return {
      price,
      per: toNum(d.per),
      pbr: toNum(d.pbr),
      roe,
      market: nameKor.includes('코스피') ? 'KOSPI' : nameKor.includes('코스닥') ? 'KOSDAQ' : null,
    }
  } catch {
    return { price: 0, per: null, pbr: null, roe: null, market: null }
  }
}

function parseN(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ''))
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

// 네이버 금융 메인 페이지에서 id="_per", id="_pbr" 로 PER/PBR 추출
// invest 서브페이지는 JavaScript로 값을 채우므로 axios로는 N/A만 읽힘
async function scrapeNaverMain(code: string): Promise<{ per: number|null; pbr: number|null }> {
  try {
    const res = await axios.get(
      `https://finance.naver.com/item/main.naver?code=${code}`,
      { headers: { ...HTML_HEADERS, Referer: 'https://finance.naver.com/' }, timeout: 12000, responseType: 'text' }
    )
    const html: string = res.data
    const mPer = html.match(/id="_per"[^>]*>([\d,.]+)</)
    const mPbr = html.match(/id="_pbr"[^>]*>([\d,.]+)</)
    return {
      per: mPer ? parseN(mPer[1]) : null,
      pbr: mPbr ? parseN(mPbr[1]) : null,
    }
  } catch { return { per: null, pbr: null } }
}

// Naver 추가 API 엔드포인트에서 ROE 시도 (/finance/ratios, /investment 등)
async function fetchNaverROEFromAPI(code: string): Promise<number | null> {
  const toNum = (v: unknown): number | null => {
    if (v == null || v === '' || v === '-') return null
    const n = parseFloat(String(v).replace(/,/g, ''))
    return isNaN(n) ? null : Math.round(n * 100) / 100
  }
  const endpoints = [
    `https://m.stock.naver.com/api/stock/${code}/finance/ratios`,
    `https://m.stock.naver.com/api/stock/${code}/investment`,
    `https://m.stock.naver.com/api/stock/${code}/finance/highlight`,
  ]
  for (const url of endpoints) {
    try {
      const res = await axios.get(url, { headers: NAVER_API_HEADERS, timeout: 6000 })
      const d = res.data
      const roe = toNum(d?.roe) ?? toNum(d?.roeRate) ?? toNum(d?.returnOnEquity)
      if (roe !== null && Math.abs(roe) < 300) return roe
    } catch { /* 엔드포인트 없으면 다음 시도 */ }
  }
  return null
}

// Naver 재무제표 HTML에서 ROE 행 전체를 파싱해 가장 최근 값 추출
async function scrapeNaverROE(code: string): Promise<number | null> {
  try {
    const res = await axios.get(
      `https://finance.naver.com/item/coinfo.naver?code=${code}&target=finsum_Y`,
      { headers: { ...HTML_HEADERS, Referer: `https://finance.naver.com/item/main.naver?code=${code}` }, timeout: 10000, responseType: 'text' }
    )
    const html = res.data as string

    // ROE 라벨 위치 찾기 (ROE, ROE(%), ROE(지배주주) 등 변형 포함)
    const roeIdx = html.search(/ROE/)
    if (roeIdx === -1) return null

    // ROE가 속한 <tr> 전체 추출
    const trStart = html.lastIndexOf('<tr', roeIdx)
    const trEnd = html.indexOf('</tr>', roeIdx)
    const rowHtml = trStart !== -1 && trEnd !== -1
      ? html.slice(trStart, trEnd + 5)
      : html.slice(roeIdx, roeIdx + 1500)

    // <em> 태그 값 우선 (네이버는 최신 연도 값을 em으로 감쌈)
    const emMatches = [...rowHtml.matchAll(/<em>\s*(-?[\d,.]+)\s*<\/em>/g)]
    for (let i = emMatches.length - 1; i >= 0; i--) {
      const n = parseN(emMatches[i][1])
      if (n !== null && n !== 0 && Math.abs(n) < 300) return n
    }

    // em 없으면 num 클래스 td에서 추출
    const tdMatches = [...rowHtml.matchAll(/<td[^>]*class="[^"]*num[^"]*"[^>]*>\s*(-?[\d,.]+)\s*<\/td>/g)]
    for (let i = tdMatches.length - 1; i >= 0; i--) {
      const n = parseN(tdMatches[i][1])
      if (n !== null && n !== 0 && Math.abs(n) < 300) return n
    }

    // 마지막 fallback: 일반 td 숫자
    const plainTd = [...rowHtml.matchAll(/<td[^>]*>\s*(-?[\d,.]+)\s*<\/td>/g)]
    for (let i = plainTd.length - 1; i >= 0; i--) {
      const n = parseN(plainTd[i][1])
      if (n !== null && n !== 0 && Math.abs(n) < 300) return n
    }

    return null
  } catch { return null }
}

export async function getKoreanStockFundamentals(ticker: string): Promise<StockFundamentals> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker

  // Naver mobile API: PER/PBR/ROE/market 한번에 + ROE 전용 추가 소스 병렬 조회
  const [naverData, apiRoe, scrapedRoe] = await Promise.all([
    fetchNaverData(code),
    fetchNaverROEFromAPI(code),
    scrapeNaverROE(code),
  ])

  // ROE 우선순위: basic API → 추가 API 엔드포인트 → HTML 스크래핑
  const roe = naverData.roe ?? apiRoe ?? scrapedRoe

  // 시장 구분: Naver API 실패 시 Yahoo fallback
  let market = naverData.market
  if (!market) {
    const [ks, kq] = await Promise.all([
      fetchYahooQuote(`${code}.KS`),
      fetchYahooQuote(`${code}.KQ`),
    ])
    function quoteMarket(q: StockQuote | null): 'KOSPI' | 'KOSDAQ' | null {
      if (!q || (q.price <= 0 && q.previousClose <= 0)) return null
      const ex = (q.exchangeName ?? '').toUpperCase()
      if (ex === 'KSC') return 'KOSPI'
      if (ex === 'KOE' || ex === 'KOQ') return 'KOSDAQ'
      return null
    }
    market = quoteMarket(ks) ?? quoteMarket(kq) ??
      (ks && (ks.price > 0 || ks.previousClose > 0) ? 'KOSPI' :
       kq && (kq.price > 0 || kq.previousClose > 0) ? 'KOSDAQ' : null)
  }

  // PER/PBR: Naver API 우선, 없으면 HTML 스크래핑 fallback
  let { per, pbr } = naverData
  if (per == null || pbr == null) {
    const scraped = await scrapeNaverMain(code)
    per = per ?? scraped.per
    pbr = pbr ?? scraped.pbr
  }

  return { per, pbr, roe, market }
}

export async function getFundamentalsMap(
  tickers: string[]
): Promise<Record<string, StockFundamentals>> {
  const results = await Promise.all(tickers.map(t => getKoreanStockFundamentals(t)))
  const map: Record<string, StockFundamentals> = {}
  tickers.forEach((t, i) => { map[t] = results[i] })
  return map
}

// 키워드 → 관련 섹터 매핑
const KEYWORD_SECTOR_MAP: Record<string, string[]> = {
  '반도체': ['반도체'],
  'AI': ['반도체', '로봇', 'IT'],
  '2차전지': ['2차전지'],
  '배터리': ['2차전지'],
  '바이오': ['바이오', '제약'],
  '방산': ['방산'],
  '조선': ['조선'],
  '금융': ['금융', '보험'],
  '자동차': ['자동차'],
  '게임': ['게임'],
  '로봇': ['로봇'],
  '인터넷': ['IT'],
  '원자력': ['원자력'],
  '철강': ['철강'],
  '화학': ['화학'],
}

// 과거 유사 패턴 조회: market_events(주요사건) + historical_patterns(종목 상승 이력) 병합
export async function getSimilarHistoricalPatterns(keywords: string[]): Promise<string> {
  const lines: string[] = []

  // 1. market_events: 키워드 연관 주요 경제 사건
  try {
    const { data: events } = await supabaseAdmin
      .from('market_events')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(50)

    if (events?.length) {
      const relevant = events.filter(e =>
        keywords.some(kw =>
          e.description?.includes(kw) ||
          e.affected_sectors?.some((s: string) => s.includes(kw))
        )
      )
      const source = relevant.length ? relevant.slice(0, 5) : events.slice(0, 3)
      lines.push('[주요 경제 사건 참고]')
      source.forEach(e => {
        lines.push(`- ${e.event_date}: ${e.description} (${e.impact_direction}, ${e.impact_magnitude}%)`)
      })
    }
  } catch { /* 실패 시 무시 */ }

  // 2. historical_patterns: 키워드 관련 섹터 종목이 크게 오른 과거 날짜 조회
  try {
    const relevantSectors = new Set<string>()
    keywords.forEach(kw => {
      ;(KEYWORD_SECTOR_MAP[kw] ?? []).forEach(s => relevantSectors.add(s))
    })

    if (relevantSectors.size > 0) {
      const relevantTickers = new Set(
        MAJOR_STOCKS.filter(s => relevantSectors.has(s.sector)).map(s => s.ticker)
      )

      const { data: patterns } = await supabaseAdmin
        .from('historical_patterns')
        .select('trade_date, top_gainers')
        .order('trade_date', { ascending: false })
        .limit(1000)

      if (patterns?.length) {
        type Gainer = { ticker: string; name: string; sector: string; change_pct: number }

        // 관련 섹터 종목이 상위 상승에 포함된 날짜만 필터
        const matchingDays = patterns
          .map(p => {
            const gainers = (p.top_gainers as Gainer[]) ?? []
            const hit = gainers.filter(g => relevantTickers.has(g.ticker))
            if (!hit.length) return null
            const avgChange = hit.reduce((s, g) => s + g.change_pct, 0) / hit.length
            return { date: p.trade_date as string, hit, avgChange }
          })
          .filter(Boolean) as { date: string; hit: Gainer[]; avgChange: number }[]

        // 평균 상승률 기준 상위 5일
        const top5 = matchingDays
          .sort((a, b) => b.avgChange - a.avgChange)
          .slice(0, 5)

        if (top5.length) {
          lines.push('\n[과거 유사 상승일 패턴 — 오늘 뉴스 관련 섹터 기준]')
          top5.forEach(d => {
            const desc = d.hit.map(g => `${g.name} +${g.change_pct.toFixed(1)}%`).join(', ')
            lines.push(`- ${d.date}: ${desc}`)
          })
        }
      }
    }
  } catch { /* 실패 시 무시 */ }

  return lines.join('\n') || '과거 패턴 데이터 없음'
}

// ─────────────────────────────────────────────
// 기술적 분석 (RSI / MACD / 이동평균 추세)
// ─────────────────────────────────────────────

export type TechnicalIndicators = {
  rsi14: number | null
  macdSignal: 'buy' | 'sell' | 'neutral' | null
  trend: 'up' | 'down' | 'sideways' | null
}

function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period
}

function calcEMA(prices: number[], period: number): number[] {
  const result: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period) return result
  const k = 2 / (period + 1)
  result[period - 1] = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  const changes = closes.slice(1).map((c, i) => c - closes[i])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    avgGain += changes[i] > 0 ? changes[i] : 0
    avgLoss += changes[i] < 0 ? -changes[i] : 0
  }
  avgGain /= period; avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + (changes[i] > 0 ? changes[i] : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (changes[i] < 0 ? -changes[i] : 0)) / period
  }
  if (avgLoss === 0) return 100
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10
}

async function fetchCloses(ticker: string): Promise<number[]> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  for (const suffix of ['.KS', '.KQ']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=180d&interval=1d`
      const res = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 })
      const raw: (number | null)[] = res.data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
      const closes = raw.filter((v): v is number => v != null && !isNaN(v))
      if (closes.length > 30) return closes
    } catch { /* 다음 시도 */ }
  }
  return []
}

export async function fetchTechnicalIndicators(ticker: string): Promise<TechnicalIndicators> {
  const empty: TechnicalIndicators = { rsi14: null, macdSignal: null, trend: null }
  try {
    const closes = await fetchCloses(ticker)
    if (closes.length < 30) return empty

    const rsi14 = calcRSI(closes)

    // 이동평균 추세: 종가 vs MA20 vs MA60
    const ma20 = calcSMA(closes, 20)
    const ma60 = closes.length >= 60 ? calcSMA(closes, 60) : null
    const last = closes[closes.length - 1]
    let trend: TechnicalIndicators['trend'] = null
    if (ma20) {
      if (last > ma20 && (ma60 == null || ma20 > ma60)) trend = 'up'
      else if (last < ma20 && (ma60 == null || ma20 < ma60)) trend = 'down'
      else trend = 'sideways'
    }

    // MACD (12/26/9)
    let macdSignal: TechnicalIndicators['macdSignal'] = null
    if (closes.length >= 35) {
      const e12 = calcEMA(closes, 12)
      const e26 = calcEMA(closes, 26)
      const macd = e12.map((v, i) => !isNaN(v) && !isNaN(e26[i]) ? v - e26[i] : NaN)
      const valid = macd.filter(v => !isNaN(v))
      if (valid.length >= 10) {
        const sig = calcEMA(valid, 9)
        const n = valid.length - 1
        const m0 = valid[n], m1 = valid[n - 1]
        const s0 = sig[n], s1 = sig[n - 1]
        if (!isNaN(s0) && !isNaN(s1)) {
          if (m1 <= s1 && m0 > s0) macdSignal = 'buy'
          else if (m1 >= s1 && m0 < s0) macdSignal = 'sell'
          else macdSignal = 'neutral'
        }
      }
    }

    return { rsi14, macdSignal, trend }
  } catch { return empty }
}

// 뉴스 키워드 관련 섹터 종목들의 기술적 지표 요약 (Gemini 프롬프트용)
export async function fetchSectorTechnicals(keywords: string[]): Promise<string> {
  const relevantSectors = new Set<string>()
  keywords.forEach(kw => { ;(KEYWORD_SECTOR_MAP[kw] ?? []).forEach(s => relevantSectors.add(s)) })
  if (relevantSectors.size === 0) return ''

  // 섹터별 대표 2종목
  const candidates = Array.from(relevantSectors).flatMap(sector =>
    MAJOR_STOCKS.filter(s => s.sector === sector).slice(0, 2)
  ).slice(0, 12)

  const results = await Promise.all(
    candidates.map(async s => ({ s, t: await fetchTechnicalIndicators(s.ticker) }))
  )

  const rsiLabel = (r: number) => r >= 70 ? '과매수주의' : r <= 30 ? '과매도반등가능' : '중립'
  const trendLabel = (t: string) => t === 'up' ? '상승추세' : t === 'down' ? '하락추세' : '횡보'
  const macdLabel = (m: string) => m === 'buy' ? '골든크로스' : m === 'sell' ? '데드크로스' : '중립'

  const lines: string[] = ['[뉴스 관련 섹터 기술적 지표]']
  let added = 0
  results.forEach(({ s, t }) => {
    if (t.rsi14 == null) return
    const parts = [`RSI=${t.rsi14}(${rsiLabel(t.rsi14)})`]
    if (t.trend) parts.push(trendLabel(t.trend))
    if (t.macdSignal && t.macdSignal !== 'neutral') parts.push(macdLabel(t.macdSignal))
    lines.push(`- ${s.name}(${s.ticker}): ${parts.join(', ')}`)
    added++
  })

  return added > 0 ? lines.join('\n') : ''
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
