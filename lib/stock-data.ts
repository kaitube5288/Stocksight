import axios from 'axios'
import { supabaseAdmin } from './supabase'
import { MAJOR_STOCKS } from './major-stocks'
import { fetchROEFromDART } from './dart'

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

// KOSPI/KOSDAQ 지수 — 네이버 금융 실시간 API
async function fetchNaverIndex(code: 'KOSPI' | 'KOSDAQ'): Promise<StockQuote | null> {
  try {
    const res = await axios.get(
      `https://m.stock.naver.com/api/index/${code}/basic`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, timeout: 6000 }
    )
    const d = res.data
    const price         = parseFloat(String(d.closePrice ?? '').replace(/,/g, ''))
    const change        = parseFloat(String(d.compareToPreviousClosePrice ?? '').replace(/,/g, ''))
    const changePct     = parseFloat(String(d.fluctuationsRatio ?? '').replace(/,/g, ''))
    if (!price) return null
    return {
      ticker: code, name: code,
      price, change, changePercent: changePct,
      volume: 0, previousClose: price - change,
    }
  } catch { return null }
}

export async function getMarketIndex(): Promise<{
  kospi: StockQuote | null
  kosdaq: StockQuote | null
}> {
  const [kospi, kosdaq] = await Promise.all([
    fetchNaverIndex('KOSPI'),
    fetchNaverIndex('KOSDAQ'),
  ])
  return { kospi, kosdaq }
}

// ─── 불장 강도 분석 ───────────────────────────────────────────────────────────

export type BullCategory = {
  indexMomentum: boolean  // 거시/수급 — KOSPI or KOSDAQ >= +1%
  volatility: boolean     // 변동성/공포 — VIX < 20
  trend: boolean          // 연속성/추세 — KOSPI > 20일 이동평균
  breadth: boolean        // 섹터 확산  — KOSPI & KOSDAQ 동반 플러스
  global: boolean         // 글로벌 연동 — NASDAQ 전일 +1% 이상 or 원화 강세
}

export type BullStrength = {
  score: number
  grade: 'S' | 'A' | 'B' | null
  categories: BullCategory
  vixPrice: number | null
}

async function fetchSimpleQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
  try {
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: YF_HEADERS, timeout: 8000 }
    )
    const meta = res.data?.chart?.result?.[0]?.meta
    if (!meta) return null
    return { price: meta.regularMarketPrice ?? 0, changePercent: meta.regularMarketChangePercent ?? 0 }
  } catch { return null }
}

async function fetchKospiMA20(): Promise<{ price: number; ma20: number } | null> {
  try {
    const res = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?interval=1d&range=60d',
      { headers: YF_HEADERS, timeout: 10000 }
    )
    const result = res.data?.chart?.result?.[0]
    if (!result) return null
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    const valid = closes.filter((c): c is number => c != null && !isNaN(c))
    if (valid.length < 20) return null
    const ma20 = valid.slice(-20).reduce((a, b) => a + b, 0) / 20
    return { price: valid[valid.length - 1], ma20 }
  } catch { return null }
}

export async function getBullStrength(
  kospi: StockQuote | null,
  kosdaq: StockQuote | null,
): Promise<BullStrength> {
  const [vix, nasdaq, kospiTrend, usdkrwQuote] = await Promise.all([
    fetchSimpleQuote('^VIX').catch(() => null),
    fetchSimpleQuote('^IXIC').catch(() => null),
    fetchKospiMA20().catch(() => null),
    fetchSimpleQuote('KRW=X').catch(() => null),  // USD/KRW: changePercent < 0 = 원화 강세
  ])

  const kospiPct  = kospi?.changePercent ?? 0
  const kosdaqPct = kosdaq?.changePercent ?? 0

  const categories: BullCategory = {
    indexMomentum: kospiPct >= 1 || kosdaqPct >= 1,
    volatility:    vix != null ? vix.price < 20 : false,
    trend:         kospiTrend != null ? kospiTrend.price > kospiTrend.ma20 : false,
    breadth:       kospiPct > 0 && kosdaqPct > 0,
    global:        (nasdaq != null && nasdaq.changePercent >= 1) ||
                   (usdkrwQuote != null && usdkrwQuote.changePercent < -0.3),
  }

  const score = Object.values(categories).filter(Boolean).length
  const grade: BullStrength['grade'] = score === 5 ? 'S' : score === 4 ? 'A' : score >= 3 ? 'B' : null

  return { score, grade, categories, vixPrice: vix?.price ?? null }
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

// 금(Gold) 가격 (USD/oz) - 국제 가격
export async function getGoldPrice(): Promise<number | null> {
  try {
    // GC=F는 Comex 금 선물가
    const res = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d',
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

// 네이버 금융 메인 페이지에서 PER/PBR/ROE + 증권사 목표주가 + 외국인/기관 순매수 파싱
// invest 서브페이지는 JavaScript로 값을 채우므로 axios로는 N/A만 읽힘
async function scrapeNaverMain(code: string): Promise<{
  per: number|null; pbr: number|null; roe: number|null;
  analystTarget: number|null;
  foreignNet: number|null;
  institutionNet: number|null;
}> {
  const empty = { per: null, pbr: null, roe: null, analystTarget: null, foreignNet: null, institutionNet: null }
  try {
    const res = await axios.get(
      `https://finance.naver.com/item/main.naver?code=${code}`,
      { headers: { ...HTML_HEADERS, Referer: 'https://finance.naver.com/' }, timeout: 12000, responseType: 'text' }
    )
    const html: string = res.data
    const mPer = html.match(/id="_per"[^>]*>([\d,.]+)</)
    const mPbr = html.match(/id="_pbr"[^>]*>([\d,.]+)</)

    // 증권사 컨센서스 목표주가: "목표주가</th>" 이후 첫 번째 4자리 이상 em 태그
    const mTarget = html.match(/목표주가<\/th>[\s\S]{0,300}?<em>([\d,]{4,})<\/em>/)
    const analystTarget = mTarget ? parseN(mTarget[1]) : null

    // 외국인/기관 순매수: th_fo 테이블에서 최신 영업일 행 파싱
    let foreignNet: number | null = null
    let institutionNet: number | null = null
    const foStart = html.indexOf('class="h_th th_fo"')
    if (foStart > 0) {
      const foEnd = html.indexOf('</table>', foStart)
      const tableHtml = html.slice(foStart, foEnd)
      const rowMatch = tableHtml.match(/<th scope="row">\d{2}\/\d{2}<\/th>([\s\S]*?)(?=<tr>|\s*<\/tbody>)/)
      if (rowMatch) {
        const row = rowMatch[1]
        const tds = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)]
        if (tds.length >= 4) {
          const fMatch = tds[2][1].match(/([+\-]?[\d,]+)\s*\n?\s*<\/em>/)
          const iMatch = tds[3][1].match(/([+\-]?[\d,]+)\s*\n?\s*<\/em>/)
          foreignNet = fMatch ? parseN(fMatch[1]) : null
          institutionNet = iMatch ? parseN(iMatch[1]) : null
        }
      }
    }

    // ROE(지배주주): th_cop_anal13 행의 첫 번째 td 숫자값
    let roe: number | null = null
    const mRoe = html.match(/ROE[\s\S]{0,400}?<td[^>]*>\s*([-\d.]+)\s*<\/td>/)
    if (mRoe) {
      const n = parseN(mRoe[1])
      roe = n !== null && Math.abs(n) < 300 ? n : null
    }

    return {
      per: mPer ? parseN(mPer[1]) : null,
      pbr: mPbr ? parseN(mPbr[1]) : null,
      roe,
      analystTarget,
      foreignNet,
      institutionNet,
    }
  } catch { return empty }
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

  // Naver basic API + main.naver 스크래핑 병렬 조회
  // (finance/ratios, investment, highlight API는 네이버가 폐기하여 404)
  const [naverData, naverScrape] = await Promise.all([
    fetchNaverData(code),
    scrapeNaverMain(code),
  ])

  // ROE 우선순위: Naver basic API → main.naver 스크래핑 → DART 재무제표
  const naverRoe = naverData.roe ?? naverScrape.roe
  const roe = naverRoe ?? await fetchROEFromDART(code).catch(() => null)

  // PER/PBR: basic API 우선, 없으면 main.naver 스크래핑 값 사용
  const per = naverData.per ?? naverScrape.per
  const pbr = naverData.pbr ?? naverScrape.pbr

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
// 기술적 분석 (RSI / MACD / 볼린저밴드 / 거래량 / 지지저항 / 캔들패턴)
// ─────────────────────────────────────────────

export type TechnicalIndicators = {
  rsi14: number | null
  macdSignal: 'buy' | 'sell' | 'neutral' | null
  trend: 'up' | 'down' | 'sideways' | null
  volumeSurge: number | null                        // 20일 평균 대비 배율 (1.5=150%)
  bollingerSignal: 'buy' | 'sell' | 'neutral' | null // 하단 근접=buy, 상단 근접=sell
  bollingerWidth: number | null                     // 밴드폭 % (변동성 지표)
  supportLevel: number | null                       // 60일 저점(지지선)
  resistanceLevel: number | null                    // 60일 고점(저항선)
  isNearHighBreakout: boolean                       // 현재가 >= 60일 고점의 98% → 신고가 돌파 신호
  candlePattern: 'hammer' | 'shooting_star' | 'doji' | 'bullish_engulfing' | 'bearish_engulfing' | null
  foreignNet: number | null                         // 최신 영업일 외국인 순매수 (주)
  institutionNet: number | null                     // 최신 영업일 기관 순매수 (주)
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

function calcBollingerBands(closes: number[], period = 20, mult = 2) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  const mid = slice.reduce((a, b) => a + b, 0) / period
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period)
  const upper = mid + mult * std
  const lower = mid - mult * std
  return { upper, middle: mid, lower, width: Math.round(((upper - lower) / mid) * 1000) / 10 }
}

function calcVolumeSurge(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null
  const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period
  if (avg === 0) return null
  return Math.round((volumes[volumes.length - 1] / avg) * 100) / 100
}

function calcSupportResistance(highs: number[], lows: number[], period = 60) {
  if (lows.length < period || highs.length < period) return null
  return {
    support:    Math.round(Math.min(...lows.slice(-period))),
    resistance: Math.round(Math.max(...highs.slice(-period))),
  }
}

function detectCandlePattern(
  opens: number[], highs: number[], lows: number[], closes: number[]
): TechnicalIndicators['candlePattern'] {
  const n = closes.length - 1
  if (n < 1) return null
  const o = opens[n], h = highs[n], l = lows[n], c = closes[n]
  const body = Math.abs(c - o)
  const range = h - l
  if (range === 0) return null
  const lowerWick = Math.min(o, c) - l
  const upperWick = h - Math.max(o, c)
  if (body / range < 0.05) return 'doji'
  if (lowerWick >= body * 2 && upperWick <= body * 0.5) return 'hammer'
  if (upperWick >= body * 2 && lowerWick <= body * 0.5) return 'shooting_star'
  const po = opens[n - 1], pc = closes[n - 1]
  if (c > o && pc < po && o < pc && c > po) return 'bullish_engulfing'
  if (c < o && pc > po && o > pc && c < po) return 'bearish_engulfing'
  return null
}

interface OHLCV { opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[] }

async function fetchOHLCV(ticker: string): Promise<OHLCV> {
  const empty: OHLCV = { opens: [], highs: [], lows: [], closes: [], volumes: [] }
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  for (const suffix of ['.KS', '.KQ']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=180d&interval=1d`
      const res = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 })
      const q = res.data?.chart?.result?.[0]?.indicators?.quote?.[0]
      if (!q) continue
      const rawClose: (number | null)[] = q.close ?? []
      const valid = rawClose.map((_, i) => i).filter(i => rawClose[i] != null && !isNaN(rawClose[i]!))
      if (valid.length < 30) continue
      const pick = (arr: (number | null)[]): number[] => valid.map(i => arr[i] ?? 0)
      return {
        closes:  pick(rawClose),
        opens:   pick(q.open   ?? []),
        highs:   pick(q.high   ?? []),
        lows:    pick(q.low    ?? []),
        volumes: pick(q.volume ?? []),
      }
    } catch { /* 다음 시도 */ }
  }
  return empty
}

export async function fetchTechnicalIndicators(ticker: string): Promise<TechnicalIndicators> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  const empty: TechnicalIndicators = {
    rsi14: null, macdSignal: null, trend: null,
    volumeSurge: null, bollingerSignal: null, bollingerWidth: null,
    supportLevel: null, resistanceLevel: null, isNearHighBreakout: false, candlePattern: null,
    foreignNet: null, institutionNet: null,
  }
  try {
    const [{ opens, highs, lows, closes, volumes }, naverScrape] = await Promise.all([
      fetchOHLCV(ticker),
      scrapeNaverMain(code),
    ])
    if (closes.length < 30) return empty

    // RSI
    const rsi14 = calcRSI(closes)

    // 이동평균 추세
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
        const m0 = valid[n], m1 = valid[n - 1], s0 = sig[n], s1 = sig[n - 1]
        if (!isNaN(s0) && !isNaN(s1)) {
          if (m1 <= s1 && m0 > s0) macdSignal = 'buy'
          else if (m1 >= s1 && m0 < s0) macdSignal = 'sell'
          else macdSignal = 'neutral'
        }
      }
    }

    // 볼린저밴드
    const bb = calcBollingerBands(closes)
    let bollingerSignal: TechnicalIndicators['bollingerSignal'] = null
    const bollingerWidth = bb?.width ?? null
    if (bb) {
      const pct = (last - bb.lower) / (bb.upper - bb.lower)
      bollingerSignal = pct <= 0.2 ? 'buy' : pct >= 0.8 ? 'sell' : 'neutral'
    }

    // 거래량 급증
    const volumeSurge = volumes.length > 0 ? calcVolumeSurge(volumes) : null

    // 지지/저항선
    const sr = calcSupportResistance(highs, lows)

    // 캔들 패턴
    const candlePattern = opens.length >= 2
      ? detectCandlePattern(opens, highs, lows, closes)
      : null

    const isNearHighBreakout = sr != null && last > 0 && last >= sr.resistance * 0.98

    return {
      rsi14, macdSignal, trend,
      volumeSurge, bollingerSignal, bollingerWidth,
      supportLevel: sr?.support ?? null,
      resistanceLevel: sr?.resistance ?? null,
      isNearHighBreakout,
      candlePattern,
      foreignNet: naverScrape.foreignNet,
      institutionNet: naverScrape.institutionNet,
    }
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

// ─────────────────────────────────────────────
// 상세 기술적 지표 (AI추천용 — 52주 범위 + MA5/20/60 + 수급 신호)
// ─────────────────────────────────────────────
export type DetailedTechnicals = TechnicalIndicators & {
  ma5: number | null
  ma20: number | null
  ma60: number | null
  high52w: number | null
  low52w: number | null
  ma5Signal: string     // ex) "근접 — 눌림목 구간"
  maAlignmentSignal: string  // ex) "정배열 유지 중"
  bollingerStatusText: string
  range52wSignal: string  // ex) "신고가 부근" / "중간 구간" / "저점 근접"
  priceSignal: string     // ex) "급등 후 조정" / "안정적 상승" / "횡보 중"
  analystTarget: number | null  // 증권사 컨센서스 목표주가
}

async function fetchOHLCV1Y(ticker: string): Promise<OHLCV & { highs1y: number[]; lows1y: number[] }> {
  const empty = { opens: [], highs: [], lows: [], closes: [], volumes: [], highs1y: [], lows1y: [] }
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  for (const suffix of ['.KS', '.KQ']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=1y&interval=1d`
      const res = await axios.get(url, { headers: YF_HEADERS, timeout: 12000 })
      const q = res.data?.chart?.result?.[0]?.indicators?.quote?.[0]
      if (!q) continue
      const rawClose: (number | null)[] = q.close ?? []
      const valid = rawClose.map((_, i) => i).filter(i => rawClose[i] != null && !isNaN(rawClose[i]!))
      if (valid.length < 30) continue
      const pick = (arr: (number | null)[]): number[] => valid.map(i => arr[i] ?? 0)
      return {
        closes:  pick(rawClose),
        opens:   pick(q.open   ?? []),
        highs:   pick(q.high   ?? []),
        lows:    pick(q.low    ?? []),
        volumes: pick(q.volume ?? []),
        highs1y: pick(q.high   ?? []),
        lows1y:  pick(q.low    ?? []),
      }
    } catch { /* 다음 시도 */ }
  }
  return empty
}

export async function fetchDetailedTechnicals(ticker: string): Promise<DetailedTechnicals> {
  const code = ticker.includes('.') ? ticker.split('.')[0] : ticker
  const base: DetailedTechnicals = {
    rsi14: null, macdSignal: null, trend: null,
    volumeSurge: null, bollingerSignal: null, bollingerWidth: null,
    supportLevel: null, resistanceLevel: null, isNearHighBreakout: false, candlePattern: null,
    foreignNet: null, institutionNet: null,
    ma5: null, ma20: null, ma60: null, high52w: null, low52w: null,
    ma5Signal: '데이터 없음', maAlignmentSignal: '데이터 없음',
    bollingerStatusText: '데이터 없음', range52wSignal: '데이터 없음', priceSignal: '데이터 없음',
    analystTarget: null,
  }
  try {
    const [ohlcv1y, naverScrape] = await Promise.all([
      fetchOHLCV1Y(ticker),
      scrapeNaverMain(code),
    ])
    const { opens, highs, lows, closes, volumes, highs1y, lows1y } = ohlcv1y
    if (closes.length < 30) return base

    const last = closes[closes.length - 1]
    const prev = closes[closes.length - 2]

    // RSI
    const rsi14 = calcRSI(closes)

    // MA
    const ma5  = calcSMA(closes, 5)
    const ma20 = calcSMA(closes, 20)
    const ma60 = closes.length >= 60 ? calcSMA(closes, 60) : null

    // 52주 범위
    const high52w = highs1y.length ? Math.round(Math.max(...highs1y)) : null
    const low52w  = lows1y.length  ? Math.round(Math.min(...lows1y))  : null

    // 추세
    let trend: TechnicalIndicators['trend'] = null
    if (ma20) {
      if (last > ma20 && (ma60 == null || ma20 > ma60)) trend = 'up'
      else if (last < ma20 && (ma60 == null || ma20 < ma60)) trend = 'down'
      else trend = 'sideways'
    }

    // MACD
    let macdSignal: TechnicalIndicators['macdSignal'] = null
    if (closes.length >= 35) {
      const e12 = calcEMA(closes, 12)
      const e26 = calcEMA(closes, 26)
      const macd = e12.map((v, i) => !isNaN(v) && !isNaN(e26[i]) ? v - e26[i] : NaN)
      const valid = macd.filter(v => !isNaN(v))
      if (valid.length >= 10) {
        const sig = calcEMA(valid, 9)
        const n = valid.length - 1
        const m0 = valid[n], m1 = valid[n - 1], s0 = sig[n], s1 = sig[n - 1]
        if (!isNaN(s0) && !isNaN(s1)) {
          if (m1 <= s1 && m0 > s0) macdSignal = 'buy'
          else if (m1 >= s1 && m0 < s0) macdSignal = 'sell'
          else macdSignal = 'neutral'
        }
      }
    }

    // 볼린저밴드
    const bb = calcBollingerBands(closes)
    let bollingerSignal: TechnicalIndicators['bollingerSignal'] = null
    const bollingerWidth = bb?.width ?? null
    if (bb) {
      const pct = (last - bb.lower) / (bb.upper - bb.lower)
      bollingerSignal = pct <= 0.2 ? 'buy' : pct >= 0.8 ? 'sell' : 'neutral'
    }

    // 볼린저 상태 텍스트
    let bollingerStatusText = '중립 구간'
    if (bb) {
      if (last > bb.upper) bollingerStatusText = '상단 이탈 — 과열 주의'
      else if (last > bb.upper * 0.98) bollingerStatusText = '상단 근접 — 과매수 경계'
      else if (last < bb.lower) bollingerStatusText = '하단 이탈 — 반등 가능'
      else if (last < bb.lower * 1.02) bollingerStatusText = '하단 근접 — 매수 구간'
      else if (Math.abs(last - bb.middle) / bb.middle < 0.01) bollingerStatusText = '중심선 수렴 중'
      else if (last > bb.middle) bollingerStatusText = '중심선~상단 구간'
      else bollingerStatusText = '중심선~하단 구간'
    }

    // 거래량 급증
    const volumeSurge = calcVolumeSurge(volumes)

    // 지지/저항
    const sr = calcSupportResistance(highs, lows)

    // 캔들 패턴
    const candlePattern = opens.length >= 2
      ? detectCandlePattern(opens, highs, lows, closes)
      : null

    // MA5 vs 현재가 신호
    let ma5Signal = '데이터 없음'
    if (ma5) {
      const diff = (last - ma5) / ma5 * 100
      if (Math.abs(diff) < 1) ma5Signal = '근접 — 눌림목 구간'
      else if (diff > 5) ma5Signal = '상회 — 단기 과열'
      else if (diff > 1) ma5Signal = '상회 — 상승 모멘텀'
      else if (diff < -5) ma5Signal = '하회 — 단기 약세'
      else ma5Signal = '하회 — 지지선 탐색'
    }

    // MA 정배열 신호
    let maAlignmentSignal = '데이터 없음'
    if (ma5 && ma20) {
      if (ma5 > ma20 && (ma60 == null || ma20 > ma60)) {
        maAlignmentSignal = '정배열 유지 중'
      } else if (ma5 < ma20 && (ma60 == null || ma20 < ma60)) {
        maAlignmentSignal = '역배열 — 하락 압력'
      } else if (ma5 > ma20) {
        maAlignmentSignal = '단기 반등 중'
      } else {
        maAlignmentSignal = '혼조 구간'
      }
    }

    // 52주 범위 신호
    let range52wSignal = '데이터 없음'
    if (high52w && low52w && last) {
      const pos = (last - low52w) / (high52w - low52w)
      if (pos >= 0.9) range52wSignal = '신고가 부근'
      else if (pos >= 0.7) range52wSignal = '상단 구간'
      else if (pos >= 0.4) range52wSignal = '중간 구간'
      else if (pos >= 0.2) range52wSignal = '하단 구간'
      else range52wSignal = '저점 근접'
    }

    // 현재가 신호 (최근 변동 패턴)
    let priceSignal = '데이터 없음'
    if (closes.length >= 5) {
      const recent5Avg = closes.slice(-5).reduce((a, b) => a + b, 0) / 5
      const chgDay = prev > 0 ? (last - prev) / prev * 100 : 0
      const chgVsAvg = (last - recent5Avg) / recent5Avg * 100
      if (chgDay > 5) priceSignal = '급등 후 조정'
      else if (chgDay > 2) priceSignal = '강세 상승'
      else if (chgDay < -3) priceSignal = '단기 조정 중'
      else if (chgVsAvg > 3) priceSignal = '5일 평균 상회'
      else if (Math.abs(chgDay) < 0.5) priceSignal = '보합 — 눌림목 가능'
      else priceSignal = '안정적 흐름'
    }

    const isNearHighBreakout = sr != null && last > 0 && last >= sr.resistance * 0.98

    return {
      rsi14, macdSignal, trend,
      volumeSurge, bollingerSignal, bollingerWidth,
      supportLevel: sr?.support ?? null,
      resistanceLevel: sr?.resistance ?? null,
      isNearHighBreakout,
      candlePattern,
      foreignNet: naverScrape.foreignNet,
      institutionNet: naverScrape.institutionNet,
      ma5: ma5 ? Math.round(ma5) : null,
      ma20: ma20 ? Math.round(ma20) : null,
      ma60: ma60 ? Math.round(ma60) : null,
      high52w, low52w,
      ma5Signal, maAlignmentSignal, bollingerStatusText, range52wSignal, priceSignal,
      analystTarget: naverScrape.analystTarget,
    }
  } catch { return base }
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

// 네이버 금융 거래량 상위 페이지 스크래핑 — KOSPI(sosok=0) + KOSDAQ(sosok=1)
export async function fetchVolumeTopStocks(limitPerMarket = 15): Promise<{ ticker: string; name: string }[]> {
  const results: { ticker: string; name: string }[] = []

  for (const sosok of ['0', '1']) {
    try {
      const res = await axios.get(
        `https://finance.naver.com/sise/sise_quant.nhn?sosok=${sosok}`,
        {
          headers: { ...HTML_HEADERS, 'Accept-Charset': 'euc-kr' },
          responseType: 'arraybuffer',
          timeout: 8000,
        }
      )
      const html = new TextDecoder('euc-kr').decode(res.data as ArrayBuffer)
      const seen = new Set<string>()
      const codeMatches = html.matchAll(/\/item\/main\.nhn\?code=(\d{6})[^"]*"[^>]*>([^<]+)</g)
      for (const m of codeMatches) {
        const ticker = m[1]
        const name = m[2].trim()
        if (!ticker || !name || seen.has(ticker)) continue
        seen.add(ticker)
        results.push({ ticker, name })
        if (seen.size >= limitPerMarket) break
      }
    } catch {
      // 스크래핑 실패 시 해당 시장 건너뜀
    }
  }

  return results
}
