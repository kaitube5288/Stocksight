'use client'

import { useState } from 'react'

export default function AdminPage() {
  const [collecting, setCollecting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [collectLog, setCollectLog] = useState<string[]>([])
  const [analyzeLog, setAnalyzeLog] = useState<string[]>([])
  const [startYear, setStartYear] = useState(2020)
  const [chatIdResult, setChatIdResult] = useState('')

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
      setCollectLog(prev => [
        ...prev,
        data.success
          ? `[${now()}] ✅ ${data.message}`
          : `[${now()}] ❌ 오류: ${data.error}`,
      ])
    } catch (e) {
      setCollectLog(prev => [...prev, `[${now()}] ❌ ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setCollecting(false)
    }
  }

  const runDailyAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeLog([`[${now()}] 일일 분석 실행 중... (30~60초 소요)`])
    try {
      const res = await fetch('/api/cron/daily', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setAnalyzeLog(prev => [
          ...prev,
          `[${now()}] ✅ 완료 — 뉴스 ${data.newsCount}건 분석`,
          `[${now()}] 텔레그램 전송: ${data.telegramSent ? '✅' : '⚠️ 토큰 미설정'}`,
        ])
      } else {
        setAnalyzeLog(prev => [...prev, `[${now()}] ❌ ${data.error}`])
      }
    } catch (e) {
      setAnalyzeLog(prev => [...prev, `[${now()}] ❌ ${e instanceof Error ? e.message : String(e)}`])
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
        <div className="flex items-center gap-4 mb-4">
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.35)' }}>시작 연도</label>
            <select
              value={startYear}
              onChange={e => setStartYear(Number(e.target.value))}
              disabled={collecting}
              className="mono text-sm px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}
            >
              <option value={2015}>2015년 (~3분)</option>
              <option value={2018}>2018년 (~2분)</option>
              <option value={2020}>2020년 (~1.5분)</option>
              <option value={2022}>2022년 (~1분)</option>
              <option value={2023}>2023년 (~45초)</option>
              <option value={2024}>2024년 (~30초)</option>
              <option value={2025}>2025년 (~20초)</option>
              <option value={2026}>2026년 (~10초)</option>
            </select>
          </div>
          <div className="flex-1" />
          <Btn onClick={runCollection} loading={collecting} label="▶ 수집 시작" />
        </div>
        <InfoBox lines={[
          '주요 KOSPI/KOSDAQ 52개 종목 × 선택 기간 히스토리',
          '날짜별 상위 5 상승 종목 → historical_patterns 저장',
          '주요 역사적 사건 12건 → market_events 저장',
          'Gemini/Google API 사용 없음 (Yahoo Finance만 사용)',
        ]} />
        <Log entries={collectLog} />
      </Section>

      {/* 섹션 2: 일일 분석 수동 실행 */}
      <Section title="② 일일 분석 수동 실행 (매일 08:40 자동)">
        <div className="flex items-center gap-4 mb-4">
          <p className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            전날 09:00 ~ 당일 08:40 뉴스 분석 → 추천 5종목 생성 → 텔레그램 알림
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
