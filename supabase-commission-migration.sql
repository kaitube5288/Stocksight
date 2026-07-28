-- portfolio_accounts에 증권사 수수료 컬럼 추가
ALTER TABLE portfolio_accounts
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0.015,
  ADD COLUMN IF NOT EXISTS brokerage TEXT DEFAULT 'etc';
