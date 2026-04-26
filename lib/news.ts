import axios from 'axios'
import * as cheerio from 'cheerio'
import Parser from 'rss-parser'

const rssParser = new Parser({ timeout: 10000 })

export type NewsItem = {
  title: string
  link: string
  pubDate: string
  source: string
  ticker?: string
}

// Google 뉴스 RSS - 한국 주식 관련
export async function fetchGoogleNewsRSS(query: string): Promise<NewsItem[]> {
  try {
    const encoded = encodeURIComponent(query)
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=ko&gl=KR&ceid=KR:ko`
    const feed = await rssParser.parseURL(url)

    return (feed.items || []).slice(0, 10).map(item => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: item.creator || 'Google 뉴스',
    }))
  } catch {
    return []
  }
}

// 네이버 금융 종목별 뉴스 제목 스크래핑
export async function fetchNaverStockNews(ticker: string): Promise<NewsItem[]> {
  try {
    const url = `https://finance.naver.com/item/news.naver?code=${ticker}`
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://finance.naver.com',
      },
      timeout: 8000,
    })

    const $ = cheerio.load(res.data)
    const items: NewsItem[] = []

    $('table.type5 tbody tr').each((_, el) => {
      const titleEl = $(el).find('td.title a')
      const dateEl = $(el).find('td.date')
      const title = titleEl.text().trim()
      const href = titleEl.attr('href') || ''
      const date = dateEl.text().trim()

      if (title) {
        items.push({
          title,
          link: href.startsWith('http') ? href : `https://finance.naver.com${href}`,
          pubDate: date,
          source: '네이버 금융',
          ticker,
        })
      }
    })

    return items.slice(0, 5)
  } catch {
    return []
  }
}

// 네이버 금융 뉴스 RSS
export async function fetchNaverFinanceRSS(): Promise<NewsItem[]> {
  const feeds = [
    'https://news.naver.com/main/rss/mnews/list.nhn?sid1=101',
    'https://finance.naver.com/news/news_list.naver?mode=LSS2D&section_id=101&section_id2=258',
  ]

  const results: NewsItem[] = []

  for (const url of feeds) {
    try {
      const feed = await rssParser.parseURL(url)
      const items = (feed.items || []).slice(0, 10).map(item => ({
        title: item.title || '',
        link: item.link || '',
        pubDate: item.pubDate || new Date().toISOString(),
        source: '네이버 경제',
      }))
      results.push(...items)
    } catch {
      // 개별 피드 실패 무시
    }
  }

  return results
}

// 오전 뉴스 수집 (전날 22:00 ~ 당일 08:40)
export async function fetchOvernightNews(): Promise<NewsItem[]> {
  const queries = [
    '한국 주식 증시',
    '코스피 코스닥',
    '반도체 주가',
    '2차전지 주가',
    '바이오 주가',
  ]

  const allNews: NewsItem[] = []

  for (const q of queries) {
    const items = await fetchGoogleNewsRSS(q)
    allNews.push(...items)
  }

  const naverItems = await fetchNaverFinanceRSS()
  allNews.push(...naverItems)

  // 중복 제거 (제목 기준)
  const seen = new Set<string>()
  return allNews.filter(item => {
    if (seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
}

// 실시간 주요 경제 뉴스 (30분 주기)
export async function fetchLiveEconomicNews(): Promise<NewsItem[]> {
  const queries = ['경제 뉴스', '주식 급등', '코스피', '코스닥', '반도체 AI']
  const all: NewsItem[] = []

  for (const q of queries) {
    const items = await fetchGoogleNewsRSS(q)
    all.push(...items)
  }

  const seen = new Set<string>()
  return all.filter(item => {
    if (seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
}

export function formatNewsForPrompt(news: NewsItem[]): string {
  if (!news.length) return '수집된 뉴스 없음'
  return news
    .slice(0, 20)
    .map(n => `- [${n.source}] ${n.title} (${n.pubDate})`)
    .join('\n')
}
