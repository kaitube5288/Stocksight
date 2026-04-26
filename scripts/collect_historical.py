"""
한국 주식 일별 상위 5종목 수집 스크립트 (2010~현재)
실행: python scripts/collect_historical.py

주의: 최초 실행 시 수 시간 소요될 수 있습니다.
     .env.local 파일에 Supabase 키 설정 후 실행하세요.
"""

import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import FinanceDataReader as fdr
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

# 프로젝트 루트의 .env.local 로드
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ .env.local 파일에 Supabase 키가 없습니다.")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def get_kospi_tickers():
    """KOSPI 전체 종목 코드 조회"""
    df = fdr.StockListing("KOSPI")
    return df[["Code", "Name"]].dropna()


def get_kosdaq_tickers():
    """KOSDAQ 전체 종목 코드 조회"""
    df = fdr.StockListing("KOSDAQ")
    return df[["Code", "Name"]].dropna()


def get_daily_top_gainers(date_str: str, tickers_df: pd.DataFrame, top_n=5):
    """특정 날짜의 상위 상승 종목 N개 조회"""
    results = []

    for _, row in tickers_df.iterrows():
        code = str(row["Code"]).zfill(6)
        try:
            df = fdr.DataReader(code, date_str, date_str)
            if df.empty:
                continue
            row_data = df.iloc[0]

            open_price = float(row_data.get("Open", 0))
            close_price = float(row_data.get("Close", 0))
            volume = float(row_data.get("Volume", 0))

            if open_price <= 0 or volume < 10000:
                continue

            change_pct = (close_price - open_price) / open_price * 100
            results.append({
                "ticker": code,
                "name": row["Name"],
                "open": open_price,
                "close": close_price,
                "change_pct": change_pct,
                "volume": volume,
            })
        except Exception:
            continue

    if not results:
        return []

    df_result = pd.DataFrame(results)
    top = df_result.nlargest(top_n, "change_pct")
    return top.to_dict("records")


def collect_and_save(start_year=2020, end_year=None):
    """
    지정 기간 일별 상위 5종목 수집 및 Supabase 저장

    Args:
        start_year: 수집 시작 연도 (기본 2020, 전체 원하면 2010)
        end_year: 수집 종료 연도 (기본 현재 연도)
    """
    if end_year is None:
        end_year = datetime.now().year

    print(f"📊 {start_year}년 ~ {end_year}년 데이터 수집 시작")

    tickers = pd.concat([get_kospi_tickers(), get_kosdaq_tickers()]).drop_duplicates("Code")
    print(f"✅ 전체 종목 수: {len(tickers)}")

    # 한국 거래일 기준으로 날짜 생성
    bdays = pd.bdate_range(
        start=f"{start_year}-01-01",
        end=f"{end_year}-12-31",
        freq="C",
        holidays=None,
    )

    print(f"📅 총 거래일: {len(bdays)}일")

    for trade_date in tqdm(bdays, desc="거래일 처리"):
        date_str = trade_date.strftime("%Y-%m-%d")

        # 이미 수집된 날짜 스킵
        existing = (
            supabase.table("historical_patterns")
            .select("trade_date")
            .eq("trade_date", date_str)
            .execute()
        )
        if existing.data:
            continue

        top_gainers = get_daily_top_gainers(date_str, tickers)
        if not top_gainers:
            continue

        try:
            supabase.table("historical_patterns").insert({
                "trade_date": date_str,
                "top_gainers": top_gainers,
                "market_events": None,
                "news_summary": None,
            }).execute()
        except Exception as e:
            print(f"⚠ {date_str} 저장 실패: {e}")

        time.sleep(0.1)  # API 부하 방지

    print("✅ 수집 완료")


def collect_major_events():
    """주요 역사적 사건 수동 태깅 데이터 입력"""
    events = [
        # 코로나 관련
        {"event_date": "2020-03-19", "event_type": "geopolitical", "description": "코로나19 팬데믹 선언, KOSPI 역대 최대 낙폭", "affected_sectors": ["전체"], "affected_tickers": [], "impact_direction": "negative", "impact_magnitude": -8.39, "source": "manual"},
        {"event_date": "2021-01-11", "event_type": "sector", "description": "2차전지 테마 급등 (LG에너지솔루션 IPO 기대)", "affected_sectors": ["2차전지", "전기차"], "affected_tickers": ["373220", "051910", "096770"], "impact_direction": "positive", "impact_magnitude": 12.5, "source": "manual"},

        # 금리 관련
        {"event_date": "2022-06-16", "event_type": "rate_change", "description": "미 연준 자이언트스텝(0.75%p 금리인상), 한국 증시 급락", "affected_sectors": ["성장주", "바이오", "IT"], "affected_tickers": [], "impact_direction": "negative", "impact_magnitude": -3.5, "source": "manual"},
        {"event_date": "2023-11-02", "event_type": "rate_change", "description": "미 연준 금리 동결, 증시 반등", "affected_sectors": ["전체"], "affected_tickers": [], "impact_direction": "positive", "impact_magnitude": 2.1, "source": "manual"},

        # 반도체
        {"event_date": "2023-06-19", "event_type": "sector", "description": "AI 반도체 수요 급증 기대, 삼성전자·SK하이닉스 급등", "affected_sectors": ["반도체", "AI"], "affected_tickers": ["005930", "000660"], "impact_direction": "positive", "impact_magnitude": 6.8, "source": "manual"},
        {"event_date": "2024-02-05", "event_type": "sector", "description": "HBM 수요 급증 기대, SK하이닉스 신고가", "affected_sectors": ["반도체", "HBM"], "affected_tickers": ["000660", "005930"], "impact_direction": "positive", "impact_magnitude": 8.2, "source": "manual"},

        # 지정학
        {"event_date": "2022-02-24", "event_type": "geopolitical", "description": "러시아 우크라이나 침공, 방산·에너지 급등", "affected_sectors": ["방산", "에너지", "원자재"], "affected_tickers": ["047810", "012450"], "impact_direction": "mixed", "impact_magnitude": 5.3, "source": "manual"},
        {"event_date": "2023-10-08", "event_type": "geopolitical", "description": "이스라엘-하마스 전쟁 발발, 방산주 급등", "affected_sectors": ["방산"], "affected_tickers": ["047810", "012450", "000050"], "impact_direction": "positive", "impact_magnitude": 9.1, "source": "manual"},

        # 정책
        {"event_date": "2024-01-02", "event_type": "sector", "description": "밸류업 프로그램 발표, 저PBR 금융주 급등", "affected_sectors": ["금융", "은행", "보험"], "affected_tickers": ["105560", "055550", "032830"], "impact_direction": "positive", "impact_magnitude": 7.4, "source": "manual"},
        {"event_date": "2020-07-14", "event_type": "sector", "description": "한국판 뉴딜 발표, 수소·태양광 테마 급등", "affected_sectors": ["수소", "신재생에너지"], "affected_tickers": ["005440", "010600"], "impact_direction": "positive", "impact_magnitude": 11.2, "source": "manual"},
    ]

    for event in events:
        try:
            supabase.table("market_events").upsert(event, on_conflict="event_date,description").execute()
        except Exception as e:
            print(f"⚠ 이벤트 저장 실패: {e}")

    print(f"✅ {len(events)}개 주요 사건 저장 완료")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="StockSight 히스토리컬 데이터 수집")
    parser.add_argument("--start", type=int, default=2020, help="수집 시작 연도 (기본: 2020)")
    parser.add_argument("--end", type=int, default=None, help="수집 종료 연도 (기본: 현재)")
    parser.add_argument("--events-only", action="store_true", help="주요 사건만 저장")
    args = parser.parse_args()

    collect_major_events()
    if not args.events_only:
        collect_and_save(start_year=args.start, end_year=args.end)
