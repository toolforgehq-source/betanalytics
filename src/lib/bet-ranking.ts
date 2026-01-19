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
import type { EnrichedGame } from './combined-data'
import type { ESPNInjury } from './espn'
import { getPlayerPropProbability, getPlayerStatsData, type PlayerStats } from './player-stats'
import { trackBestBet, trackParlay, trackSportBet, trackPropBet } from './recommendation-tracking'
import { 
  getEloWinProbabilityByName, 
  getEloWinProbabilityWithInjuries,
  calculateSpreadCoverProbability,
  calculateTotalProbability,
  type InjuryInfo,
  type PlayerImportance
} from './elo'

export interface RankedBet {
  gameId: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  
  // The recommended bet
  team: string
  betType: 'moneyline' | 'spread' | 'total'
  line?: number  // For spread/total bets (e.g., -3.5, +7, 224.5)
  
  // Probability and edge calculations
  consensusProbability: number  // No-vig average across books (market fair value)
  bestPrice: number             // Best available American odds
  bestBook: string              // Which book has the best price
  impliedProbability: number    // Implied prob from best price
  edge: number                  // modelProbability - impliedProbability (Elo-based edge)
  
  // Elo model data (when available)
  eloProbability?: number       // Our Elo model's win probability
  eloConfidence?: string        // Confidence level based on games played
  homeElo?: number              // Home team's Elo rating
  awayElo?: number              // Away team's Elo rating
  
  // Expected Value and ROI calculations (based on Elo probability when available)
  expectedValue: number         // EV in dollars per $100 bet
  roi: number                   // ROI as percentage
  
  // All book prices for transparency
  allBookPrices: { book: string; price: number; impliedProb: number }[]
  
  // Ranking score (for sorting) - NOW BASED ON EV/ROI
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
  // Expected Value and ROI calculations
  expectedValue: number         // EV in dollars per $100 bet
  roi: number                   // ROI as percentage
  // NEW: Unified score (same formula as RankedBet)
  score: number                 // Score from -55 to 100
  // Filter status
  disqualifyReasons: string[]
  isValuePlay: boolean          // True if qualifies as VALUE PLAY (48%+ prob, 5%+ ROI)
  // Elo model data (when available)
  eloProbability?: number       // Our Elo model's win probability
  eloConfidence?: string        // Confidence level based on games played
  homeElo?: number              // Home team's Elo rating
  awayElo?: number              // Away team's Elo rating
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

// ============================================
// NEW UNIFIED SCORING SYSTEM
// ============================================
// 
// HARD FILTERS (automatic rejection):
// - Odds limit: Reject if American odds worse than -250
// - Probability floor: Reject if win probability below 52%
// - ROI floor: Reject if ROI worse than -4.5%
//
// SCORING FORMULA (100 points max):
// - Probability Score: 45 points max
// - ROI Score: 35 points max (negative values SUBTRACT points)
// - Edge Score: 20 points max (negative values SUBTRACT points)
//
// VALUE PLAY EXCEPTION:
// - Bets with +5% ROI can have probability as low as 48%
// - These are labeled as "VALUE PLAY" not "BEST BET"
//
// PROGRESSIVE FALLBACK (when nothing passes filters):
// - Attempt 1: All filters (odds -250, prob 52%, ROI -4.5%)
// - Attempt 2: Relax ROI to -6%
// - Attempt 3: Relax ROI to -8%
// - Attempt 4: Relax odds to -300
// - Attempt 5: Relax prob to 50%
// - Final: "No recommended bets today"

// Filter thresholds
const MAX_JUICE_ODDS = -250       // Don't recommend worse than -250
const MIN_PROBABILITY = 0.52     // 52% minimum win probability
const MIN_ROI = -4.5             // -4.5% minimum ROI (as percentage)

// VALUE PLAY exception thresholds
const VALUE_PLAY_MIN_ROI = 5.0   // +5% ROI required for VALUE PLAY
const VALUE_PLAY_MIN_PROB = 0.48 // 48% minimum probability for VALUE PLAY

// Progressive fallback thresholds
const FALLBACK_ROI_RELAXED_1 = -6.0  // First relaxation
const FALLBACK_ROI_RELAXED_2 = -8.0  // Second relaxation
const FALLBACK_ODDS_RELAXED = -300   // Relaxed odds limit
const FALLBACK_PROB_RELAXED = 0.50   // Relaxed probability floor

// Legacy thresholds (for qualified bets - stricter)
const MIN_EDGE = 0.03             // 3% minimum edge for "qualified" bets

// Spread-specific thresholds (more relaxed since spreads are ~50% probability)
const MIN_SPREAD_PROBABILITY = 0.48  // 48% minimum for spreads (they're designed to be ~50%)
const MIN_SPREAD_EDGE = 0.01         // 1% minimum edge for spreads (edges are smaller from line shopping)
const MIN_SPREAD_ROI = 0.5           // 0.5% minimum ROI for spreads

// SANITY CHECK: Maximum edge threshold - edges > 25% are almost certainly calculation errors
// Real market inefficiencies rarely exceed 5-10%, and even sharp bettors rarely find 15%+ edges
const MAX_SANE_EDGE = 0.25           // 25% maximum edge - anything higher is flagged as suspicious

// Reputable books for consensus calculation (exclude sharp-only books)
const CONSENSUS_BOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet',
  'BetRivers', 'Unibet', 'Barstool', 'WynnBET', 'SuperBook'
]

// Map odds API sport codes to Elo league names
const SPORT_TO_ELO_LEAGUE: Record<string, string> = {
  'basketball_nba': 'NBA',
  'basketball_ncaab': 'NCAAB',
  'americanfootball_nfl': 'NFL',
  'americanfootball_ncaaf': 'NCAAF',
  'icehockey_nhl': 'NHL',
  'baseball_mlb': 'MLB',
  'soccer_epl': 'soccer_epl',
  'soccer_spain_la_liga': 'soccer_spain_la_liga',
  'soccer_germany_bundesliga': 'soccer_germany_bundesliga',
  'soccer_italy_serie_a': 'soccer_italy_serie_a',
  'soccer_france_ligue_one': 'soccer_france_ligue_one',
  'soccer_usa_mls': 'soccer_usa_mls',
  'soccer_uefa_champs_league': 'soccer_uefa_champs_league',
}

/**
 * Convert ESPN injury data to InjuryInfo format for Elo calculations
 */
function convertESPNInjuriesToInjuryInfo(espnInjuries: ESPNInjury[]): InjuryInfo[] {
  return espnInjuries.map(injury => ({
    player: injury.player,
    team: injury.team,
    status: injury.status,
    details: injury.details
  }))
}

/**
 * Normalize team name for matching (handles "Denver Nuggets" vs "Nuggets" vs "Denver")
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

/**
 * Check if two team names match (fuzzy matching)
 */
function teamsMatch(team1: string, team2: string): boolean {
  const n1 = normalizeTeamName(team1)
  const n2 = normalizeTeamName(team2)
  return n1.includes(n2) || n2.includes(n1) || n1 === n2
}

/**
 * Check if a team has a star player OUT
 * Returns the name of the OUT star player if found, null otherwise
 * 
 * A "star player" is defined as one of the top 3 scorers on the team
 * This prevents recommending bets on teams missing key players like Jokic, LeBron, etc.
 */
async function getStarPlayerOut(
  teamName: string, 
  sport: string, 
  injuries: InjuryInfo[]
): Promise<string | null> {
  try {
    // Get top scorers for the team
    const topScorers = await getTopScorersForTeam(teamName, sport)
    if (topScorers.length === 0) {
      return null
    }
    
    // Check if any top scorer is OUT
    for (const scorer of topScorers) {
      const matchingInjury = injuries.find(inj => {
        const nameMatch = normalizeTeamName(inj.player).includes(normalizeTeamName(scorer.playerName)) ||
                          normalizeTeamName(scorer.playerName).includes(normalizeTeamName(inj.player))
        const teamMatch = teamsMatch(inj.team, teamName)
        const isOut = inj.status.toLowerCase() === 'out' || 
                      inj.status.toLowerCase().includes('out for') ||
                      inj.status.toLowerCase() === 'doubtful'
        return nameMatch && teamMatch && isOut
      })
      
      if (matchingInjury) {
        return matchingInjury.player
      }
    }
    
    return null
  } catch (error) {
    console.error('[getStarPlayerOut] Error:', error)
    return null
  }
}

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
 * Calculate Expected Value (EV) in dollars per $100 bet
 * EV = (Win Probability × Payout) - (Loss Probability × Stake)
 * 
 * Example: -800 odds with 89% probability
 * - Payout on win: $12.50 (100/8)
 * - EV = (0.89 × $12.50) - (0.11 × $100) = $11.13 - $11 = +$0.13
 * - This is terrible value despite high probability!
 */
export function calculateExpectedValue(americanOdds: number, winProbability: number): number {
  const winProb = winProbability // Already in decimal form (0-1)
  const loseProb = 1 - winProb
  
  let payout: number
  if (americanOdds < 0) {
    // Favorite: -200 means bet $200 to win $100, so payout per $100 bet = 100 / (200/100) = $50
    payout = 100 / (Math.abs(americanOdds) / 100)
  } else {
    // Underdog: +150 means bet $100 to win $150
    payout = americanOdds
  }
  
  // EV = (Win Prob × Payout) - (Loss Prob × Stake)
  const ev = (winProb * payout) - (loseProb * 100)
  
  return ev
}

/**
 * Calculate ROI (Return on Investment) as a percentage
 * ROI = EV / Stake × 100
 */
export function calculateROI(expectedValue: number): number {
  return (expectedValue / 100) * 100 // EV per $100 bet as percentage
}

/**
 * Calculate bet quality score (-55 to 100)
 * 
 * NEW UNIFIED SCORING SYSTEM (45/35/20 weights):
 * - Probability Score: 45 points max (most important - we want users to win)
 * - ROI Score: 35 points max (important - negative values SUBTRACT points)
 * - Edge Score: 20 points max (useful - negative values SUBTRACT points)
 * 
 * This ensures:
 * - High win rate (users happy they're winning)
 * - Reasonable value (users not losing too much on -EV days)
 * - Balanced approach (not just picking highest probability)
 * 
 * @param winProbability - Win probability as decimal (0-1, e.g., 0.67 = 67%)
 * @param edge - Edge as decimal (e.g., 0.03 = 3%, -0.028 = -2.8%)
 * @param roi - ROI as percentage (e.g., 5.0 = 5%, -4.0 = -4%)
 * @returns Score from -55 to 100
 */
function calculateBetScore(
  winProbability: number,  // 0-1 (e.g., 0.67 = 67%)
  edge: number,            // decimal (e.g., 0.03 = 3%)
  roi: number              // percentage (e.g., 5.0 = 5%)
): number {
  // ============================================
  // PROBABILITY SCORE: 45 points maximum
  // ============================================
  // Formula: ((Win Probability - 50) / 40) × 45
  // 50% = 0 points, 60% = 11.25 points, 70% = 22.5 points, 90% = 45 points
  const probPercent = winProbability * 100  // Convert to 0-100 scale
  const probScore = Math.max(0, Math.min(45, ((probPercent - 50) / 40) * 45))
  
  // ============================================
  // ROI SCORE: 35 points maximum (can go negative!)
  // ============================================
  // Different formulas for positive vs negative ROI:
  // - Positive ROI: Score = 17.5 + (ROI / 20) × 17.5
  // - Negative ROI: Score = 17.5 + (ROI / 10) × 17.5 (penalized more heavily)
  // 
  // Examples:
  // +20% ROI = 35 points (max)
  // +5% ROI = 21.875 points
  // 0% ROI = 17.5 points
  // -4% ROI = 10.5 points
  // -10% ROI = 0 points
  // -20% ROI = -17.5 points
  let roiScore: number
  if (roi >= 0) {
    // Positive ROI: rewarded
    roiScore = 17.5 + (roi / 20) * 17.5
  } else {
    // Negative ROI: penalized more heavily
    roiScore = 17.5 + (roi / 10) * 17.5
  }
  roiScore = Math.max(-35, Math.min(35, roiScore))
  
  // ============================================
  // EDGE SCORE: 20 points maximum (can go negative!)
  // ============================================
  // Formula: (Edge / 10) × 20
  // +10% edge = 20 points (max)
  // +5% edge = 10 points
  // 0% edge = 0 points
  // -2.8% edge = -5.6 points
  // -10% edge = -20 points
  const edgePercent = edge * 100  // Convert to percentage
  const edgeScore = Math.max(-20, Math.min(20, (edgePercent / 10) * 20))
  
  // ============================================
  // TOTAL SCORE
  // ============================================
  // Possible range: -55 to 100 points
  // - Worst possible: 0 + (-35) + (-20) = -55 points
  // - Best possible: 45 + 35 + 20 = 100 points
  return Math.round(probScore + roiScore + edgeScore)
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
 * Remove vig from a 3-way market (Home/Draw/Away) to get true probabilities
 * Takes all three outcomes' implied probabilities and normalizes to sum to 1
 * 
 * Example: Home -140 (58.3%), Draw +260 (27.8%), Away +350 (22.2%)
 * Total = 108.3% (8.3% vig)
 * True Home = 58.3/108.3 = 53.8%
 * True Draw = 27.8/108.3 = 25.7%
 * True Away = 22.2/108.3 = 20.5%
 */
function removeVigThreeWay(
  homeImplied: number, 
  drawImplied: number, 
  awayImplied: number
): { home: number; draw: number; away: number } {
  const total = homeImplied + drawImplied + awayImplied
  return {
    home: homeImplied / total,
    draw: drawImplied / total,
    away: awayImplied / total
  }
}

/**
 * Calculate consensus no-vig probability for a team in a 3-way market (soccer)
 * This properly accounts for the Draw outcome when calculating win probability
 */
function calculateConsensusProbabilityThreeWay(
  game: Game,
  team: string
): { consensusProb: number; bookPrices: { book: string; price: number; impliedProb: number; noVigProb: number }[] } | null {
  const bookPrices: { book: string; price: number; impliedProb: number; noVigProb: number }[] = []
  
  const isHomeTeam = team === game.homeTeam
  
  for (const ml of game.moneylines) {
    // Only use reputable books for consensus
    if (!CONSENSUS_BOOKS.includes(ml.bookmaker)) continue
    
    // Must have exactly 3 outcomes (Home, Draw, Away)
    if (ml.outcomes.length !== 3) continue
    
    const homeOutcome = ml.outcomes.find(o => o.name === game.homeTeam)
    const awayOutcome = ml.outcomes.find(o => o.name === game.awayTeam)
    const drawOutcome = ml.outcomes.find(o => 
      o.name.toLowerCase() === 'draw' || 
      o.name.toLowerCase() === 'tie' ||
      o.name.toLowerCase() === 'x'
    )
    
    if (!homeOutcome || !awayOutcome || !drawOutcome) continue
    
    const homeImplied = americanToImpliedProbability(homeOutcome.price)
    const awayImplied = americanToImpliedProbability(awayOutcome.price)
    const drawImplied = americanToImpliedProbability(drawOutcome.price)
    
    // Remove vig using 3-way calculation
    const noVig = removeVigThreeWay(homeImplied, drawImplied, awayImplied)
    
    // Get the team's no-vig probability
    const teamNoVigProb = isHomeTeam ? noVig.home : noVig.away
    const teamOutcome = isHomeTeam ? homeOutcome : awayOutcome
    const teamImplied = isHomeTeam ? homeImplied : awayImplied
    
    bookPrices.push({
      book: ml.bookmaker,
      price: teamOutcome.price,
      impliedProb: teamImplied,
      noVigProb: teamNoVigProb
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
 * Calculate consensus no-vig probability for a team from multiple books
 * Handles both 2-way markets (most sports) and 3-way markets (soccer)
 */
function calculateConsensusProbability(
  game: Game,
  team: string
): { consensusProb: number; bookPrices: { book: string; price: number; impliedProb: number; noVigProb: number }[] } | null {
  // For 3-way markets (soccer), use the specialized 3-way calculation
  // This properly accounts for Draw probability when calculating win probability
  if (isThreeWayMarket(game)) {
    return calculateConsensusProbabilityThreeWay(game, team)
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
/**
 * Get top 3 scorers for a team from player stats data
 * Used for injury adjustment calculations
 */
async function getTopScorersForTeam(
  teamName: string,
  sport: string
): Promise<PlayerImportance[]> {
  try {
    const playerStats = await getPlayerStatsData()
    if (!playerStats || !playerStats.players) return []
    
    // Filter players for this team and sport (players is a Record, not an array)
    const allPlayers = Object.values(playerStats.players)
    const teamPlayers = allPlayers.filter((p: PlayerStats) => {
      const playerTeamNorm = p.teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
      const teamNorm = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
      return (playerTeamNorm.includes(teamNorm) || teamNorm.includes(playerTeamNorm)) &&
             p.sport.toLowerCase() === sport.toLowerCase()
    })
    
    // Get scoring average based on sport
    const getScoringAverage = (player: PlayerStats): number => {
      if (sport === 'basketball_nba' || sport === 'basketball_ncaab') {
        return player.averages?.points || 0
      } else if (sport === 'icehockey_nhl') {
        return player.averages?.goals || 0
      } else if (sport === 'americanfootball_nfl' || sport === 'americanfootball_ncaaf') {
        // For NFL/NCAAF, use total yards as a proxy for importance
        return (player.averages?.passingYards || 0) + 
               (player.averages?.rushingYards || 0) + 
               (player.averages?.receivingYards || 0)
      }
      return 0
    }
    
    // Sort by scoring average and take top 3
    const sortedPlayers = teamPlayers
      .map((p: PlayerStats) => ({
        playerName: p.playerName,
        teamName: p.teamName,
        sport: p.sport,
        scoringAverage: getScoringAverage(p),
        isTopScorer: true
      }))
      .sort((a: PlayerImportance, b: PlayerImportance) => b.scoringAverage - a.scoringAverage)
      .slice(0, 3)
    
    return sortedPlayers
  } catch (error) {
    console.error('[getTopScorersForTeam] Error:', error)
    return []
  }
}

export async function analyzeGame(game: Game, injuries?: InjuryInfo[]): Promise<RankedBet[]> {
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
  
  // Get Elo prediction for this game (if available)
  const eloLeague = SPORT_TO_ELO_LEAGUE[game.sport]
  let eloResult: { 
    probability: number
    homeRating: number
    awayRating: number
    confidence: string
    homeEffectiveRating?: number
    awayEffectiveRating?: number
    homeAdjustments?: string[]
    awayAdjustments?: string[]
  } | null = null
  
  if (eloLeague) {
    try {
      // If injuries are provided, use injury-adjusted Elo
      if (injuries && injuries.length > 0) {
        // Get top scorers for both teams (for NBA/NCAAB/NHL injury adjustments)
        const [homeTopScorers, awayTopScorers] = await Promise.all([
          getTopScorersForTeam(game.homeTeam, game.sport),
          getTopScorersForTeam(game.awayTeam, game.sport)
        ])
        
        const injuryResult = await getEloWinProbabilityWithInjuries(
          eloLeague,
          game.homeTeam,
          game.awayTeam,
          injuries,
          homeTopScorers,
          awayTopScorers
        )
        
        if (injuryResult) {
          eloResult = {
            probability: injuryResult.probability,
            homeRating: injuryResult.homeRating,
            awayRating: injuryResult.awayRating,
            confidence: injuryResult.confidence,
            homeEffectiveRating: injuryResult.homeEffectiveRating,
            awayEffectiveRating: injuryResult.awayEffectiveRating,
            homeAdjustments: injuryResult.homeAdjustments,
            awayAdjustments: injuryResult.awayAdjustments
          }
          
          // Log injury adjustments for debugging
          if (injuryResult.homeAdjustments.length > 0 || injuryResult.awayAdjustments.length > 0) {
            console.log(`[analyzeGame] Injury adjustments for ${game.homeTeam} vs ${game.awayTeam}:`)
            if (injuryResult.homeAdjustments.length > 0) {
              console.log(`  ${game.homeTeam}: ${injuryResult.homeAdjustments.join(', ')}`)
            }
            if (injuryResult.awayAdjustments.length > 0) {
              console.log(`  ${game.awayTeam}: ${injuryResult.awayAdjustments.join(', ')}`)
            }
          }
        }
      } else {
        // No injuries, use standard Elo
        eloResult = await getEloWinProbabilityByName(eloLeague, game.homeTeam, game.awayTeam)
      }
    } catch (error) {
      console.error('[analyzeGame] Error fetching Elo:', error)
    }
  }
  
  // Analyze both teams
  for (const team of [game.homeTeam, game.awayTeam]) {
    const consensus = calculateConsensusProbability(game, team)
    if (!consensus) continue
    
    const bestPrice = findBestPrice(game, team)
    if (!bestPrice) continue
    
    // Check juice constraint (don't recommend worse than -250)
    if (bestPrice.price < MAX_JUICE_ODDS) continue
    
    // Determine model probability: use Elo if available and confident, else use market consensus
    const isHomeTeam = team === game.homeTeam
    let modelProbability = consensus.consensusProb
    let eloProbability: number | undefined
    let eloConfidence: string | undefined
    let homeElo: number | undefined
    let awayElo: number | undefined
    
    if (eloResult && eloResult.confidence !== 'very_low') {
      // Elo returns home team win probability, so flip for away team
      eloProbability = isHomeTeam ? eloResult.probability : (1 - eloResult.probability)
      eloConfidence = eloResult.confidence
      homeElo = eloResult.homeRating
      awayElo = eloResult.awayRating
      
      // Use Elo as the model probability for edge calculation
      modelProbability = eloProbability
    }
    
    // Calculate edge: model probability - implied probability from best price
    // This is the key change: edge is now based on our Elo model vs market
    const edge = modelProbability - bestPrice.impliedProb
    
    // Calculate Expected Value and ROI using MODEL probability (Elo when available)
    const ev = calculateExpectedValue(bestPrice.price, modelProbability)
    const roi = calculateROI(ev)
    
    // Check minimum thresholds using MODEL probability
    if (modelProbability < MIN_PROBABILITY) continue
    if (edge < MIN_EDGE) continue
    
    // Also require positive EV
    if (ev <= 0) continue
    
    // Require minimum ROI of 1% to avoid tiny-edge heavy favorites
    if (roi < 1) continue
    
    // Calculate score using EV-based scoring system
    const score = calculateBetScore(modelProbability, edge, roi)
    
    rankedBets.push({
      gameId: game.id,
      sport: game.sport,
      sportName: game.sportName,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      team,
      betType: 'moneyline',
      consensusProbability: Math.round(consensus.consensusProb * 1000) / 10, // Market fair value
      bestPrice: bestPrice.price,
      bestBook: bestPrice.book,
      impliedProbability: Math.round(bestPrice.impliedProb * 1000) / 10,
      edge: Math.round(edge * 1000) / 10, // Now based on Elo vs market
      eloProbability: eloProbability ? Math.round(eloProbability * 1000) / 10 : undefined,
      eloConfidence,
      homeElo,
      awayElo,
      expectedValue: Math.round(ev * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      allBookPrices: consensus.bookPrices.map(b => ({
        book: b.book,
        price: b.price,
        impliedProb: Math.round(b.impliedProb * 1000) / 10
      })),
      score,
      calculatedAt: now
    })
  }
  
  // SPREAD ANALYSIS - uses Elo-based cover probability
  if (game.spreads && game.spreads.length > 0 && eloResult) {
    // Group spreads by team and line
    const spreadLines = new Map<string, { outcome: { name: string; price: number; point: number }; book: string }[]>()
    
    for (const spread of game.spreads) {
      for (const outcome of spread.outcomes) {
        if (outcome.point !== undefined) {
          const key = `${outcome.name}|${outcome.point}`
          if (!spreadLines.has(key)) spreadLines.set(key, [])
          spreadLines.get(key)!.push({ outcome: { ...outcome, point: outcome.point }, book: spread.bookmaker })
        }
      }
    }
    
    // Evaluate each unique spread line
    spreadLines.forEach((entries, key) => {
      const [teamName, pointStr] = key.split('|')
      const point = parseFloat(pointStr)
      
      // Find best price across all books
      const bestEntry = entries.reduce((best, curr) => 
        curr.outcome.price > best.outcome.price ? curr : best
      )
      
      // Determine if this is for home or away team
      const isHomeTeam = teamName.toLowerCase().includes(game.homeTeam.toLowerCase()) ||
                         game.homeTeam.toLowerCase().includes(teamName.toLowerCase())
      
      // Use effective ratings if available (injury-adjusted), otherwise use base ratings
      const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
      const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
      
      // Calculate Elo-based spread cover probability
      // Note: spread is from the team's perspective (e.g., home -3.5 means home must win by > 3.5)
      // For home team: use spread as-is
      // For away team: the spread is already from away's perspective (e.g., away +3.5)
      const spreadFromHomePerspective = isHomeTeam ? point : -point
      const spreadResult = calculateSpreadCoverProbability(
        homeElo,
        awayElo,
        spreadFromHomePerspective,
        eloLeague,
        isHomeTeam
      )
      
      const eloCoverProb = spreadResult.probability
      
      // DEBUG: Log spread calculation inputs for high-probability bets
      if (eloCoverProb > 0.85) {
        console.log(`[SPREAD DEBUG] ${teamName} ${point > 0 ? '+' : ''}${point}:`)
        console.log(`  - homeTeam: ${game.homeTeam}, awayTeam: ${game.awayTeam}`)
        console.log(`  - isHomeTeam: ${isHomeTeam}`)
        console.log(`  - point (from odds): ${point}`)
        console.log(`  - spreadFromHomePerspective: ${spreadFromHomePerspective}`)
        console.log(`  - eloLeague: ${eloLeague}`)
        console.log(`  - homeElo (effective): ${homeElo}, awayElo (effective): ${awayElo}`)
        console.log(`  - homeElo (base): ${eloResult.homeRating}, awayElo (base): ${eloResult.awayRating}`)
        console.log(`  - expectedMargin: ${spreadResult.expectedMargin}`)
        console.log(`  - eloCoverProb: ${(eloCoverProb * 100).toFixed(1)}%`)
      }
      
      // Calculate implied probability from best price
      const impliedProb = americanToImpliedProbability(bestEntry.outcome.price)
      
      // Edge is Elo probability - implied probability (our model vs market)
      const edge = eloCoverProb - impliedProb
      
      // Calculate EV and ROI using Elo probability
      const ev = calculateExpectedValue(bestEntry.outcome.price, eloCoverProb)
      const roi = calculateROI(ev)
      
      // Apply spread-specific thresholds (more relaxed than moneyline)
      if (eloCoverProb < MIN_SPREAD_PROBABILITY) return
      if (edge < MIN_SPREAD_EDGE) return
      if (ev <= 0) return
      if (roi < MIN_SPREAD_ROI) return
      
      // SANITY CHECK: Reject bets with impossibly large edges (likely calculation errors)
      if (edge > MAX_SANE_EDGE) {
        console.warn(`[analyzeGame] SANITY CHECK FAILED: ${teamName} spread ${point} has edge ${(edge * 100).toFixed(1)}% > 25% max. Skipping.`)
        return
      }
      
      // Check juice constraint
      if (bestEntry.outcome.price < MAX_JUICE_ODDS) return
      
      // Calculate score
      const score = calculateBetScore(eloCoverProb, edge, roi)
      
      // Collect all book prices for this spread
      const allBookPrices = entries.map(e => ({
        book: e.book,
        price: e.outcome.price,
        impliedProb: Math.round(americanToImpliedProbability(e.outcome.price) * 1000) / 10
      }))
      
      rankedBets.push({
        gameId: game.id,
        sport: game.sport,
        sportName: game.sportName,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        commenceTime: game.commenceTime,
        team: teamName,
        betType: 'spread',
        line: point,
        consensusProbability: Math.round(eloCoverProb * 1000) / 10, // Now Elo-based
        bestPrice: bestEntry.outcome.price,
        bestBook: bestEntry.book,
        impliedProbability: Math.round(impliedProb * 1000) / 10,
        edge: Math.round(edge * 1000) / 10,
        eloProbability: Math.round(eloCoverProb * 1000) / 10,
        eloConfidence: spreadResult.confidence,
        homeElo: homeElo, // Use effective (injury-adjusted) rating that was actually used in calculation
        awayElo: awayElo, // Use effective (injury-adjusted) rating that was actually used in calculation
        expectedValue: Math.round(ev * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        allBookPrices,
        score,
        calculatedAt: now
      })
    })
  }
  
  // TOTAL (OVER/UNDER) ANALYSIS - uses Elo-based total probability
  if (game.totals && game.totals.length > 0 && eloResult) {
    // Group totals by line value
    const totalLines = new Map<number, { outcome: { name: string; price: number; point: number }; book: string }[]>()
    
    for (const total of game.totals) {
      for (const outcome of total.outcomes) {
        if (outcome.point !== undefined) {
          const line = outcome.point
          if (!totalLines.has(line)) totalLines.set(line, [])
          totalLines.get(line)!.push({ 
            outcome: { name: outcome.name, price: outcome.price, point: line }, 
            book: total.bookmaker 
          })
        }
      }
    }
    
    // Evaluate each unique total line
    totalLines.forEach((entries, line) => {
      // Separate over and under entries
      const overEntries = entries.filter(e => e.outcome.name.toLowerCase() === 'over')
      const underEntries = entries.filter(e => e.outcome.name.toLowerCase() === 'under')
      
      // Use effective ratings if available (injury-adjusted), otherwise use base ratings
      const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
      const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
      
      // Analyze OVER bets
      if (overEntries.length > 0) {
        const bestOverEntry = overEntries.reduce((best, curr) => 
          curr.outcome.price > best.outcome.price ? curr : best
        )
        
        // Calculate Elo-based over probability
        const overResult = calculateTotalProbability(homeElo, awayElo, line, eloLeague, true)
        const eloOverProb = overResult.probability
        
        // Calculate implied probability from best price
        const impliedProb = americanToImpliedProbability(bestOverEntry.outcome.price)
        
        // Edge is Elo probability - implied probability
        const edge = eloOverProb - impliedProb
        
        // Calculate EV and ROI
        const ev = calculateExpectedValue(bestOverEntry.outcome.price, eloOverProb)
        const roi = calculateROI(ev)
        
        // Apply total-specific thresholds (same as spread)
        // SANITY CHECK: Reject bets with impossibly large edges (likely calculation errors)
        if (edge > MAX_SANE_EDGE) {
          console.warn(`[analyzeGame] SANITY CHECK FAILED: Over ${line} has edge ${(edge * 100).toFixed(1)}% > 25% max. Skipping.`)
        } else if (eloOverProb >= MIN_SPREAD_PROBABILITY && edge >= MIN_SPREAD_EDGE && ev > 0 && roi >= MIN_SPREAD_ROI) {
          if (bestOverEntry.outcome.price >= MAX_JUICE_ODDS) {
            const score = calculateBetScore(eloOverProb, edge, roi)
            
            const allBookPrices = overEntries.map(e => ({
              book: e.book,
              price: e.outcome.price,
              impliedProb: Math.round(americanToImpliedProbability(e.outcome.price) * 1000) / 10
            }))
            
            rankedBets.push({
              gameId: game.id,
              sport: game.sport,
              sportName: game.sportName,
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              commenceTime: game.commenceTime,
              team: 'Over',
              betType: 'total',
              line: line,
              consensusProbability: Math.round(eloOverProb * 1000) / 10,
              bestPrice: bestOverEntry.outcome.price,
              bestBook: bestOverEntry.book,
              impliedProbability: Math.round(impliedProb * 1000) / 10,
              edge: Math.round(edge * 1000) / 10,
              eloProbability: Math.round(eloOverProb * 1000) / 10,
              eloConfidence: overResult.confidence,
              homeElo: eloResult.homeRating,
              awayElo: eloResult.awayRating,
              expectedValue: Math.round(ev * 100) / 100,
              roi: Math.round(roi * 100) / 100,
              allBookPrices,
              score,
              calculatedAt: now
            })
          }
        }
      }
      
      // Analyze UNDER bets
      if (underEntries.length > 0) {
        const bestUnderEntry = underEntries.reduce((best, curr) => 
          curr.outcome.price > best.outcome.price ? curr : best
        )
        
        // Calculate Elo-based under probability
        const underResult = calculateTotalProbability(homeElo, awayElo, line, eloLeague, false)
        const eloUnderProb = underResult.probability
        
        // Calculate implied probability from best price
        const impliedProb = americanToImpliedProbability(bestUnderEntry.outcome.price)
        
        // Edge is Elo probability - implied probability
        const edge = eloUnderProb - impliedProb
        
        // Calculate EV and ROI
        const ev = calculateExpectedValue(bestUnderEntry.outcome.price, eloUnderProb)
        const roi = calculateROI(ev)
        
        // Apply total-specific thresholds
        // SANITY CHECK: Reject bets with impossibly large edges (likely calculation errors)
        if (edge > MAX_SANE_EDGE) {
          console.warn(`[analyzeGame] SANITY CHECK FAILED: Under ${line} has edge ${(edge * 100).toFixed(1)}% > 25% max. Skipping.`)
        } else if (eloUnderProb >= MIN_SPREAD_PROBABILITY && edge >= MIN_SPREAD_EDGE && ev > 0 && roi >= MIN_SPREAD_ROI) {
          if (bestUnderEntry.outcome.price >= MAX_JUICE_ODDS) {
            const score = calculateBetScore(eloUnderProb, edge, roi)
            
            const allBookPrices = underEntries.map(e => ({
              book: e.book,
              price: e.outcome.price,
              impliedProb: Math.round(americanToImpliedProbability(e.outcome.price) * 1000) / 10
            }))
            
            rankedBets.push({
              gameId: game.id,
              sport: game.sport,
              sportName: game.sportName,
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              commenceTime: game.commenceTime,
              team: 'Under',
              betType: 'total',
              line: line,
              consensusProbability: Math.round(eloUnderProb * 1000) / 10,
              bestPrice: bestUnderEntry.outcome.price,
              bestBook: bestUnderEntry.book,
              impliedProbability: Math.round(impliedProb * 1000) / 10,
              edge: Math.round(edge * 1000) / 10,
              eloProbability: Math.round(eloUnderProb * 1000) / 10,
              eloConfidence: underResult.confidence,
              homeElo: eloResult.homeRating,
              awayElo: eloResult.awayRating,
              expectedValue: Math.round(ev * 100) / 100,
              roi: Math.round(roi * 100) / 100,
              allBookPrices,
              score,
              calculatedAt: now
            })
          }
        }
      }
    })
  }
  
  return rankedBets
}

/**
 * Analyze a single game WITHOUT strict filters - returns all bets with scores and filter status
 * Used for:
 * 1. Computing fallback data when no bets pass strict filters
 * 2. Finding VALUE PLAY candidates (48%+ prob, 5%+ ROI)
 * 3. Progressive fallback selection
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
  
  // Skip 3-way markets (soccer) for now
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
    
    // Calculate Expected Value and ROI
    const ev = calculateExpectedValue(bestPrice.price, consensus.consensusProb)
    const roi = calculateROI(ev)
    
    // Calculate unified score using new 45/35/20 formula
    const score = calculateBetScore(consensus.consensusProb, edge, roi)
    
    // Check if this qualifies as a VALUE PLAY (48%+ prob, 5%+ ROI)
    const isValuePlay = consensus.consensusProb >= VALUE_PLAY_MIN_PROB && roi >= VALUE_PLAY_MIN_ROI
    
    const disqualifyReasons: string[] = []
    
    // Check against NEW unified filters (odds -250, prob 52%, ROI -4.5%)
    if (bestPrice.price < MAX_JUICE_ODDS) {
      disqualifyReasons.push(`Odds ${bestPrice.price} worse than -250 limit`)
    }
    if (consensus.consensusProb < MIN_PROBABILITY && !isValuePlay) {
      // VALUE PLAY exception: 48%+ prob is OK if ROI >= 5%
      disqualifyReasons.push(`Probability ${(consensus.consensusProb * 100).toFixed(1)}% < 52% min`)
    }
    if (roi < MIN_ROI) {
      disqualifyReasons.push(`ROI ${roi.toFixed(1)}% worse than -4.5% floor`)
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
      expectedValue: Math.round(ev * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      score,
      disqualifyReasons,
      isValuePlay
    })
  }
  
  return fallbackBets
}

/**
 * Check if a bet passes the unified filters
 * @param bet - The bet to check
 * @param relaxedOdds - Use relaxed odds limit (-300 instead of -250)
 * @param relaxedROI - Relaxed ROI floor (e.g., -6% or -8%)
 * @param relaxedProb - Use relaxed probability floor (50% instead of 52%)
 */
function passesFilters(
  bet: FallbackBet,
  relaxedOdds: boolean = false,
  relaxedROI: number = MIN_ROI,
  relaxedProb: boolean = false
): boolean {
  const oddsLimit = relaxedOdds ? FALLBACK_ODDS_RELAXED : MAX_JUICE_ODDS
  const probLimit = relaxedProb ? FALLBACK_PROB_RELAXED : MIN_PROBABILITY
  
  // Check odds limit
  if (bet.bestPrice < oddsLimit) return false
  
  // Check probability floor (with VALUE PLAY exception)
  const probDecimal = bet.consensusProbability / 100
  if (probDecimal < probLimit && !bet.isValuePlay) return false
  
  // Check ROI floor
  if (bet.roi < relaxedROI) return false
  
  return true
}

/**
 * Compute the Best Bet of the Day from all available games
 * Uses the NEW UNIFIED SCORING SYSTEM with progressive fallback
 * 
 * IMPORTANT: Now filters out bets where the recommended team has a star player OUT
 * This prevents recommending teams missing key players like Jokic, LeBron, etc.
 * 
 * This is the main entry point - call this on each cron refresh
 */
export async function computeBestBets(games: Game[]): Promise<BestBetResult> {
  const now = new Date().toISOString()
  const allRankedBets: RankedBet[] = []
  const allUnfilteredBets: FallbackBet[] = []
  
  // Analyze all games (now async to fetch Elo data)
  for (const game of games) {
    // Extract injury data from enriched game (if available)
    const enrichedGame = game as EnrichedGame
    const espnInjuries = enrichedGame.espnData?.injuries || []
    const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
    
    // Log injury data for debugging
    if (injuries.length > 0) {
      console.log(`[computeBestBets] ${game.homeTeam} vs ${game.awayTeam}: ${injuries.length} injuries found`)
      injuries.forEach(inj => console.log(`  - ${inj.player} (${inj.team}): ${inj.status}`))
    }
    
    const bets = await analyzeGame(game, injuries)
    allRankedBets.push(...bets)
    
    // Also collect unfiltered bets for fallback/scoring
    const unfilteredBets = analyzeGameUnfiltered(game)
    allUnfilteredBets.push(...unfilteredBets)
  }
  
  // ============================================
  // STAR PLAYER OUT FILTER
  // ============================================
  // Filter out bets where the recommended team has a star player OUT
  // This is a hard disqualifier - we don't want to recommend betting on
  // teams missing their best players (e.g., Jokic, LeBron, etc.)
  const filteredRankedBets: RankedBet[] = []
  for (const bet of allRankedBets) {
    // Only check moneyline bets for star player injuries (spread/total are less affected)
    if (bet.betType === 'moneyline') {
      const enrichedGame = games.find(g => g.id === bet.gameId) as EnrichedGame | undefined
      const espnInjuries = enrichedGame?.espnData?.injuries || []
      const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
      
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED: ${bet.team} ML - star player ${starOut} is OUT`)
        continue // Skip this bet
      }
    }
    filteredRankedBets.push(bet)
  }
  
  // Sort ranked bets by score (desc), then by game time (asc) for stable tiebreaker
  filteredRankedBets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  // Sort ALL unfiltered bets by score for fallback selection
  allUnfilteredBets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  const bestBet = filteredRankedBets[0] || null
  const runnerUp = filteredRankedBets[1] || null
  
  let reason: string | null = null
  if (!bestBet) {
    if (games.length === 0) {
      reason = 'No games available'
    } else {
      reason = 'No games meet strict criteria (52%+ prob, -4.5%+ ROI, -250 odds limit)'
    }
  }
  
  // ============================================
  // PROGRESSIVE FALLBACK SELECTION
  // ============================================
  // When no bets pass strict filters, use progressive relaxation:
  // 1. Standard filters (odds -250, prob 52%, ROI -4.5%)
  // 2. Relax ROI to -6%
  // 3. Relax ROI to -8%
  // 4. Relax odds to -300
  // 5. Relax prob to 50%
  // 6. "No recommended bets today"
  
  let closestMisses: FallbackBet[] = []
  let mostLikelyWinners: FallbackBet[] = []
  
  if (!bestBet && allUnfilteredBets.length > 0) {
    // Attempt 1: Standard filters - find bets that pass all filters
    let passingBets = allUnfilteredBets.filter(b => passesFilters(b, false, MIN_ROI, false))
    
    // Attempt 2: Relax ROI to -6%
    if (passingBets.length === 0) {
      passingBets = allUnfilteredBets.filter(b => passesFilters(b, false, FALLBACK_ROI_RELAXED_1, false))
    }
    
    // Attempt 3: Relax ROI to -8%
    if (passingBets.length === 0) {
      passingBets = allUnfilteredBets.filter(b => passesFilters(b, false, FALLBACK_ROI_RELAXED_2, false))
    }
    
    // Attempt 4: Relax odds to -300
    if (passingBets.length === 0) {
      passingBets = allUnfilteredBets.filter(b => passesFilters(b, true, FALLBACK_ROI_RELAXED_2, false))
    }
    
    // Attempt 5: Relax prob to 50%
    if (passingBets.length === 0) {
      passingBets = allUnfilteredBets.filter(b => passesFilters(b, true, FALLBACK_ROI_RELAXED_2, true))
    }
    
    // closestMisses = bets that passed progressive filters, sorted by score
    closestMisses = passingBets.slice(0, 5)
    
    // mostLikelyWinners = highest probability bets (for context)
    mostLikelyWinners = allUnfilteredBets
      .filter(b => b.bestPrice >= MAX_JUICE_ODDS)
      .sort((a, b) => b.consensusProbability - a.consensusProbability)
      .slice(0, 5)
  }
  
  return {
    bestBet,
    runnerUp,
    allRankedBets: filteredRankedBets.slice(0, 10),
    calculatedAt: now,
    gamesAnalyzed: games.length,
    gamesQualified: filteredRankedBets.length,
    reason,
    closestMisses,
    mostLikelyWinners
  }
}

/**
 * Format the best bet result for Claude's context
 * Uses the NEW UNIFIED SCORING SYSTEM (45/35/20 weights)
 */
export function formatBestBetForContext(result: BestBetResult): string {
  const lines: string[] = []
  
  lines.push('=== PRE-COMPUTED BEST BET (as of ' + formatTime(result.calculatedAt) + ') ===')
  lines.push(`Games analyzed: ${result.gamesAnalyzed} | Qualified bets: ${result.gamesQualified}`)
  lines.push('')
  
  if (!result.bestBet) {
    // Get fallback data - already sorted by SCORE from computeBestBets
    const closestMisses = result.closestMisses ?? []
    const mostLikelyWinners = result.mostLikelyWinners ?? []
    
    // NEW: Select best available by SCORE (not by ROI or probability)
    // closestMisses are already sorted by score from progressive fallback
    let bestAvailable: FallbackBet | null = null
    
    if (closestMisses.length > 0) {
      // Take the highest scored bet from progressive fallback
      bestAvailable = closestMisses[0]
    } else if (mostLikelyWinners.length > 0) {
      // Fallback to highest probability if nothing passed progressive filters
      bestAvailable = mostLikelyWinners[0]
    }
    
    lines.push('NO STRICT VALUE BET AVAILABLE')
    lines.push(`Reason: ${result.reason}`)
    lines.push('')
    
    if (bestAvailable) {
      // Determine if this is a VALUE PLAY
      const isValuePlay = bestAvailable.isValuePlay
      const label = isValuePlay ? 'VALUE PLAY' : 'BEST AVAILABLE LEAN'
      
      lines.push(`=== ${label} (USE THIS) ===`)
      lines.push('IMPORTANT: When user asks for "best bet", IMMEDIATELY give them this pick.')
      lines.push('DO NOT ask follow-up questions. DO NOT offer multiple options.')
      lines.push('')
      lines.push(`${label}:`)
      lines.push(`Team: ${bestAvailable.team} (Moneyline)`)
      lines.push(`Game: ${bestAvailable.awayTeam} @ ${bestAvailable.homeTeam}`)
      lines.push(`Sport: ${bestAvailable.sportName}`)
      lines.push(`Best Price: ${formatOdds(bestAvailable.bestPrice)} at ${bestAvailable.bestBook}`)
      lines.push('')
      
      // NEW: Show SCORE prominently
      lines.push('SCORE (NEW UNIFIED SYSTEM):')
      lines.push(`Score: ${bestAvailable.score}/100`)
      lines.push('')
      
      // Use MODEL probability (Elo when available, market consensus as fallback)
      const fbModelProbPercent = bestAvailable.eloProbability !== undefined ? bestAvailable.eloProbability : bestAvailable.consensusProbability
      const fbModelSource = bestAvailable.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
      
      // 1. LEAD WITH THE EDGE - most important
      lines.push('=== THE EDGE (Why This Bet Has Value) ===')
      if (bestAvailable.eloProbability !== undefined) {
        lines.push(`Our Elo Model: ${bestAvailable.eloProbability}% win probability`)
        lines.push(`Market Odds (${formatOdds(bestAvailable.bestPrice)}): ${bestAvailable.impliedProbability}% implied probability`)
        lines.push(`EDGE FOUND: +${bestAvailable.edge}% (Market is undervaluing this team)`)
      } else {
        lines.push(`Market Consensus: ${bestAvailable.consensusProbability}% win probability`)
        lines.push(`Best Odds (${formatOdds(bestAvailable.bestPrice)}): ${bestAvailable.impliedProbability}% implied probability`)
        lines.push(`EDGE: +${bestAvailable.edge}% vs market`)
      }
      lines.push('')
      
      // 2. MATCHUP ANALYSIS
      lines.push('=== MATCHUP ANALYSIS ===')
      if (bestAvailable.homeElo && bestAvailable.awayElo) {
        lines.push(`${bestAvailable.homeTeam} (Elo: ${bestAvailable.homeElo}) vs ${bestAvailable.awayTeam} (Elo: ${bestAvailable.awayElo})`)
        const eloDiff = Math.abs(bestAvailable.homeElo - bestAvailable.awayElo)
        lines.push(`Elo Difference: ${eloDiff} points`)
        lines.push(`Elo Confidence: ${bestAvailable.eloConfidence || 'unknown'}`)
      } else {
        lines.push(`${bestAvailable.awayTeam} @ ${bestAvailable.homeTeam}`)
        lines.push('Elo ratings not available - using market consensus')
      }
      lines.push('')
      
      // 3. VALUE METRICS
      lines.push('=== VALUE METRICS ===')
      lines.push(`- Win Probability: ${fbModelProbPercent}% (${fbModelSource})`)
      lines.push(`- Expected Value: $${bestAvailable.expectedValue.toFixed(2)} per $100`)
      lines.push(`- ROI: ${bestAvailable.roi.toFixed(2)}%`)
      lines.push(`- Edge: ${bestAvailable.edge}%`)
      lines.push(`- Best Price: ${formatOdds(bestAvailable.bestPrice)} at ${bestAvailable.bestBook}`)
      lines.push('')
      
      // 4. SCORE BREAKDOWN
      lines.push('=== SCORE BREAKDOWN ===')
      const probScore = Math.max(0, Math.min(45, ((fbModelProbPercent - 50) / 40) * 45))
      const roi = bestAvailable.roi
      let roiScore: number
      if (roi >= 0) {
        roiScore = 17.5 + (roi / 20) * 17.5
      } else {
        roiScore = 17.5 + (roi / 10) * 17.5
      }
      roiScore = Math.max(-35, Math.min(35, roiScore))
      const edgePercent = bestAvailable.edge
      const edgeScore = Math.max(-20, Math.min(20, (edgePercent / 10) * 20))
      
      lines.push(`- Probability Score: ${probScore.toFixed(1)}/45 points (${fbModelProbPercent}% win probability)`)
      lines.push(`- ROI Score: ${roiScore.toFixed(1)}/35 points (${roi.toFixed(2)}% expected return)`)
      lines.push(`- Edge Score: ${edgeScore.toFixed(1)}/20 points (${edgePercent}% edge vs market)`)
      lines.push('')
      
      if (bestAvailable.expectedValue > 0) {
        lines.push('STATUS: Positive EV - This is a mathematically sound bet.')
        if (bestAvailable.disqualifyReasons.length > 0) {
          lines.push(`Note: ${bestAvailable.disqualifyReasons.join(', ')}`)
        }
      } else {
        lines.push('STATUS: Negative EV - This is NOT a value bet. Only for users who want action.')
        lines.push('DISCLAIMER: "This doesn\'t meet our value criteria. Consider passing or betting small."')
      }
      lines.push('')
      
      // Show alternatives with scores
      if (closestMisses.length > 1) {
        lines.push('ALTERNATIVE OPTIONS (by score):')
        for (let i = 1; i < Math.min(4, closestMisses.length); i++) {
          const alt = closestMisses[i]
          lines.push(`#${i + 1}: ${alt.team} @ ${formatOdds(alt.bestPrice)} (Score: ${alt.score}/100, Prob: ${alt.consensusProbability}%, ROI: ${alt.roi.toFixed(2)}%)`)
        }
        lines.push('')
      }
      
      lines.push('RESPONSE FORMAT:')
      lines.push(`## Today's ${isValuePlay ? 'Value Play' : 'Best Lean'}`)
      lines.push('')
      lines.push(`**${bestAvailable.team} ML @ ${formatOdds(bestAvailable.bestPrice)}** (${bestAvailable.bestBook})`)
      lines.push('')
      lines.push(`**Score: ${bestAvailable.score}/100**`)
      lines.push(`Win Probability: ${bestAvailable.consensusProbability}% | ROI: ${bestAvailable.roi.toFixed(2)}% | Edge: ${bestAvailable.edge}%`)
      lines.push('')
      lines.push('[Add 2-3 sentences about why this scores highest and any relevant game factors from the data]')
      lines.push('')
      if (bestAvailable.expectedValue < 0) {
        lines.push('**Note:** This has negative expected value. Consider smaller bet size or passing.')
      }
    } else {
      lines.push('NO RECOMMENDED BET TODAY')
      lines.push('No games pass our filters (odds -250, prob 52%, ROI -4.5%) even with relaxation.')
      lines.push('Tell the user: "No recommended bets today. All options have poor value or low probability."')
    }
    lines.push('')
    
    return lines.join('\n')
  }
  
  const bet = result.bestBet
  
    lines.push('BEST BET OF THE DAY:')
    // Format bet type display based on bet type
    let betTypeDisplay: string
    let teamDisplay: string
    if (bet.betType === 'total' && bet.line !== undefined) {
      // For totals, show "Over/Under LINE" with the game
      betTypeDisplay = `${bet.team} ${bet.line}`
      teamDisplay = `${bet.awayTeam} @ ${bet.homeTeam} — ${bet.team} ${bet.line}`
    } else if (bet.betType === 'spread' && bet.line !== undefined) {
      betTypeDisplay = `Spread ${bet.line > 0 ? '+' : ''}${bet.line}`
      teamDisplay = `${bet.team} (${betTypeDisplay})`
    } else {
      betTypeDisplay = 'Moneyline'
      teamDisplay = `${bet.team} (${betTypeDisplay})`
    }
    lines.push(`Pick: ${teamDisplay}`)
    lines.push(`Game: ${bet.awayTeam} @ ${bet.homeTeam}`)
  lines.push(`Sport: ${bet.sportName}`)
  lines.push(`Game Time: ${formatTime(bet.commenceTime)}`)
  lines.push('')
  
  // NEW: Show SCORE prominently with breakdown
  lines.push('SCORE (NEW UNIFIED SYSTEM):')
  lines.push(`Score: ${bet.score}/100`)
  lines.push('')
  
  // Use MODEL probability (Elo when available, market consensus as fallback)
  const modelProbPercent = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  const modelSource = bet.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
  
  // Determine probability label based on bet type
  const isTotal = bet.betType === 'total'
  const isSpread = bet.betType === 'spread'
  const probLabel = isTotal 
    ? `probability the total goes ${bet.team}` 
    : isSpread 
      ? `probability ${bet.team} covers the spread`
      : 'win probability'
  
  // 1. LEAD WITH THE EDGE - This is why the bet is valuable (most important)
  lines.push('=== THE EDGE (Why This Bet Has Value) ===')
  if (bet.eloProbability !== undefined) {
    lines.push(`Our Elo Model: ${bet.eloProbability}% ${probLabel}`)
    lines.push(`Market Odds (${formatOdds(bet.bestPrice)}): ${bet.impliedProbability}% implied probability`)
    if (isTotal) {
      lines.push(`EDGE FOUND: +${bet.edge}% (Market is underpricing the ${bet.team})`)
      lines.push('')
      lines.push(`This is a significant market inefficiency - our model based on ${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data sees the ${bet.team} as more likely than the betting market thinks.`)
    } else if (isSpread) {
      lines.push(`EDGE FOUND: +${bet.edge}% (Market is undervaluing ${bet.team}'s ability to cover)`)
      lines.push('')
      lines.push(`This is a significant market inefficiency - our model based on ${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data sees ${bet.team} covering as more likely than the market thinks.`)
    } else {
      lines.push(`EDGE FOUND: +${bet.edge}% (Market is undervaluing this team)`)
      lines.push('')
      lines.push(`This is a significant market inefficiency - our model based on ${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data sees this team as stronger than the betting market thinks.`)
    }
  } else {
    lines.push(`Market Consensus: ${bet.consensusProbability}% ${probLabel}`)
    lines.push(`Best Odds (${formatOdds(bet.bestPrice)}): ${bet.impliedProbability}% implied probability`)
    lines.push(`EDGE: +${bet.edge}% vs market`)
  }
  lines.push('')
  
  // 2. MATCHUP ANALYSIS - Elo ratings and context (different for totals vs moneyline/spread)
  lines.push('=== MATCHUP ANALYSIS ===')
  if (bet.homeElo && bet.awayElo) {
    if (isTotal) {
      // For totals, show combined scoring context instead of head-to-head
      const avgElo = Math.round((bet.homeElo + bet.awayElo) / 2)
      lines.push(`${bet.awayTeam} @ ${bet.homeTeam}`)
      lines.push(`Combined Elo Strength: ${avgElo} average (${bet.homeTeam}: ${bet.homeElo}, ${bet.awayTeam}: ${bet.awayElo})`)
      lines.push(`Market Total Line: ${bet.line}`)
      lines.push(`Elo Confidence: ${bet.eloConfidence || 'unknown'} (${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data)`)
      lines.push('')
      lines.push(`Our model uses combined team strength to estimate expected total scoring. Higher combined Elo suggests more total points.`)
    } else {
      // For moneyline/spread, show head-to-head comparison
      lines.push(`${bet.homeTeam} (Elo: ${bet.homeElo}) vs ${bet.awayTeam} (Elo: ${bet.awayElo})`)
      const eloDiff = Math.abs(bet.homeElo - bet.awayElo)
      const favoredTeam = bet.homeElo > bet.awayElo ? bet.homeTeam : bet.awayTeam
      lines.push(`Elo Difference: ${eloDiff} points favoring ${favoredTeam}`)
      lines.push(`Elo Confidence: ${bet.eloConfidence || 'unknown'} (${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data)`)
    }
  } else {
    lines.push(`${bet.awayTeam} @ ${bet.homeTeam}`)
    lines.push('Elo ratings not available - using market consensus')
  }
  lines.push('')
  
  // 3. VALUE METRICS - EV, ROI, Probability
  lines.push('=== VALUE METRICS ===')
  lines.push(`- ${isTotal ? `${bet.team} Probability` : isSpread ? 'Cover Probability' : 'Win Probability'}: ${modelProbPercent}% (${modelSource})`)
  lines.push(`- Expected Value: $${bet.expectedValue.toFixed(2)} per $100 bet`)
  lines.push(`- ROI: ${bet.roi.toFixed(2)}%`)
  lines.push(`- Edge: ${bet.edge}%`)
  lines.push(`- Best Price: ${formatOdds(bet.bestPrice)} at ${bet.bestBook}`)
  lines.push('')
  
  // 4. SCORE BREAKDOWN - Technical details for users who want to dig deeper
  lines.push('=== SCORE BREAKDOWN ===')
  const probScore = Math.max(0, Math.min(45, ((modelProbPercent - 50) / 40) * 45))
  const roi = bet.roi
  let roiScore: number
  if (roi >= 0) {
    roiScore = 17.5 + (roi / 20) * 17.5
  } else {
    roiScore = 17.5 + (roi / 10) * 17.5
  }
  roiScore = Math.max(-35, Math.min(35, roiScore))
  const edgePercent = bet.edge
  const edgeScore = Math.max(-20, Math.min(20, (edgePercent / 10) * 20))
  
  const probScoreLabel = isTotal ? `${bet.team} probability` : isSpread ? 'cover probability' : 'win probability'
  lines.push(`- Probability Score: ${probScore.toFixed(1)}/45 points (${modelProbPercent}% ${probScoreLabel})`)
  lines.push(`- ROI Score: ${roiScore.toFixed(1)}/35 points (${roi.toFixed(2)}% expected return)`)
  lines.push(`- Edge Score: ${edgeScore.toFixed(1)}/20 points (${edgePercent}% edge vs market)`)
  lines.push('')
  lines.push('ALL BOOK PRICES:')
  const bookPrices = bet.allBookPrices || []
  for (const book of bookPrices) {
    lines.push(`  ${book.book}: ${formatOdds(book.price)} (${book.impliedProb}% implied)`)
  }
  
    if (result.runnerUp) {
      const ru = result.runnerUp
      // Format runner-up bet type display
      let ruBetTypeDisplay: string
      let ruTeamDisplay: string
      if (ru.betType === 'total' && ru.line !== undefined) {
        ruBetTypeDisplay = `${ru.team} ${ru.line}`
        ruTeamDisplay = `${ru.awayTeam} @ ${ru.homeTeam} — ${ru.team} ${ru.line}`
      } else if (ru.betType === 'spread' && ru.line !== undefined) {
        ruBetTypeDisplay = `Spread ${ru.line > 0 ? '+' : ''}${ru.line}`
        ruTeamDisplay = `${ru.team} (${ruBetTypeDisplay})`
      } else {
        ruBetTypeDisplay = 'Moneyline'
        ruTeamDisplay = `${ru.team} (${ruBetTypeDisplay})`
      }
      lines.push('')
      lines.push('RUNNER-UP:')
      lines.push(`Pick: ${ruTeamDisplay}`)
    lines.push(`Game: ${ru.awayTeam} @ ${ru.homeTeam}`)
    lines.push(`Score: ${ru.score}/100 | Prob: ${ru.consensusProbability}% | ROI: ${ru.roi.toFixed(2)}%`)
  }
  
  lines.push('')
  lines.push('IMPORTANT: When user asks for "best bet", present the BEST BET above.')
  lines.push('This bet was selected because it has the HIGHEST SCORE using the unified 45/35/20 formula.')
  lines.push('Always show the score and breakdown in your response.')
  
  return lines.join('\n')
}

/**
 * Result of analyzing a specific game
 */
export interface GameAnalysisResult {
  game: {
    homeTeam: string
    awayTeam: string
    sport: string
    sportName: string
    commenceTime: string
  }
  bets: RankedBet[]
  bestBet: RankedBet | null
  calculatedAt: string
}

/**
 * Analyze a specific game and return all betting options with full analysis
 * This is used for on-demand analysis when a user asks about a specific game
 */
export async function analyzeSpecificGame(game: Game): Promise<GameAnalysisResult> {
  const now = new Date().toISOString()
  
  // Analyze the game to get all betting options
  const bets = await analyzeGame(game)
  
  // Sort by score to find the best bet for this game
  const sortedBets = [...bets].sort((a, b) => b.score - a.score)
  
  return {
    game: {
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      sport: game.sport,
      sportName: game.sportName || game.sport,
      commenceTime: game.commenceTime
    },
    bets: sortedBets,
    bestBet: sortedBets[0] || null,
    calculatedAt: now
  }
}

/**
 * Format a specific game analysis for Claude's context
 * Uses the same detailed format as the best bet of the day
 */
export function formatGameAnalysisForContext(result: GameAnalysisResult): string {
  const lines: string[] = []
  
  lines.push(`=== GAME ANALYSIS: ${result.game.awayTeam} @ ${result.game.homeTeam} ===`)
  lines.push(`Sport: ${result.game.sportName}`)
  lines.push(`Game Time: ${formatTime(result.game.commenceTime)}`)
  lines.push(`Analysis Time: ${formatTime(result.calculatedAt)}`)
  lines.push(`Betting Options Analyzed: ${result.bets.length}`)
  lines.push('')
  
  if (!result.bestBet) {
    lines.push('NO BETTING OPTIONS AVAILABLE')
    lines.push('This game may have already started or odds are not available.')
    return lines.join('\n')
  }
  
  // Show the best bet for this game
  const bet = result.bestBet
  const isSpread = bet.betType === 'spread'
  const isTotal = bet.betType === 'total'
  
  // Format bet type display
  let betTypeDisplay: string
  let teamDisplay: string
  if (isTotal) {
    betTypeDisplay = `${bet.team} ${bet.line}`
    teamDisplay = betTypeDisplay
  } else if (isSpread && bet.line !== undefined) {
    betTypeDisplay = `Spread ${bet.line > 0 ? '+' : ''}${bet.line}`
    teamDisplay = `${bet.team} (${betTypeDisplay})`
  } else {
    betTypeDisplay = 'Moneyline'
    teamDisplay = `${bet.team} (${betTypeDisplay})`
  }
  
  lines.push('=== BEST BET FOR THIS GAME ===')
  lines.push(`**Pick: ${teamDisplay} @ ${formatOdds(bet.bestPrice)}**`)
  lines.push(`Book: ${bet.bestBook}`)
  lines.push(`Score: ${bet.score}/100`)
  lines.push('')
  
  // Model probability
  const modelProbPercent = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  const modelSource = bet.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
  const probLabel = isTotal ? `${bet.team} probability` : isSpread ? 'cover probability' : 'win probability'
  
  // 1. THE EDGE
  lines.push('=== THE EDGE (Why This Bet Has Value) ===')
  if (bet.eloProbability !== undefined) {
    if (isSpread) {
      lines.push(`Our Elo Model: ${bet.eloProbability}% cover probability`)
      lines.push(`Market Odds (${formatOdds(bet.bestPrice)}): ${bet.impliedProbability}% implied probability`)
      lines.push(`EDGE FOUND: +${bet.edge}% (Market is undervaluing ${bet.team} covering)`)
    } else if (isTotal) {
      lines.push(`Our Elo Model: ${bet.eloProbability}% ${bet.team.toLowerCase()} probability`)
      lines.push(`Market Odds (${formatOdds(bet.bestPrice)}): ${bet.impliedProbability}% implied probability`)
      lines.push(`EDGE FOUND: +${bet.edge}% (Market is undervaluing the ${bet.team.toLowerCase()})`)
    } else {
      lines.push(`Our Elo Model: ${bet.eloProbability}% win probability`)
      lines.push(`Market Odds (${formatOdds(bet.bestPrice)}): ${bet.impliedProbability}% implied probability`)
      lines.push(`EDGE FOUND: +${bet.edge}% (Market is undervaluing this team)`)
    }
  } else {
    lines.push(`Market Consensus: ${bet.consensusProbability}% ${probLabel}`)
    lines.push(`Best Odds (${formatOdds(bet.bestPrice)}): ${bet.impliedProbability}% implied probability`)
    lines.push(`EDGE: +${bet.edge}% vs market`)
  }
  lines.push('')
  
  // 2. MATCHUP ANALYSIS - Elo ratings
  lines.push('=== MATCHUP ANALYSIS ===')
  if (bet.homeElo && bet.awayElo) {
    if (isTotal) {
      const avgElo = Math.round((bet.homeElo + bet.awayElo) / 2)
      lines.push(`${bet.awayTeam} @ ${bet.homeTeam}`)
      lines.push(`Combined Elo Strength: ${avgElo} average (${bet.homeTeam}: ${bet.homeElo}, ${bet.awayTeam}: ${bet.awayElo})`)
      lines.push(`Market Total Line: ${bet.line}`)
      lines.push(`Elo Confidence: ${bet.eloConfidence || 'unknown'} (${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data)`)
    } else {
      lines.push(`${bet.homeTeam} (Elo: ${bet.homeElo}) vs ${bet.awayTeam} (Elo: ${bet.awayElo})`)
      const eloDiff = Math.abs(bet.homeElo - bet.awayElo)
      const favoredTeam = bet.homeElo > bet.awayElo ? bet.homeTeam : bet.awayTeam
      lines.push(`Elo Difference: ${eloDiff} points favoring ${favoredTeam}`)
      lines.push(`Elo Confidence: ${bet.eloConfidence || 'unknown'} (${bet.eloConfidence === 'high' ? '20+' : bet.eloConfidence === 'medium' ? '10-19' : '5-9'} games of data)`)
    }
  } else {
    lines.push(`${bet.awayTeam} @ ${bet.homeTeam}`)
    lines.push('Elo ratings not available - using market consensus')
  }
  lines.push('')
  
  // 3. VALUE METRICS
  lines.push('=== VALUE METRICS ===')
  lines.push(`- ${isTotal ? `${bet.team} Probability` : isSpread ? 'Cover Probability' : 'Win Probability'}: ${modelProbPercent}% (${modelSource})`)
  lines.push(`- Expected Value: $${bet.expectedValue.toFixed(2)} per $100 bet`)
  lines.push(`- ROI: ${bet.roi.toFixed(2)}%`)
  lines.push(`- Edge: ${bet.edge}%`)
  lines.push(`- Best Price: ${formatOdds(bet.bestPrice)} at ${bet.bestBook}`)
  lines.push('')
  
  // 4. ALL BOOK PRICES
  lines.push('=== ALL BOOK PRICES ===')
  const bookPrices = bet.allBookPrices || []
  for (const book of bookPrices) {
    lines.push(`  ${book.book}: ${formatOdds(book.price)} (${book.impliedProb}% implied)`)
  }
  lines.push('')
  
  // 5. OTHER BETTING OPTIONS FOR THIS GAME
  if (result.bets.length > 1) {
    lines.push('=== OTHER BETTING OPTIONS ===')
    for (let i = 1; i < Math.min(result.bets.length, 5); i++) {
      const otherBet = result.bets[i]
      let otherDisplay: string
      if (otherBet.betType === 'total') {
        otherDisplay = `${otherBet.team} ${otherBet.line}`
      } else if (otherBet.betType === 'spread' && otherBet.line !== undefined) {
        otherDisplay = `${otherBet.team} ${otherBet.line > 0 ? '+' : ''}${otherBet.line}`
      } else {
        otherDisplay = `${otherBet.team} ML`
      }
      lines.push(`${i + 1}. ${otherDisplay} @ ${formatOdds(otherBet.bestPrice)} | Score: ${otherBet.score}/100 | Edge: ${otherBet.edge}% | ROI: ${otherBet.roi.toFixed(2)}%`)
    }
    lines.push('')
  }
  
  lines.push('IMPORTANT: Use the analysis above to answer the user\'s question about this game.')
  lines.push('Always include the Elo ratings, edge, and value metrics in your response.')
  
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
    
    // Track the recommendation for performance monitoring
    if (result.bestBet) {
      await trackBestBet(result.bestBet)
    }
    
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
  // Sort by MODEL probability (Elo when available, market consensus as fallback) - highest first
  const sortedBets = [...allRankedBets].sort((a, b) => {
    const aProb = a.eloProbability !== undefined ? a.eloProbability : a.consensusProbability
    const bProb = b.eloProbability !== undefined ? b.eloProbability : b.consensusProbability
    return bProb - aProb
  })
  
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
  
  // Calculate combined probability using MODEL probability (Elo when available)
  const getModelProb = (bet: RankedBet) => bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  const safeCombinedProb = safeParlay.length === 2
    ? (getModelProb(safeParlay[0]) / 100) * (getModelProb(safeParlay[1]) / 100) * 100
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
    
    // Track parlays for performance monitoring
    if (parlay.safeParlay && parlay.safeParlay.length > 0) {
      await trackParlay(parlay.safeParlay, 'safe')
    }
    if (parlay.aggressiveParlay && parlay.aggressiveParlay.length > 0) {
      await trackParlay(parlay.aggressiveParlay, 'aggressive')
    }
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
    
    // Track sport-specific bets for performance monitoring
    for (const [sportName, bet] of Object.entries(sportBets)) {
      if (bet) {
        await trackSportBet(bet, sportName)
      }
    }
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
  
  // NEW: Model-based probability from player stats (when available)
  modelProbability?: number      // Our independent probability estimate
  modelAverage?: number          // Player's rolling average for this stat
  modelGamesPlayed?: number      // How many games our model has for this player
  modelEdge?: number             // Edge based on model probability vs implied
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

// Minimum games required before using model probability
const MIN_GAMES_FOR_MODEL = 8

// Map Odds API market names to our stat names
const MARKET_TO_STAT: Record<string, string> = {
  // NBA stats
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threePointersMade',
  // NFL stats
  'player_pass_yds': 'passingYards',
  'player_rush_yds': 'rushingYards',
  'player_reception_yds': 'receivingYards',
  // NHL stats (hockey uses same market names but different context)
  'player_goals': 'goals',
  'player_shots_on_goal': 'shotsOnGoal',
  'player_power_play_points': 'powerPlayPoints',
}

// Map sport names from Odds API to our sport names
const SPORT_NAME_MAP: Record<string, string> = {
  'basketball_nba': 'NBA',
  'basketball_ncaab': 'NCAAB',
  'americanfootball_nfl': 'NFL',
  'americanfootball_ncaaf': 'NCAAF',
  'icehockey_nhl': 'NHL',
  'baseball_mlb': 'MLB',
}

/**
 * Compute Best Prop with Model Enhancement
 * 
 * This async version enhances props with our player stats model probability
 * when we have sufficient data (8+ games tracked for the player).
 * 
 * The model probability is used to:
 * 1. Provide an independent estimate (not derived from sportsbook odds)
 * 2. Calculate model-based edge
 * 3. Boost score for props where model agrees with consensus
 */
export async function computeBestPropWithModel(propsData: GamePlayerProps[]): Promise<BestPropResult> {
  // First, compute using the standard consensus method
  const baseResult = computeBestProp(propsData)
  
  // If no props qualified, return as-is
  if (baseResult.allRankedProps.length === 0) {
    return baseResult
  }
  
  // Try to load player stats data
  const playerStatsData = await getPlayerStatsData()
  if (!playerStatsData || Object.keys(playerStatsData.players).length === 0) {
    // No player stats available, return base result
    console.log('[BetRanking] No player stats data available for model enhancement')
    return baseResult
  }
  
  console.log(`[BetRanking] Enhancing props with model data (${Object.keys(playerStatsData.players).length} players tracked)`)
  
  // Enhance each ranked prop with model probability
  const enhancedProps: RankedProp[] = []
  
  for (const prop of baseResult.allRankedProps) {
    // Map the sport name
    const sportName = SPORT_NAME_MAP[prop.sport] || prop.sport
    
    // Map the market to our stat name
    const statName = MARKET_TO_STAT[prop.market]
    if (!statName) {
      // Unknown market, keep original
      enhancedProps.push(prop)
      continue
    }
    
    // Try to get model probability for this player/stat/line
    const modelResult = await getPlayerPropProbability(
      prop.playerName,
      sportName,
      statName,
      prop.line
    )
    
    if (!modelResult || modelResult.gamesPlayed < MIN_GAMES_FOR_MODEL) {
      // Not enough data for this player, keep original
      enhancedProps.push(prop)
      continue
    }
    
    // Calculate model-based edge
    const modelProbPercent = modelResult.probability * 100
    const modelEdge = modelProbPercent - prop.impliedProbability
    
    // Enhance the prop with model data
    const enhancedProp: RankedProp = {
      ...prop,
      modelProbability: Math.round(modelProbPercent * 10) / 10,
      modelAverage: Math.round(modelResult.average * 10) / 10,
      modelGamesPlayed: modelResult.gamesPlayed,
      modelEdge: Math.round(modelEdge * 10) / 10,
    }
    
    // Boost score if model agrees with consensus (both show positive edge)
    if (modelEdge > 0 && prop.edge > 0) {
      // Model and consensus agree - boost score by 10%
      enhancedProp.score = prop.score * 1.1
    } else if (modelEdge > 5) {
      // Model shows strong edge even if consensus doesn't - slight boost
      enhancedProp.score = prop.score * 1.05
    }
    
    enhancedProps.push(enhancedProp)
  }
  
  // Re-sort by score
  enhancedProps.sort((a, b) => b.score - a.score)
  
  return {
    bestProp: enhancedProps[0] || null,
    runnerUp: enhancedProps[1] || null,
    allRankedProps: enhancedProps.slice(0, 10),
    calculatedAt: baseResult.calculatedAt,
    propsAnalyzed: baseResult.propsAnalyzed,
    propsQualified: enhancedProps.length,
    reason: baseResult.reason
  }
}

/**
 * Compute props using MODEL-FIRST approach (like Elo for teams)
 * 
 * This function uses the player stats model as the PRIMARY ranking system,
 * not just an enhancement layer. It will always return props ranked by model
 * probability, even if they don't meet strict +EV criteria.
 * 
 * Used for: Player prop parlays, "best available" prop requests
 * 
 * Algorithm:
 * 1. Get all available props (no strict filtering)
 * 2. For each prop, calculate model probability using player stats
 * 3. Rank by model probability/edge
 * 4. Return top props based on model (with honest labeling)
 */
export async function computeBestPropModelFirst(propsData: GamePlayerProps[]): Promise<BestPropResult> {
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
  
  // Load player stats data - this is our "Elo" for players
  const playerStatsData = await getPlayerStatsData()
  const hasModelData = playerStatsData && Object.keys(playerStatsData.players).length > 0
  
  if (hasModelData) {
    console.log(`[BetRanking] Model-first props: ${Object.keys(playerStatsData.players).length} players tracked`)
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
    
    // Analyze each group (even with just 1 book for model-first approach)
    const propGroupEntries = Array.from(propGroups.entries())
    for (const [key, props] of propGroupEntries) {
      const [playerName, market, lineStr] = key.split('|')
      const line = parseFloat(lineStr)
      
      // Calculate implied probabilities from available books
      const overPrices = props.map(p => p.overOdds)
      const underPrices = props.map(p => p.underOdds)
      
      const overImpliedProbs = overPrices.map(p => americanToImpliedProbability(p))
      const underImpliedProbs = underPrices.map(p => americanToImpliedProbability(p))
      
      // Calculate consensus (or single-book) probability
      const avgOverImplied = overImpliedProbs.reduce((a, b) => a + b, 0) / overImpliedProbs.length
      const avgUnderImplied = underImpliedProbs.reduce((a, b) => a + b, 0) / underImpliedProbs.length
      const totalImplied = avgOverImplied + avgUnderImplied
      
      const overNoVig = (avgOverImplied / totalImplied) * 100
      const underNoVig = (avgUnderImplied / totalImplied) * 100
      
      // Find best prices
      const bestOverPrice = Math.max(...overPrices)
      const bestUnderPrice = Math.max(...underPrices)
      
      const overBestImplied = americanToImpliedProbability(bestOverPrice) * 100
      const underBestImplied = americanToImpliedProbability(bestUnderPrice) * 100
      
      // Try to get model probability for this player
      let modelResult: { probability: number; average: number; gamesPlayed: number } | null = null
      
      if (hasModelData) {
        const sportName = SPORT_NAME_MAP[game.sport] || game.sport
        const statName = MARKET_TO_STAT[market]
        
        if (statName) {
          modelResult = await getPlayerPropProbability(playerName, sportName, statName, line)
        }
      }
      
      // Analyze both Over and Under
      const sides: Array<{
        pick: 'Over' | 'Under'
        consensusProb: number
        bestPrice: number
        bestImplied: number
        marketEdge: number
        prices: number[]
      }> = [
        { pick: 'Over', consensusProb: overNoVig, bestPrice: bestOverPrice, bestImplied: overBestImplied, marketEdge: overNoVig - overBestImplied, prices: overPrices },
        { pick: 'Under', consensusProb: underNoVig, bestPrice: bestUnderPrice, bestImplied: underBestImplied, marketEdge: underNoVig - underBestImplied, prices: underPrices }
      ]
      
      for (const side of sides) {
        // Skip extreme juice (worse than -300)
        if (side.bestPrice < -300) continue
        
        // Find which book has the best price
        const bestBookIndex = side.prices.indexOf(side.bestPrice)
        const bestBook = props[bestBookIndex]?.bookmaker || 'Unknown'
        
        // Build all book prices
        const allBookPrices = props.map(p => ({
          book: p.bookmaker,
          price: side.pick === 'Over' ? p.overOdds : p.underOdds,
          impliedProb: Math.round(americanToImpliedProbability(side.pick === 'Over' ? p.overOdds : p.underOdds) * 1000) / 10
        }))
        
        // Calculate model-based values
        let modelProbability: number | undefined
        let modelAverage: number | undefined
        let modelGamesPlayed: number | undefined
        let modelEdge: number | undefined
        let score: number
        
        if (modelResult && modelResult.gamesPlayed >= 5) {
          // We have model data - use it as primary ranking
          // For Over: model probability is P(actual > line)
          // For Under: model probability is 1 - P(actual > line)
          const rawModelProb = side.pick === 'Over' ? modelResult.probability : (1 - modelResult.probability)
          modelProbability = Math.round(rawModelProb * 1000) / 10
          modelAverage = Math.round(modelResult.average * 10) / 10
          modelGamesPlayed = modelResult.gamesPlayed
          modelEdge = Math.round((modelProbability - side.bestImplied) * 10) / 10
          
          // Score based on MODEL probability and edge (model-first!)
          score = modelProbability * 0.6 + Math.max(0, modelEdge) * 0.4
        } else {
          // No model data - fall back to market consensus
          score = side.consensusProb * 0.6 + Math.max(0, side.marketEdge) * 0.4
        }
        
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
          edge: Math.round(side.marketEdge * 10) / 10,
          booksWithLine: props.length,
          allBookPrices,
          score,
          calculatedAt: now,
          modelProbability,
          modelAverage,
          modelGamesPlayed,
          modelEdge
        })
      }
    }
  }
  
  // Sort by score (model-first ranking)
  allRankedProps.sort((a, b) => b.score - a.score)
  
  // Filter to only include props with reasonable probability (at least 40%)
  const viableProps = allRankedProps.filter(p => {
    const prob = p.modelProbability !== undefined ? p.modelProbability : p.consensusProbability
    return prob >= 40
  })
  
  return {
    bestProp: viableProps[0] || null,
    runnerUp: viableProps[1] || null,
    allRankedProps: viableProps.slice(0, 10),
    calculatedAt: now,
    propsAnalyzed,
    propsQualified: viableProps.length,
    reason: viableProps.length === 0 ? 'No props with sufficient model data or probability' : null
  }
}

/**
 * Format best prop result for Claude's context
 * 
 * NOW USES MODEL-FIRST APPROACH FOR ALL PLAYER PROP QUESTIONS (like Elo for teams)
 * 
 * @param result - Legacy strict-filter result (kept for backwards compatibility)
 * @param modelFirstProps - Model-first props - uses player stats as PRIMARY ranking for ALL prop questions
 */
export function formatBestPropForContext(result: BestPropResult, modelFirstProps?: BestPropResult | null): string {
  const lines: string[] = []
  
  // Use MODEL-FIRST props as the PRIMARY source for ALL player prop questions
  // This is like how we use Elo for team-based game recommendations
  const rankedProps = modelFirstProps?.allRankedProps && modelFirstProps.allRankedProps.length > 0 
    ? modelFirstProps.allRankedProps 
    : result.allRankedProps || []
  
  // Find the best prop with positive edge (for "best prop" recommendations)
  const propsWithPositiveEdge = rankedProps.filter(p => {
    const edge = p.modelEdge !== undefined ? p.modelEdge : p.edge
    return edge > 0
  })
  
  // Best prop is the top-ranked prop with positive edge
  const bestProp = propsWithPositiveEdge.length > 0 ? propsWithPositiveEdge[0] : null
  const runnerUp = propsWithPositiveEdge.length > 1 ? propsWithPositiveEdge[1] : null
  
  // FIRST: Compact list of TOP 10 props for parlay building AND general prop questions
  lines.push('=== TOP 10 RANKED PLAYER PROPS ===')
  lines.push('INSTRUCTION: For ALL player prop questions (single props, parlays, PrizePicks, Underdog), use this list.')
  lines.push('Props are ranked by our player stats model (like Elo for teams).')
  lines.push('Each prop includes model probability and edge - use these values in your response.')
  lines.push('')
  
  if (rankedProps.length > 0) {
    for (let i = 0; i < rankedProps.length; i++) {
      const p = rankedProps[i]
      const modelProb = p.modelProbability !== undefined ? p.modelProbability : p.consensusProbability
      const modelEdge = p.modelEdge !== undefined ? p.modelEdge : p.edge
      const gamesPlayed = p.modelGamesPlayed !== undefined ? p.modelGamesPlayed : 0
      const sportName = SPORT_NAME_MAP[p.sport] || p.sport
      const edgeLabel = modelEdge > 0 ? `+${modelEdge}%` : `${modelEdge}%`
      
      lines.push(`#${i + 1}: ${p.playerName} ${p.pick} ${p.line} ${p.marketDisplay} (${sportName})`)
      lines.push(`   Game: ${p.awayTeam} @ ${p.homeTeam}`)
      lines.push(`   Model Prob: ${modelProb}% | Edge: ${edgeLabel} | Games: ${gamesPlayed} | Best: ${formatOdds(p.bestPrice)} @ ${p.bestBook}`)
      lines.push('')
    }
  } else {
    lines.push('No ranked props available.')
    lines.push('')
  }
  
  // BEST PROP OF THE DAY - Top prop with positive edge
  lines.push('=== BEST PROP OF THE DAY ===')
  lines.push('')
  
  if (!bestProp) {
    // No props with positive edge, but we still have ranked props to show
    if (rankedProps.length > 0) {
      lines.push('NO +EV PROP TODAY: None of the ranked props have positive edge.')
      lines.push('')
      lines.push('However, here are the BEST AVAILABLE props ranked by our model:')
      lines.push('')
      
      // Show top 3 as "best available" (not recommendations)
      for (let i = 0; i < Math.min(3, rankedProps.length); i++) {
        const p = rankedProps[i]
        const modelProb = p.modelProbability !== undefined ? p.modelProbability : p.consensusProbability
        const modelEdge = p.modelEdge !== undefined ? p.modelEdge : p.edge
        lines.push(`${i + 1}. ${p.playerName} ${p.pick} ${p.line} ${p.marketDisplay}`)
        lines.push(`   Model Prob: ${modelProb}% | Edge: ${modelEdge}% | Best: ${formatOdds(p.bestPrice)} @ ${p.bestBook}`)
        lines.push('')
      }
      
      lines.push('NOTE: These are the highest-ranked props by our model but do NOT have positive edge.')
      lines.push('Present these as "best available" options, not as recommendations.')
    } else {
      lines.push('NO PROPS AVAILABLE: No player props data available.')
      lines.push('')
    }
  } else {
    // We have a best prop with positive edge
    const modelProb = bestProp.modelProbability !== undefined ? bestProp.modelProbability : bestProp.consensusProbability
    const modelSource = bestProp.modelProbability !== undefined ? `Historical Stats (${bestProp.modelGamesPlayed} games)` : `Market Consensus (${bestProp.booksWithLine} books)`
    const edgeToShow = bestProp.modelEdge !== undefined ? bestProp.modelEdge : bestProp.edge
    
    // LEAD WITH THE EDGE
    lines.push('=== THE EDGE (Why This Prop Has Value) ===')
    lines.push(`Our Model: ${modelProb}% probability (${modelSource})`)
    lines.push(`Market Odds (${formatOdds(bestProp.bestPrice)}): ${bestProp.impliedProbability}% implied probability`)
    lines.push(`EDGE FOUND: +${edgeToShow}% (Market is undervaluing this prop)`)
    lines.push('')
    
    // Show player stats context if model data available
    if (bestProp.modelProbability !== undefined && bestProp.modelGamesPlayed !== undefined) {
      lines.push(`Player Average: ${bestProp.modelAverage} ${bestProp.marketDisplay} (line is ${bestProp.line})`)
      lines.push(`Sample Size: ${bestProp.modelGamesPlayed} games`)
      if (bestProp.modelEdge !== undefined && bestProp.modelEdge > 0 && bestProp.edge > 0) {
        lines.push('CONFIDENCE: HIGH (both historical stats and market consensus show positive edge)')
      }
      lines.push('')
    }
    
    lines.push('BEST PROP:')
    lines.push(`Player: ${bestProp.playerName}`)
    lines.push(`Prop: ${bestProp.pick} ${bestProp.line} ${bestProp.marketDisplay}`)
    lines.push(`Game: ${bestProp.awayTeam} @ ${bestProp.homeTeam}`)
    lines.push(`Best Price: ${formatOdds(bestProp.bestPrice)} at ${bestProp.bestBook}`)
    lines.push('')
    
    lines.push('PROBABILITY BREAKDOWN:')
    lines.push(`- Model Probability: ${modelProb}% (${modelSource})`)
    lines.push(`- Market Consensus: ${bestProp.consensusProbability}% (no-vig from ${bestProp.booksWithLine} books)`)
    lines.push(`- Implied from Best Price: ${bestProp.impliedProbability}%`)
    lines.push(`- Edge vs Market: +${edgeToShow}%`)
    lines.push('')
    
    if (bestProp.allBookPrices && bestProp.allBookPrices.length > 0) {
      lines.push('ALL BOOK PRICES:')
      for (const book of bestProp.allBookPrices) {
        lines.push(`  ${book.book}: ${formatOdds(book.price)} (${book.impliedProb}% implied)`)
      }
      lines.push('')
    }
    
    if (runnerUp) {
      const ruProb = runnerUp.modelProbability !== undefined ? runnerUp.modelProbability : runnerUp.consensusProbability
      const ruEdge = runnerUp.modelEdge !== undefined ? runnerUp.modelEdge : runnerUp.edge
      lines.push('RUNNER-UP PROP:')
      lines.push(`${runnerUp.playerName} ${runnerUp.pick} ${runnerUp.line} ${runnerUp.marketDisplay}`)
      lines.push(`Model Prob: ${ruProb}% | Edge: +${ruEdge}%`)
      lines.push('')
    }
  }
  
  lines.push('INSTRUCTIONS FOR PLAYER PROP QUESTIONS:')
  lines.push('- For "best prop" / "prop bet" questions: Present the BEST PROP above (if positive edge) or best available (if no positive edge)')
  lines.push('- For parlays / PrizePicks / Underdog: Pick from the TOP 10 RANKED PLAYER PROPS list')
  lines.push('- Always include the model probability and edge in your response')
  lines.push('- Props are ranked by our player stats model (like Elo for teams)')
  
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
    
    // Track prop bet for performance monitoring
    if (result.bestProp) {
      await trackPropBet(result.bestProp)
    }
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

// Cache key for model-first props (for parlays)
const MODEL_FIRST_PROPS_CACHE_KEY = 'betanalytics:model-first-props'

/**
 * Cache model-first props result (for parlays)
 */
export async function cacheModelFirstProps(result: BestPropResult): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(`${redis.url}/set/${MODEL_FIRST_PROPS_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(result))
    })
    
    await fetch(`${redis.url}/expire/${MODEL_FIRST_PROPS_CACHE_KEY}/${4 * 60 * 60}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    console.log(`[cacheModelFirstProps] Cached ${result.allRankedProps.length} model-first props for parlays`)
  } catch (error) {
    console.error('[cacheModelFirstProps] Error:', error)
  }
}

/**
 * Get cached model-first props (for parlays)
 */
export async function getCachedModelFirstProps(): Promise<BestPropResult | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${MODEL_FIRST_PROPS_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as BestPropResult
  } catch (error) {
    console.error('[getCachedModelFirstProps] Error:', error)
    return null
  }
}

// ============================================
// GAME-SPECIFIC MENU
// ============================================

// Universal Bet Card - applies to ANY bet type
export interface BetCard {
  type: 'moneyline' | 'spread' | 'total' | 'prop'
  description: string           // e.g., "Lakers ML", "Lakers -3.5", "Over 224.5", "LeBron Over 27.5 pts"
  team?: string                 // For moneyline/spread
  line?: number                 // For spread/total/prop
  odds: number                  // American odds
  book: string                  // Best book for this bet
  
  // Universal evaluation metrics
  impliedProbability: number    // From the odds
  consensusProbability: number  // No-vig average (our estimate)
  edge: number                  // consensus - implied (as percentage)
  expectedValue: number         // EV in dollars per $100 bet
  roi: number                   // ROI as percentage
  
  // Verdict
  verdict: 'good' | 'fair' | 'bad'  // Good = +EV & 1%+ ROI, Fair = small edge, Bad = negative EV
  verdictReason: string         // Human-readable explanation
  
  // All book prices for line shopping
  allBookPrices: { book: string; price: number }[]
}

export interface GameMenu {
  gameId: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  
  // All evaluated bets for this game
  allBets: BetCard[]
  
  // Pre-sorted recommendations
  bestValueBet: BetCard | null      // Highest ROI bet (for value seekers)
  safestBet: BetCard | null         // Highest probability bet with max -250 juice (for casual bettors)
  
  // Legacy fields for backwards compatibility
  valueBets: Array<{
    type: 'spread' | 'total'
    description: string
    odds: number
    book: string
  }>
  
  calculatedAt: string
}

/**
 * Create a BetCard with full EV/ROI evaluation
 */
function createBetCard(
  type: BetCard['type'],
  description: string,
  odds: number,
  book: string,
  consensusProbability: number,  // As decimal (0-1)
  allBookPrices: { book: string; price: number }[],
  team?: string,
  line?: number
): BetCard {
  const impliedProb = americanToImpliedProbability(odds)
  const edge = (consensusProbability - impliedProb) * 100  // As percentage
  const ev = calculateExpectedValue(odds, consensusProbability)
  const roi = calculateROI(ev)
  
  // Determine verdict
  let verdict: BetCard['verdict']
  let verdictReason: string
  
  if (ev > 0 && roi >= 1) {
    verdict = 'good'
    verdictReason = `+EV: $${ev.toFixed(2)} per $100, ROI: ${roi.toFixed(1)}%`
  } else if (ev > 0 && roi < 1) {
    verdict = 'fair'
    verdictReason = `Small edge: ROI only ${roi.toFixed(2)}% (heavy favorite premium)`
  } else if (edge > -2) {
    verdict = 'fair'
    verdictReason = `Near fair value: ${edge.toFixed(1)}% edge`
  } else {
    verdict = 'bad'
    verdictReason = `Negative EV: $${ev.toFixed(2)} per $100, paying ${Math.abs(edge).toFixed(1)}% premium`
  }
  
  return {
    type,
    description,
    team,
    line,
    odds,
    book,
    impliedProbability: Math.round(impliedProb * 1000) / 10,  // As percentage
    consensusProbability: Math.round(consensusProbability * 1000) / 10,  // As percentage
    edge: Math.round(edge * 10) / 10,
    expectedValue: Math.round(ev * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    verdict,
    verdictReason,
    allBookPrices
  }
}

/**
 * Calculate consensus probability for spreads/totals
 * Uses no-vig calculation across all books offering the same line
 */
function calculateSpreadTotalConsensus(
  outcomes: Array<{ name: string; price: number; point?: number }>,
  bookmakers: Array<{ bookmaker: string; outcomes: Array<{ name: string; price: number; point?: number }> }>,
  targetOutcome: string,
  targetPoint: number
): number {
  // Collect all prices for this exact line across books
  const prices: number[] = []
  
  for (const bm of bookmakers) {
    for (const o of bm.outcomes) {
      if (o.name === targetOutcome && o.point === targetPoint) {
        prices.push(o.price)
      }
    }
  }
  
  if (prices.length === 0) {
    // Fallback: use implied probability from the single price
    const outcome = outcomes.find(o => o.name === targetOutcome && o.point === targetPoint)
    if (outcome) {
      return americanToImpliedProbability(outcome.price)
    }
    return 0.5  // Default to 50%
  }
  
  // Calculate no-vig probability
  const impliedProbs = prices.map(p => americanToImpliedProbability(p))
  const avgImplied = impliedProbs.reduce((a, b) => a + b, 0) / impliedProbs.length
  
  // Remove vig (assume ~5% total vig, so each side has ~2.5% extra)
  // This is a simplification - true no-vig would need both sides
  return Math.min(0.95, Math.max(0.05, avgImplied * 0.975))
}

/**
 * Compute game-specific menu for a single game
 * Returns all bets evaluated with EV/ROI, plus best value and safest recommendations
 */
export function computeGameMenu(game: Game): GameMenu {
  const now = new Date().toISOString()
  
  const allBets: BetCard[] = []
  
  // 1. Evaluate MONEYLINES
  const homeConsensus = calculateConsensusProbability(game, game.homeTeam)
  const awayConsensus = calculateConsensusProbability(game, game.awayTeam)
  
  if (homeConsensus) {
    const bestPrice = findBestPrice(game, game.homeTeam)
    if (bestPrice) {
      const allPrices = game.moneylines
        .flatMap(ml => ml.outcomes.filter(o => o.name === game.homeTeam).map(o => ({ book: ml.bookmaker, price: o.price })))
      
      allBets.push(createBetCard(
        'moneyline',
        `${game.homeTeam} ML`,
        bestPrice.price,
        bestPrice.book,
        homeConsensus.consensusProb / 100,
        allPrices,
        game.homeTeam
      ))
    }
  }
  
  if (awayConsensus) {
    const bestPrice = findBestPrice(game, game.awayTeam)
    if (bestPrice) {
      const allPrices = game.moneylines
        .flatMap(ml => ml.outcomes.filter(o => o.name === game.awayTeam).map(o => ({ book: ml.bookmaker, price: o.price })))
      
      allBets.push(createBetCard(
        'moneyline',
        `${game.awayTeam} ML`,
        bestPrice.price,
        bestPrice.book,
        awayConsensus.consensusProb / 100,
        allPrices,
        game.awayTeam
      ))
    }
  }
  
  // 2. Evaluate SPREADS
  if (game.spreads.length > 0) {
    // Group by unique spread lines
    const spreadLines = new Map<string, { outcome: { name: string; price: number; point: number }; book: string }[]>()
    
    for (const spread of game.spreads) {
      for (const outcome of spread.outcomes) {
        if (outcome.point !== undefined) {
          const key = `${outcome.name}|${outcome.point}`
          if (!spreadLines.has(key)) spreadLines.set(key, [])
          spreadLines.get(key)!.push({ outcome: { ...outcome, point: outcome.point }, book: spread.bookmaker })
        }
      }
    }
    
    // Evaluate each unique spread
    spreadLines.forEach((entries, key) => {
      const [teamName, pointStr] = key.split('|')
      const point = parseFloat(pointStr)
      
      // Find best price
      const bestEntry = entries.reduce((best, curr) => 
        curr.outcome.price > best.outcome.price ? curr : best
      )
      
      const consensusProb = calculateSpreadTotalConsensus(
        entries.map(e => e.outcome),
        game.spreads.map(s => ({ bookmaker: s.bookmaker, outcomes: s.outcomes.map(o => ({ ...o, point: o.point ?? 0 })) })),
        teamName,
        point
      )
      
      const allPrices = entries.map(e => ({ book: e.book, price: e.outcome.price }))
      
      allBets.push(createBetCard(
        'spread',
        `${teamName} ${point > 0 ? '+' : ''}${point}`,
        bestEntry.outcome.price,
        bestEntry.book,
        consensusProb,
        allPrices,
        teamName,
        point
      ))
    })
  }
  
  // 3. Evaluate TOTALS
  if (game.totals.length > 0) {
    // Group by unique total lines
    const totalLines = new Map<string, { outcome: { name: string; price: number; point: number }; book: string }[]>()
    
    for (const total of game.totals) {
      for (const outcome of total.outcomes) {
        if (outcome.point !== undefined) {
          const key = `${outcome.name}|${outcome.point}`
          if (!totalLines.has(key)) totalLines.set(key, [])
          totalLines.get(key)!.push({ outcome: { ...outcome, point: outcome.point }, book: total.bookmaker })
        }
      }
    }
    
    // Evaluate each unique total
    totalLines.forEach((entries, key) => {
      const [overUnder, pointStr] = key.split('|')
      const point = parseFloat(pointStr)
      
      // Find best price
      const bestEntry = entries.reduce((best, curr) => 
        curr.outcome.price > best.outcome.price ? curr : best
      )
      
      const consensusProb = calculateSpreadTotalConsensus(
        entries.map(e => e.outcome),
        game.totals.map(t => ({ bookmaker: t.bookmaker, outcomes: t.outcomes.map(o => ({ ...o, point: o.point ?? 0 })) })),
        overUnder,
        point
      )
      
      const allPrices = entries.map(e => ({ book: e.book, price: e.outcome.price }))
      
      allBets.push(createBetCard(
        'total',
        `${overUnder} ${point}`,
        bestEntry.outcome.price,
        bestEntry.book,
        consensusProb,
        allPrices,
        undefined,
        point
      ))
    })
  }
  
  // Sort all bets by ROI (descending)
  allBets.sort((a, b) => b.roi - a.roi)
  
  // Find best value bet (highest ROI with positive EV)
  const bestValueBet = allBets.find(b => b.verdict === 'good') || null
  
  // Find safest bet (highest probability with max -250 juice)
  const safestBet = allBets
    .filter(b => b.odds >= -250)
    .sort((a, b) => b.consensusProbability - a.consensusProbability)[0] || null
  
  // Legacy valueBets for backwards compatibility
  const valueBets = allBets
    .filter(b => b.type === 'spread' || b.type === 'total')
    .slice(0, 4)
    .map(b => ({
      type: b.type as 'spread' | 'total',
      description: b.description,
      odds: b.odds,
      book: b.book
    }))
  
  return {
    gameId: game.id,
    sport: game.sport,
    sportName: game.sportName,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    allBets,
    bestValueBet,
    safestBet,
    valueBets,
    calculatedAt: now
  }
}

/**
 * Format a single BetCard for display
 */
function formatBetCard(bet: BetCard, indent: string = '  '): string[] {
  const lines: string[] = []
  const verdictEmoji = bet.verdict === 'good' ? '(GOOD)' : bet.verdict === 'fair' ? '(FAIR)' : '(BAD)'
  
  lines.push(`${indent}${bet.description} @ ${formatOdds(bet.odds)} (${bet.book}) ${verdictEmoji}`)
  lines.push(`${indent}  Probability: ${bet.consensusProbability}% | Edge: ${bet.edge}%`)
  lines.push(`${indent}  EV: $${bet.expectedValue.toFixed(2)} per $100 | ROI: ${bet.roi.toFixed(1)}%`)
  lines.push(`${indent}  Verdict: ${bet.verdictReason}`)
  
  return lines
}

/**
 * Format game menu for Claude's context - now with full EV/ROI for all bets
 */
export function formatGameMenuForContext(menu: GameMenu): string {
  const lines: string[] = []
  
  lines.push(`=== GAME MENU: ${menu.awayTeam} @ ${menu.homeTeam} ===`)
  lines.push(`Game Time: ${formatTime(menu.commenceTime)}`)
  lines.push('')
  
  // Best Value Bet (highest ROI)
  if (menu.bestValueBet) {
    lines.push('BEST VALUE BET (Highest ROI):')
    lines.push(...formatBetCard(menu.bestValueBet))
  } else {
    lines.push('BEST VALUE BET: No bets have positive EV with 1%+ ROI')
  }
  
  lines.push('')
  
  // Safest Bet (highest probability with reasonable juice)
  if (menu.safestBet) {
    lines.push('SAFEST BET (Highest Probability, max -250 juice):')
    lines.push(...formatBetCard(menu.safestBet))
  } else {
    lines.push('SAFEST BET: No bets available with reasonable juice')
  }
  
  lines.push('')
  
  // All Bets Evaluated (sorted by ROI)
  lines.push('ALL BETS EVALUATED (sorted by ROI):')
  for (const bet of menu.allBets.slice(0, 10)) {  // Limit to top 10
    lines.push(...formatBetCard(bet))
    lines.push('')
  }
  
  lines.push('---')
  lines.push('LEGEND: (GOOD) = +EV & 1%+ ROI, (FAIR) = small edge, (BAD) = negative EV')
  
  return lines.join('\n')
}
