import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Public, separate snapshot branch. No Neon usage and no changes to /api/picks.
const SNAPSHOT_URL = 'https://raw.githubusercontent.com/toolforgehq-source/betanalytics/paper-football-data/latest.json'

export async function GET() {
  try {
    const response = await fetch(SNAPSHOT_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) {
      return NextResponse.json({
        success: false,
        status: 'NOT_INITIALIZED',
        message: 'Paper data has not been published yet. No paper results are available.',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid paper snapshot')
    const obj = data as { mode?: string; generatedAt?: string; records?: unknown[] }
    if (obj.mode !== 'PAPER_ONLY' || !Array.isArray(obj.records) || !obj.generatedAt ||
        !Number.isFinite(Date.parse(obj.generatedAt))) throw new Error('Invalid snapshot schema')
    const lag = Date.now() - Date.parse(obj.generatedAt)
    if (lag < -10 * 60_000 || lag > 8 * 3600_000) {
      return NextResponse.json({
        success: false,
        status: 'STALE',
        generatedAt: obj.generatedAt,
        message: 'Paper feed is stale. No current picks should be inferred from this snapshot.',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ success: true, ...obj }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('Failed to load paper football feed:', e)
    return NextResponse.json({
      success: false,
      status: 'UNAVAILABLE',
      message: 'Paper tracking temporarily unavailable.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
