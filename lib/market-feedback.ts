import axios from 'axios'
import * as cheerio from 'cheerio'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getSupabaseAdmin } from './supabase'
import { STOCK_MAP } from './major-stocks'

export type TopGainer = {
  ticker: string
  name: string
  change_pct: number
  price: number
}

export type GainerAnalysis = {
  ticker: string
  name: string
  change_pct: number
  theme: string
  reason: string
  news_titles: string[]
  beneficiary_sectors: string[]
  beneficiary_tickers: string[]
  beneficiary_analysis: string
}

// Naver Finance 상위 급등 종목 스크래핑 (KOSPI + KOSDAQ)
export async function scrapeNaverTopGainers(limit = 15): Promise<TopGainer[]> {
  const gainers: TopGainer[] = []

  for (const sosok of ['0', '1']) {
    try {
      const res = await axios.get(
        `https://finance.naver.com/sise/sise_rise.naver?sosok=${sosok}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9',
            Referer: 'https://finance.naver.com',
          },
          timeout: 12000,
        }
      )
      const $ = cheerio.load(res.data)

      $('table.type_2 tr').each((_, row) => {
        const cells = $(row).find('td')
        if (cells.length < 5) return

        const nameEl = $(cells[1]).find('a')
        const name = nameEl.text().trim()
        const link = nameEl.attr('href') ?? ''
        const ticker = link.match(/code=(\d+)/)?.[1] ?? ''
        const priceText = $(cells[2]).text().trim().replace(/,/g, '')
        const changePctText = $(cells[4]).text().trim().replace('%', '').replace(',', '')
        const price = parseFloat(priceText) || 0
        const change_pct = parseFloat(changePctText) || 0

        if (ticker && name && change_pct > 0) {
          gainers.push({ ticker, name, change_pct, price })
        }
      })
    } catch { /* ignore */ }
  }

  return gainers
    .filter((g, i, arr) => arr.findIndex(x => x.ticker === g.ticker) === i)
    .sort((a, b) => b.change_pct - a.change_pct)
    .slice(0, limit)
}

// 특정 종목 관련 뉴스 헤드라인 수집
export async function fetchStockNewsHeadlines(ticker: string, name: string): Promise<string[]> {
  const headlines: string[] = []

  // 1차: Naver Finance 종목 뉴스
  try {
    const res = await axios.get(
      `https://finance.naver.com/item/news_news.naver?code=${ticker}&page=1&category=0`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'ko-KR',
          Referer: 'https://finance.naver.com',
        },
        timeout: 8000,
      }
    )
    const $ = cheerio.load(res.data)
    $('table.type5 tr td.title a, .newsTitle a').each((_, el) => {
      const title = $(el).text().trim()
      if (title && title.length > 5) headlines.push(title)
    })
  } catch { /* ignore */ }

  // 2차: Google News RSS (종목명 검색)
  if (headlines.length < 3) {
    try {
      const { default: Parser } = await import('rss-parser')
      const parser = new Parser({ timeout: 8000 })
      const feed = await parser.parseURL(
        `https://news.google.com/rss/search?q=${encodeURIComponent(name + ' 주가')}&hl=ko&gl=KR&ceid=KR:ko`
      )
      feed.items.slice(0, 8).forEach(item => {
        if (item.title) headlines.push(item.title)
      })
    } catch { /* ignore */ }
  }

  return [...new Set(headlines)].slice(0, 10)
}

// Gemini API 호출 (여러 키/모델 fallback)
async function callGemini(prompt: string): Promise<string> {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean) as string[]

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']

  for (const key of keys) {
    const genAI = new GoogleGenerativeAI(key)
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel(
          { model: modelName, generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' } },
          { apiVersion: 'v1beta' }
        )
        const result = await model.generateContent(prompt)
        return result.response.text()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('429') || msg.toLowerCase().includes('quota')) break
        continue
      }
    }
  }
  throw new Error('Gemini API 호출 실패')
}

// 급등 종목 일괄 분석 — 원인 + 수혜주 발굴
export async function analyzeTopGainersWithGemini(
  gainers: TopGainer[],
  newsMap: Record<string, string[]>
): Promise<{ analyses: GainerAnalysis[]; market_theme: string; missed_themes: string; tomorrow_hints: string }> {
  const gainingLines = gainers.map(g => {
    const news = newsMap[g.ticker] ?? []
    const newsText = news.length
      ? news.slice(0, 5).map(n => `  - ${n}`).join('\n')
      : '  (뉴스 없음)'
    return `[${g.name}(${g.ticker}) +${g.change_pct.toFixed(1)}%]\n${newsText}`
  }).join('\n\n')

  const prompt = `당신은 한국 주식 시장 전문 애널리스트입니다.
오늘 주식 시장 급등 종목들의 상승 원인을 분석하고, 내일 주목할 관련 수혜주를 발굴하세요.

## 오늘 급등 종목 및 관련 뉴스
${gainingLines}

---
아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "analyses": [
    {
      "ticker": "6자리 종목코드",
      "theme": "상승 테마 (예: AI 전력 인프라, 방산 수출 모멘텀, 레이저 의료기기)",
      "reason": "상승 원인 2-3문장 (구체적 뉴스·이슈 포함)",
      "beneficiary_sectors": ["수혜섹터1", "수혜섹터2"],
      "beneficiary_tickers": ["수혜종목코드1", "수혜종목코드2"],
      "beneficiary_analysis": "수혜주 발굴 근거 1-2문장 (왜 이 종목이 수혜를 받는가)"
    }
  ],
  "market_theme": "오늘 시장 전체 주도 테마 요약 (1문장)",
  "missed_themes": "기존 대형주 추천 알고리즘이 놓칠 수 있는 테마·섹터 (예: 소형 전선주, 레이저·광학, 수소 연료전지)",
  "tomorrow_hints": "내일 주목할 섹터·테마 힌트 2-3문장 (모멘텀 지속 여부 포함)"
}`

  const text = await callGemini(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Gemini 응답 파싱 실패')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    // JSON이 중간에 잘린 경우 analyses 배열만 부분 복구 시도
    const partial = jsonMatch[0].replace(/,?\s*\{[^{}]*$/, '').replace(/,?\s*\[$/, '')
    const fixAttempt = partial.endsWith(']') ? partial + '}}' : partial + ']}}'
    try {
      parsed = JSON.parse(fixAttempt)
    } catch {
      throw new Error(`Gemini JSON 파싱 실패 (position 오류): ${jsonMatch[0].slice(0, 200)}`)
    }
  }
  const analysisMap = new Map<string, Record<string, unknown>>(
    ((parsed.analyses as Record<string, unknown>[]) ?? []).map((a) => [a.ticker as string, a])
  )

  const analyses: GainerAnalysis[] = gainers.map(g => {
    const a = analysisMap.get(g.ticker) ?? {}
    return {
      ticker: g.ticker,
      name: g.name,
      change_pct: g.change_pct,
      theme: (a.theme as string) ?? '분석 불가',
      reason: (a.reason as string) ?? '관련 뉴스 없음',
      news_titles: newsMap[g.ticker] ?? [],
      beneficiary_sectors: (a.beneficiary_sectors as string[]) ?? [],
      beneficiary_tickers: (a.beneficiary_tickers as string[]) ?? [],
      beneficiary_analysis: (a.beneficiary_analysis as string) ?? '',
    }
  })

  return {
    analyses,
    market_theme: (parsed.market_theme as string) ?? '',
    missed_themes: (parsed.missed_themes as string) ?? '',
    tomorrow_hints: (parsed.tomorrow_hints as string) ?? '',
  }
}

// Supabase market_feedback 저장
export async function storeMarketFeedback(
  date: string,
  analyses: GainerAnalysis[],
  meta: { market_theme: string; missed_themes: string; tomorrow_hints: string }
) {
  const supabase = getSupabaseAdmin()

  await supabase.from('market_feedback').delete().eq('date', date)

  const rows = analyses.map(a => ({
    date,
    ticker: a.ticker,
    name: a.name,
    change_pct: a.change_pct,
    theme: a.theme,
    reason: a.reason,
    news_titles: a.news_titles,
    beneficiary_sectors: a.beneficiary_sectors,
    beneficiary_tickers: a.beneficiary_tickers,
    beneficiary_analysis: a.beneficiary_analysis,
    market_theme: meta.market_theme,
    missed_themes: meta.missed_themes,
    tomorrow_hints: meta.tomorrow_hints,
  }))

  const { error } = await supabase.from('market_feedback').insert(rows)
  if (error) throw error
}

// 최근 3일 market_feedback → Gemini 프롬프트 주입용 텍스트
export async function buildMarketFeedbackInsights(): Promise<string> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('market_feedback')
      .select('*')
      .order('date', { ascending: false })
      .limit(45)

    if (error || !data || data.length === 0) return ''

    // 날짜별 그룹핑
    const byDate = new Map<string, typeof data>()
    for (const row of data) {
      if (!byDate.has(row.date)) byDate.set(row.date, [])
      byDate.get(row.date)!.push(row)
    }

    const lines: string[] = ['[최근 급등주 패턴 분석 — 내일 추천에 우선 반영]']

    for (const [date, rows] of [...byDate.entries()].slice(0, 3)) {
      const meta = rows[0]
      lines.push(`\n## ${date} 장마감 분석`)
      lines.push(`주도 테마: ${meta.market_theme}`)
      if (meta.missed_themes) lines.push(`놓친 테마: ${meta.missed_themes}`)
      if (meta.tomorrow_hints) lines.push(`내일 힌트: ${meta.tomorrow_hints}`)

      rows.slice(0, 6).forEach(r => {
        const ben = (r.beneficiary_tickers ?? []).slice(0, 3).join(', ')
        lines.push(`• ${r.name}(${r.ticker}) +${Number(r.change_pct).toFixed(1)}% — ${r.theme}${ben ? ` | 수혜주: ${ben}` : ''}`)
      })
    }

    // 최근 자주 언급된 수혜 후보 집계
    const beneficiaryCount = new Map<string, number>()
    for (const row of data) {
      for (const t of (row.beneficiary_tickers ?? [])) {
        beneficiaryCount.set(t, (beneficiaryCount.get(t) ?? 0) + 1)
      }
    }
    const topBeneficiaries = [...beneficiaryCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t, cnt]) => `${t}(${cnt}회)`)

    if (topBeneficiaries.length > 0) {
      lines.push(`\n반복 수혜 후보 티커: ${topBeneficiaries.join(', ')}`)
      lines.push('→ 위 티커들이 후보 풀에 있다면 가중치 +1로 우선 검토하세요')
    }

    return lines.join('\n')
  } catch {
    return ''
  }
}

// 전일 급등 종목의 수혜 후보(beneficiary_tickers)에서 섹터연동 후보 추출
export async function getSectorMomentumCandidates(
  existingTickerSet: Set<string>
): Promise<{ ticker: string; name: string; sector: string }[]> {
  try {
    const supabase = getSupabaseAdmin()
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    kst.setDate(kst.getDate() - 1)
    const kstYesterday = kst.toISOString().slice(0, 10)

    const { data } = await supabase
      .from('market_feedback')
      .select('beneficiary_tickers, change_pct')
      .eq('date', kstYesterday)
      .order('change_pct', { ascending: false })

    if (!data?.length) return []

    const seen = new Set<string>()
    const candidates: { ticker: string; name: string; sector: string }[] = []

    for (const row of data) {
      const tickers: string[] = row.beneficiary_tickers ?? []
      for (const t of tickers) {
        if (seen.has(t) || existingTickerSet.has(t)) continue
        const stock = STOCK_MAP[t]
        if (!stock) continue
        seen.add(t)
        candidates.push({ ticker: t, name: stock.name, sector: '섹터연동' })
      }
    }

    const result = candidates.slice(0, 8)
    if (result.length > 0) {
      console.log(`[섹터연동] ${kstYesterday} 기준 수혜 후보 ${result.length}개: ${result.map(c => c.ticker).join(', ')}`)
    }
    return result
  } catch {
    return []
  }
}
