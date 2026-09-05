-- =========================================================
-- StockSight Phase 1: 조언 로직 확장 필드
-- Supabase SQL Editor에서 실행하세요
-- =========================================================

-- portfolio_advice에 3개 필드 추가
ALTER TABLE portfolio_advice
  ADD COLUMN IF NOT EXISTS trailing_stop_note TEXT,
  ADD COLUMN IF NOT EXISTS partial_exit_note TEXT,
  ADD COLUMN IF NOT EXISTS time_stop_note TEXT;

-- portfolio_account_advice에 포지션 사이징 필드 추가
ALTER TABLE portfolio_account_advice
  ADD COLUMN IF NOT EXISTS position_sizing JSONB;
