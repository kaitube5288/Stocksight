import { NextResponse } from 'next/server'
import axios from 'axios'

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    return NextResponse.json({ success: false, error: 'TELEGRAM_BOT_TOKEN 환경변수가 없음' })
  }

  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${token}/getUpdates`,
      { timeout: 8000 }
    )
    const updates = res.data?.result
    if (!updates?.length) {
      return NextResponse.json({
        success: false,
        error: '업데이트 없음 — 봇에 메시지를 보낸 후 다시 시도하세요',
        tokenPrefix: token.slice(0, 10) + '...',
        updatesCount: 0,
      })
    }
    const last = updates[updates.length - 1]
    const chatId = String(last?.message?.chat?.id ?? last?.channel_post?.chat?.id ?? '')
    return NextResponse.json({ success: true, chatId, updatesCount: updates.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({
      success: false,
      error: msg,
      tokenPrefix: token.slice(0, 10) + '...',
    })
  }
}
