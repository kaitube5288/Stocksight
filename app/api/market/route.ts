import { NextResponse } from 'next/server'
import { getMarketIndex, getUSDKRW, getBullStrength, BullStrength } from '@/lib/stock-data'

// VIX·NASDAQ·KOSPI MA20은 한국 장 중 변하지 않으므로 10분 캐시
let bullCache: { data: BullStrength; ts: number } | null = null
const BULL_TTL = 10 * 60 * 1000

export async function GET() {
  try {
    const [{ kospi, kosdaq }, usdkrw] = await Promise.all([
      getMarketIndex(),
      getUSDKRW(),
    ])

    const now = Date.now()
    if (!bullCache || now - bullCache.ts > BULL_TTL) {
      const fresh = await getBullStrength(kospi, kosdaq).catch(() => null)
      if (fresh) bullCache = { data: fresh, ts: now }
    }
    const bullStrength = bullCache?.data ?? null

    return NextResponse.json({ kospi, kosdaq, usdkrw, bullStrength })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
