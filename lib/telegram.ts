import axios from 'axios'
import { StockRecommendation } from './supabase'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

export async function sendTelegramAlert(params: {
  stocks: StockRecommendation[]
  marketOutlook: string
  date: string
  usdkrw?: number | null
  goldPrice?: number | null
}): Promise<boolean> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return false
  if (TELEGRAM_TOKEN.startsWith('your-')) return false

  const groups: { label: string; emoji: string; type: string }[] = [
    { label: '단타', emoji: '⚡', type: '단타' },
    { label: '스윙', emoji: '📈', type: '스윙' },
    { label: '중기', emoji: '🏦', type: '중기' },
  ]

  const stockLines: string[] = []
  for (const g of groups) {
    const group = params.stocks.filter(s => s.trade_type === g.type)
    if (group.length === 0) continue
    stockLines.push(`${g.emoji} <b>[${g.label} · ${group[0].hold_period}]</b>`)
    group.slice(0, 3).forEach((s, i) => {
      stockLines.push(
        `  ${['1️⃣','2️⃣','3️⃣'][i]} <b>${s.name}</b> (${s.ticker}) +${s.expected_return.toFixed(1)}% | ${s.probability}%`,
        `     <i>${s.key_catalyst}</i>`
      )
    })
    stockLines.push('')
  }

  const marketIndicators: string[] = []
  if (params.usdkrw) {
    marketIndicators.push(`💵 USD/KRW: ${params.usdkrw.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`)
  }
  if (params.goldPrice && params.usdkrw) {
    // 국제 금 가격(USD/oz) → 한국 금시세(KRW/돈)로 변환
    // 1 oz = 31.1035g, 1돈 = 3.75g
    const goldPricePerDon = Math.round((params.goldPrice * params.usdkrw * 3.75) / 31.1035)
    marketIndicators.push(`🥇 Gold: ${goldPricePerDon.toLocaleString('ko-KR')}원/돈`)
  }

  const lines = [
    `📊 <b>StockSight 오늘의 추천 (${params.date})</b>`,
    ``,
    ...stockLines,
    marketIndicators.length > 0 ? marketIndicators.join(' | ') : '',
    marketIndicators.length > 0 ? `` : '',
    `📉 ${(params.marketOutlook ?? '').slice(0, 80)}...`,
    ``,
    `🔗 <a href="https://stocksight-pied.vercel.app">분석 보기</a>`,
  ].filter(Boolean)

  const MAX_MSG_LENGTH = 4000
  const linkLine = `\n🔗 <a href="https://stocksight-pied.vercel.app">분석 보기</a>`
  const bodyLines = lines.filter(l => !l.startsWith('🔗'))
  let body = bodyLines.join('\n')
  if (body.length + linkLine.length > MAX_MSG_LENGTH) {
    body = body.slice(0, MAX_MSG_LENGTH - linkLine.length - 3) + '...'
  }
  const text = body + linkLine

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { timeout: 15000 }
      )
      return true
    } catch (e) {
      if (attempt === 2) {
        console.error('텔레그램 전송 실패 (3회 재시도 소진):', e instanceof Error ? e.message : e)
        return false
      }
      console.warn(`텔레그램 전송 재시도 (${attempt + 1}/3)...`)
      await new Promise(r => setTimeout(r, (attempt + 1) * 3000))
    }
  }
  return false
}

// Chat ID 조회 헬퍼 (봇에 메시지 보낸 후 호출)
export async function getTelegramChatId(): Promise<string | null> {
  if (!TELEGRAM_TOKEN) return null
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`,
      { timeout: 8000 }
    )
    const updates = res.data?.result
    if (!updates?.length) return null
    return String(updates[updates.length - 1]?.message?.chat?.id ?? '')
  } catch {
    return null
  }
}
