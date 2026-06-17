import { NextResponse } from 'next/server'
import { getMarketIndex, getUSDKRW, getBullStrength } from '@/lib/stock-data'

export async function GET() {
  try {
    const [{ kospi, kosdaq }, usdkrw] = await Promise.all([
      getMarketIndex(),
      getUSDKRW(),
    ])
    const bullStrength = await getBullStrength(kospi, kosdaq).catch(() => null)

    return NextResponse.json({ kospi, kosdaq, usdkrw, bullStrength })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
