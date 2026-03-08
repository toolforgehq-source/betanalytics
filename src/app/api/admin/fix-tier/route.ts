import { NextResponse } from 'next/server'
import { getRecommendation, updateRecommendation } from '@/lib/recommendation-tracking'

/**
 * One-time admin endpoint to swap confidence tiers between two recommendations.
 * Protected by CRON_SECRET.
 * 
 * Usage: POST /api/admin/fix-tier
 * Body: { "lockId": "reco_xxx", "strongId": "reco_yyy" }
 * 
 * This swaps lockId's tier to "lock" and strongId's tier to "strong".
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { lockId, strongId } = await request.json()

    if (!lockId || !strongId) {
      return NextResponse.json({ error: 'lockId and strongId required' }, { status: 400 })
    }

    // Get both recommendations
    const lockReco = await getRecommendation(lockId)
    const strongReco = await getRecommendation(strongId)

    if (!lockReco) return NextResponse.json({ error: `Not found: ${lockId}` }, { status: 404 })
    if (!strongReco) return NextResponse.json({ error: `Not found: ${strongId}` }, { status: 404 })

    console.log(`[Admin] Swapping tiers: ${lockId} (${lockReco.confidenceTier} -> lock), ${strongId} (${strongReco.confidenceTier} -> strong)`)

    // Set the new lock pick
    const lockResult = await updateRecommendation(lockId, { confidenceTier: 'lock' })
    // Set the old lock to strong
    const strongResult = await updateRecommendation(strongId, { confidenceTier: 'strong' })

    return NextResponse.json({
      success: true,
      changes: {
        [lockId]: { from: lockReco.confidenceTier, to: 'lock', selection: lockReco.selection, updated: lockResult },
        [strongId]: { from: strongReco.confidenceTier, to: 'strong', selection: strongReco.selection, updated: strongResult }
      }
    })
  } catch (error) {
    console.error('[Admin] fix-tier error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
