-- portfolio_advice에 source 컬럼 추가 (auto=자동, manual=수동)
ALTER TABLE portfolio_advice
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto';
