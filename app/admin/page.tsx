'use client'

import { useState, useEffect } from 'react'

const YEAR_OPTIONS = [
  { year: 2015, label: '2015', time: '~3분', once: true },
  { year: 2018, label: '2018', time: '~2분', once: true },
  { year: 2020, label: '2020', time: '~1.5분', once: true },
  { year: 2022, label: '2022', time: '~1분', once: true },
  { year: 2023, label: '2023', time: '~45초', once: true },
  { year: 2024, label: '2024', time: '~30초', once: true },
  { year: 2025, label: '2025', time: '~20초', once: true },
  { year: 2026, label: '2026', time: '~10초', once: false },
]

export default function AdminPage() {
  const [collecting, setCollecting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [collectLog, setCollectLog] = useState<string[]>([])
  const [analyzeLog, setAnalyzeLog] = useState<string[]>([])
  const [startYear, setStartYear] = useState(2020)
  const [chatIdResult, setChatIdResult] = useState('')
  const [collectedYears, setCollectedYears] = useState<number[]>([])
  const [last2026Update, setLast2026Update] = useState<string | null>(null)
  const [lastHistCollect, setLastHistCollect] = useState<string | null>(null)

  const loadCollectedYears = async () => {
    fetch('/api/collect-history')
      .then(r => r.json())
      .then(d => {
        setCollectedYears(d.collectedYears ?? [])
        setLast2026Update(d.last2026Update ?? null)
        setLastHistCollect(d.lastHistCollect ?? null)
      })
      .catch(() => {})
  }

  useEffect(() => { loadCollectedYears() }, [])

  const isCollected = (year: number) => collectedYears.includes(year)

  const runCollection = async () => {
    setCollecting(true)
    setCollectLog([`[${now()}] 수집 시작... (${startYear}년 ~ 현재, 약 2~5분 소요)`])
    try {
      const res = await fetch('/api/collect-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startYear }),
      })
      const data = await res.json()
      if (data.success) {
        setCollectLog(prev => [...prev, `[${now()}] ✅ ${data.message}`, `[${now()}] 💡 추천 종목을 갱신하려면 ② 일일 분석을 실행하세요`])
        await loadCollectedYears()
      } else {
        setCollectLog(prev => [...prev, `[${now()}] ❌ 오류: ${data.error}`])
      }
    } catch (e) {
      setCollectLog(prev => [...prev, `[${now()}] ❌ ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setCollecting(false)
    }
  }

  const runDailyAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeLog([`[${now()}] GitHub Actions에 분석 실행 요청 중...`])
    try {
      // Vercel 60초 제한 우회: GitHub Actions workflow_dispatch로 트리거
      const res = await fetch('/api/trigger-daily', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setAnalyzeLog(prev => [
          ...prev,
          `[${now()}] ✅ 실행 시작됨 — GitHub Actions에서 4~5분간 실행됩니다`,
          `[${now()}] 📱 완료 시 텔레그램 알림 도착 예정`,
          `[${now()}] 🔗 진행 상황: https://github.com/kaitube5288/Stocksight/actions`,
        ])
      } else {
        setAnalyzeLog(prev => [
          ...prev,
          `[${now()}] ❌ ${data.error}`,
          ...(last2026Update ? [`[${now()}] 📦 마지막 수집 데이터: ${formatKST(last2026Update)}`] : []),
        ])
      }
    } catch (e) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? '5분 초과로 타임아웃 — 서버에서는 계속 실행 중일 수 있습니다'
        : e instanceof Error ? e.message : String(e)
      setAnalyzeLog(prev => [
        ...prev,
        `[${now()}] ❌ ${msg}`,
        ...(last2026Update ? [`[${now()}] 📦 마지막 수집 데이터: ${formatKST(last2026Update)}`] : []),
      ])
    } finally {
      setAnalyzing(false)
    }
  }

  const fetchChatId = async () => {
    setChatIdResult('조회 중...')
    const res = await fetch('/api/telegram/chatid')
    const data = await res.json()
    if (data.success) {
      setChatIdResult(`✅ Chat ID: ${data.chatId}  ← .env.local에 TELEGRAM_CHAT_ID로 입력`)
    } else {
      setChatIdResult(`❌ ${data.error}`)
    }
  }

  return (
    <main className="min-h-screen px-6 py-8 max-w-3xl mx-auto" style={{ background: '#050505', color: 'rgba(255,255,255,0.85)' }}>
      <div className="mb-8">
        <h1 className="text-xl font-light tracking-widest mono mb-1" style={{ letterSpacing: '0.2em' }}>
          STOCKSIGHT ADMIN
        </h1>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
          데이터 수집 · 일일 분석 · 텔레그램 설정
        </p>
      </div>

      {/* 섹션 1: 히스토리컬 수집 */}
      <Section title="① 히스토리컬 데이터 수집">
        <div className="mb-3">
          <label className="text-xs mb-2 block" style={{ color: 'rgba(255,255,255,0.35)' }}>
            시작 연도 선택
          </label>
          <div className="flex flex-wrap gap-2 mb-4">
            {YEAR_OPTIONS.map(({ year, label, time, once }) => {
              const collected = isCollected(year)
              const selected = startYear === year
              return (
                <button
                  key={year}
                  onClick={() => !collecting && setStartYear(year)}
                  disabled={collecting}
                  className="relative px-3 py-2 rounded-xl text-xs mono transition-all"
                  style={{
                    background: selected
                      ? 'rgba(255,255,255,0.12)'
                      : 'rgba(255,255,255,0.03)',
                    border: selected
                      ? '1px solid rgba(255,255,255,0.3)'
                      : collected
                      ? '1px solid rgba(100,255,150,0.25)'
                      : '1px solid rgba(255,255,255,0.08)',
                    color: selected
                      ? 'rgba(255,255,255,0.9)'
                      : collected
                      ? 'rgba(150,255,180,0.8)'
                      : 'rgba(255,255,255,0.45)',
                    cursor: collecting ? 'not-allowed' : 'pointer',
                    minWidth: '72px',
                  }}
                >
                  <div className="font-medium">{label}년</div>
                  <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '1px' }}>
                    {collected && once ? '✓ 완료' : time}
                  </div>
                  {!once && (
                    <div style={{ fontSize: '9px', color: 'rgba(255,200,100,0.7)', marginTop: '1px' }}>
                      갱신 권장
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 text-xs space-y-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {collectedYears.length > 0 ? (
              <>
                <div>{`수집 완료: ${collectedYears.filter(y => y !== 2026).join(', ')}년`}</div>
                {last2026Update ? (
                  <div style={{ color: 'rgba(255,200,100,0.6)' }}>
                    {`2026년 마지막 분석 성공: ${formatKST(last2026Update)}`}
                  </div>
                ) : lastHistCollect ? (
                  <div style={{ color: 'rgba(255,200,100,0.45)' }}>
                    {`2026년 마지막 수집: ${formatKST(lastHistCollect)}`}
                  </div>
                ) : collectedYears.includes(2026) ? (
                  <div style={{ color: 'rgba(100,255,150,0.5)' }}>2026년 수집 완료</div>
                ) : null}
              </>
            ) : '수집된 데이터 없음'}
          </div>
          <Btn onClick={runCollection} loading={collecting} label={`▶ ${startYear}년부터 수집`} />
        </div>

        <InfoBox lines={[
          '주요 KOSPI/KOSDAQ 52개 종목 × 선택 기간 히스토리',
          '✓ 완료 표시된 연도는 재수집 불필요 (2026년만 주기적 갱신)',
          '날짜별 상위 5 상승 종목 → historical_patterns 저장',
          'Gemini/Google API 사용 없음 (Yahoo Finance만 사용)',
        ]} />
        <Log entries={collectLog} />
      </Section>

      {/* 섹션 2: 일일 분석 수동 실행 */}
      <Section title="② 일일 분석 수동 실행 (매일 08:40 자동)">
        <div className="flex items-center gap-4 mb-4">
          <p className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            전날 09:00 ~ 당일 08:40 뉴스 분석 → 추천 3종목 생성 → 텔레그램 알림
          </p>
          <Btn onClick={runDailyAnalysis} loading={analyzing} label="▶ 지금 실행" />
        </div>
        <Log entries={analyzeLog} />
      </Section>

      {/* 섹션 3: 텔레그램 설정 */}
      <Section title="③ 텔레그램 Chat ID 조회">
        <div className="text-xs space-y-2 mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <p>1. 텔레그램에서 내 봇에게 아무 메시지 전송</p>
          <p>2. 아래 버튼 클릭 → Chat ID 확인</p>
          <p>3. .env.local 의 TELEGRAM_CHAT_ID 에 입력</p>
        </div>
        <div className="flex items-center gap-4">
          <Btn onClick={fetchChatId} loading={false} label="🔍 Chat ID 조회" />
        </div>
        {chatIdResult && (
          <div className="mt-3 mono text-xs p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', color: chatIdResult.startsWith('✅') ? 'rgba(180,255,180,0.8)' : 'rgba(255,150,150,0.8)' }}>
            {chatIdResult}
          </div>
        )}
        <div className="mt-4 text-xs p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' }}>
          <p className="mb-1">.env.local 설정:</p>
          <p className="mono">TELEGRAM_BOT_TOKEN=봇토큰</p>
          <p className="mono">TELEGRAM_CHAT_ID=채팅ID</p>
        </div>
      </Section>

      <a href="/" className="text-xs mt-6 block" style={{ color: 'rgba(255,255,255,0.2)' }}>
        ← 메인으로
      </a>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <h2 className="text-sm font-medium mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>{title}</h2>
      {children}
    </div>
  )
}

function Btn({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="px-4 py-2 rounded-xl text-sm font-medium transition-all shrink-0"
      style={{
        background: loading ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: loading ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.85)',
        cursor: loading ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? '⏳ 처리 중...' : label}
    </button>
  )
}

function InfoBox({ lines }: { lines: string[] }) {
  return (
    <div className="text-xs rounded-xl p-3 mb-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.28)' }}>
      {lines.map((l, i) => <p key={i}>• {l}</p>)}
    </div>
  )
}

function Log({ entries }: { entries: string[] }) {
  if (!entries.length) return null
  return (
    <div className="rounded-xl p-3 mono text-xs space-y-0.5 mt-2" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
      {entries.map((line, i) => (
        <div key={i} style={{ color: line.includes('✅') ? 'rgba(180,255,180,0.8)' : line.includes('❌') ? 'rgba(255,150,150,0.8)' : 'rgba(255,255,255,0.4)' }}>
          {line}
        </div>
      ))}
    </div>
  )
}

function now() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatKST(iso: string): string {
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = kst.getUTCFullYear()
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const min = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min} (KST)`
}
