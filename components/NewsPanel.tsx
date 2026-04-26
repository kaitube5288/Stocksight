'use client'

import { useEffect, useState, useCallback } from 'react'
import { NewsItem } from '@/lib/supabase'

export default function NewsPanel() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [fetchedAt, setFetchedAt] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [nextRefresh, setNextRefresh] = useState(30 * 60)

  const fetchNews = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/news')
      const data = await res.json()
      if (data.news) {
        setNews(data.news)
        setFetchedAt(data.fetchedAt)
        setNextRefresh(30 * 60)
      }
    } catch {
      // 실패 시 무시
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNews()

    // 30분마다 자동 갱신
    const interval = setInterval(fetchNews, 30 * 60 * 1000)

    // 카운트다운
    const countdown = setInterval(() => {
      setNextRefresh(prev => (prev <= 1 ? 30 * 60 : prev - 1))
    }, 1000)

    return () => {
      clearInterval(interval)
      clearInterval(countdown)
    }
  }, [fetchNews])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="glass glow-white rounded-2xl p-5 flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="pulse-dot" />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            실시간 경제 뉴스
          </span>
        </div>
        <div className="flex items-center gap-3">
          {fetchedAt && (
            <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatDate(fetchedAt)} 수집
            </span>
          )}
          <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
            갱신 {formatTime(nextRefresh)}
          </span>
          <button
            onClick={fetchNews}
            disabled={loading}
            className="badge glass-hover cursor-pointer transition-all"
            style={{ color: loading ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          >
            {loading ? '수집중...' : '새로고침'}
          </button>
        </div>
      </div>

      <hr className="separator" />

      {/* 뉴스 목록 */}
      <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
        {loading && !news.length ? (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            <div className="mono text-xs">뉴스 수집 중...</div>
          </div>
        ) : news.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            <div className="mono text-xs">뉴스 없음</div>
          </div>
        ) : (
          news.map((item, i) => (
            <a
              key={i}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 rounded-xl glass-hover transition-all duration-200 group"
              style={{ textDecoration: 'none' }}
            >
              <span className="mono text-xs mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs leading-relaxed group-hover:text-white transition-colors duration-200 line-clamp-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {item.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {item.ticker && (
                    <span className="badge text-[10px]">{item.ticker}</span>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {item.source}
                  </span>
                  {item.pubDate && (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      · {item.pubDate.slice(0, 16)}
                    </span>
                  )}
                </div>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  )
}
