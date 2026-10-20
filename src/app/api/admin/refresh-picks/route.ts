import { NextResponse } from 'next/server'
import { kvDel, kvDelPattern } from '@/lib/pg-kv'

/**
 * Admin endpoint to force-refresh the Model Picks page.
 * 
 * Clears:
 * 1. Today's pinned picks (frozen tier assignments stuck in Redis)
 * 2. The cached best bet result (forces next fetch-odds cron to recompute from scratch)
 * 
 * After calling this, the next page load will show fresh picks from the model,
 * and the next hourly fetch-odds cron will rebuild the cache without stale data.
 * 
 * Protected by CRON_SECRET.
 * 
 * Usage: POST /api/admin/refresh-picks
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const cleared: string[] = []

    // 1. Clear all pinned picks (any version prefix)
    const pinnedDeleted = await kvDelPattern('betanalytics:pinned-picks%')
    cleared.push(`pinned picks (${pinnedDeleted} keys)`)

    // 2. Clear the cached best bet result
    await kvDel('betanalytics:best-bet')
    cleared.push('best bet cache')

    // 3. Clear the cached best prop result
    await kvDel('betanalytics:best-prop')
    cleared.push('best prop cache')

    console.log(`[Admin] refresh-picks: cleared ${cleared.join(', ')}`)

    return NextResponse.json({
      success: true,
      cleared,
      message: 'Picks cache cleared. The Model Picks page will show fresh data on next load, and the next fetch-odds cron will rebuild the cache.'
    })
  } catch (error) {
    console.error('[Admin] refresh-picks error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
