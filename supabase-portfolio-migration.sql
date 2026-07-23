-- ========================================
-- StockSight 포트폴리오 기능 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- ========================================

-- 1. 보유 종목 테이블
CREATE TABLE IF NOT EXISTS portfolio (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avg_price NUMERIC NOT NULL,
  shares INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 보유 현금 테이블 (단일 행)
CREATE TABLE IF NOT EXISTS portfolio_cash (
  id INTEGER DEFAULT 1 PRIMARY KEY,
  amount NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 일별 종목 조언 이력 테이블
CREATE TABLE IF NOT EXISTS portfolio_advice (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  advice_type TEXT NOT NULL,
  advice_detail TEXT NOT NULL,
  current_price NUMERIC,
  avg_price NUMERIC,
  profit_pct NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, ticker)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_portfolio_advice_date ON portfolio_advice(date);
CREATE INDEX IF NOT EXISTS idx_portfolio_advice_ticker ON portfolio_advice(ticker);

-- RLS (Row Level Security) — 서비스 키만 접근 허용
ALTER TABLE portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_cash ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_advice ENABLE ROW LEVEL SECURITY;

-- 서비스 롤은 모두 허용 (anon은 차단)
CREATE POLICY "service_all" ON portfolio FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON portfolio_cash FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON portfolio_advice FOR ALL TO service_role USING (true) WITH CHECK (true);
