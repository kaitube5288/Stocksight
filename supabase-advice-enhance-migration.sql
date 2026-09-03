-- =========================================================
-- StockSight 종목 조언 강화 필드 추가 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- =========================================================

ALTER TABLE portfolio_advice
  ADD COLUMN IF NOT EXISTS target_price INTEGER,
  ADD COLUMN IF NOT EXISTS stop_loss_price INTEGER,
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS checkpoint_note TEXT,
  ADD COLUMN IF NOT EXISTS psychology_note TEXT,
  ADD COLUMN IF NOT EXISTS alternatives JSONB;
