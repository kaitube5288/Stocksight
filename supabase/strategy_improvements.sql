-- 전략 자동 개선 기록 테이블
-- 누적 수익률 15% 미달 섹션에 대해 Gemini가 자기진단한 결과를 저장
CREATE TABLE IF NOT EXISTS strategy_improvements (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  trade_type        text        NOT NULL,   -- '단타' | '스윙' | '중기'
  cumulative_return numeric     NOT NULL,   -- 자기진단 시점 누적 수익률 (%)
  failed_count      integer     NOT NULL DEFAULT 0,  -- 손실 종목 수
  total_count       integer     NOT NULL DEFAULT 0,  -- 전체 만료 종목 수
  analysis          text        NOT NULL   -- Gemini 분석 결과 (실패 원인 + 개선 규칙)
);

CREATE INDEX IF NOT EXISTS idx_strategy_improvements_tt_date
  ON strategy_improvements (trade_type, created_at DESC);

-- RLS: 읽기 공개, 쓰기는 service_role(서버)만
ALTER TABLE strategy_improvements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON strategy_improvements
  FOR SELECT USING (true);

-- 2026-10-30 Supabase 정책 변경 대응: public 스키마 테이블에 명시적 GRANT 부여
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_improvements TO anon, authenticated;
