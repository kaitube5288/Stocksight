import { NextResponse } from 'next/server'
import { fetchLiveEconomicNews } from '@/lib/news'
import { supabaseAdmin } from '@/lib/supabase'

// Vercel Cron 30분 자동 호출
export async function POST() {
  return collectNews()
}

export async function GET() {
  return collectNews()
}

async function collectNews() {
  try {
    // 30분 이내 캐시 확인
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: cached } = await supabaseAdmin
      .from('news_cache')
      .select('*')
      .gte('fetched_at', thirtyMinAgo)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single()

    if (cached) {
      return NextResponse.json({ news: cached.news, cached: true, fetchedAt: cached.fetched_at })
    }

    // 신규 뉴스 수집
    const news = await fetchLiveEconomicNews()

    // 캐시 저장
    await supabaseAdmin.from('news_cache').insert({
      source: 'google+naver',
      news,
    })

    return NextResponse.json({ news, cached: false, fetchedAt: new Date().toISOString() })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
