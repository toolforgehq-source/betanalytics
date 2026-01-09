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

export interface BestBetResult {
  bestBet: RankedBet | null
  runnerUp: RankedBet | null
  allRankedBets: RankedBet[]
  calculatedAt: string
  gamesAnalyzed: number
  gamesQualified: number
  reason: string | null  // Why no best bet if null
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
 * Compute the Best Bet of the Day from all available games
 * This is the main entry point - call this on each cron refresh
 */
export function computeBestBets(games: Game[]): BestBetResult {
  const now = new Date().toISOString()
  const allRankedBets: RankedBet[] = []
  
  // Analyze all games
  for (const game of games) {
    const bets = analyzeGame(game)
    allRankedBets.push(...bets)
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
  
  return {
    bestBet,
    runnerUp,
    allRankedBets: allRankedBets.slice(0, 10), // Top 10 for context
    calculatedAt: now,
    gamesAnalyzed: games.length,
    gamesQualified: allRankedBets.length,
    reason
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
    lines.push('When user asks for "best bet", explain that no games currently meet our criteria:')
    lines.push('- Minimum 55% win probability (market consensus)')
    lines.push('- Minimum 3% edge (better price than fair value)')
    lines.push('- Maximum -250 juice (reasonable odds)')
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
    lines.push('When user asks for a parlay, explain that not enough games meet our criteria.')
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
