import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { getSupabaseAdmin } from '@/lib/supabase'
import { MAJOR_STOCKS } from '@/lib/major-stocks'

export const maxDuration = 300 // 5분 타임아웃

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

type DailyPrice = {
  date: string
  open: number
  close: number
  changePercent: number
  volume: number
}

// Yahoo Finance에서 종목 전체 히스토리 조회
async function fetchStockHistory(ticker: string): Promise<DailyPrice[]> {
  const symbol = `${ticker}.KS`
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=15y&interval=1d`
    const res = await axios.get(url, { headers: YF_HEADERS, timeout: 15000 })
    const result = res.data?.chart?.result?.[0]
    if (!result) return []

    const timestamps: number[] = result.timestamp || []
    const opens: number[] = result.indicators?.quote?.[0]?.open || []
    const closes: number[] = result.indicators?.quote?.[0]?.close || []
    const volumes: number[] = result.indicators?.quote?.[0]?.volume || []

    return timestamps
      .map((ts, i) => {
        const open = opens[i]
        const close = closes[i]
        if (!open || !close || open <= 0) return null
        return {
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          open,
          close,
          changePercent: ((close - open) / open) * 100,
          volume: volumes[i] || 0,
        }
      })
      .filter(Boolean) as DailyPrice[]
  } catch {
    return []
  }
}

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { data } = await supabaseAdmin
      .from('historical_patterns')
      .select('trade_date')
      .order('trade_date', { ascending: true })
      .limit(1)

    const { data: latest } = await supabaseAdmin
      .from('historical_patterns')
      .select('trade_date')
      .order('trade_date', { ascending: false })
      .limit(1)

    const minYear = data?.[0]?.trade_date ? new Date(data[0].trade_date).getFullYear() : null
    const maxYear = latest?.[0]?.trade_date ? new Date(latest[0].trade_date).getFullYear() : null

    return NextResponse.json({ minYear, maxYear })
  } catch {
    return NextResponse.json({ minYear: null, maxYear: null })
  }
}

export async function POST(req: NextRequest) {
  const { startYear = 2015 } = await req.json().catch(() => ({}))
  const supabaseAdmin = getSupabaseAdmin()

  try {
    // 1. 주요 사건 데이터 먼저 저장
    await saveMarketEvents(supabaseAdmin)

    // 2. 전체 종목 히스토리 수집
    const startDate = `${startYear}-01-01`
    const allData: Record<string, Record<string, { changePercent: number; volume: number; name: string; sector: string }>> = {}

    let processed = 0
    for (const stock of MAJOR_STOCKS) {
      const history = await fetchStockHistory(stock.ticker)
      for (const day of history) {
        if (day.date < startDate) continue
        if (!allData[day.date]) allData[day.date] = {}
        allData[day.date][stock.ticker] = {
          changePercent: day.changePercent,
          volume: day.volume,
          name: stock.name,
          sector: stock.sector,
        }
      }
      processed++
      // 과부하 방지
      await new Promise(r => setTimeout(r, 200))
    }

    // 3. 날짜별 상위 5종목 계산 후 Supabase 저장
    const dates = Object.keys(allData).sort()
    let saved = 0

    for (const date of dates) {
      const dayData = allData[date]
      const sorted = Object.entries(dayData)
        .sort((a, b) => b[1].changePercent - a[1].changePercent)
        .slice(0, 5)
        .map(([ticker, info]) => ({
          ticker,
          name: info.name,
          sector: info.sector,
          change_pct: parseFloat(info.changePercent.toFixed(2)),
          volume: info.volume,
        }))

      if (sorted.length < 3) continue

      const { error } = await supabaseAdmin
        .from('historical_patterns')
        .upsert({ trade_date: date, top_gainers: sorted }, { onConflict: 'trade_date' })

      if (!error) saved++
    }

    return NextResponse.json({
      success: true,
      message: `${processed}개 종목, ${saved}일 데이터 저장 완료`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveMarketEvents(supabaseAdmin: any) {
  const events = [
    { event_date: '2020-03-19', event_type: 'geopolitical', description: '코로나19 팬데믹 글로벌 확산, KOSPI 역대 최대 낙폭 후 반등', affected_sectors: ['전체'], affected_tickers: [], impact_direction: 'negative', impact_magnitude: -8.39, source: 'manual' },
    { event_date: '2021-01-11', event_type: 'sector', description: '2차전지 테마 급등 LG에너지솔루션 IPO 기대감', affected_sectors: ['2차전지', '전기차'], affected_tickers: ['373220', '051910', '006400'], impact_direction: 'positive', impact_magnitude: 12.5, source: 'manual' },
    { event_date: '2022-06-16', event_type: 'rate_change', description: '미 연준 자이언트스텝 0.75%p 금리인상 성장주 급락', affected_sectors: ['바이오', 'IT', '2차전지'], affected_tickers: [], impact_direction: 'negative', impact_magnitude: -3.5, source: 'manual' },
    { event_date: '2023-06-19', event_type: 'sector', description: 'AI 반도체 수요 급증 엔비디아 호실적 삼성·하이닉스 급등', affected_sectors: ['반도체', 'AI'], affected_tickers: ['005930', '000660'], impact_direction: 'positive', impact_magnitude: 6.8, source: 'manual' },
    { event_date: '2024-02-05', event_type: 'sector', description: 'HBM 수요 급증 기대 SK하이닉스 신고가 경신', affected_sectors: ['반도체', 'HBM'], affected_tickers: ['000660', '005930'], impact_direction: 'positive', impact_magnitude: 8.2, source: 'manual' },
    { event_date: '2022-02-24', event_type: 'geopolitical', description: '러시아 우크라이나 침공 방산 에너지 급등', affected_sectors: ['방산', '에너지'], affected_tickers: ['047810', '012450'], impact_direction: 'positive', impact_magnitude: 9.1, source: 'manual' },
    { event_date: '2023-10-08', event_type: 'geopolitical', description: '이스라엘 하마스 전쟁 발발 방산주 급등', affected_sectors: ['방산'], affected_tickers: ['047810', '012450', '064350'], impact_direction: 'positive', impact_magnitude: 9.1, source: 'manual' },
    { event_date: '2024-01-02', event_type: 'sector', description: '밸류업 프로그램 발표 저PBR 금융주 급등', affected_sectors: ['금융', '은행', '보험'], affected_tickers: ['105560', '055550', '032830'], impact_direction: 'positive', impact_magnitude: 7.4, source: 'manual' },
    { event_date: '2023-11-02', event_type: 'rate_change', description: '미 연준 금리 동결 성장주 반등', affected_sectors: ['전체'], affected_tickers: [], impact_direction: 'positive', impact_magnitude: 2.1, source: 'manual' },
    { event_date: '2024-07-11', event_type: 'geopolitical', description: '트럼프 피격 사건 방산 테마 급등', affected_sectors: ['방산'], affected_tickers: ['047810', '012450', '064350'], impact_direction: 'positive', impact_magnitude: 11.3, source: 'manual' },
    { event_date: '2025-01-20', event_type: 'geopolitical', description: '트럼프 취임 관세 우려 수출주 약세 방산 강세', affected_sectors: ['방산', '반도체'], affected_tickers: ['047810', '012450'], impact_direction: 'mixed', impact_magnitude: 4.2, source: 'manual' },
    { event_date: '2024-12-03', event_type: 'geopolitical', description: '윤석열 비상계엄 선포 시장 충격 익일 급반등', affected_sectors: ['전체'], affected_tickers: [], impact_direction: 'negative', impact_magnitude: -4.9, source: 'manual' },
  ]

  for (const event of events) {
    try {
      await supabaseAdmin
        .from('market_events')
        .upsert(event, { onConflict: 'event_date,description' })
    } catch {
      // 개별 이벤트 저장 실패 무시
    }
  }
}
