import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'StockSight — AI 주식 추천',
  description: '뉴스·공시·역사적 패턴을 분석한 한국 주식 AI 추천 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-animated min-h-screen">
        {children}
      </body>
    </html>
  )
}
