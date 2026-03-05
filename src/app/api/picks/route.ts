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
import { getRecentRecommendations, calculateTrackingStats } from '@/lib/recommendation-tracking'
import { getCachedBestBet, type RankedBet } from '@/lib/bet-ranking'

export const dynamic = 'force-dynamic'

// These caps MUST match the values in bet-ranking.ts computeBestBets()
const MAX_LOCKS = 1
const MAX_STRONG = 3

/**
 * Deduplicate and enforce tier caps on a list of picks.
 * This is the final gate before displaying picks to the user.
 * 
 * Steps:
 * 1. Deduplicate by gameId:team:betType (prefer strict/higher score version)
 * 2. Filter to only picks with qualifying probability + edge
 * 3. Sort by score descending
 * 4. Re-tier: highest-scored qualifying bet = Lock, next N = Strong, rest = value
 * 5. Return only Lock + Strong picks
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PickLike = Record<string, any>

/**
 * Compute edge (probability - implied probability) from American odds.
 * Stored recommendations have `probability` and `odds` but NOT `edge`,
 * so we must compute it here.
 */
function computeEdge(pick: PickLike): number {
  // If edge is already present (from live cache / RankedBet), use it
  if (typeof pick.edge === 'number' && pick.edge !== 0) return pick.edge
  
  // Compute from probability and odds
  const prob = (pick.eloProbability || pick.probability || pick.consensusProbability || 0) as number
  const odds = (pick.odds || pick.bestPrice || 0) as number
  
  if (prob <= 0 || odds === 0) return 0
  
  // Convert American odds to implied probability
  let impliedProb: number
  if (odds > 0) {
    impliedProb = (100 / (odds + 100)) * 100
  } else {
    impliedProb = (Math.abs(odds) / (Math.abs(odds) + 100)) * 100
  }
  
  return prob - impliedProb
}

function dedupeAndEnforceCaps(picks: PickLike[]): PickLike[] {
  // Step 1: Deduplicate by gameId:team:betType
  // For duplicates (same game/team/betType from different analysis paths or cron runs),
  // keep the version with the higher score. Exclude parlays (multi-game gameIds with _).
  const dedupMap = new Map<string, PickLike>()
  for (const pick of picks) {
    // Stored recommendations use `selection` (e.g. "Northwestern Wildcats +11.5") instead of `team`.
    // Extract team name from selection by stripping the line/ML suffix.
    const team = pick.team || (pick.selection ? String(pick.selection).replace(/\s+[+-]?\d[\d.]*$/, '').replace(/\s+ML$/i, '').trim() : '')
    if (!pick.gameId || !team || !pick.betType) continue
    // Skip parlays (gameId contains underscore for multi-game combos)
    if (String(pick.gameId).includes('_')) continue
    // Skip prop bets (tracked separately)
    if (pick.betType === 'prop') continue
    
    // Normalize: attach team to the pick so downstream code can use it
    if (!pick.team) pick.team = team
    
    const key = `${pick.gameId}:${team}:${pick.betType}`
    const existing = dedupMap.get(key)
    if (!existing || (pick.score || 0) > (existing.score || 0)) {
      dedupMap.set(key, pick)
    }
  }
  
  // Step 2: Sort by score descending
  const sorted = Array.from(dedupMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
  
  // Step 3: Re-tier with fresh counters enforcing caps
  let lockCount = 0
  let strongCount = 0
  
  for (const pick of sorted) {
    const prob = (pick.eloProbability || pick.probability || pick.consensusProbability || 0) as number
    const edge = computeEdge(pick)
    
    // Qualifying criteria: 58%+ probability, 4%+ edge (same as bet-ranking.ts)
    const qualifies = prob >= 58 && edge >= 4
    
    if (qualifies && lockCount < MAX_LOCKS) {
      pick.confidenceTier = 'lock'
      lockCount++
    } else if (qualifies && strongCount < MAX_STRONG) {
      pick.confidenceTier = 'strong'
      strongCount++
    } else {
      pick.confidenceTier = 'value'
    }
  }
  
  // Step 4: Return only Lock + Strong picks, sorted: locks first, then strong, by score
  return sorted.filter(p => p.confidenceTier === 'lock' || p.confidenceTier === 'strong')
}

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
    // CRITICAL: Choose data source and ALWAYS enforce dedup + tier caps
    // ============================================
    // Whether data comes from live cache or stored recommendations, we MUST
    // deduplicate and enforce tier caps (max 1 Lock, max 3 Strong).
    // This prevents overpopulation from: stale caches, accumulated cron recommendations,
    // or dedup mismatches between strict/elo paths.
    const rawPicks: PickLike[] = livePicks.length > 0 ? livePicks : todaysRecommendations
    const enforcedPicks = dedupeAndEnforceCaps(rawPicks)
    
    const lockCount = enforcedPicks.filter(p => p.confidenceTier === 'lock').length
    const strongCount = enforcedPicks.filter(p => p.confidenceTier === 'strong').length
    console.log(`[API /picks] Final enforced picks: ${enforcedPicks.length} total (${lockCount} locks, ${strongCount} strong) from ${rawPicks.length} raw picks`)

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
