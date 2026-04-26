import axios from 'axios'
import { StockRecommendation } from './supabase'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

export async function sendTelegramAlert(params: {
  stocks: StockRecommendation[]
  marketOutlook: string
  date: string
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

  const lines = [
    `📊 <b>StockSight 오늘의 추천 (${params.date})</b>`,
    ``,
    ...stockLines,
    `📉 ${params.marketOutlook.slice(0, 80)}...`,
    ``,
    `🔗 <a href="https://stocksight-pied.vercel.app">분석 보기</a>`,
  ]

  const text = lines.join('\n')

  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10000 }
    )
    return true
  } catch (e) {
    console.error('텔레그램 전송 실패:', e instanceof Error ? e.message : e)
    return false
  }
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
