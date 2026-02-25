/**
 * Public API endpoint for model picks and track record
 * 
 * Returns:
 * - Today's model picks (best bet, sport bets)
 * - Historical track record (7d, 30d, 90d, all-time)
 * - Recent settled picks with results
 */

import { NextResponse } from 'next/server'
import { getTrackRecord, getAllPicks, type StoredPick } from '@/lib/pick-tracking'
import { getRecentRecommendations, calculateTrackingStats } from '@/lib/recommendation-tracking'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Fetch all data in parallel
    const [trackRecord, allPicks, recentRecos, stats] = await Promise.all([
      getTrackRecord(),
      getAllPicks(),
      getRecentRecommendations(200),
      calculateTrackingStats()
    ])

    // Separate picks into today's and historical
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    
    const todaysPicks = allPicks.filter((p: StoredPick) => {
      const pickDate = new Date(p.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return pickDate === todayStr
    })

    const recentSettled = allPicks
      .filter((p: StoredPick) => p.status !== 'pending' && p.status !== 'cancelled')
      .sort((a: StoredPick, b: StoredPick) => new Date(b.gradedAt || b.createdAt).getTime() - new Date(a.gradedAt || a.createdAt).getTime())
      .slice(0, 50)

    // Also get recent recommendations with full details
    const recentRecoSettled = recentRecos
      .filter(r => r.status !== 'pending')
      .slice(0, 50)

    return NextResponse.json({
      success: true,
      todaysPicks,
      recentSettled,
      recentRecommendations: recentRecoSettled,
      trackRecord,
      stats: {
        totalBets: stats.totalBets,
        settledBets: stats.settledBets,
        pendingBets: stats.pendingBets,
        wins: stats.wins,
        losses: stats.losses,
        pushes: stats.pushes,
        winRate: stats.winRate,
        roi: stats.roi,
        totalProfit: stats.totalProfit,
        byBetType: stats.byBetType,
        bySport: stats.bySport,
        byConfidence: stats.byConfidence,
        calibration: stats.calibration,
      },
      lastUpdated: new Date().toISOString()
    })
  } catch (error) {
    console.error('[API /picks] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch picks data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
