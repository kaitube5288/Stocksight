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

export type AnalyzedNews = NewsItem & {
  impact: 'high' | 'medium' | 'low'
  relatedSectors: string[]
}

// 고임팩트 키워드 (실적·수주·수급·정책 등 주가 직접 영향)
const HIGH_IMPACT = [
  '급등', '폭등', '사상최고', '최고가', '신고가', '어닝서프라이즈', '흑자전환', '흑자',
  '수주', '대규모 수주', '외국인순매수', '기관순매수', '정부지원', '보조금', '국책사업',
  '수출급증', '세계최초', '독점', '호실적', '매출 급증', '영업익 급증', '배당 확대',
  '자사주 매입', '공급 계약', '파트너십 체결', '인수', '합병',
]

// 저임팩트 키워드 (불확실·부정·우려)
const LOW_IMPACT = [
  '전망', '예상', '계획', '검토', '논의', '예정', '가능성', '우려',
  '하락 전망', '감소', '적자', '손실', '리스크', '위기', '불확실',
]

// 섹터 → 뉴스 내 키워드 매핑 (종목명·산업 용어 포함)
const SECTOR_KEYWORDS: Record<string, string[]> = {
  '반도체': ['반도체', 'HBM', 'DRAM', 'D램', '낸드', 'NAND', 'AI칩', '메모리', '파운드리', 'SK하이닉스', '삼성전자', '시스템반도체'],
  'AI':     ['인공지능', ' AI ', 'AI반도체', '데이터센터', 'GPU', 'LLM', '챗GPT', '생성AI', 'AI서버'],
  '2차전지': ['2차전지', '배터리', '전기차', ' EV ', '리튬', '양극재', '음극재', 'LFP', '전고체', 'LG에너지솔루션', '삼성SDI', 'SK온'],
  '바이오': ['바이오', '제약', '임상', '신약', 'FDA', '항암', '바이오시밀러', '셀트리온', '삼성바이오'],
  '자동차': ['자동차', '현대차', '기아', '완성차', '자율주행'],
  '철강':   ['철강', '포스코', '현대제철', '냉연강판'],
  '화학':   ['화학', '정유', '석유화학', 'LG화학', '롯데케미칼', '에틸렌'],
  '금융':   ['금융', '은행', '보험', '증권', '금리', '코픽스', 'KB', '신한', '하나'],
  '부동산': ['부동산', '건설', '아파트', '분양', '현대건설', '대우건설'],
  '원자력': ['원자력', '원전', 'SMR', '핵융합', '두산에너빌리티'],
  '방산':   ['방산', '무기', 'K방산', '방위산업', '한화에어로', '현대로템'],
  '인터넷': ['네이버', '카카오', '인터넷 플랫폼', '플랫폼 기업'],
  '게임':   ['게임', '넥슨', '엔씨소프트', '크래프톤', '넷마블'],
  '조선':   ['조선', '선박', 'LNG선', '수주잔량', 'HD현대중공업', '삼성중공업'],
  '로봇':   ['로봇', '자동화', '협동로봇', '레인보우로보틱스'],
  '전선':   ['전선', '케이블', '초고압', '전력망', '가온전선', '대한전선', 'LS전선', '전력 인프라', '전력케이블', 'KBI메탈', '일진전기', '대원전선'],
  '전력기기': ['변압기', '전력기기', '배전', '송전', 'HD현대일렉트릭', '효성중공업', '전력 설비', 'LS일렉트릭', '제룡전기'],
  '레이저': ['레이저', '광학', '광섬유', '레이저 의료', '레이저 가공', '필옵틱스', '한빛레이저', 'HB테크놀로지', '이오테크닉스', '해성옵틱스', '루멘스', 'AP시스템'],
  '수소':   ['수소', '연료전지', '수소차', 'FCEV', '두산퓨얼셀', '수소 경제', '그린수소', '일진하이솔루스', '에스퓨얼셀', '코오롱인더'],
  '반도체소재': ['반도체 소재', 'FCCL', '동박', '식각', '세정액', 'SKC', '와이씨켐', '이엔에프'],
  '전자부품': ['커패시터', 'MLCC', '저항기', '전자부품', 'PCB', '기판', '뉴인텍', '케스피온', '켐트로닉스'],
  '전장':   ['전장', 'ADAS', '차량용 카메라', '블랙박스', '차량 전자', '파인디지털', '아이비전'],
}

function scoreImpact(title: string): 'high' | 'medium' | 'low' {
  if (HIGH_IMPACT.some(k => title.includes(k))) return 'high'
  if (LOW_IMPACT.some(k => title.includes(k))) return 'low'
  return 'medium'
}

function detectSectors(title: string): string[] {
  return Object.entries(SECTOR_KEYWORDS)
    .filter(([, keywords]) => keywords.some(k => title.includes(k)))
    .map(([sector]) => sector)
}

export function analyzeNews(news: NewsItem[]): AnalyzedNews[] {
  return news.map(n => ({
    ...n,
    impact: scoreImpact(n.title),
    relatedSectors: detectSectors(n.title),
  }))
}

// 분석된 뉴스를 임팩트 티어별로 Gemini 프롬프트용 텍스트로 포맷
export function formatAnalyzedNewsForPrompt(analyzed: AnalyzedNews[]): string {
  if (!analyzed.length) return '수집된 뉴스 없음'

  const high   = analyzed.filter(n => n.impact === 'high')
  const medium = analyzed.filter(n => n.impact === 'medium')
  const low    = analyzed.filter(n => n.impact === 'low')

  const lines: string[] = []

  if (high.length) {
    lines.push('【HIGH 임팩트 — 즉각 섹터/종목 반영 필수】')
    high.slice(0, 12).forEach(n => {
      const sec = n.relatedSectors.length ? ` [${n.relatedSectors.join('/')}]` : ''
      lines.push(`  ★ [${n.source}] ${n.title} (${n.pubDate})${sec}`)
    })
  }

  if (medium.length) {
    lines.push('【MEDIUM 임팩트 — 참고 반영】')
    medium.slice(0, 12).forEach(n => {
      const sec = n.relatedSectors.length ? ` [${n.relatedSectors.join('/')}]` : ''
      lines.push(`  • [${n.source}] ${n.title} (${n.pubDate})${sec}`)
    })
  }

  if (low.length) {
    lines.push('【LOW 임팩트 (배경 참고)】')
    low.slice(0, 6).forEach(n => {
      lines.push(`  ○ [${n.source}] ${n.title} (${n.pubDate})`)
    })
  }

  return lines.join('\n')
}

// 분석된 뉴스에서 활성 섹터 키워드 추출 (high 3점, medium 1점 가중)
export function extractSectorsFromNews(analyzed: AnalyzedNews[]): string[] {
  const counts: Record<string, number> = {}
  for (const n of analyzed) {
    const weight = n.impact === 'high' ? 3 : n.impact === 'medium' ? 1 : 0
    for (const s of n.relatedSectors) {
      counts[s] = (counts[s] ?? 0) + weight
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
}

// Google 뉴스 RSS - 쿼리 기반
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

// 네이버 금융 종목별 뉴스 스크래핑
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

// 네이버 금융 RSS
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

// 전날 저녁 ~ 당일 아침 뉴스 수집 (기존 함수, 하위호환)
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

  const seen = new Set<string>()
  return allNews.filter(item => {
    if (seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
}

// 실시간 뉴스 수집 + 분석 (크론 직접 호출용)
export async function fetchAndAnalyzeNews(): Promise<{ news: NewsItem[]; analyzed: AnalyzedNews[] }> {
  const queries = [
    '코스피 코스닥 오늘',
    '한국 주식 급등',
    '반도체 AI 주가',
    '2차전지 전기차 주가',
    '바이오 제약 임상',
    '원자력 방산 조선 주가',
    '금융 보험 증권 주가',
    '전선 전력망 케이블 주가',
    '레이저 광학 수소 연료전지 주가',
    '경제 뉴스 오늘',
  ]

  const all: NewsItem[] = []
  for (const q of queries) {
    const items = await fetchGoogleNewsRSS(q)
    all.push(...items)
  }

  const naverItems = await fetchNaverFinanceRSS()
  all.push(...naverItems)

  // 중복 제거 (제목 기준)
  const seen = new Set<string>()
  const unique = all.filter(n => {
    if (!n.title || seen.has(n.title)) return false
    seen.add(n.title)
    return true
  })

  const analyzed = analyzeNews(unique)
  return { news: unique, analyzed }
}

// 하위호환 — app/api/news/route.ts 에서 사용
export async function fetchLiveEconomicNews(): Promise<NewsItem[]> {
  return fetchOvernightNews()
}

export function formatNewsForPrompt(news: NewsItem[]): string {
  if (!news.length) return '수집된 뉴스 없음'
  return news
    .slice(0, 20)
    .map(n => `- [${n.source}] ${n.title} (${n.pubDate})`)
    .join('\n')
}
