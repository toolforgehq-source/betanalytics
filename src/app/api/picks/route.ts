/**
 * Public API endpoint for model picks and track record
 * 
 * Returns:
 * - Today's model picks (best bet, sport bets) — includes LIVE picks from cached best bet
 * - Historical track record (7d, 30d, 90d, all-time)
 * - Recent settled picks with results
 * 
 * IMPORTANT: The picks page now uses live computed picks from the same cached best bet
 * result that the AI chat uses. This ensures the Model Picks page shows the same
 * high-edge picks that the chat recommends, rather than relying solely on what the
 * cron job stored (which could be stale or incomplete).
 */

import { NextResponse } from 'next/server'
import { getTrackRecord, getAllPicks, type StoredPick } from '@/lib/pick-tracking'
import { getRecentRecommendations, calculateTrackingStats } from '@/lib/recommendation-tracking'
import { getCachedBestBet, type RankedBet } from '@/lib/bet-ranking'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Fetch all data in parallel — including the cached best bet result (same source as chat)
    const [trackRecord, rawAllPicks, rawRecentRecos, stats, cachedBestBet] = await Promise.all([
      getTrackRecord(),
      getAllPicks(),
      getRecentRecommendations(200),
      calculateTrackingStats(),
      getCachedBestBet()
    ])

    // Defensive: ensure arrays are actually arrays
    const allPicks = Array.isArray(rawAllPicks) ? rawAllPicks : []
    const recentRecos = Array.isArray(rawRecentRecos) ? rawRecentRecos : []

    // Separate picks into today's and historical
    // Use the "betting day" boundary: a day runs until 2 AM ET the next morning.
    // e.g., at 11:30 PM ET on March 3, todayStr = "3/3/2026".
    // At 1:30 AM ET on March 4, todayStr = "3/3/2026" (still showing March 3 picks).
    // At 2:30 AM ET on March 4, todayStr = "3/4/2026" (new day starts).
    const now = new Date()
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    const etNow = new Date(etStr)
    // If it's before 2 AM ET, treat it as the previous calendar day
    const bettingDay = new Date(etNow)
    if (etNow.getHours() < 2) {
      bettingDay.setDate(bettingDay.getDate() - 1)
    }
    const todayStr = bettingDay.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    
    const todaysPicks = allPicks.filter((p: StoredPick) => {
      const pickDate = new Date(p.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return pickDate === todayStr
    })

    const recentSettled = allPicks
      .filter((p: StoredPick) => p.status !== 'pending' && p.status !== 'cancelled')
      .sort((a: StoredPick, b: StoredPick) => new Date(b.gradedAt || b.createdAt).getTime() - new Date(a.gradedAt || a.createdAt).getTime())
      .slice(0, 50)

    // Get today's recommendations (pending or settled) from recommendation system
    const todaysRecommendations = recentRecos.filter(r => {
      const recoDate = new Date(r.commenceTime || r.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return recoDate === todayStr
    })

    // Get settled recommendations for history table
    const settledRecos = recentRecos
      .filter(r => r.status !== 'pending')
      .slice(0, 100)
    
    // Get ALL recent recommendations (including pending) for the full history view
    const allRecentRecos = recentRecos.slice(0, 100)

    // ============================================
    // LIVE PICKS from cached best bet result
    // ============================================
    // The cached best bet result contains ALL tiered picks from both strict (analyzeGame)
    // and relaxed (analyzeGameForSportQuery) analysis paths. This is the SAME data source
    // the AI chat uses, ensuring consistency between chat recommendations and Model Picks.
    //
    // We merge picks from both allRankedBets (strict) and allEloBets (relaxed),
    // deduplicating by gameId + team to avoid showing the same pick twice.
    // The relaxed path often finds high-edge picks that the strict path misses.
    let livePicks: RankedBet[] = []
    if (cachedBestBet) {
      const strictPicks = cachedBestBet.allRankedBets || []
      const eloPicks = cachedBestBet.allEloBets || []
      
      // Start with strict picks, then add elo picks not already covered
      const seenKeys = new Set(strictPicks.map((b: RankedBet) => `${b.gameId}:${b.team}:${b.betType}`))
      const additionalEloPicks = eloPicks.filter((b: RankedBet) => !seenKeys.has(`${b.gameId}:${b.team}:${b.betType}`))
      const allLivePicks = [...strictPicks, ...additionalEloPicks]
      
      // Filter to today's games (by commence time) using the betting day boundary.
      // Games from the current betting day (until 2 AM ET) are included.
      livePicks = allLivePicks.filter((bet: RankedBet) => {
        const betDate = new Date(bet.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        return betDate === todayStr
      })
      
      // Only include locks and strong plays — value spots are excluded from the public picks page
      livePicks = livePicks.filter((bet: RankedBet) => bet.confidenceTier === 'lock' || bet.confidenceTier === 'strong')
      
      // Sort: locks first, then strong, each sub-sorted by score desc
      const tierOrder: Record<string, number> = { lock: 0, strong: 1 }
      livePicks.sort((a: RankedBet, b: RankedBet) => {
        const tierDiff = (tierOrder[a.confidenceTier || 'strong'] ?? 1) - (tierOrder[b.confidenceTier || 'strong'] ?? 1)
        if (tierDiff !== 0) return tierDiff
        if (b.score !== a.score) return b.score - a.score
        return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
      })
      
      console.log(`[API /picks] Live picks from cache: ${livePicks.length} total (${livePicks.filter(p => p.confidenceTier === 'lock').length} locks, ${livePicks.filter(p => p.confidenceTier === 'strong').length} strong)`)
    } else {
      console.log('[API /picks] No cached best bet available — falling back to stored recommendations only')
    }

    return NextResponse.json({
      success: true,
      todaysPicks,
      todaysRecommendations,
      livePicks,  // NEW: Live computed picks from the same source as chat
      recentSettled,
      recentRecommendations: allRecentRecos,
      settledRecommendations: settledRecos,
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
      lastUpdated: cachedBestBet?.calculatedAt || new Date().toISOString()
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
