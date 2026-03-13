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
import { dedupeAndEnforceCaps, dedupeToMap, MAX_LOCKS, MAX_STRONG, type PickLike } from '@/lib/enforce-picks'

// ============================================
// PICK PINNING — Prevents picks from rotating on refresh
// ============================================
// Once a pick is assigned Lock/Strong for the day, its tier assignment
// is persisted in Redis. Subsequent API calls honor the persisted
// assignments instead of recomputing from scratch. Only EMPTY slots
// (caused by game cancellations or data removal) get filled with new picks.
// This ensures users always see the same picks regardless of how many
// times they refresh or when the cron updates odds/scores.

interface PinnedPick {
  gameId: string
  team: string
  betType: string
  tier: 'lock' | 'strong'
  pinnedAt: string
}

const PINNED_PICKS_PREFIX = 'betanalytics:pinned-picks:'

async function getPinRedis() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  return { url, token }
}

/**
 * Load today's pinned tier assignments from Redis.
 */
async function loadPinnedPicks(dateKey: string): Promise<PinnedPick[]> {
  const redis = await getPinRedis()
  if (!redis) return []
  try {
    const res = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', `${PINNED_PICKS_PREFIX}${dateKey}`]),
      cache: 'no-store'
    })
    const data = await res.json()
    if (!data.result) return []
    let parsed = data.result
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('[API /picks] Error loading pinned picks:', err)
    return []
  }
}

/**
 * Persist today's tier assignments to Redis.
 * TTL is set to expire at 2 AM ET (same as the best bet cache).
 */
async function savePinnedPicks(dateKey: string, pins: PinnedPick[]): Promise<void> {
  const redis = await getPinRedis()
  if (!redis) return
  try {
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', `${PINNED_PICKS_PREFIX}${dateKey}`, JSON.stringify(pins)]),
      cache: 'no-store'
    })
    // Expire at 2 AM ET (36 hours max to cover full betting day + buffer)
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['EXPIRE', `${PINNED_PICKS_PREFIX}${dateKey}`, 36 * 60 * 60]),
      cache: 'no-store'
    })
  } catch (err) {
    console.error('[API /picks] Error saving pinned picks:', err)
  }
}

/**
 * Resolve pinned picks against fresh data and fill any empty slots.
 *
 * 1. For each pinned pick, find the matching pick in the fresh deduped pool
 *    (by gameId:team:betType). This gives us the latest odds/scores while
 *    keeping the tier assignment fixed.
 * 2. If a pinned pick is no longer in the data (game removed), its slot opens up.
 * 3. Fill empty slots from the freshly computed enforcedPicks.
 * 4. Return the final picks + whether new pins were added.
 */
function resolvePinnedPicks(
  rawPicks: PickLike[],
  pinned: PinnedPick[],
  enforcedPicks: PickLike[]
): { picks: PickLike[]; updatedPins: PinnedPick[]; changed: boolean } {
  // Build deduped lookup from ALL raw picks (for resolving pinned picks)
  const dedupMap = dedupeToMap(rawPicks)

  // Resolve each pinned pick against fresh data
  const resolvedPicks: PickLike[] = []
  const validPins: PinnedPick[] = []
  const usedGameIds = new Set<string>()
  let lockCount = 0
  let strongCount = 0

  for (const pin of pinned) {
    const key = `${pin.gameId}:${pin.team}:${pin.betType}`
    const freshPick = dedupMap.get(key)
    if (freshPick) {
      // Found in fresh data — use latest odds/scores but keep pinned tier
      freshPick.confidenceTier = pin.tier
      resolvedPicks.push(freshPick)
      validPins.push(pin)
      usedGameIds.add(String(pin.gameId))
      if (pin.tier === 'lock') lockCount++
      else strongCount++
    } else {
      // Pick no longer in data (game cancelled/removed) — slot opens up
      console.log(`[API /picks] Pinned pick ${key} no longer in data — slot released`)
    }
  }

  // Fill empty slots from freshly computed enforcedPicks
  let changed = validPins.length !== pinned.length // changed if we lost any pins
  for (const pick of enforcedPicks) {
    if (lockCount >= MAX_LOCKS && strongCount >= MAX_STRONG) break

    const gameId = String(pick.gameId || '')
    // Don't add another pick from a game that already has a pinned pick
    if (usedGameIds.has(gameId)) continue

    const key = `${pick.gameId}:${pick.team || ''}:${pick.betType}`
    // Don't add if already in resolved set
    if (resolvedPicks.some(rp => `${rp.gameId}:${rp.team || ''}:${rp.betType}` === key)) continue

    if (lockCount < MAX_LOCKS) {
      pick.confidenceTier = 'lock'
      resolvedPicks.push(pick)
      validPins.push({
        gameId: gameId,
        team: String(pick.team || ''),
        betType: String(pick.betType || ''),
        tier: 'lock',
        pinnedAt: new Date().toISOString()
      })
      lockCount++
      usedGameIds.add(gameId)
      changed = true
    } else if (strongCount < MAX_STRONG) {
      pick.confidenceTier = 'strong'
      resolvedPicks.push(pick)
      validPins.push({
        gameId: gameId,
        team: String(pick.team || ''),
        betType: String(pick.betType || ''),
        tier: 'strong',
        pinnedAt: new Date().toISOString()
      })
      strongCount++
      usedGameIds.add(gameId)
      changed = true
    }
  }

  // Sort: locks first, then strong, by score within each tier
  resolvedPicks.sort((a, b) => {
    if (a.confidenceTier === 'lock' && b.confidenceTier !== 'lock') return -1
    if (a.confidenceTier !== 'lock' && b.confidenceTier === 'lock') return 1
    return (b.score || 0) - (a.score || 0)
  })

  return { picks: resolvedPicks, updatedPins: validPins, changed }
}

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Fetch all data in parallel — including the cached best bet result (same source as chat)
    const [trackRecord, rawAllPicks, rawRecentRecos, stats, cachedBestBet] = await Promise.all([
      getTrackRecord(),
      getAllPicks(),
      getRecentRecommendations(0),  // Fetch ALL recommendations (no limit) for complete history
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
    // Return ALL capped recommendations — no artificial slice limit.
    // Previously .slice(0, 100) truncated history to ~5 days.
    const allRecentRecos = [...cappedRecos, ...nonTrackedRecos]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

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

    // ============================================
    // PICK PINNING: Prevent picks from rotating on refresh
    // ============================================
    // Once tier assignments are computed, they are persisted in Redis.
    // On subsequent requests, the persisted assignments are used instead
    // of recomputing (which could produce different results due to
    // odds changes, freeze window timing, or cron updates).
    // Only EMPTY slots (from game cancellations) get filled with new picks.
    const dateKey = todayStr.replace(/\//g, '-')
    const pinnedPicks = await loadPinnedPicks(dateKey)

    let finalPicks: PickLike[]
    if (pinnedPicks.length > 0) {
      // We have persisted tier assignments — resolve against fresh data
      console.log(`[API /picks] Found ${pinnedPicks.length} pinned picks — resolving against fresh data`)
      const { picks, updatedPins, changed } = resolvePinnedPicks(rawPicks, pinnedPicks, enforcedPicks)
      finalPicks = picks
      // Update Redis if pins changed (lost pins or filled new slots)
      if (changed) {
        console.log(`[API /picks] Pins changed (${pinnedPicks.length} → ${updatedPins.length}) — saving updated pins`)
        await savePinnedPicks(dateKey, updatedPins)
      }
    } else {
      // No pinned picks for today — use freshly computed picks and pin them
      console.log(`[API /picks] No pinned picks for today — pinning ${enforcedPicks.length} computed picks`)
      finalPicks = enforcedPicks
      const newPins: PinnedPick[] = enforcedPicks.map(p => ({
        gameId: String(p.gameId || ''),
        team: String(p.team || ''),
        betType: String(p.betType || ''),
        tier: p.confidenceTier as 'lock' | 'strong',
        pinnedAt: new Date().toISOString()
      }))
      if (newPins.length > 0) {
        await savePinnedPicks(dateKey, newPins)
      }
    }
    
    // Mark picks whose games have already started so the frontend can show appropriate status.
    // We keep them visible (users may want to see what was recommended) but flag them.
    const nowMs = Date.now()
    for (const pick of finalPicks) {
      if (pick.commenceTime) {
        const gameStart = new Date(pick.commenceTime as string).getTime()
        if (nowMs >= gameStart) {
          pick.gameStarted = true
        }
      }
    }
    
    const lockCount = finalPicks.filter(p => p.confidenceTier === 'lock').length
    const strongCount = finalPicks.filter(p => p.confidenceTier === 'strong').length
    const startedCount = finalPicks.filter(p => p.gameStarted).length
    const frozenCount = finalPicks.filter(p => p.frozen).length
    console.log(`[API /picks] Final picks: ${finalPicks.length} total (${lockCount} locks, ${strongCount} strong, ${startedCount} already started, ${frozenCount} frozen, pinned=${pinnedPicks.length > 0})`)

    return NextResponse.json({
      success: true,
      todaysPicks,
      todaysRecommendations,
      livePicks: finalPicks,  // ALWAYS deduped + tier-capped + pinned
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
