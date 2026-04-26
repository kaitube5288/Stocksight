import { NextResponse } from 'next/server'
import { getMarketIndex, getUSDKRW } from '@/lib/stock-data'

export async function GET() {
  try {
    const [{ kospi, kosdaq }, usdkrw] = await Promise.all([
      getMarketIndex(),
      getUSDKRW(),
    ])

    return NextResponse.json({ kospi, kosdaq, usdkrw })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
