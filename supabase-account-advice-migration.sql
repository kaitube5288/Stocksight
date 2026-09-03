-- =========================================================
-- StockSight 계좌별 AI 조언 테이블 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- =========================================================

CREATE TABLE IF NOT EXISTS portfolio_account_advice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  account_id UUID NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  advice_summary TEXT NOT NULL,
  risk_level TEXT CHECK (risk_level IN ('낮음', '중간', '높음')),
  sector_concentration JSONB,
  source TEXT DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, account_id)
);

CREATE INDEX IF NOT EXISTS idx_paa_account_date ON portfolio_account_advice(account_id, date DESC);
