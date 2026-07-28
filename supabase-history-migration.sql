-- 포트폴리오 일별 스냅샷
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_eval NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  total_cash NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 거래 이력 (추매/매도/추가투자)
CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  account_id UUID REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  ticker TEXT,
  name TEXT,
  type TEXT NOT NULL,
  price NUMERIC,
  quantity NUMERIC,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_account ON portfolio_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_pt_date ON portfolio_transactions(date DESC);
