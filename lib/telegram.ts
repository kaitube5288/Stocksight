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

  const top3 = params.stocks.slice(0, 3)

  const lines = [
    `📊 <b>StockSight 오늘의 추천 (${params.date})</b>`,
    ``,
    ...top3.map((s, i) =>
      [
        `${['1️⃣','2️⃣','3️⃣'][i]} <b>${s.name}</b> (${s.ticker})`,
        `   매수 ₩${s.buy_price.toLocaleString()} → 목표 ₩${s.sell_price.toLocaleString()}`,
        `   예상 +${s.expected_return.toFixed(1)}% | 확률 ${s.probability}%`,
        `   <i>${s.key_catalyst}</i>`,
      ].join('\n')
    ),
    ``,
    `📈 ${params.marketOutlook.slice(0, 100)}...`,
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
