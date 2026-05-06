// 주요 KOSPI/KOSDAQ 종목 (시총 상위 + 주요 테마주)
export const MAJOR_STOCKS = [
  // 반도체
  { ticker: '005930', name: '삼성전자', sector: '반도체' },
  { ticker: '000660', name: 'SK하이닉스', sector: '반도체' },
  { ticker: '000990', name: 'DB하이텍', sector: '반도체' },
  { ticker: '036930', name: '주성엔지니어링', sector: '반도체' },
  { ticker: '058470', name: '리노공업', sector: '반도체' },
  // 2차전지
  { ticker: '373220', name: 'LG에너지솔루션', sector: '2차전지' },
  { ticker: '051910', name: 'LG화학', sector: '2차전지' },
  { ticker: '006400', name: '삼성SDI', sector: '2차전지' },
  { ticker: '096770', name: 'SK이노베이션', sector: '2차전지' },
  { ticker: '247540', name: '에코프로비엠', sector: '2차전지' },
  { ticker: '086520', name: '에코프로', sector: '2차전지' },
  { ticker: '003670', name: '포스코퓨처엠', sector: '2차전지' },
  // 자동차
  { ticker: '005380', name: '현대차', sector: '자동차' },
  { ticker: '000270', name: '기아', sector: '자동차' },
  { ticker: '012330', name: '현대모비스', sector: '자동차' },
  // IT/인터넷
  { ticker: '035420', name: 'NAVER', sector: 'IT' },
  { ticker: '035720', name: '카카오', sector: 'IT' },
  { ticker: '251270', name: '넷마블', sector: '게임' },
  { ticker: '036570', name: 'NC소프트', sector: '게임' },
  { ticker: '259960', name: '크래프톤', sector: '게임' },
  // 바이오/제약
  { ticker: '068270', name: '셀트리온', sector: '바이오' },
  { ticker: '207940', name: '삼성바이오로직스', sector: '바이오' },
  { ticker: '326030', name: 'SK바이오팜', sector: '바이오' },
  { ticker: '128940', name: '한미약품', sector: '제약' },
  { ticker: '000100', name: '유한양행', sector: '제약' },
  // 금융
  { ticker: '105560', name: 'KB금융', sector: '금융' },
  { ticker: '055550', name: '신한지주', sector: '금융' },
  { ticker: '086790', name: '하나금융지주', sector: '금융' },
  { ticker: '316140', name: '우리금융지주', sector: '금융' },
  { ticker: '032830', name: '삼성생명', sector: '보험' },
  // 에너지/화학
  { ticker: '010950', name: 'S-Oil', sector: '에너지' },
  { ticker: '011170', name: '롯데케미칼', sector: '화학' },
  { ticker: '009830', name: '한화솔루션', sector: '태양광' },
  // 철강/소재
  { ticker: '005490', name: 'POSCO홀딩스', sector: '철강' },
  { ticker: '004020', name: '현대제철', sector: '철강' },
  // 방산
  { ticker: '047810', name: '한국항공우주', sector: '방산' },
  { ticker: '012450', name: '한화에어로스페이스', sector: '방산' },
  { ticker: '064350', name: '현대로템', sector: '방산' },
  // 조선
  { ticker: '009540', name: 'HD한국조선해양', sector: '조선' },
  { ticker: '042660', name: '한화오션', sector: '조선' },
  { ticker: '010140', name: '삼성중공업', sector: '조선' },
  // 건설/부동산
  { ticker: '000720', name: '현대건설', sector: '건설' },
  { ticker: '028260', name: '삼성물산', sector: '건설' },
  // 유통/소비
  { ticker: '139480', name: '이마트', sector: '유통' },
  { ticker: '023530', name: '롯데쇼핑', sector: '유통' },
  // 통신
  { ticker: '017670', name: 'SK텔레콤', sector: '통신' },
  { ticker: '030200', name: 'KT', sector: '통신' },
  // 로봇/AI
  { ticker: '277810', name: '레인보우로보틱스', sector: '로봇' },
  { ticker: '215380', name: '두산로보틱스', sector: '로봇' },
  // 원자력/수소
  { ticker: '034020', name: '두산에너빌리티', sector: '원자력' },
  { ticker: '336260', name: '두산퓨얼셀', sector: '수소' },
  { ticker: '426550', name: '이엔에프테크놀로지', sector: '수소' },
  // 전선/전력 인프라 (AI 데이터센터·초고압 전선 수요 급증)
  { ticker: '000500', name: '가온전선', sector: '전선' },
  { ticker: '001440', name: '대한전선', sector: '전선' },
  { ticker: '229640', name: 'LS전선아시아', sector: '전선' },
  { ticker: '006260', name: 'LS', sector: '전선' },
  // 레이저/광학 (의료·산업용 레이저 성장)
  { ticker: '161580', name: '필옵틱스', sector: '레이저' },
  { ticker: '452190', name: '한빛레이저', sector: '레이저' },
  { ticker: '065350', name: '신성델타테크', sector: '레이저' },
  // 전력기기/변압기 (전력망 투자 테마)
  { ticker: '267260', name: 'HD현대일렉트릭', sector: '전력기기' },
  { ticker: '298040', name: '효성중공업', sector: '전력기기' },
]

export const STOCK_MAP = Object.fromEntries(
  MAJOR_STOCKS.map(s => [s.ticker, s])
)
