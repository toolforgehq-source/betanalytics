/**
 * Shared dedup + tier enforcement logic for model picks.
 *
 * Used by BOTH the picks API (Model Picks page) and the chat route (best bet tool)
 * to guarantee they always agree on which pick is the Lock of the Day.
 *
 * Single source of truth for:
 * - Deduplication (gameId:team:betType, prefer higher score)
 * - Kelly Criterion filtering (only bets with meaningful Kelly fraction qualify)
 * - Score-based tier assignment (highest score = Lock, next best = Strong)
 * - Tier caps (max 1 Lock, max 3 Strong)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PickLike = Record<string, any>

// These caps MUST match the values in bet-ranking.ts computeBestBets()
export const MAX_LOCKS = 1
export const MAX_STRONG = 3

// ============================================
// KELLY CRITERION GATES FOR LOCK/STRONG TIERS
// ============================================
// These hard filters prevent ridiculous picks from appearing in the top 4.
// Heavy favorites (-345) have tiny payouts → tiny Kelly fractions.
// Big underdogs (+650) have low win probabilities → tiny Kelly fractions.
// Only bets in the sweet spot (moderate odds with real edges) qualify.
export const TIER_MAX_JUICE_ODDS = -250   // No heavy favorites worse than -250
export const TIER_MAX_PLUS_ODDS = 400     // No long underdogs beyond +400
export const TIER_MIN_KELLY = 0.02        // Minimum 2% Kelly fraction for Lock/Strong
export const TIER_MIN_PROBABILITY = 55    // Minimum 55% win probability for Lock/Strong

/**
 * Calculate Kelly Criterion fraction for a bet.
 * Kelly fraction = (b * p - q) / b
 * where b = decimal payout, p = win probability (0-1), q = 1-p
 *
 * This represents the optimal fraction of bankroll to wager.
 * Higher Kelly fraction = better bet for long-term bankroll growth.
 *
 * Examples:
 *   -150 favorite, 65% prob → Kelly = (0.667 * 0.65 - 0.35) / 0.667 = 12.5%
 *   +200 underdog, 40% prob → Kelly = (2.0 * 0.40 - 0.60) / 2.0 = 10.0%
 *   -345 favorite, 80% prob → Kelly = (0.290 * 0.80 - 0.20) / 0.290 = 11.0%
 *   +650 underdog, 20% prob → Kelly = (6.5 * 0.20 - 0.80) / 6.5 = 7.7%
 *   -110 pick, 55% prob     → Kelly = (0.909 * 0.55 - 0.45) / 0.909 = 5.5%
 */
export function calculateKellyFraction(probabilityPct: number, americanOdds: number): number {
  if (americanOdds === 0 || probabilityPct <= 0 || probabilityPct >= 100) return 0

  // Convert American odds to decimal payout (net profit per $1 wagered)
  let b: number
  if (americanOdds > 0) {
    b = americanOdds / 100  // e.g., +200 → 2.0
  } else {
    b = 100 / Math.abs(americanOdds)  // e.g., -150 → 0.667
  }

  const p = probabilityPct / 100  // Convert percentage to decimal
  const q = 1 - p

  // Kelly fraction: f* = (bp - q) / b
  const kelly = (b * p - q) / b

  return Math.max(0, kelly)  // Never negative (don't bet if negative edge)
}

/**
 * Check if a pick's odds are within the acceptable range for Lock/Strong tiers.
 * Rejects heavy favorites (worse than -250) and long underdogs (beyond +400).
 */
function isOddsInTierRange(americanOdds: number): boolean {
  if (americanOdds === 0) return false
  if (americanOdds < TIER_MAX_JUICE_ODDS) return false  // e.g., -345 < -250 → reject
  if (americanOdds > TIER_MAX_PLUS_ODDS) return false   // e.g., +650 > +400 → reject
  return true
}

/**
 * Get the Kelly fraction for a pick, computing from available fields.
 */
function getPickKellyFraction(pick: PickLike): number {
  const prob = (pick.eloProbability || pick.probability || pick.consensusProbability || 0) as number
  const odds = (pick.bestPrice || pick.odds || 0) as number
  if (prob <= 0 || odds === 0) return 0
  return calculateKellyFraction(prob, odds)
}

/**
 * Get the win probability for a pick from available fields.
 */
function getPickProbability(pick: PickLike): number {
  return (pick.eloProbability || pick.probability || pick.consensusProbability || 0) as number
}

/**
 * Get the American odds for a pick from available fields.
 */
function getPickOdds(pick: PickLike): number {
  return (pick.bestPrice || pick.odds || 0) as number
}

/**
 * Check if a pick qualifies for Lock/Strong tier based on Kelly Criterion gates.
 * This is the HARD FILTER that prevents ridiculous picks from appearing in top 4.
 */
function qualifiesForTopTier(pick: PickLike): boolean {
  const odds = getPickOdds(pick)
  const prob = getPickProbability(pick)
  const kelly = getPickKellyFraction(pick)

  // Hard filter: odds must be in [-250, +400] range
  if (!isOddsInTierRange(odds)) return false

  // Hard filter: minimum 55% win probability
  if (prob < TIER_MIN_PROBABILITY) return false

  // Hard filter: minimum 2% Kelly fraction (meaningful bet size)
  if (kelly < TIER_MIN_KELLY) return false

  return true
}

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

// How far before game time a pick becomes "frozen" (cannot be bumped from its tier slot).
// Once a game is within this window, the pick stays in Lock/Strong regardless of
// score changes from later model updates.  This lets users bet with confidence
// knowing the board won't rotate under them.
export const FREEZE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

/**
 * Deduplicate and enforce tier caps on a list of picks.
 * This is the final gate before displaying picks to the user.
 *
 * Steps:
 * 1. Deduplicate by gameId:team:betType (prefer higher score version)
 * 2. Mark picks within FREEZE_WINDOW_MS of game time as "frozen"
 * 3. Assign tiers: frozen picks claim slots first (by score), then remaining
 *    slots are filled by unfrozen picks (by score)
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
  
  // Step 2: Sort ALL deduped picks by score descending and mark frozen status.
  const allDeduped = Array.from(dedupMap.values())
  allDeduped.sort((a, b) => (b.score || 0) - (a.score || 0))
  
  const now = Date.now()
  
  // Separate picks into frozen (within FREEZE_WINDOW_MS of game time or already started)
  // and unfrozen.  Both lists stay sorted by score descending.
  const frozen: PickLike[] = []
  const unfrozen: PickLike[] = []
  
  for (const pick of allDeduped) {
    const gameStart = pick.commenceTime ? new Date(pick.commenceTime as string).getTime() : Infinity
    const timeUntilGame = gameStart - now
    
    if (timeUntilGame <= FREEZE_WINDOW_MS) {
      // Game starts within 1 hour (or has already started) → frozen
      pick.frozen = true
      frozen.push(pick)
    } else {
      unfrozen.push(pick)
    }
  }
  
  // Step 3: Assign tiers PURELY BY SCORE — no freeze-window priority.
  // Previously, frozen picks claimed slots first, which let low-score games
  // (e.g. European soccer at score 39) steal slots from high-score games
  // (e.g. UCLA at score 87) just because they happened to start sooner.
  // Now ALL picks compete on score alone. The freeze window only affects
  // whether a pick gets pinned in Redis (handled by resolveHybridPicks),
  // NOT whether it gets a slot.
  //
  // Only 1 pick per gameId can be Lock or Strong. This prevents correlated
  // losses when the model likes multiple bet types on the same game.
  //
  // KELLY CRITERION GATE: Only picks that pass qualifiesForTopTier() can be
  // Lock or Strong. This prevents heavy favorites (-345), long underdogs (+650),
  // and low-Kelly-fraction bets from appearing in the top 4.
  let lockCount = 0
  let strongCount = 0
  const topTierGameIds = new Set<string>()
  
  // Helper to assign a tier to a single pick
  const assignTier = (pick: PickLike) => {
    const gameId = String(pick.gameId || '')
    
    // If this game already has a pick in Lock/Strong, skip to value tier
    if (gameId && topTierGameIds.has(gameId)) {
      pick.confidenceTier = 'value'
      return
    }
    
    // KELLY CRITERION GATE: Must pass hard filters to be Lock/Strong
    if (!qualifiesForTopTier(pick)) {
      pick.confidenceTier = 'value'
      return
    }
    
    if (lockCount < MAX_LOCKS) {
      pick.confidenceTier = 'lock'
      lockCount++
      if (gameId) topTierGameIds.add(gameId)
    } else if (strongCount < MAX_STRONG) {
      pick.confidenceTier = 'strong'
      strongCount++
      if (gameId) topTierGameIds.add(gameId)
    } else {
      pick.confidenceTier = 'value'
    }
  }
  
  // Single pass: ALL picks compete by score (allDeduped is already sorted by score desc).
  // Frozen status is still marked on the pick for display purposes, but does NOT
  // give priority for slot assignment.
  for (const pick of allDeduped) {
    assignTier(pick)
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

/**
 * Build a deduped lookup map from raw picks.
 * Key is "gameId:team:betType", value is the highest-scored version.
 * Used by the picks API to resolve pinned picks against fresh data.
 */
export function dedupeToMap(picks: PickLike[]): Map<string, PickLike> {
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
  return dedupMap
}
