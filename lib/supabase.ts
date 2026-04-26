import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null
let _supabaseAdmin: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Supabase 환경변수가 설정되지 않았습니다 (.env.local 확인)')
    _supabase = createClient(url, key)
  }
  return _supabase
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) throw new Error('Supabase 서비스 키가 설정되지 않았습니다 (.env.local 확인)')
    _supabaseAdmin = createClient(url, key)
  }
  return _supabaseAdmin
}

// 하위 호환성을 위한 프록시 (API 라우트에서만 실제 접근됨)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return getSupabase()[prop as keyof SupabaseClient]
  },
})

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return getSupabaseAdmin()[prop as keyof SupabaseClient]
  },
})

export type StockRecommendation = {
  name: string
  ticker: string
  buy_price: number
  sell_price: number
  expected_return: number
  probability: number
  reasoning: string
  key_catalyst: string
}

export type DailyRecommendation = {
  id: string
  date: string
  stocks: StockRecommendation[]
  market_outlook: string
  risk_factors: string
  created_at: string
}

export type NewsItem = {
  title: string
  link: string
  pubDate: string
  source: string
  ticker?: string
}
