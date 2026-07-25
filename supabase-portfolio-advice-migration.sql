-- =========================================================
-- StockSight portfolio_advice 계좌별 독립 조언 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- =========================================================

-- 1. portfolio_item_id 컬럼 추가 (portfolio.id FK)
ALTER TABLE portfolio_advice
  ADD COLUMN IF NOT EXISTS portfolio_item_id UUID REFERENCES portfolio(id) ON DELETE SET NULL;

-- 2. 기존 UNIQUE(date, ticker) 제약 제거
ALTER TABLE portfolio_advice DROP CONSTRAINT IF EXISTS portfolio_advice_date_ticker_key;

-- 3. 신규 행 전용 unique index: portfolio_item_id 있는 경우
CREATE UNIQUE INDEX IF NOT EXISTS idx_pa_date_item
  ON portfolio_advice(date, portfolio_item_id)
  WHERE portfolio_item_id IS NOT NULL;

-- 4. 레거시 행 전용 unique index: portfolio_item_id 없는 구버전 행 (backward compat)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pa_date_ticker_legacy
  ON portfolio_advice(date, ticker)
  WHERE portfolio_item_id IS NULL;
