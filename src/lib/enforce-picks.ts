/**
 * Shared dedup + tier enforcement logic for model picks.
 *
 * Used by BOTH the picks API (Model Picks page) and the chat route (best bet tool)
 * to guarantee they always agree on which pick is the Lock of the Day.
 *
 * Single source of truth for:
 * - Deduplication (gameId:team:betType, prefer higher score)
 * - Score-based tier assignment (highest score = Lock, next best = Strong)
 * - Tier caps (max 1 Lock, max 3 Strong)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PickLike = Record<string, any>

// These caps MUST match the values in bet-ranking.ts computeBestBets()
export const MAX_LOCKS = 1
export const MAX_STRONG = 3

/**
 * Compute edge (probability - implied probability) from American odds.
 * Stored recommendations have `probability` and `odds` but NOT `edge`,
 * so we must compute it here.
 */
export function computeEdge(pick: PickLike): number {
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

/**
 * Deduplicate and enforce tier caps on a list of picks.
 * This is the final gate before displaying picks to the user.
 *
 * Steps:
 * 1. Deduplicate by gameId:team:betType (prefer higher score version)
 * 2. Sort by score descending
 * 3. Re-tier: highest-scored bet = Lock, next N = Strong, rest = value
 * 4. Return only Lock + Strong picks
 */
export function dedupeAndEnforceCaps(picks: PickLike[]): PickLike[] {
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
    // Always prefer the higher-scored version during dedup.
    // Score is the single source of truth for pick quality.
    if (!existing || (pick.score || 0) > (existing.score || 0)) {
      dedupMap.set(key, pick)
    }
  }
  
  // Step 2: Sort ALL deduped picks by score descending.
  // Score is the single source of truth — the highest-scoring picks always
  // get the top tier slots, regardless of whether their game has started.
  // This prevents low-scoring started games (e.g. Alcorn State) from stealing
  // slots away from genuinely high-scoring picks.
  const allDeduped = Array.from(dedupMap.values())
  allDeduped.sort((a, b) => (b.score || 0) - (a.score || 0))
  
  // Step 3: Assign tiers purely by score rank.
  // Highest score = Lock, next best = Strong, rest = value.
  // No special priority for started/locked-in games — score is king.
  let lockCount = 0
  let strongCount = 0
  
  for (const pick of allDeduped) {
    if (lockCount < MAX_LOCKS) {
      pick.confidenceTier = 'lock'
      lockCount++
    } else if (strongCount < MAX_STRONG) {
      pick.confidenceTier = 'strong'
      strongCount++
    } else {
      pick.confidenceTier = 'value'
    }
  }
  
  // Step 4: Return Lock/Strong picks
  const result = allDeduped.filter(p => p.confidenceTier === 'lock' || p.confidenceTier === 'strong')
  // Sort: locks first, then strong, by score within each tier
  return result.sort((a, b) => {
    if (a.confidenceTier === 'lock' && b.confidenceTier !== 'lock') return -1
    if (a.confidenceTier !== 'lock' && b.confidenceTier === 'lock') return 1
    return (b.score || 0) - (a.score || 0)
  })
}

/**
 * Returns ALL deduped and sorted picks (not just Lock + Strong).
 * Used by the chat to get the full ranked list for best bet selection,
 * while still using the same dedup logic as the picks page.
 */
/**
 * Normalize a pick (which might be a stored recommendation) to have
 * the fields that formatFilteredBestBetResponse expects (RankedBet shape).
 * 
 * Stored recommendations have: odds, probability, selection, gameName, source
 * RankedBets have: bestPrice, eloProbability, homeTeam, awayTeam, expectedValue, roi, etc.
 * 
 * This bridges the gap so both can be formatted by the same function.
 */
export function normalizeToRankedBetShape(pick: PickLike): PickLike {
  // If it already has bestPrice, it's likely a RankedBet — skip normalization
  if (pick.bestPrice !== undefined && pick.expectedValue !== undefined) return pick

  const prob = (pick.eloProbability || pick.probability || pick.consensusProbability || 0) as number
  const odds = (pick.bestPrice || pick.odds || 0) as number

  // Map stored recommendation fields to RankedBet equivalents
  if (pick.bestPrice === undefined && pick.odds !== undefined) {
    pick.bestPrice = pick.odds
  }
  if (pick.eloProbability === undefined && pick.probability !== undefined) {
    pick.eloProbability = pick.probability
  }
  if (pick.consensusProbability === undefined && pick.probability !== undefined) {
    pick.consensusProbability = pick.probability
  }

  // Compute impliedProbability from odds if missing
  if (pick.impliedProbability === undefined && odds !== 0) {
    if (odds > 0) {
      pick.impliedProbability = Number(((100 / (odds + 100)) * 100).toFixed(1))
    } else {
      pick.impliedProbability = Number(((Math.abs(odds) / (Math.abs(odds) + 100)) * 100).toFixed(1))
    }
  }

  // Compute edge if missing
  if (pick.edge === undefined || pick.edge === 0) {
    pick.edge = Number(computeEdge(pick).toFixed(1))
  }

  // Compute expectedValue and roi if missing
  if (pick.expectedValue === undefined) {
    if (prob > 0 && odds !== 0) {
      let payout: number
      if (odds > 0) {
        payout = odds / 100
      } else {
        payout = 100 / Math.abs(odds)
      }
      pick.expectedValue = Number(((prob / 100) * payout * 100 - ((100 - prob) / 100) * 100).toFixed(2))
    } else {
      pick.expectedValue = 0
    }
  }
  if (pick.roi === undefined) {
    pick.roi = pick.expectedValue || 0
  }

  // Extract homeTeam/awayTeam from gameName if missing (format: "Away Team @ Home Team")
  if (!pick.homeTeam && !pick.awayTeam && pick.gameName) {
    const parts = String(pick.gameName).split(' @ ')
    if (parts.length === 2) {
      pick.awayTeam = parts[0].trim()
      pick.homeTeam = parts[1].trim()
    }
  }

  // Default bestBook if missing
  if (!pick.bestBook) {
    pick.bestBook = 'Best Available'
  }

  // Default allBookPrices if missing
  if (!pick.allBookPrices) {
    pick.allBookPrices = odds !== 0 ? [{ book: pick.bestBook, price: odds, impliedProb: pick.impliedProbability || 0 }] : []
  }

  // Default calculatedAt if missing
  if (!pick.calculatedAt) {
    pick.calculatedAt = pick.createdAt || new Date().toISOString()
  }

  return pick
}

export function dedupeAndSort(picks: PickLike[]): PickLike[] {
  const dedupMap = new Map<string, PickLike>()
  for (const pick of picks) {
    const team = pick.team || (pick.selection ? String(pick.selection).replace(/\s+[+-]?\d[\d.]*$/, '').replace(/\s+ML$/i, '').trim() : '')
    if (!pick.gameId || !team || !pick.betType) continue
    if (String(pick.gameId).includes('_')) continue
    if (pick.betType === 'prop') continue
    
    if (!pick.team) pick.team = team
    
    const key = `${pick.gameId}:${team}:${pick.betType}`
    const existing = dedupMap.get(key)
    if (!existing || (pick.score || 0) > (existing.score || 0)) {
      dedupMap.set(key, pick)
    }
  }
  
  return Array.from(dedupMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
}
