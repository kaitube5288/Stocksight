import { NextRequest, NextResponse } from 'next/server'
import { fetchLiveEconomicNews } from '@/lib/news'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Vercel Cron 자동 호출
export async function POST() {
  return collectNews(false)
}

// 수동 호출: ?force=true 시 30분 캐시 무시
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get('force') === 'true'
  return collectNews(force)
}

async function collectNews(force: boolean) {
  try {
    // force=false 시 30분 이내 캐시 반환
    if (!force) {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const { data: cached } = await supabaseAdmin
        .from('news_cache')
        .select('*')
        .gte('fetched_at', thirtyMinAgo)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single()

      if (cached) {
        return NextResponse.json({
          news: cached.news,
          count: Array.isArray(cached.news) ? cached.news.length : 0,
          cached: true,
          fetchedAt: cached.fetched_at,
        })
      }
    }

    // 신규 뉴스 수집
    const news = await fetchLiveEconomicNews()

    await supabaseAdmin.from('news_cache').insert({
      source: 'google+naver',
      news,
    })

    return NextResponse.json({
      news,
      count: news.length,
      cached: false,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
