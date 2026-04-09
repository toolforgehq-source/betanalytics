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
import { dedupeAndEnforceCaps, dedupeToMap, FREEZE_WINDOW_MS, MAX_LOCKS, MAX_STRONG, type PickLike } from '@/lib/enforce-picks'
import { kvGet, kvSet, isDbConfigured } from '@/lib/pg-kv'


// ============================================
// HYBRID PICK PINNING — Fresh until 1hr before game, then locked forever
// ============================================
// Picks update freely throughout the day as new data comes in (injuries,
// line moves, weather). Once a game enters the 1-hour freeze window,
// its tier assignment gets permanently pinned in Redis. From that point
// on, that pick never changes — even if the model finds a higher-scoring
// alternative. This gives users the best of both worlds: fresh picks
// during the day, but locked-in stability before they need to bet.

interface PinnedPick {
  gameId: string
  team: string
  betType: string
  tier: 'lock' | 'strong'
  pinnedAt: string
  // v3: Store display data so pinned picks survive even when fresh data disappears
  // (e.g., ESPN removes in-progress games from the odds feed)
  snapshot?: PickLike
}

// v3: Bumped to store snapshot data on pins so locked-in picks are never dropped
// when ESPN removes in-progress games from the odds feed.
const PINNED_PICKS_PREFIX = 'betanalytics:pinned-picks-v3:'

/**
 * Load today's pinned tier assignments from the database.
 */
async function loadPinnedPicks(dateKey: string): Promise<PinnedPick[]> {
  if (!isDbConfigured()) return []
  try {
    const raw = await kvGet(`${PINNED_PICKS_PREFIX}${dateKey}`)
    if (!raw) return []
    let parsed = raw
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('[API /picks] Error loading pinned picks:', err)
    return []
  }
}

/**
 * Persist today's tier assignments to the database.
 * TTL is set to expire after 36 hours (same as the best bet cache).
 */
async function savePinnedPicks(dateKey: string, pins: PinnedPick[]): Promise<void> {
  if (!isDbConfigured()) return
  try {
    await kvSet(`${PINNED_PICKS_PREFIX}${dateKey}`, JSON.stringify(pins), 36 * 60 * 60)
  } catch (err) {
    console.error('[API /picks] Error saving pinned picks:', err)
  }
}

/**
 * Hybrid pick resolution: pinned (frozen) picks stay locked, remaining slots
 * are filled PURELY BY SCORE from the model on every request.
 *
 * Flow:
 * 1. Load any previously pinned picks from Redis — honor existing frozen picks
 * 2. Fill remaining slots from enforcedPicks sorted by score (best first)
 *    - If a selected pick is within the freeze window, also pin it in Redis
 *    - If not in the freeze window, it shows as a fresh (unfrozen) pick
 * 3. Return final picks + updated pins
 *
 * KEY CHANGE: Freeze-window status does NOT give priority for slot assignment.
 * Only the highest-scoring picks get slots. This prevents low-score games
 * that happen to start soon from stealing slots from high-score later games.
 */
function resolveHybridPicks(
  rawPicks: PickLike[],
  pinned: PinnedPick[],
  enforcedPicks: PickLike[]
): { picks: PickLike[]; updatedPins: PinnedPick[]; changed: boolean } {
  const now = Date.now()
  const dedupMap = dedupeToMap(rawPicks)

  // --- Phase 1: Resolve existing pinned picks against fresh data ---
  const resolvedPicks: PickLike[] = []
  const validPins: PinnedPick[] = []
  const usedGameIds = new Set<string>()
  const pinnedKeys = new Set<string>()
  let lockCount = 0
  let strongCount = 0

  for (const pin of pinned) {
    const key = `${pin.gameId}:${pin.team}:${pin.betType}`
    const freshPick = dedupMap.get(key)
    if (freshPick) {
      // Only honor the pin if the game is actually within the freeze window
      // (or has already started). Pins for games >1hr away were created by
      // the old "lock everything on first load" approach and should be dropped
      // so those picks can recalculate fresh with latest data.
      const gameStart = freshPick.commenceTime ? new Date(freshPick.commenceTime as string).getTime() : Infinity
      const timeUntilGame = gameStart - now
      if (timeUntilGame > FREEZE_WINDOW_MS) {
        console.log(`[API /picks] Dropping stale pin ${key} — game is ${Math.round(timeUntilGame / 60000)}min away (not yet frozen)`)
        continue
      }
      freshPick.confidenceTier = pin.tier
      freshPick.frozen = true
      resolvedPicks.push(freshPick)
      // Update snapshot on the pin so future requests have the latest data
      pin.snapshot = { ...freshPick }
      validPins.push(pin)
      usedGameIds.add(String(pin.gameId))
      pinnedKeys.add(key)
      if (pin.tier === 'lock') lockCount++
      else strongCount++
    } else if (pin.snapshot) {
      // Fresh data is gone (ESPN removed in-progress game from odds feed),
      // but we have a snapshot from when the pick was pinned. Use it.
      // This is the critical fix: locked-in picks must NEVER be dropped.
      const snapshotPick: PickLike = { ...pin.snapshot }
      snapshotPick.confidenceTier = pin.tier
      snapshotPick.frozen = true
      snapshotPick.gameStarted = true // game must have started if data disappeared
      resolvedPicks.push(snapshotPick)
      validPins.push(pin)
      usedGameIds.add(String(pin.gameId))
      pinnedKeys.add(key)
      if (pin.tier === 'lock') lockCount++
      else strongCount++
      console.log(`[API /picks] Pinned pick ${key} no longer in fresh data — using snapshot (game likely in progress)`)
    } else {
      console.log(`[API /picks] Pinned pick ${key} no longer in data and no snapshot — slot released`)
    }
  }

  // --- Phase 2: Fill remaining slots PURELY BY SCORE ---
  // Previously, Phase 2 grabbed slots for ANY freeze-window pick before
  // Phase 3 could fill by score. This let low-score European soccer games
  // (score 39) steal slots from high-score NCAAB games (score 87).
  // Now we iterate enforcedPicks (already sorted by score) in a single pass.
  // If a selected pick happens to be in the freeze window, we also pin it.
  let changed = validPins.length !== pinned.length
  const newlyPinned: PickLike[] = []

  for (const pick of enforcedPicks) {
    if (lockCount >= MAX_LOCKS && strongCount >= MAX_STRONG) break

    const gameId = String(pick.gameId || '')
    const key = `${pick.gameId}:${pick.team || ''}:${pick.betType}`

    // Skip if already pinned/used
    if (pinnedKeys.has(key)) continue
    if (usedGameIds.has(gameId)) continue

    // Assign tier based on score (enforcedPicks is sorted by score desc)
    if (lockCount < MAX_LOCKS) {
      pick.confidenceTier = 'lock'
      lockCount++
    } else if (strongCount < MAX_STRONG) {
      pick.confidenceTier = 'strong'
      strongCount++
    } else {
      continue
    }

    resolvedPicks.push(pick)
    usedGameIds.add(gameId)

    // If this pick is within the freeze window, also pin it in Redis
    const gameStart = pick.commenceTime ? new Date(pick.commenceTime as string).getTime() : Infinity
    const timeUntilGame = gameStart - now
    if (timeUntilGame <= FREEZE_WINDOW_MS) {
      pick.frozen = true
      validPins.push({
        gameId: gameId,
        team: String(pick.team || ''),
        betType: String(pick.betType || ''),
        tier: pick.confidenceTier as 'lock' | 'strong',
        pinnedAt: new Date().toISOString(),
        snapshot: { ...pick }
      })
      pinnedKeys.add(key)
      changed = true
      newlyPinned.push(pick)
    }
  }

  if (newlyPinned.length > 0) {
    console.log(`[API /picks] Newly pinned ${newlyPinned.length} picks entering freeze window: ${newlyPinned.map(p => p.team).join(', ')}`)
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
    // NOTE: calculateTrackingStats is NOT called here because it would re-fetch
    // getRecentRecommendations(0) internally, doubling our Redis commands.
    // Instead we pass the pre-fetched recos to it below.
    const [trackRecord, rawAllPicks, rawRecentRecos, cachedBestBet] = await Promise.all([
      getTrackRecord(),
      getAllPicks(),
      getRecentRecommendations(0),  // Fetch ALL recommendations (no limit) for complete history
      getCachedBestBet()
    ])

    // Defensive: ensure arrays are actually arrays
    const allPicks = Array.isArray(rawAllPicks) ? rawAllPicks : []
    const recentRecos = Array.isArray(rawRecentRecos) ? rawRecentRecos : []

    // Calculate stats from the already-fetched recommendations (avoids a second Redis round-trip)
    const stats = await calculateTrackingStats(recentRecos)

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
      // Use gameTime (commence time) to determine which betting day this pick belongs to,
      // falling back to createdAt. Previously only used createdAt, which caused picks
      // created late at night for tomorrow's games to be filtered out of "today."
      const referenceDate = p.gameTime || p.createdAt
      const pickDate = new Date(referenceDate).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
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
    // HYBRID PICK PINNING: Fresh until 1hr before game, then locked
    // ============================================
    // Picks recalculate freely during the day (new injuries, line moves,
    // weather all factor in). Once a game enters the 1-hour freeze window,
    // its tier assignment gets permanently pinned in Redis. From that point
    // on, it never changes — even if the model finds a higher-scoring pick.
    // Unfrozen picks (games > 1hr away) continue to update on every request.
    const dateKey = todayStr.replace(/\//g, '-')
    const pinnedPicks = await loadPinnedPicks(dateKey)
    console.log(`[API /picks] Loaded ${pinnedPicks.length} pinned picks from Redis`)

    const { picks: finalPicks, updatedPins, changed } = resolveHybridPicks(rawPicks, pinnedPicks, enforcedPicks)

    // Save updated pins to Redis if anything changed (new pins or lost pins)
    if (changed) {
      console.log(`[API /picks] Pins changed (${pinnedPicks.length} → ${updatedPins.length}) — saving to Redis`)
      await savePinnedPicks(dateKey, updatedPins)
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
    console.log(`[API /picks] Final picks: ${finalPicks.length} total (${lockCount} locks, ${strongCount} strong, ${startedCount} started, ${frozenCount} frozen/pinned, ${finalPicks.length - frozenCount} fresh)`)

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
