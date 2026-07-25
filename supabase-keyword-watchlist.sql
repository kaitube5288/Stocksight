-- =========================================================
-- StockSight 동적 키워드 감시 테이블
-- Supabase SQL Editor에서 실행하세요
-- =========================================================

CREATE TABLE IF NOT EXISTS keyword_watchlist (
  id            UUID      DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword       TEXT      NOT NULL UNIQUE,
  sector        TEXT,                          -- 반도체, AI, 2차전지, 바이오 등
  related_tickers TEXT[]  DEFAULT '{}',        -- 관련 종목코드 배열
  is_high_impact BOOLEAN  NOT NULL DEFAULT FALSE,
  source        TEXT      NOT NULL DEFAULT 'ai', -- 'seed' | 'ai' | 'manual'
  hit_count     INTEGER   NOT NULL DEFAULT 0,
  last_hit_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_sector    ON keyword_watchlist(sector);
CREATE INDEX IF NOT EXISTS idx_keyword_impact    ON keyword_watchlist(is_high_impact);

ALTER TABLE keyword_watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON keyword_watchlist FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =========================================================
-- 시드 데이터: 누락되었던 반도체/빅테크 경쟁 위협 키워드
-- =========================================================
INSERT INTO keyword_watchlist (keyword, sector, related_tickers, is_high_impact, source) VALUES

-- 중국 NAND 경쟁사 (삼성/SK하이닉스 낸드 시장 위협)
('YMTC',          '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('양쯔메모리',     '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('양쯔',          '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('Yangtze Memory','반도체', ARRAY['005930','000660'], TRUE,  'seed'),

-- 중국 DRAM 경쟁사 (삼성/SK하이닉스 DRAM 시장 위협)
('CXMT',          '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('창신메모리',     '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('창신',          '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('ChangXin',      '반도체', ARRAY['005930','000660'], TRUE,  'seed'),

-- 주요 고객사 (삼성/SK 반도체 구매처)
('애플',          '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('Apple',         '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('아이폰 반도체', '반도체', ARRAY['005930','000660'], FALSE, 'seed'),
('구글 TPU',      'AI',     ARRAY['005930','000660'], FALSE, 'seed'),
('마이크로소프트 반도체','반도체',ARRAY['005930','000660'],FALSE,'seed'),

-- 화웨이 (독자 반도체 개발, 수출 규제 핵심)
('화웨이',        '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('Huawei',        '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('기린칩',        '반도체', ARRAY['005930','000660'], FALSE, 'seed'),
('화웨이 반도체', '반도체', ARRAY['005930','000660'], TRUE,  'seed'),

-- 미국 수출 규제 / 제재 (한국 반도체 공급망 영향)
('반도체 수출 규제','반도체',ARRAY['005930','000660'], TRUE,  'seed'),
('반도체 제재',   '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('BIS 규제',      '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('칩법',          '반도체', ARRAY['005930','000660'], FALSE, 'seed'),
('Chips Act',     '반도체', ARRAY['005930','000660'], FALSE, 'seed'),
('엔비디아 수출 제한','반도체',ARRAY['005930','000660'],TRUE, 'seed'),

-- 반도체 수급/경쟁 이슈
('메모리 공급과잉','반도체',ARRAY['005930','000660'], TRUE,  'seed'),
('낸드 가격',     '반도체', ARRAY['005930','000660'], FALSE, 'seed'),
('HBM 경쟁',      '반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('중국 반도체 추격','반도체',ARRAY['005930','000660'],TRUE,  'seed'),
('삼성 점유율',   '반도체', ARRAY['005930'],          TRUE,  'seed'),
('SK하이닉스 점유율','반도체',ARRAY['000660'],         TRUE,  'seed'),

-- AI 서버/데이터센터 메모리 수요 (삼성/SK하이닉스 호재)
('AI 서버 메모리','반도체', ARRAY['005930','000660'], TRUE,  'seed'),
('HBM 수요',      '반도체', ARRAY['000660','005930'], TRUE,  'seed'),
('HBM4',          '반도체', ARRAY['000660','005930'], TRUE,  'seed'),
('엔비디아 HBM',  '반도체', ARRAY['000660','005930'], TRUE,  'seed'),

-- 배터리 경쟁사 (중국)
('CATL',          '2차전지',ARRAY['373220','006400','011790'],FALSE,'seed'),
('BYD 배터리',    '2차전지',ARRAY['373220','006400'],         FALSE,'seed'),
('중국 배터리',   '2차전지',ARRAY['373220','006400','011790'],FALSE,'seed'),
('LFP 확대',      '2차전지',ARRAY['373220','006400'],         FALSE,'seed'),

-- 미국 IRA / 보조금 (배터리·전기차)
('IRA',           '2차전지',ARRAY['373220','006400','011790'],TRUE, 'seed'),
('배터리 보조금', '2차전지',ARRAY['373220','006400','011790'],TRUE, 'seed'),
('전기차 세액공제','2차전지',ARRAY['373220','006400'],         FALSE,'seed')

ON CONFLICT (keyword) DO NOTHING;
