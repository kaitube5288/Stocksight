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

-- RLS 정책 (필요시 활성화)
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE historical_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE dart_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 정책 (서비스 키로 쓰기)
CREATE POLICY "Public read recommendations" ON recommendations FOR SELECT USING (true);
CREATE POLICY "Public read news_cache" ON news_cache FOR SELECT USING (true);
CREATE POLICY "Public read historical_patterns" ON historical_patterns FOR SELECT USING (true);
CREATE POLICY "Public read dart_disclosures" ON dart_disclosures FOR SELECT USING (true);
CREATE POLICY "Public read market_events" ON market_events FOR SELECT USING (true);
