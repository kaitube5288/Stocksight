import { NextResponse } from 'next/server'

// GitHub Actions workflow_dispatch를 통해 daily-analysis workflow 트리거
// Vercel 60초 타임아웃 우회 (GitHub Actions는 15분 제한)
// 텔레그램 전송 포함 (cron-job.org TEST RUN과 동일 동작)
export async function POST() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다' }, { status: 500 })
  }

  const owner = 'kaitube5288'
  const repo = 'Stocksight'
  const workflow = 'daily-analysis.yml'

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { force_run: 'true' } }),
      }
    )

    if (!res.ok) {
      const errorText = await res.text()
      return NextResponse.json(
        { error: `GitHub API 오류 ${res.status}: ${errorText.slice(0, 200)}` },
        { status: 500 }
      )
    }

    // GitHub API는 성공 시 204 No Content 반환 (본문 없음)
    return NextResponse.json({
      success: true,
      message: '분석 실행 시작됨. 4~5분 후 텔레그램 알림 도착 예정',
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
