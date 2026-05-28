-- StockSight Database Schema

-- 오늘의 추천 종목 저장
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  stocks JSONB NOT NULL,
  market_outlook TEXT,
  risk_factors TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_date ON recommendations(date DESC);

-- 뉴스 캐시 (30분 주기)
CREATE TABLE IF NOT EXISTS news_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT NOT NULL,
  news JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_fetched ON news_cache(fetched_at DESC);

-- 과거 일별 상위 5종목 패턴
CREATE TABLE IF NOT EXISTS historical_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trade_date DATE NOT NULL UNIQUE,
  top_gainers JSONB NOT NULL,
  market_events JSONB,
  news_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patterns_date ON historical_patterns(trade_date DESC);

-- DART 공시 캐시
CREATE TABLE IF NOT EXISTS dart_disclosures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rcept_no TEXT UNIQUE,
  corp_name TEXT,
  report_nm TEXT,
  rcept_dt TEXT,
  flr_nm TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dart_date ON dart_disclosures(rcept_dt DESC);

-- 주요 역사적 사건 (수동 태깅 + 자동 수집)
CREATE TABLE IF NOT EXISTS market_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL, -- 'rate_change', 'earnings', 'geopolitical', 'sector', etc.
  description TEXT NOT NULL,
  affected_sectors TEXT[],
  affected_tickers TEXT[],
  impact_direction TEXT, -- 'positive', 'negative', 'mixed'
  impact_magnitude NUMERIC, -- avg % change of affected stocks
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON market_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON market_events(event_type);

-- 장 마감 후 급등 종목 원인 분석 및 수혜주 피드백
CREATE TABLE IF NOT EXISTS market_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  change_pct NUMERIC NOT NULL,
  theme TEXT,
  reason TEXT,
  news_titles TEXT[],
  beneficiary_sectors TEXT[],
  beneficiary_tickers TEXT[],
  beneficiary_analysis TEXT,
  market_theme TEXT,
  missed_themes TEXT,
  tomorrow_hints TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_date ON market_feedback(date DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_ticker ON market_feedback(ticker);

-- RLS 정책 (필요시 활성화)
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE historical_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE dart_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_feedback ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 정책 (서비스 키로 쓰기)
CREATE POLICY "Public read recommendations" ON recommendations FOR SELECT USING (true);
CREATE POLICY "Public read news_cache" ON news_cache FOR SELECT USING (true);
CREATE POLICY "Public read historical_patterns" ON historical_patterns FOR SELECT USING (true);
CREATE POLICY "Public read dart_disclosures" ON dart_disclosures FOR SELECT USING (true);
CREATE POLICY "Public read market_events" ON market_events FOR SELECT USING (true);
CREATE POLICY "Public read market_feedback" ON market_feedback FOR SELECT USING (true);

-- 2026-10-30 Supabase 정책 변경 대응: public 스키마 테이블에 명시적 GRANT 부여
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.news_cache TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_patterns TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dart_disclosures TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_feedback TO anon, authenticated;
