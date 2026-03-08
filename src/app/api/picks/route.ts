/**
 * Public API endpoint for model picks and track record
 * 
 * Returns:
 * - Today's model picks (best bet, sport bets) — includes LIVE picks from cached best bet
 * - Historical track record (7d, 30d, 90d, all-time)
 * - Recent settled picks with results
 * 
 * CRITICAL: This API is the SINGLE SOURCE OF TRUTH for the Model Picks page display.
 * It ALWAYS enforces dedup + tier caps (max 1 Lock, max 3 Strong) regardless of whether
 * data comes from the live cache or stored recommendations. This prevents overpopulation
 * caused by stale caches, recommendation accumulation across cron runs, or dedup mismatches
 * between strict/elo analysis paths.
 * 
 * The dedupeAndEnforceCaps() function handles both data source schemas:
 * - Live cache: has `team`, `edge` fields directly
 * - Stored recommendations: has `selection` (team extracted), `odds` (edge computed)
 */

import { NextResponse } from 'next/server'
import { getTrackRecord, getAllPicks, type StoredPick } from '@/lib/pick-tracking'
import { getRecentRecommendations, calculateTrackingStats, enforceDailyCaps } from '@/lib/recommendation-tracking'
import { getCachedBestBet, type RankedBet } from '@/lib/bet-ranking'
import { dedupeAndEnforceCaps, type PickLike } from '@/lib/enforce-picks'

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

    // Get today's recommendations (pending or locked-in) from recommendation system.
    // Exclude voided recommendations — these were superseded before game start and shouldn't display.
    const todaysRecommendations = recentRecos.filter(r => {
      if (r.status === 'void') return false // Superseded picks don't show on the page
      const recoDate = new Date(r.commenceTime || r.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return recoDate === todayStr
    })

    // Get settled recommendations for history table
    const settledRecos = recentRecos
      .filter(r => r.status !== 'pending')
      .slice(0, 100)
    
    // Get ALL recent recommendations (including pending) for the full history view.
    // CRITICAL: Apply daily caps (1 Lock + 3 Strong per betting day) server-side
    // so the Performance page receives already-capped data. The client also caps
    // as a safety net, but the server should be the source of truth.
    const bestBetRecos = recentRecos.filter(r =>
      r.source === 'best_bet' &&
      (r.confidenceTier === 'lock' || r.confidenceTier === 'strong')
    )
    const cappedRecos = enforceDailyCaps(bestBetRecos)
    // Include non-best_bet recos and non-lock/strong recos unchanged (they're filtered out on client)
    const nonTrackedRecos = recentRecos.filter(r =>
      r.source !== 'best_bet' ||
      (r.confidenceTier !== 'lock' && r.confidenceTier !== 'strong')
    )
    const allRecentRecos = [...cappedRecos, ...nonTrackedRecos]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)

    // ============================================
    // LIVE PICKS from cached best bet result
    // ============================================
    // The cached best bet result contains ALL tiered picks from both strict (analyzeGame)
    // and relaxed (analyzeGameForSportQuery) analysis paths.
    let livePicks: PickLike[] = []
    if (cachedBestBet) {
      const strictPicks = cachedBestBet.allRankedBets || []
      const eloPicks = cachedBestBet.allEloBets || []
      
      // Start with strict picks, then add elo picks not already covered
      const seenKeys = new Set(strictPicks.map((b: RankedBet) => `${b.gameId}:${b.team}:${b.betType}`))
      const additionalEloPicks = eloPicks.filter((b: RankedBet) => !seenKeys.has(`${b.gameId}:${b.team}:${b.betType}`))
      const allLivePicks = [...strictPicks, ...additionalEloPicks] as PickLike[]
      
      // Filter to today's games
      const todayLivePicks = allLivePicks.filter((bet) => {
        if (!bet.commenceTime) return false
        const betDate = new Date(bet.commenceTime as string).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        return betDate === todayStr
      })
      
      livePicks = todayLivePicks
      console.log(`[API /picks] Live picks from cache: ${livePicks.length} candidates`)
    } else {
      console.log('[API /picks] No cached best bet available — falling back to stored recommendations')
    }

    // ============================================
    // CRITICAL: Merge ALL data sources and enforce dedup + tier caps
    // ============================================
    // Combine live cache picks AND stored recommendations, then deduplicate.
    // This ensures we always have the best picks regardless of which source they came from.
    // The dedup function handles both schemas (live cache has `team`/`edge`, stored recos have `selection`/`odds`).
    // If one source is empty, the other still provides picks.
    const rawPicks: PickLike[] = [...livePicks, ...todaysRecommendations]
    console.log(`[API /picks] Merging ${livePicks.length} live picks + ${todaysRecommendations.length} stored recos = ${rawPicks.length} raw picks`)
    const enforcedPicks = dedupeAndEnforceCaps(rawPicks)
    
    // Mark picks whose games have already started so the frontend can show appropriate status.
    // We keep them visible (users may want to see what was recommended) but flag them.
    const nowMs = Date.now()
    for (const pick of enforcedPicks) {
      if (pick.commenceTime) {
        const gameStart = new Date(pick.commenceTime as string).getTime()
        if (nowMs >= gameStart) {
          pick.gameStarted = true
        }
      }
    }
    
    const lockCount = enforcedPicks.filter(p => p.confidenceTier === 'lock').length
    const strongCount = enforcedPicks.filter(p => p.confidenceTier === 'strong').length
    const startedCount = enforcedPicks.filter(p => p.gameStarted).length
    console.log(`[API /picks] Final enforced picks: ${enforcedPicks.length} total (${lockCount} locks, ${strongCount} strong, ${startedCount} already started)`)

    return NextResponse.json({
      success: true,
      todaysPicks,
      todaysRecommendations,
      livePicks: enforcedPicks,  // ALWAYS deduped + tier-capped
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
