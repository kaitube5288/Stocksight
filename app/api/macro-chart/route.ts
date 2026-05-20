import { NextResponse } from 'next/server'
import axios from 'axios'

export const dynamic = 'force-dynamic'

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

interface DayPoint { date: string; value: number }

async function fetchHistory(symbol: string): Promise<DayPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=90d&interval=1d`
  try {
    const res = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 })
    const result = res.data?.chart?.result?.[0]
    if (!result) return []
    const timestamps: number[] = result.timestamp ?? []
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    const points: DayPoint[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const v = closes[i]
      if (v == null || isNaN(v)) continue
      const d = new Date(timestamps[i] * 1000)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      points.push({ date, value: v })
    }
    return points
  } catch {
    return []
  }
}

export async function GET() {
  const [usdkrw, gold, bond, fedRate] = await Promise.all([
    fetchHistory('KRW=X'),
    fetchHistory('GC=F'),
    fetchHistory('^TNX'),   // 미국 10년물 국채 금리 (%)
    fetchHistory('^IRX'),   // 미국 3개월 단기채 금리 — 연준 기준금리 추종
  ])
  return NextResponse.json({ usdkrw, gold, bond, fedRate })
}
