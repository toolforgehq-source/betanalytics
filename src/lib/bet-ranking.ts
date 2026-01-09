/**
 * Deterministic Best Bet Ranking Algorithm
 * 
 * This module computes the "Best Bet of the Day" using a deterministic algorithm
 * based on market consensus probability and price value (edge).
 * 
 * The algorithm:
 * 1. Calculate no-vig consensus probability from multiple sportsbooks
 * 2. Find the best available price across all books
 * 3. Calculate edge (consensus prob - implied prob from best price)
 * 4. Filter: 55%+ probability, 3%+ edge, max -250 juice
 * 5. Rank by probability (desc), then edge (desc), then game time (asc)
 * 
 * This ensures the same "best bet" is returned for all users until the next refresh.
 */

import type { Game } from './odds'

export interface RankedBet {
  gameId: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  
  // The recommended bet
  team: string
  betType: 'moneyline'
  
  // Probability and edge calculations
  consensusProbability: number  // No-vig average across books
  bestPrice: number             // Best available American odds
  bestBook: string              // Which book has the best price
  impliedProbability: number    // Implied prob from best price
  edge: number                  // consensus - implied
  
  // All book prices for transparency
  allBookPrices: { book: string; price: number; impliedProb: number }[]
  
  // Ranking score (for sorting)
  score: number
  
  // Timestamp
  calculatedAt: string
}

export interface FallbackBet {
  gameId: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  team: string
  consensusProbability: number
  bestPrice: number
  bestBook: string
  impliedProbability: number
  edge: number
  disqualifyReasons: string[]
}

export interface BestBetResult {
  bestBet: RankedBet | null
  runnerUp: RankedBet | null
  allRankedBets: RankedBet[]
  calculatedAt: string
  gamesAnalyzed: number
  gamesQualified: number
  reason: string | null  // Why no best bet if null
  // Fallback data when no bets qualify
  closestMisses: FallbackBet[]  // Games that nearly qualified (reasonable odds, small edge)
  mostLikelyWinners: FallbackBet[]  // Highest probability games (may have negative edge)
}

export interface ParlayResult {
  safeParlay: RankedBet[] | null      // 2-leg parlay with highest combined probability
  aggressiveParlay: RankedBet[] | null // 3-leg parlay with good value
  combinedProbability: number | null   // Combined probability of safe parlay
  calculatedAt: string
  reason: string | null
}

export interface SportBestBets {
  [sportName: string]: RankedBet | null
}

// Minimum thresholds
const MIN_PROBABILITY = 0.55      // 55% minimum win probability
const MIN_EDGE = 0.03             // 3% minimum edge
const MAX_JUICE_ODDS = -250       // Don't recommend worse than -250

// Reputable books for consensus calculation (exclude sharp-only books)
const CONSENSUS_BOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet',
  'BetRivers', 'Unibet', 'Barstool', 'WynnBET', 'SuperBook'
]

/**
 * Convert American odds to implied probability
 */
export function americanToImpliedProbability(odds: number): number {
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100)
  } else {
    return 100 / (odds + 100)
  }
}

/**
 * Remove vig from a two-way market to get true probabilities
 * Takes both sides' implied probabilities and normalizes to sum to 1
 */
function removeVig(impliedProb1: number, impliedProb2: number): { prob1: number; prob2: number } {
  const total = impliedProb1 + impliedProb2
  return {
    prob1: impliedProb1 / total,
    prob2: impliedProb2 / total
  }
}

/**
 * Check if a game has a 3-way market (includes Draw option)
 * Soccer and some other sports have win/draw/win markets
 */
function isThreeWayMarket(game: Game): boolean {
  if (!game.moneylines || game.moneylines.length === 0) return false
  
  // Check if any bookmaker has a "Draw" outcome
  for (const ml of game.moneylines) {
    const hasDrawOutcome = ml.outcomes.some(o => 
      o.name.toLowerCase() === 'draw' || 
      o.name.toLowerCase() === 'tie' ||
      o.name.toLowerCase() === 'x'
    )
    if (hasDrawOutcome) return true
    
    // Also check if there are more than 2 outcomes
    if (ml.outcomes.length > 2) return true
  }
  
  return false
}

/**
 * Calculate consensus no-vig probability for a team from multiple books
 * Only works for 2-way markets (excludes soccer 3-way markets)
 */
function calculateConsensusProbability(
  game: Game,
  team: string
): { consensusProb: number; bookPrices: { book: string; price: number; impliedProb: number; noVigProb: number }[] } | null {
  // CRITICAL: Skip 3-way markets (soccer win/draw/win)
  // Our 2-way no-vig calculation doesn't work for 3-way markets
  if (isThreeWayMarket(game)) {
    return null
  }
  
  const bookPrices: { book: string; price: number; impliedProb: number; noVigProb: number }[] = []
  
  const isHomeTeam = team === game.homeTeam
  const opponent = isHomeTeam ? game.awayTeam : game.homeTeam
  
  for (const ml of game.moneylines) {
    // Only use reputable books for consensus
    if (!CONSENSUS_BOOKS.includes(ml.bookmaker)) continue
    
    // Skip if not exactly 2 outcomes (safety check)
    if (ml.outcomes.length !== 2) continue
    
    const teamOutcome = ml.outcomes.find(o => o.name === team)
    const opponentOutcome = ml.outcomes.find(o => o.name === opponent)
    
    if (!teamOutcome || !opponentOutcome) continue
    
    const teamImplied = americanToImpliedProbability(teamOutcome.price)
    const opponentImplied = americanToImpliedProbability(opponentOutcome.price)
    
    // Remove vig to get true probability
    const noVig = removeVig(teamImplied, opponentImplied)
    
    bookPrices.push({
      book: ml.bookmaker,
      price: teamOutcome.price,
      impliedProb: teamImplied,
      noVigProb: noVig.prob1
    })
  }
  
  if (bookPrices.length < 2) {
    // Need at least 2 books for consensus
    return null
  }
  
  // Calculate median no-vig probability (more robust than mean)
  const sortedProbs = bookPrices.map(b => b.noVigProb).sort((a, b) => a - b)
  const mid = Math.floor(sortedProbs.length / 2)
  const consensusProb = sortedProbs.length % 2 === 0
    ? (sortedProbs[mid - 1] + sortedProbs[mid]) / 2
    : sortedProbs[mid]
  
  return { consensusProb, bookPrices }
}

/**
 * Find the best available price for a team across all books
 */
function findBestPrice(
  game: Game,
  team: string
): { price: number; book: string; impliedProb: number } | null {
  let best: { price: number; book: string; impliedProb: number } | null = null
  
  for (const ml of game.moneylines) {
    const outcome = ml.outcomes.find(o => o.name === team)
    if (!outcome) continue
    
    // Higher price is better (less juice)
    // For favorites: -150 is better than -200
    // For underdogs: +150 is better than +130
    if (!best || outcome.price > best.price) {
      best = {
        price: outcome.price,
        book: ml.bookmaker,
        impliedProb: americanToImpliedProbability(outcome.price)
      }
    }
  }
  
  return best
}

/**
 * Analyze a single game and return ranked bets for both teams
 */
function analyzeGame(game: Game): RankedBet[] {
  const rankedBets: RankedBet[] = []
  const now = new Date().toISOString()
  
  // Skip games that have already started
  if (new Date(game.commenceTime) < new Date()) {
    return []
  }
  
  // Must have moneyline odds
  if (!game.moneylines || game.moneylines.length === 0) {
    return []
  }
  
  // Analyze both teams
  for (const team of [game.homeTeam, game.awayTeam]) {
    const consensus = calculateConsensusProbability(game, team)
    if (!consensus) continue
    
    const bestPrice = findBestPrice(game, team)
    if (!bestPrice) continue
    
    // Check juice constraint (don't recommend worse than -250)
    if (bestPrice.price < MAX_JUICE_ODDS) continue
    
    const edge = consensus.consensusProb - bestPrice.impliedProb
    
    // Check minimum thresholds
    if (consensus.consensusProb < MIN_PROBABILITY) continue
    if (edge < MIN_EDGE) continue
    
    // Calculate ranking score: probability first, then edge
    // Score = probability * 100 + edge * 10 (so 60% + 5% edge = 60.5)
    const score = consensus.consensusProb * 100 + edge * 10
    
    rankedBets.push({
      gameId: game.id,
      sport: game.sport,
      sportName: game.sportName,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      team,
      betType: 'moneyline',
      consensusProbability: Math.round(consensus.consensusProb * 1000) / 10, // e.g., 62.5%
      bestPrice: bestPrice.price,
      bestBook: bestPrice.book,
      impliedProbability: Math.round(bestPrice.impliedProb * 1000) / 10,
      edge: Math.round(edge * 1000) / 10,
      allBookPrices: consensus.bookPrices.map(b => ({
        book: b.book,
        price: b.price,
        impliedProb: Math.round(b.impliedProb * 1000) / 10
      })),
      score,
      calculatedAt: now
    })
  }
  
  return rankedBets
}

/**
 * Analyze a single game WITHOUT filters - returns all bets with disqualify reasons
 * Used for computing fallback data (closest misses, most likely winners)
 */
function analyzeGameUnfiltered(game: Game): FallbackBet[] {
  const fallbackBets: FallbackBet[] = []
  
  // Skip games that have already started
  if (new Date(game.commenceTime) < new Date()) {
    return []
  }
  
  // Must have moneyline odds
  if (!game.moneylines || game.moneylines.length === 0) {
    return []
  }
  
  // Skip 3-way markets (soccer)
  if (isThreeWayMarket(game)) {
    return []
  }
  
  // Analyze both teams
  for (const team of [game.homeTeam, game.awayTeam]) {
    const consensus = calculateConsensusProbability(game, team)
    if (!consensus) continue
    
    const bestPrice = findBestPrice(game, team)
    if (!bestPrice) continue
    
    const edge = consensus.consensusProb - bestPrice.impliedProb
    const disqualifyReasons: string[] = []
    
    // Check why it doesn't qualify
    if (bestPrice.price < MAX_JUICE_ODDS) {
      disqualifyReasons.push(`Juice ${bestPrice.price} worse than -250 max`)
    }
    if (consensus.consensusProb < MIN_PROBABILITY) {
      disqualifyReasons.push(`Probability ${(consensus.consensusProb * 100).toFixed(1)}% < 55% min`)
    }
    if (edge < MIN_EDGE) {
      disqualifyReasons.push(`Edge ${(edge * 100).toFixed(1)}% < 3% min`)
    }
    
    fallbackBets.push({
      gameId: game.id,
      sport: game.sport,
      sportName: game.sportName,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      team,
      consensusProbability: Math.round(consensus.consensusProb * 1000) / 10,
      bestPrice: bestPrice.price,
      bestBook: bestPrice.book,
      impliedProbability: Math.round(bestPrice.impliedProb * 1000) / 10,
      edge: Math.round(edge * 1000) / 10,
      disqualifyReasons
    })
  }
  
  return fallbackBets
}

/**
 * Compute the Best Bet of the Day from all available games
 * This is the main entry point - call this on each cron refresh
 */
export function computeBestBets(games: Game[]): BestBetResult {
  const now = new Date().toISOString()
  const allRankedBets: RankedBet[] = []
  const allUnfilteredBets: FallbackBet[] = []
  
  // Analyze all games
  for (const game of games) {
    const bets = analyzeGame(game)
    allRankedBets.push(...bets)
    
    // Also collect unfiltered bets for fallback data
    const unfilteredBets = analyzeGameUnfiltered(game)
    allUnfilteredBets.push(...unfilteredBets)
  }
  
  // Sort by score (desc), then by game time (asc) for stable tiebreaker
  allRankedBets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  const bestBet = allRankedBets[0] || null
  const runnerUp = allRankedBets[1] || null
  
  let reason: string | null = null
  if (!bestBet) {
    if (games.length === 0) {
      reason = 'No games available'
    } else {
      reason = 'No games meet criteria (55%+ probability, 3%+ edge, max -250 juice)'
    }
  }
  
  // Compute fallback data (only relevant when no bets qualify)
  let closestMisses: FallbackBet[] = []
  let mostLikelyWinners: FallbackBet[] = []
  
  if (!bestBet && allUnfilteredBets.length > 0) {
    // Closest misses: games with reasonable odds (-250 or better) and small positive or neutral edge
    // These are games that ALMOST qualified
    closestMisses = allUnfilteredBets
      .filter(b => b.bestPrice >= MAX_JUICE_ODDS && b.edge >= -1) // Reasonable odds, edge >= -1%
      .sort((a, b) => b.edge - a.edge) // Sort by edge (highest first)
      .slice(0, 3)
    
    // Most likely winners: highest probability games (may have negative edge)
    // Filter to reasonable odds only (-250 or better) to avoid extreme favorites
    mostLikelyWinners = allUnfilteredBets
      .filter(b => b.bestPrice >= MAX_JUICE_ODDS) // Reasonable odds only
      .sort((a, b) => b.consensusProbability - a.consensusProbability) // Sort by probability
      .slice(0, 3)
  }
  
  return {
    bestBet,
    runnerUp,
    allRankedBets: allRankedBets.slice(0, 10), // Top 10 for context
    calculatedAt: now,
    gamesAnalyzed: games.length,
    gamesQualified: allRankedBets.length,
    reason,
    closestMisses,
    mostLikelyWinners
  }
}

/**
 * Format the best bet result for Claude's context
 */
export function formatBestBetForContext(result: BestBetResult): string {
  const lines: string[] = []
  
  lines.push('=== PRE-COMPUTED BEST BET (as of ' + formatTime(result.calculatedAt) + ') ===')
  lines.push(`Games analyzed: ${result.gamesAnalyzed} | Qualified bets: ${result.gamesQualified}`)
  lines.push('')
  
  if (!result.bestBet) {
    lines.push(`NO BEST BET AVAILABLE: ${result.reason}`)
    lines.push('')
    lines.push('When user asks for "best bet", respond with this two-tier message:')
    lines.push('')
    lines.push('TIER 1 - EXPLAIN WHY NO PICK:')
    lines.push('"No high-confidence value bets today. Our criteria (55% win probability, 3% edge, max -250 juice) ensure we only recommend +EV plays."')
    lines.push('')
    lines.push('"Today\'s market: All high-probability games are heavy favorites with negative edge (you\'d be paying a premium, not getting value)."')
    lines.push('')
    lines.push('TIER 2 - OFFER FALLBACK OPTIONS:')
    lines.push('"If you still want action, I can show you:"')
    lines.push('- "Closest misses - Games that nearly qualified (reasonable odds, small edge)"')
    lines.push('- "Most likely winners - High probability picks, but NOT value bets (informational only, not recommendations)"')
    lines.push('')
    lines.push('"Which would you like to see?"')
    lines.push('')
    
    // Include fallback data for when user asks
    const closestMisses = result.closestMisses ?? []
    const mostLikelyWinners = result.mostLikelyWinners ?? []
    
    if (closestMisses.length > 0) {
      lines.push('=== CLOSEST MISSES (for user who asks) ===')
      lines.push('IMPORTANT: These are NOT recommendations. Label them as "informational only".')
      for (const miss of closestMisses) {
        lines.push(`- ${miss.team} ML @ ${formatOdds(miss.bestPrice)} (${miss.bestBook})`)
        lines.push(`  Game: ${miss.awayTeam} @ ${miss.homeTeam} | ${miss.sportName}`)
        lines.push(`  Probability: ${miss.consensusProbability}% | Edge: ${miss.edge}%`)
        lines.push(`  Why disqualified: ${miss.disqualifyReasons.join(', ')}`)
      }
      lines.push('')
    }
    
    if (mostLikelyWinners.length > 0) {
      lines.push('=== MOST LIKELY WINNERS (for user who asks) ===')
      lines.push('IMPORTANT: These are NOT recommendations. They may have NEGATIVE edge.')
      lines.push('Label them as "informational only - not a betting recommendation".')
      for (const winner of mostLikelyWinners) {
        lines.push(`- ${winner.team} ML @ ${formatOdds(winner.bestPrice)} (${winner.bestBook})`)
        lines.push(`  Game: ${winner.awayTeam} @ ${winner.homeTeam} | ${winner.sportName}`)
        lines.push(`  Probability: ${winner.consensusProbability}% | Edge: ${winner.edge}%`)
        if (winner.edge < 0) {
          lines.push(`  WARNING: Negative edge - you are paying a premium for this bet`)
        }
      }
      lines.push('')
    }
    
    return lines.join('\n')
  }
  
  const bet = result.bestBet
  
  lines.push('BEST BET OF THE DAY:')
  lines.push(`Team: ${bet.team} (Moneyline)`)
  lines.push(`Game: ${bet.awayTeam} @ ${bet.homeTeam}`)
  lines.push(`Sport: ${bet.sportName}`)
  lines.push(`Game Time: ${formatTime(bet.commenceTime)}`)
  lines.push('')
  lines.push('PROBABILITY CALCULATION:')
  lines.push(`- Consensus Win Probability: ${bet.consensusProbability}% (no-vig median from ${bet.allBookPrices.length} books)`)
  lines.push(`- Best Available Price: ${formatOdds(bet.bestPrice)} at ${bet.bestBook}`)
  lines.push(`- Implied Probability from Best Price: ${bet.impliedProbability}%`)
  lines.push(`- EDGE: ${bet.consensusProbability}% - ${bet.impliedProbability}% = ${bet.edge}%`)
  lines.push('')
  lines.push('ALL BOOK PRICES:')
  for (const book of bet.allBookPrices) {
    lines.push(`  ${book.book}: ${formatOdds(book.price)} (${book.impliedProb}% implied)`)
  }
  
  if (result.runnerUp) {
    const ru = result.runnerUp
    lines.push('')
    lines.push('RUNNER-UP (Value Play):')
    lines.push(`Team: ${ru.team} (Moneyline)`)
    lines.push(`Game: ${ru.awayTeam} @ ${ru.homeTeam}`)
    lines.push(`Consensus Probability: ${ru.consensusProbability}%`)
    lines.push(`Best Price: ${formatOdds(ru.bestPrice)} at ${ru.bestBook}`)
    lines.push(`Edge: ${ru.edge}%`)
  }
  
  lines.push('')
  lines.push('IMPORTANT: When user asks for "best bet", present the BEST BET above.')
  lines.push('Do NOT pick a different game. This is the pre-computed best bet based on market consensus.')
  lines.push('Your job is to EXPLAIN why this is the best bet, not to choose a different one.')
  
  return lines.join('\n')
}

function formatOdds(price: number): string {
  return price > 0 ? `+${price}` : `${price}`
}

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
}

// Redis cache key for best bet
const BEST_BET_CACHE_KEY = 'betanalytics:best-bet'

/**
 * Get Redis client for caching
 */
async function getRedisClient() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.warn('Redis not configured for best bet caching')
    return null
  }
  
  return { url, token }
}

/**
 * Cache the best bet result in Redis
 */
export async function cacheBestBet(result: BestBetResult): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(`${redis.url}/set/${BEST_BET_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(result))
    })
    
    // Set 4-hour expiry
    await fetch(`${redis.url}/expire/${BEST_BET_CACHE_KEY}/${4 * 60 * 60}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    console.log('[cacheBestBet] Cached best bet:', result.bestBet?.team || 'none')
  } catch (error) {
    console.error('[cacheBestBet] Error caching best bet:', error)
  }
}

/**
 * Get cached best bet from Redis
 */
export async function getCachedBestBet(): Promise<BestBetResult | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${BEST_BET_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as BestBetResult
  } catch (error) {
    console.error('[getCachedBestBet] Error getting cached best bet:', error)
    return null
  }
}

/**
 * Compute Parlay of the Day from ranked bets
 * Safe Parlay: 2 legs from different games with highest combined probability
 * Aggressive Parlay: 3 legs with good value
 */
export function computeParlayOfTheDay(allRankedBets: RankedBet[]): ParlayResult {
  const now = new Date().toISOString()
  
  if (allRankedBets.length < 2) {
    return {
      safeParlay: null,
      aggressiveParlay: null,
      combinedProbability: null,
      calculatedAt: now,
      reason: 'Not enough qualified bets for a parlay (need at least 2)'
    }
  }
  
  // Filter to only include bets from different games
  // Sort by probability (highest first)
  const sortedBets = [...allRankedBets].sort((a, b) => b.consensusProbability - a.consensusProbability)
  
  // Build safe parlay (2 legs) - pick top 2 from different games
  const safeParlay: RankedBet[] = []
  const usedGameIds = new Set<string>()
  
  for (const bet of sortedBets) {
    if (usedGameIds.has(bet.gameId)) continue
    safeParlay.push(bet)
    usedGameIds.add(bet.gameId)
    if (safeParlay.length === 2) break
  }
  
  // Build aggressive parlay (3 legs) - continue from safe parlay
  const aggressiveParlay = [...safeParlay]
  for (const bet of sortedBets) {
    if (usedGameIds.has(bet.gameId)) continue
    aggressiveParlay.push(bet)
    usedGameIds.add(bet.gameId)
    if (aggressiveParlay.length === 3) break
  }
  
  // Calculate combined probability (multiply individual probabilities)
  const safeCombinedProb = safeParlay.length === 2
    ? (safeParlay[0].consensusProbability / 100) * (safeParlay[1].consensusProbability / 100) * 100
    : null
  
  return {
    safeParlay: safeParlay.length === 2 ? safeParlay : null,
    aggressiveParlay: aggressiveParlay.length === 3 ? aggressiveParlay : null,
    combinedProbability: safeCombinedProb ? Math.round(safeCombinedProb * 10) / 10 : null,
    calculatedAt: now,
    reason: safeParlay.length < 2 ? 'Not enough bets from different games' : null
  }
}

/**
 * Compute best bet for each sport
 */
export function computeSportBestBets(allRankedBets: RankedBet[]): SportBestBets {
  const sportBets: SportBestBets = {}
  
  // Group by sport and pick the best for each
  for (const bet of allRankedBets) {
    if (!sportBets[bet.sportName] || bet.score > sportBets[bet.sportName]!.score) {
      sportBets[bet.sportName] = bet
    }
  }
  
  return sportBets
}

/**
 * Format parlay result for Claude's context
 */
export function formatParlayForContext(parlay: ParlayResult): string {
  const lines: string[] = []
  
  lines.push('=== PRE-COMPUTED PARLAY OF THE DAY ===')
  lines.push('')
  
  if (!parlay.safeParlay) {
    lines.push(`NO PARLAY AVAILABLE: ${parlay.reason}`)
    lines.push('')
    lines.push('When user asks for a parlay, respond with this two-tier message:')
    lines.push('')
    lines.push('TIER 1 - EXPLAIN WHY NO PARLAY:')
    lines.push('"No parlay available today. Parlays require at least 2 games that meet our value criteria (55% probability, 3% edge, max -250 juice)."')
    lines.push('')
    lines.push('"Today\'s market doesn\'t have enough qualifying games to build a responsible parlay."')
    lines.push('')
    lines.push('TIER 2 - OFFER ALTERNATIVES:')
    lines.push('"If you still want a parlay, I can show you:"')
    lines.push('- "Most likely winners parlay - High probability picks combined, but may have negative edge (informational only)"')
    lines.push('')
    lines.push('"Would you like to see that? Note: This is NOT a recommendation - just informational."')
    lines.push('')
    return lines.join('\n')
  }
  
  lines.push('SAFE PARLAY (2 Legs) - Recommended:')
  lines.push(`Combined Win Probability: ${parlay.combinedProbability}%`)
  lines.push('')
  
  for (let i = 0; i < parlay.safeParlay.length; i++) {
    const leg = parlay.safeParlay[i]
    lines.push(`Leg ${i + 1}: ${leg.team} ML (${leg.consensusProbability}%)`)
    lines.push(`  Game: ${leg.awayTeam} @ ${leg.homeTeam}`)
    lines.push(`  Best Price: ${formatOdds(leg.bestPrice)} at ${leg.bestBook}`)
  }
  
  if (parlay.aggressiveParlay) {
    lines.push('')
    lines.push('AGGRESSIVE PARLAY (3 Legs) - Higher Risk/Reward:')
    const aggCombinedProb = parlay.aggressiveParlay.reduce((acc, leg) => acc * (leg.consensusProbability / 100), 1) * 100
    lines.push(`Combined Win Probability: ${Math.round(aggCombinedProb * 10) / 10}%`)
    lines.push('')
    
    for (let i = 0; i < parlay.aggressiveParlay.length; i++) {
      const leg = parlay.aggressiveParlay[i]
      lines.push(`Leg ${i + 1}: ${leg.team} ML (${leg.consensusProbability}%)`)
    }
  }
  
  lines.push('')
  lines.push('IMPORTANT: When user asks for a parlay, present the SAFE PARLAY above.')
  lines.push('Explain that parlay odds vary by sportsbook - recommend placing at one book.')
  
  return lines.join('\n')
}

/**
 * Format sport-specific best bets for Claude's context
 */
export function formatSportBestBetsForContext(sportBets: SportBestBets): string {
  const lines: string[] = []
  
  lines.push('=== SPORT-SPECIFIC BEST BETS ===')
  lines.push('')
  lines.push('When user asks for "best NBA bet" or "best NFL bet", use these:')
  lines.push('')
  
  const sports = Object.keys(sportBets).sort()
  
  if (sports.length === 0) {
    lines.push('No sport-specific bets available.')
    return lines.join('\n')
  }
  
  for (const sport of sports) {
    const bet = sportBets[sport]
    if (!bet) continue
    
    lines.push(`${sport.toUpperCase()}:`)
    lines.push(`  ${bet.team} ML @ ${formatOdds(bet.bestPrice)}`)
    lines.push(`  Game: ${bet.awayTeam} @ ${bet.homeTeam}`)
    lines.push(`  Probability: ${bet.consensusProbability}% | Edge: ${bet.edge}%`)
    lines.push('')
  }
  
  return lines.join('\n')
}

// Cache keys for parlay and sport bets
const PARLAY_CACHE_KEY = 'betanalytics:parlay'
const SPORT_BETS_CACHE_KEY = 'betanalytics:sport-bets'

/**
 * Cache parlay result
 */
export async function cacheParlay(parlay: ParlayResult): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(`${redis.url}/set/${PARLAY_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(parlay))
    })
    
    await fetch(`${redis.url}/expire/${PARLAY_CACHE_KEY}/${4 * 60 * 60}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
  } catch (error) {
    console.error('[cacheParlay] Error:', error)
  }
}

/**
 * Get cached parlay
 */
export async function getCachedParlay(): Promise<ParlayResult | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${PARLAY_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as ParlayResult
  } catch (error) {
    console.error('[getCachedParlay] Error:', error)
    return null
  }
}

/**
 * Cache sport-specific bets
 */
export async function cacheSportBets(sportBets: SportBestBets): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(`${redis.url}/set/${SPORT_BETS_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(sportBets))
    })
    
    await fetch(`${redis.url}/expire/${SPORT_BETS_CACHE_KEY}/${4 * 60 * 60}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
  } catch (error) {
    console.error('[cacheSportBets] Error:', error)
  }
}

/**
 * Get cached sport-specific bets
 */
export async function getCachedSportBets(): Promise<SportBestBets | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${SPORT_BETS_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as SportBestBets
  } catch (error) {
    console.error('[getCachedSportBets] Error:', error)
    return null
  }
}

// ============================================
// BEST PROP OF THE DAY
// ============================================

import type { GamePlayerProps, PlayerProp } from './odds'

export interface RankedProp {
  gameId: string
  sport: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  
  playerName: string
  market: string              // e.g., 'player_points'
  marketDisplay: string       // e.g., 'Points'
  line: number                // e.g., 25.5
  pick: 'Over' | 'Under'
  
  consensusProbability: number
  bestPrice: number
  bestBook: string
  impliedProbability: number
  edge: number
  
  booksWithLine: number       // How many books have this exact line
  allBookPrices: { book: string; price: number; impliedProb: number }[]
  
  score: number
  calculatedAt: string
}

export interface BestPropResult {
  bestProp: RankedProp | null
  runnerUp: RankedProp | null
  allRankedProps: RankedProp[]
  calculatedAt: string
  propsAnalyzed: number
  propsQualified: number
  reason: string | null
}

// Market display names
const MARKET_DISPLAY: Record<string, string> = {
  'player_points': 'Points',
  'player_rebounds': 'Rebounds',
  'player_assists': 'Assists',
  'player_threes': '3-Pointers',
  'player_pass_yds': 'Pass Yards',
  'player_rush_yds': 'Rush Yards',
  'player_reception_yds': 'Receiving Yards',
  'player_pass_tds': 'Pass TDs',
}

/**
 * Compute Best Prop of the Day from player props data
 * 
 * Algorithm:
 * 1. Group props by player + market + line (find consensus lines)
 * 2. For lines with 2+ books, calculate no-vig probability for Over/Under
 * 3. Find best available price
 * 4. Calculate edge and filter by criteria
 * 5. Rank by probability, then edge
 */
export function computeBestProp(propsData: GamePlayerProps[]): BestPropResult {
  const now = new Date().toISOString()
  
  if (!propsData || propsData.length === 0) {
    return {
      bestProp: null,
      runnerUp: null,
      allRankedProps: [],
      calculatedAt: now,
      propsAnalyzed: 0,
      propsQualified: 0,
      reason: 'No player props data available'
    }
  }
  
  const allRankedProps: RankedProp[] = []
  let propsAnalyzed = 0
  
  // Process each game's props
  for (const game of propsData) {
    // Group props by player + market + line
    const propGroups = new Map<string, PlayerProp[]>()
    
    for (const prop of game.props) {
      const key = `${prop.playerName}|${prop.market}|${prop.line}`
      const existing = propGroups.get(key) || []
      existing.push(prop)
      propGroups.set(key, existing)
      propsAnalyzed++
    }
    
    // Analyze each group with 2+ books (consensus)
    const propGroupEntries = Array.from(propGroups.entries())
    for (const [key, props] of propGroupEntries) {
      if (props.length < 2) continue // Need at least 2 books for consensus
      
      const [playerName, market, lineStr] = key.split('|')
      const line = parseFloat(lineStr)
      
      // Calculate no-vig probability for Over and Under
      const overPrices = props.map(p => p.overOdds)
      const underPrices = props.map(p => p.underOdds)
      
      // Calculate median implied probabilities
      const overImpliedProbs = overPrices.map(p => americanToImpliedProbability(p))
      const underImpliedProbs = underPrices.map(p => americanToImpliedProbability(p))
      
      // Remove vig by normalizing (Over + Under should = 100%)
      const avgOverImplied = overImpliedProbs.reduce((a, b) => a + b, 0) / overImpliedProbs.length
      const avgUnderImplied = underImpliedProbs.reduce((a, b) => a + b, 0) / underImpliedProbs.length
      const totalImplied = avgOverImplied + avgUnderImplied
      
      const overNoVig = (avgOverImplied / totalImplied) * 100
      const underNoVig = (avgUnderImplied / totalImplied) * 100
      
      // Determine which side has better value
      const bestOverPrice = Math.max(...overPrices)
      const bestUnderPrice = Math.max(...underPrices)
      
      const overBestImplied = americanToImpliedProbability(bestOverPrice) * 100
      const underBestImplied = americanToImpliedProbability(bestUnderPrice) * 100
      
      const overEdge = overNoVig - overBestImplied
      const underEdge = underNoVig - underBestImplied
      
      // Pick the side with better edge (if it meets criteria)
      const sides: Array<{
        pick: 'Over' | 'Under'
        consensusProb: number
        bestPrice: number
        bestImplied: number
        edge: number
        prices: number[]
      }> = [
        { pick: 'Over', consensusProb: overNoVig, bestPrice: bestOverPrice, bestImplied: overBestImplied, edge: overEdge, prices: overPrices },
        { pick: 'Under', consensusProb: underNoVig, bestPrice: bestUnderPrice, bestImplied: underBestImplied, edge: underEdge, prices: underPrices }
      ]
      
      for (const side of sides) {
        // Apply filters
        if (side.consensusProb < MIN_PROBABILITY * 100) continue
        if (side.edge < MIN_EDGE * 100) continue
        if (side.bestPrice < MAX_JUICE_ODDS) continue
        
        // Find which book has the best price
        const bestBookIndex = side.prices.indexOf(side.bestPrice)
        const bestBook = props[bestBookIndex]?.bookmaker || 'Unknown'
        
        // Build all book prices
        const allBookPrices = props.map(p => ({
          book: p.bookmaker,
          price: side.pick === 'Over' ? p.overOdds : p.underOdds,
          impliedProb: Math.round(americanToImpliedProbability(side.pick === 'Over' ? p.overOdds : p.underOdds) * 1000) / 10
        }))
        
        // Calculate score (probability * 0.7 + edge * 0.3)
        const score = side.consensusProb * 0.7 + side.edge * 0.3
        
        allRankedProps.push({
          gameId: game.gameId,
          sport: game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          commenceTime: game.commenceTime,
          playerName,
          market,
          marketDisplay: MARKET_DISPLAY[market] || market,
          line,
          pick: side.pick,
          consensusProbability: Math.round(side.consensusProb * 10) / 10,
          bestPrice: side.bestPrice,
          bestBook,
          impliedProbability: Math.round(side.bestImplied * 10) / 10,
          edge: Math.round(side.edge * 10) / 10,
          booksWithLine: props.length,
          allBookPrices,
          score,
          calculatedAt: now
        })
      }
    }
  }
  
  // Sort by score (desc)
  allRankedProps.sort((a, b) => b.score - a.score)
  
  return {
    bestProp: allRankedProps[0] || null,
    runnerUp: allRankedProps[1] || null,
    allRankedProps: allRankedProps.slice(0, 10),
    calculatedAt: now,
    propsAnalyzed,
    propsQualified: allRankedProps.length,
    reason: allRankedProps.length === 0 ? 'No props meet criteria (55%+ probability, 3%+ edge)' : null
  }
}

/**
 * Format best prop result for Claude's context
 */
export function formatBestPropForContext(result: BestPropResult): string {
  const lines: string[] = []
  
  lines.push('=== PRE-COMPUTED BEST PROP OF THE DAY ===')
  lines.push('')
  
  if (!result.bestProp) {
    lines.push(`NO BEST PROP AVAILABLE: ${result.reason}`)
    lines.push('')
    lines.push('When user asks for a prop bet, respond with this two-tier message:')
    lines.push('')
    lines.push('TIER 1 - EXPLAIN WHY NO PROP:')
    lines.push('"No high-confidence prop bets today. Our criteria (55% probability, 3% edge, max -250 juice) ensure we only recommend +EV player props."')
    lines.push('')
    lines.push('"Today\'s prop market doesn\'t have any lines with enough edge to recommend."')
    lines.push('')
    lines.push('TIER 2 - OFFER ALTERNATIVES:')
    lines.push('"If you still want a prop bet, I can show you:"')
    lines.push('- "Closest misses - Props that nearly qualified (reasonable odds, small edge)"')
    lines.push('- "Popular props - High-volume props that many bettors are taking (informational only)"')
    lines.push('')
    lines.push('"Which would you like to see? Note: These are NOT recommendations - just informational."')
    lines.push('')
    return lines.join('\n')
  }
  
  const prop = result.bestProp
  
  lines.push('BEST PROP OF THE DAY:')
  lines.push(`Player: ${prop.playerName}`)
  lines.push(`Prop: ${prop.pick} ${prop.line} ${prop.marketDisplay}`)
  lines.push(`Game: ${prop.awayTeam} @ ${prop.homeTeam}`)
  lines.push('')
  lines.push('PROBABILITY CALCULATION:')
  lines.push(`- Consensus Probability: ${prop.consensusProbability}% (no-vig from ${prop.booksWithLine} books)`)
  lines.push(`- Best Available Price: ${formatOdds(prop.bestPrice)} at ${prop.bestBook}`)
  lines.push(`- Implied Probability: ${prop.impliedProbability}%`)
  lines.push(`- EDGE: ${prop.edge}%`)
  lines.push('')
  lines.push('ALL BOOK PRICES:')
  for (const book of prop.allBookPrices) {
    lines.push(`  ${book.book}: ${formatOdds(book.price)} (${book.impliedProb}% implied)`)
  }
  
  if (result.runnerUp) {
    const ru = result.runnerUp
    lines.push('')
    lines.push('RUNNER-UP PROP:')
    lines.push(`${ru.playerName} ${ru.pick} ${ru.line} ${ru.marketDisplay}`)
    lines.push(`Probability: ${ru.consensusProbability}% | Edge: ${ru.edge}%`)
  }
  
  lines.push('')
  lines.push('IMPORTANT: When user asks for a prop bet, present the BEST PROP above.')
  lines.push('Do NOT pick a different prop. This is the pre-computed best prop based on market consensus.')
  
  return lines.join('\n')
}

// Cache key for best prop
const BEST_PROP_CACHE_KEY = 'betanalytics:best-prop'

/**
 * Cache best prop result
 */
export async function cacheBestProp(result: BestPropResult): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(`${redis.url}/set/${BEST_PROP_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(result))
    })
    
    await fetch(`${redis.url}/expire/${BEST_PROP_CACHE_KEY}/${4 * 60 * 60}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
  } catch (error) {
    console.error('[cacheBestProp] Error:', error)
  }
}

/**
 * Get cached best prop
 */
export async function getCachedBestProp(): Promise<BestPropResult | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${BEST_PROP_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as BestPropResult
  } catch (error) {
    console.error('[getCachedBestProp] Error:', error)
    return null
  }
}

// ============================================
// GAME-SPECIFIC MENU
// ============================================

export interface GameMenu {
  gameId: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  
  safestBet: {
    type: 'moneyline'
    team: string
    odds: number
    book: string
    probability: number
    edge: number
  } | null
  
  valueBets: Array<{
    type: 'spread' | 'total'
    description: string
    odds: number
    book: string
  }>
  
  calculatedAt: string
}

/**
 * Compute game-specific menu for a single game
 * Returns safest bet (moneyline favorite with edge) and value options (spreads/totals)
 */
export function computeGameMenu(game: Game): GameMenu {
  const now = new Date().toISOString()
  
  const menu: GameMenu = {
    gameId: game.id,
    sport: game.sport,
    sportName: game.sportName,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    safestBet: null,
    valueBets: [],
    calculatedAt: now
  }
  
  // Calculate safest bet (moneyline with highest probability and edge)
  const homeConsensus = calculateConsensusProbability(game, game.homeTeam)
  const awayConsensus = calculateConsensusProbability(game, game.awayTeam)
  
  const candidates: Array<{
    team: string
    consensus: NonNullable<ReturnType<typeof calculateConsensusProbability>>
  }> = []
  
  if (homeConsensus) candidates.push({ team: game.homeTeam, consensus: homeConsensus })
  if (awayConsensus) candidates.push({ team: game.awayTeam, consensus: awayConsensus })
  
  // Find the safest bet (highest probability with positive edge)
  for (const candidate of candidates) {
    const bestPrice = findBestPrice(game, candidate.team)
    if (!bestPrice) continue
    
    const impliedProb = americanToImpliedProbability(bestPrice.price) * 100
    const edge = candidate.consensus.consensusProb - impliedProb
    
    if (edge >= MIN_EDGE * 100 && candidate.consensus.consensusProb >= MIN_PROBABILITY * 100) {
      if (!menu.safestBet || candidate.consensus.consensusProb > menu.safestBet.probability) {
        menu.safestBet = {
          type: 'moneyline',
          team: candidate.team,
          odds: bestPrice.price,
          book: bestPrice.book,
          probability: Math.round(candidate.consensus.consensusProb * 10) / 10,
          edge: Math.round(edge * 10) / 10
        }
      }
    }
  }
  
  // Add value bets (spreads and totals)
  // Best spread
  if (game.spreads.length > 0) {
    for (const spread of game.spreads) {
      for (const outcome of spread.outcomes) {
        if (outcome.point !== undefined) {
          menu.valueBets.push({
            type: 'spread',
            description: `${outcome.name} ${outcome.point > 0 ? '+' : ''}${outcome.point}`,
            odds: outcome.price,
            book: spread.bookmaker
          })
        }
      }
    }
  }
  
  // Best total
  if (game.totals.length > 0) {
    for (const total of game.totals) {
      for (const outcome of total.outcomes) {
        if (outcome.point !== undefined) {
          menu.valueBets.push({
            type: 'total',
            description: `${outcome.name} ${outcome.point}`,
            odds: outcome.price,
            book: total.bookmaker
          })
        }
      }
    }
  }
  
  // Limit value bets to best 4
  menu.valueBets = menu.valueBets.slice(0, 4)
  
  return menu
}

/**
 * Format game menu for Claude's context
 */
export function formatGameMenuForContext(menu: GameMenu): string {
  const lines: string[] = []
  
  lines.push(`=== GAME MENU: ${menu.awayTeam} @ ${menu.homeTeam} ===`)
  lines.push('')
  
  if (menu.safestBet) {
    lines.push('SAFEST BET (Moneyline with Edge):')
    lines.push(`  ${menu.safestBet.team} ML @ ${formatOdds(menu.safestBet.odds)} (${menu.safestBet.book})`)
    lines.push(`  Probability: ${menu.safestBet.probability}% | Edge: ${menu.safestBet.edge}%`)
  } else {
    lines.push('SAFEST BET: No moneyline meets our criteria for this game')
  }
  
  lines.push('')
  
  if (menu.valueBets.length > 0) {
    lines.push('VALUE OPTIONS (Spreads/Totals):')
    for (const bet of menu.valueBets) {
      lines.push(`  ${bet.description} @ ${formatOdds(bet.odds)} (${bet.book})`)
    }
  }
  
  return lines.join('\n')
}
