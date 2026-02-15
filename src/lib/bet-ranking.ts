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
import { getPlayerPropProbability, getPlayerStatsData, type PlayerStats, type EnhancedPropProbability } from './player-stats'
import { trackBestBet, trackParlay, trackSportBet, trackPropBet } from './recommendation-tracking'
import { 
  getEloWinProbabilityByName, 
  getEloWinProbabilityWithInjuries,
  calculateSpreadCoverProbability,
  calculateTotalProbability,
  getTeamMarginStatsByName,
  type InjuryInfo,
  type PlayerImportance
} from './elo'
import {
  calculateSituationalFactors,
  calculateSituationalAdjustment,
  applyAdjustment
} from './situational-factors'
import type { WeatherData } from './weather'
import { type LineMovement } from './line-movement'
import { normalizeTeamName as normalizeScheduleTeamName, type TeamScheduleData } from './team-schedule'
import { getCalibratedProbability } from './calibration'

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
  
  // Situational factors (when available)
  situationalAdjustment?: number     // Total probability adjustment from situational factors
  situationalNotes?: string[]        // Human-readable notes about situational factors
  situationalBreakdown?: {           // Full breakdown of all 7 situational factors
    restDays: { value: string; adjustment: number }
    travel: { value: string; adjustment: number }
    recentForm: { value: string; adjustment: number }
    weather: { value: string; adjustment: number }
    sharpMoney: { value: string; adjustment: number }
    motivation: { value: string; adjustment: number }
    injuries: { value: string; adjustment: number }
  }
  baseEloProbability?: number        // Base Elo probability before situational adjustments
  
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
  allEloBets: RankedBet[]  // ALL bets with Elo data (for sport-specific queries, not filtered)
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

// Enhanced parlay result with full analysis for conversational responses
export interface EnhancedParlayResult {
  legs: RankedBet[]                    // The parlay legs
  legCount: number                     // Number of legs
  combinedProbability: number          // Combined probability (multiply individual probs)
  parlayOdds: number                   // American odds for the parlay
  parlayPayout: number                 // Payout per $100 bet
  impliedProbability: number           // Implied probability from parlay odds
  parlayEdge: number                   // Edge on the parlay (combined prob - implied prob)
  expectedValue: number                // Expected value per $100 bet
  calculatedAt: string
  alternatives: {                      // Alternative parlay options
    twoLeg?: EnhancedParlayResult
    threeLeg?: EnhancedParlayResult
    fourLeg?: EnhancedParlayResult
  }
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

// ============================================
// IMPROVED SPREAD BETTING PARAMETERS (System-wide)
// ============================================
// These improvements apply to ALL bet analysis functions, not just backtest

// Sport-specific minimum expected margin edge (in points/goals)
// Only recommend spreads when our expected margin differs from market spread by this much
// Higher threshold = more selective = higher win rate
const MIN_SPREAD_MARGIN_EDGE: Record<string, number> = {
  'NBA': 3,        // Only bet when expected margin differs by 3+ points from market
  'NFL': 2.5,      // NFL has fewer games, slightly lower threshold
  'NHL': 999,      // NHL: Don't recommend puck lines at all (use moneylines only)
  'MLB': 1,        // MLB run lines are 1.5, so smaller threshold
  'NCAAB': 4,      // College has more variance, need higher threshold
  'NCAAF': 3,      // Similar to NFL but more variance
  'soccer_epl': 0.5,
  'soccer_spain_la_liga': 0.5,
  'soccer_germany_bundesliga': 0.5,
  'soccer_italy_serie_a': 0.5,
  'soccer_france_ligue_one': 0.5,
  'soccer_usa_mls': 0.5,
  'soccer_uefa_champs_league': 0.5,
}

// Maximum margin variance (sigma) allowed for a team
// Teams with higher variance are harder to predict - skip these matchups
const MAX_TEAM_VARIANCE: Record<string, number> = {
  'NBA': 16,       // Skip games with teams that have >16 point std dev
  'NFL': 18,       // NFL has more variance naturally
  'NHL': 2.5,      // NHL goals
  'MLB': 4,        // MLB runs
  'NCAAB': 18,     // College has more variance
  'NCAAF': 22,     // College football has highest variance
  'soccer_epl': 2,
  'soccer_spain_la_liga': 2,
  'soccer_germany_bundesliga': 2,
  'soccer_italy_serie_a': 2,
  'soccer_france_ligue_one': 2,
  'soccer_usa_mls': 2,
  'soccer_uefa_champs_league': 2,
}

// Reputable books for consensus calculation (exclude sharp-only books)
const CONSENSUS_BOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet',
  'BetRivers', 'Unibet', 'Barstool', 'WynnBET', 'SuperBook'
]

// Map sport codes to Elo league names
// Includes both odds API sport codes (e.g., 'icehockey_nhl') and ESPN sport codes (e.g., 'hockey')
const SPORT_TO_ELO_LEAGUE: Record<string, string> = {
  // Odds API sport codes
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
  // ESPN sport codes (from ESPN odds cache)
  'hockey': 'NHL',
  'basketball': 'NBA',
  'football': 'NFL',
  'baseball': 'MLB',
  'soccer': 'soccer_epl',  // Default to EPL for generic soccer
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
 * FALLBACK: Hardcoded star players for each NBA team
 * Used when player stats data is unavailable (Redis not configured or empty)
 * This ensures star player detection ALWAYS works for injury filtering
 */
const NBA_STAR_PLAYERS: Record<string, string[]> = {
  // Western Conference
  'nuggets': ['Nikola Jokic', 'Jamal Murray', 'Michael Porter Jr'],
  'denver': ['Nikola Jokic', 'Jamal Murray', 'Michael Porter Jr'],
  'lakers': ['LeBron James', 'Anthony Davis', 'Austin Reaves'],
  'los angeles lakers': ['LeBron James', 'Anthony Davis', 'Austin Reaves'],
  'clippers': ['Kawhi Leonard', 'Paul George', 'James Harden'],
  'la clippers': ['Kawhi Leonard', 'Paul George', 'James Harden'],
  'warriors': ['Stephen Curry', 'Klay Thompson', 'Draymond Green'],
  'golden state': ['Stephen Curry', 'Klay Thompson', 'Draymond Green'],
  'suns': ['Kevin Durant', 'Devin Booker', 'Bradley Beal'],
  'phoenix': ['Kevin Durant', 'Devin Booker', 'Bradley Beal'],
  'mavericks': ['Luka Doncic', 'Kyrie Irving', 'PJ Washington'],
  'dallas': ['Luka Doncic', 'Kyrie Irving', 'PJ Washington'],
  'grizzlies': ['Ja Morant', 'Desmond Bane', 'Jaren Jackson Jr'],
  'memphis': ['Ja Morant', 'Desmond Bane', 'Jaren Jackson Jr'],
  'pelicans': ['Zion Williamson', 'Brandon Ingram', 'CJ McCollum'],
  'new orleans': ['Zion Williamson', 'Brandon Ingram', 'CJ McCollum'],
  'timberwolves': ['Anthony Edwards', 'Karl-Anthony Towns', 'Rudy Gobert'],
  'minnesota': ['Anthony Edwards', 'Karl-Anthony Towns', 'Rudy Gobert'],
  'thunder': ['Shai Gilgeous-Alexander', 'Jalen Williams', 'Chet Holmgren'],
  'oklahoma city': ['Shai Gilgeous-Alexander', 'Jalen Williams', 'Chet Holmgren'],
  'rockets': ['Jalen Green', 'Alperen Sengun', 'Fred VanVleet'],
  'houston': ['Jalen Green', 'Alperen Sengun', 'Fred VanVleet'],
  'spurs': ['Victor Wembanyama', 'Devin Vassell', 'Keldon Johnson'],
  'san antonio': ['Victor Wembanyama', 'Devin Vassell', 'Keldon Johnson'],
  'kings': ['De\'Aaron Fox', 'Domantas Sabonis', 'Keegan Murray'],
  'sacramento': ['De\'Aaron Fox', 'Domantas Sabonis', 'Keegan Murray'],
  'trail blazers': ['Damian Lillard', 'Anfernee Simons', 'Jerami Grant'],
  'portland': ['Damian Lillard', 'Anfernee Simons', 'Jerami Grant'],
  'jazz': ['Lauri Markkanen', 'Jordan Clarkson', 'Collin Sexton'],
  'utah': ['Lauri Markkanen', 'Jordan Clarkson', 'Collin Sexton'],
  // Eastern Conference
  'celtics': ['Jayson Tatum', 'Jaylen Brown', 'Kristaps Porzingis'],
  'boston': ['Jayson Tatum', 'Jaylen Brown', 'Kristaps Porzingis'],
  'bucks': ['Giannis Antetokounmpo', 'Damian Lillard', 'Khris Middleton'],
  'milwaukee': ['Giannis Antetokounmpo', 'Damian Lillard', 'Khris Middleton'],
  '76ers': ['Joel Embiid', 'Tyrese Maxey', 'Tobias Harris'],
  'sixers': ['Joel Embiid', 'Tyrese Maxey', 'Tobias Harris'],
  'philadelphia': ['Joel Embiid', 'Tyrese Maxey', 'Tobias Harris'],
  'knicks': ['Jalen Brunson', 'Julius Randle', 'RJ Barrett'],
  'new york': ['Jalen Brunson', 'Julius Randle', 'RJ Barrett'],
  'nets': ['Mikal Bridges', 'Cameron Johnson', 'Spencer Dinwiddie'],
  'brooklyn': ['Mikal Bridges', 'Cameron Johnson', 'Spencer Dinwiddie'],
  'heat': ['Jimmy Butler', 'Bam Adebayo', 'Tyler Herro'],
  'miami': ['Jimmy Butler', 'Bam Adebayo', 'Tyler Herro'],
  'cavaliers': ['Donovan Mitchell', 'Darius Garland', 'Evan Mobley'],
  'cleveland': ['Donovan Mitchell', 'Darius Garland', 'Evan Mobley'],
  'bulls': ['DeMar DeRozan', 'Zach LaVine', 'Nikola Vucevic'],
  'chicago': ['DeMar DeRozan', 'Zach LaVine', 'Nikola Vucevic'],
  'hawks': ['Trae Young', 'Dejounte Murray', 'John Collins'],
  'atlanta': ['Trae Young', 'Dejounte Murray', 'John Collins'],
  'raptors': ['Pascal Siakam', 'Scottie Barnes', 'OG Anunoby'],
  'toronto': ['Pascal Siakam', 'Scottie Barnes', 'OG Anunoby'],
  'pacers': ['Tyrese Haliburton', 'Myles Turner', 'Buddy Hield'],
  'indiana': ['Tyrese Haliburton', 'Myles Turner', 'Buddy Hield'],
  'magic': ['Paolo Banchero', 'Franz Wagner', 'Jalen Suggs'],
  'orlando': ['Paolo Banchero', 'Franz Wagner', 'Jalen Suggs'],
  'pistons': ['Cade Cunningham', 'Jaden Ivey', 'Bojan Bogdanovic'],
  'detroit': ['Cade Cunningham', 'Jaden Ivey', 'Bojan Bogdanovic'],
  'wizards': ['Kyle Kuzma', 'Jordan Poole', 'Deni Avdija'],
  'washington': ['Kyle Kuzma', 'Jordan Poole', 'Deni Avdija'],
  'hornets': ['LaMelo Ball', 'Terry Rozier', 'Gordon Hayward'],
  'charlotte': ['LaMelo Ball', 'Terry Rozier', 'Gordon Hayward'],
}

/**
 * Get fallback star players for a team when player stats data is unavailable
 */
function getFallbackStarPlayers(teamName: string, sport: string): PlayerImportance[] {
  // Only NBA has hardcoded fallback for now
  if (!sport.toLowerCase().includes('nba') && !sport.toLowerCase().includes('basketball')) {
    return []
  }
  
  const teamNorm = teamName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  
  // Try to find matching team
  for (const [key, players] of Object.entries(NBA_STAR_PLAYERS)) {
    if (teamNorm.includes(key) || key.includes(teamNorm)) {
      console.log(`[getFallbackStarPlayers] Using fallback for ${teamName}: ${players.join(', ')}`)
      return players.map(name => ({
        playerName: name,
        teamName: teamName,
        sport: sport,
        scoringAverage: 25, // Placeholder - these are all star players
        isTopScorer: true
      }))
    }
  }
  
  console.log(`[getFallbackStarPlayers] No fallback found for team: ${teamName}`)
  return []
}

/**
 * Get top 3 scorers for a team from player stats data
 * Used for injury adjustment calculations
 * CRITICAL: Falls back to hardcoded star players when Redis data unavailable
 */
async function getTopScorersForTeam(
  teamName: string,
  sport: string
): Promise<PlayerImportance[]> {
  try {
    const playerStats = await getPlayerStatsData()
    
    // CRITICAL FIX: If player stats data is unavailable, use hardcoded fallback
    // This ensures star player detection works even when Redis is not configured
    if (!playerStats || !playerStats.players) {
      console.log(`[getTopScorersForTeam] Player stats unavailable, using fallback for ${teamName}`)
      return getFallbackStarPlayers(teamName, sport)
    }
    
    // Filter players for this team and sport (players is a Record, not an array)
    const allPlayers = Object.values(playerStats.players)
    const teamPlayers = allPlayers.filter((p: PlayerStats) => {
      const playerTeamNorm = p.teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
      const teamNorm = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
      return (playerTeamNorm.includes(teamNorm) || teamNorm.includes(playerTeamNorm)) &&
             p.sport.toLowerCase() === sport.toLowerCase()
    })
    
    // If no players found in stats data, use fallback
    if (teamPlayers.length === 0) {
      console.log(`[getTopScorersForTeam] No players in stats for ${teamName}, using fallback`)
      return getFallbackStarPlayers(teamName, sport)
    }
    
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
    
    // If sorted players is empty after filtering, use fallback
    if (sortedPlayers.length === 0) {
      console.log(`[getTopScorersForTeam] No scorers found for ${teamName}, using fallback`)
      return getFallbackStarPlayers(teamName, sport)
    }
    
    return sortedPlayers
  } catch (error) {
    console.error('[getTopScorersForTeam] Error:', error)
    // On error, use fallback instead of returning empty
    return getFallbackStarPlayers(teamName, sport)
  }
}

export async function analyzeGame(
  game: Game, 
  injuries?: InjuryInfo[],
  weather?: WeatherData | null,
  lineMovement?: LineMovement | null,
  homeLastGameDate?: string | null,
  awayLastGameDate?: string | null
): Promise<RankedBet[]> {
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
  console.log(`[analyzeGame] Game: ${game.awayTeam} @ ${game.homeTeam}, sport="${game.sport}", eloLeague="${eloLeague || 'NONE'}"`)
  
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
    
    if (eloResult) {
      // Elo returns home team win probability, so flip for away team
      eloProbability = isHomeTeam ? eloResult.probability : (1 - eloResult.probability)
      eloConfidence = eloResult.confidence
      homeElo = eloResult.homeRating
      awayElo = eloResult.awayRating
      
      // Use Elo as the model probability for edge calculation
      // Note: We now use Elo even with 'very_low' confidence to ensure all sports have Elo-based recommendations
      // The confidence level is still tracked and displayed to users
      modelProbability = eloProbability
      
      if (eloResult.confidence === 'very_low') {
        console.log(`[analyzeGame] Using Elo with very_low confidence for ${game.homeTeam} vs ${game.awayTeam} (${game.sportName})`)
      }
    }
    
    // Calculate situational factors and apply adjustment to model probability
    // This accounts for back-to-back games, rest advantage, travel fatigue, etc.
    const eloLeagueForSituational = SPORT_TO_ELO_LEAGUE[game.sport] || game.sport
    const opponentName = isHomeTeam ? game.awayTeam : game.homeTeam
    
    // Get the correct lastGameDate based on which team we're analyzing
    const teamLastGameDate = isHomeTeam ? homeLastGameDate : awayLastGameDate
    const opponentLastGameDate = isHomeTeam ? awayLastGameDate : homeLastGameDate
    
    const situationalFactors = calculateSituationalFactors(
      team,
      opponentName,
      eloLeagueForSituational,
      isHomeTeam,
      undefined, // teamRecord - would need to be passed from enriched game data
      teamLastGameDate || undefined,  // lastGameDate from schedule data
      opponentLastGameDate || undefined,  // opponentLastGameDate from schedule data
      weather,   // Weather data for outdoor sports
      lineMovement,  // Line movement data for sharp money detection
      game.commenceTime ? new Date(game.commenceTime) : null
    )
    
    const situationalAdj = calculateSituationalAdjustment(situationalFactors, eloLeagueForSituational, team, opponentName)
    
    // Apply situational adjustment to model probability
    const adjustedModelProbability = applyAdjustment(modelProbability, situationalAdj.totalAdjustment)
    
    // Log significant situational adjustments
    if (Math.abs(situationalAdj.totalAdjustment) >= 0.02) {
      console.log(`[analyzeGame] Situational adjustment for ${team}: ${(situationalAdj.totalAdjustment * 100).toFixed(1)}%`)
      situationalAdj.notes.forEach(note => console.log(`  - ${note}`))
    }
    
    // Calculate edge: adjusted model probability - implied probability from best price
    // This is the key change: edge is now based on our Elo model + situational factors vs market
    const edge = adjustedModelProbability - bestPrice.impliedProb
    
    // Calculate Expected Value and ROI using ADJUSTED probability (Elo + situational factors)
    const ev = calculateExpectedValue(bestPrice.price, adjustedModelProbability)
    const roi = calculateROI(ev)
    
    // Check minimum thresholds using ADJUSTED probability
    if (adjustedModelProbability < MIN_PROBABILITY) continue
    if (edge < MIN_EDGE) continue
    
    // Also require positive EV
    if (ev <= 0) continue
    
    // Require minimum ROI of 1% to avoid tiny-edge heavy favorites
    if (roi < 1) continue
    
    // Calculate score using EV-based scoring system with adjusted probability
    const score = calculateBetScore(adjustedModelProbability, edge, roi)
    
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
      edge: Math.round(edge * 1000) / 10, // Now based on Elo + situational vs market
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
      situationalAdjustment: situationalAdj.totalAdjustment !== 0 ? Math.round(situationalAdj.totalAdjustment * 1000) / 10 : undefined,
      situationalNotes: situationalAdj.notes.length > 0 ? situationalAdj.notes : undefined,
      situationalBreakdown: {
        restDays: {
          // Show actual rest days info even if adjustment is 0
          value: situationalFactors.isBackToBack ? 'Back-to-back game' : 
                 situationalFactors.restAdvantage > 0 ? `+${situationalFactors.restAdvantage} days rest vs opponent` :
                 situationalFactors.restAdvantage < 0 ? `${situationalFactors.restAdvantage} days rest vs opponent` : 
                 `${situationalFactors.restDays || 3} days rest (equal)`,
          adjustment: Math.round((situationalAdj.breakdown.backToBack + situationalAdj.breakdown.restAdvantage) * 1000) / 10
        },
        travel: {
          // Fix: Show correct travel info based on whether team is home or away
          // isHomeTeam is true if this team is the home team, false if away
          value: isHomeTeam ? 'Home game (no travel)' :
                 situationalFactors.travelDistance === 'cross_country' ? `Cross-country travel (${situationalFactors.timezoneChange}hr TZ change)` :
                 situationalFactors.travelDistance === 'long' ? `Long travel (${situationalFactors.timezoneChange}hr TZ change)` :
                 situationalFactors.travelDistance === 'medium' ? 'Medium distance travel' :
                 situationalFactors.travelDistance === 'short' ? 'Short travel' :
                 'Away game (travel data unavailable)',
          adjustment: Math.round(situationalAdj.breakdown.travel * 1000) / 10
        },
        recentForm: {
          // Show actual form info even if neutral
          value: situationalFactors.formTrend === 'hot' ? 'Hot streak (winning)' :
                 situationalFactors.formTrend === 'cold' ? 'Cold streak (losing)' : 
                 'Recent form: neutral',
          adjustment: Math.round(situationalAdj.breakdown.recentForm * 1000) / 10
        },
        weather: {
          // Show weather info or explain why N/A
          value: situationalFactors.weatherImpact ? `${situationalFactors.weatherImpact.level} weather impact` : 
                 (eloLeagueForSituational === 'NFL' || eloLeagueForSituational === 'MLB' || eloLeagueForSituational?.includes('soccer')) ? 'Weather: normal conditions' : 'Indoor sport (N/A)',
          adjustment: Math.round(situationalAdj.breakdown.weather * 1000) / 10
        },
        sharpMoney: {
          // Show line movement info even if no sharp action detected
          value: situationalFactors.sharpMoneyIndicator ? 'Sharp money detected' :
                 situationalFactors.lineMovementDirection === 'toward' ? 'Line moving toward this team' :
                 situationalFactors.lineMovementDirection === 'away' ? 'Line moving away from this team' : 
                 'No significant line movement',
          adjustment: Math.round(situationalAdj.breakdown.sharpMoney * 1000) / 10
        },
        motivation: {
          // Show motivation info or explain standard game
          value: situationalAdj.motivationAdjustment?.notes.length ? situationalAdj.motivationAdjustment.notes[0] : 'Regular season game',
          adjustment: Math.round(situationalAdj.breakdown.motivation * 1000) / 10
        },
        injuries: {
          // Show injury info
          value: injuries && injuries.length > 0 ? `${injuries.length} injuries tracked` : 'No major injuries reported',
          adjustment: 0
        }
      },
      baseEloProbability: eloProbability ? Math.round(eloProbability * 1000) / 10 : undefined,
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
    for (const [key, entries] of Array.from(spreadLines.entries())) {
      const [teamName, pointStr] = key.split('|')
      const point = parseFloat(pointStr)
      
      // Find best price across all books
      const bestEntry = entries.reduce((best, curr) => 
        curr.outcome.price > best.outcome.price ? curr : best
      )
      
      // Determine if this is for home or away team
      // Use exact match first, then fall back to case-insensitive match
      const isHomeTeam = teamName === game.homeTeam || 
                         teamName.toLowerCase() === game.homeTeam.toLowerCase()
      
      // Use effective ratings if available (injury-adjusted), otherwise use base ratings
      const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
      const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
      
      // SPREAD DIRECTION VALIDATION: Ensure spread sign matches Elo favorite
      // Higher Elo team should have negative spread (favorite), lower Elo should have positive spread (underdog)
      const teamElo = isHomeTeam ? homeElo : awayElo
      const opponentElo = isHomeTeam ? awayElo : homeElo
      
      if (teamElo > opponentElo && point > 0) {
        console.error(`[SPREAD VALIDATION ERROR] ${teamName} has higher Elo (${Math.round(teamElo)}) than opponent (${Math.round(opponentElo)}) but has POSITIVE spread (+${point}). This indicates a spread direction bug.`)
        continue // Skip this bet - spread direction is wrong
      }
      
      if (teamElo < opponentElo && point < 0) {
        console.error(`[SPREAD VALIDATION ERROR] ${teamName} has lower Elo (${Math.round(teamElo)}) than opponent (${Math.round(opponentElo)}) but has NEGATIVE spread (${point}). This indicates a spread direction bug.`)
        continue // Skip this bet - spread direction is wrong
      }
      
      // Calculate Elo-based spread cover probability
      // Note: spread is from the team's perspective (e.g., home -3.5 means home must win by > 3.5)
      // For home team: use spread as-is
      // For away team: the spread is already from away's perspective (e.g., away +3.5)
      const spreadFromHomePerspective = isHomeTeam ? point : -point
      
      // FIX 2: Get team-specific margin variance for the betting team
      const bettingTeamMarginStats = await getTeamMarginStatsByName(eloLeague, teamName)
      const teamSpecificSigma = bettingTeamMarginStats?.marginStdDev
      
      const spreadResult = calculateSpreadCoverProbability(
        homeElo,
        awayElo,
        spreadFromHomePerspective,
        eloLeague,
        isHomeTeam,
        teamSpecificSigma  // FIX 2: Pass team-specific sigma for variance adjustment
      )
      
      // ============================================
      // IMPROVED SPREAD FILTERING (System-wide)
      // ============================================
      
      // FILTER 1: Skip NHL puck lines entirely (use moneylines only)
      // Puck lines (-1.5/+1.5) are very hard to beat because most games are 1-2 goal margins
      const minMarginEdge = MIN_SPREAD_MARGIN_EDGE[eloLeague] || 2
      if (minMarginEdge >= 999) {
        console.log(`[analyzeGame] Skipping ${eloLeague} spread bet - league uses moneylines only`)
        continue
      }
      
      // FILTER 2: Skip high-variance teams (harder to predict)
      const maxVariance = MAX_TEAM_VARIANCE[eloLeague] || 16
      const opponentMarginStats = await getTeamMarginStatsByName(eloLeague, isHomeTeam ? game.awayTeam : game.homeTeam)
      const opponentSigma = opponentMarginStats?.marginStdDev || 12
      
      if ((teamSpecificSigma && teamSpecificSigma > maxVariance) || opponentSigma > maxVariance) {
        console.log(`[analyzeGame] Skipping high-variance spread: ${teamName} sigma=${teamSpecificSigma?.toFixed(1)}, opponent sigma=${opponentSigma.toFixed(1)}, max=${maxVariance}`)
        continue
      }
      
      // FILTER 3: Check margin edge (difference between our expected margin and market spread)
      // Only bet when our expected margin differs significantly from the market spread
      const expectedMargin = spreadResult.expectedMargin
      const marketSpread = spreadFromHomePerspective // The spread from home perspective
      const marginEdge = Math.abs(expectedMargin - (-marketSpread)) // How much our prediction differs from market
      
      if (marginEdge < minMarginEdge) {
        // Edge too small - skip this spread bet
        continue
      }
      
      const rawEloCoverProb = spreadResult.probability
      
      // FIX 3: Apply calibration to adjust probability based on historical accuracy
      // This corrects for systematic over/under-confidence in our predictions
      const baseEloCoverProb = await getCalibratedProbability(rawEloCoverProb)
      
      // Apply situational factors to spread cover probability
      const opponentName = isHomeTeam ? game.awayTeam : game.homeTeam
      // Get the correct lastGameDate based on which team we're analyzing
      const spreadTeamLastGameDate = isHomeTeam ? homeLastGameDate : awayLastGameDate
      const spreadOpponentLastGameDate = isHomeTeam ? awayLastGameDate : homeLastGameDate
      
      const spreadSituationalFactors = calculateSituationalFactors(
        teamName,
        opponentName,
        eloLeague,
        isHomeTeam,
        undefined, // teamRecord
        spreadTeamLastGameDate || undefined,  // lastGameDate from schedule data
        spreadOpponentLastGameDate || undefined,  // opponentLastGameDate from schedule data
        weather,   // Weather data for outdoor sports
        lineMovement,  // Line movement data for sharp money detection
        game.commenceTime ? new Date(game.commenceTime) : null
      )
      const spreadSituationalAdj = calculateSituationalAdjustment(spreadSituationalFactors, eloLeague, teamName, opponentName)
      const eloCoverProb = applyAdjustment(baseEloCoverProb, spreadSituationalAdj.totalAdjustment)
      
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
      if (eloCoverProb < MIN_SPREAD_PROBABILITY) continue
      if (edge < MIN_SPREAD_EDGE) continue
      if (ev <= 0) continue
      if (roi < MIN_SPREAD_ROI) continue
      
      // SANITY CHECK: Reject bets with impossibly large edges (likely calculation errors)
      if (edge > MAX_SANE_EDGE) {
        console.warn(`[analyzeGame] SANITY CHECK FAILED: ${teamName} spread ${point} has edge ${(edge * 100).toFixed(1)}% > 25% max. Skipping.`)
        continue
      }
      
      // Check juice constraint
      if (bestEntry.outcome.price < MAX_JUICE_ODDS) continue
      
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
        consensusProbability: Math.round(eloCoverProb * 1000) / 10, // Now Elo-based + situational
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
        situationalAdjustment: spreadSituationalAdj.totalAdjustment !== 0 ? Math.round(spreadSituationalAdj.totalAdjustment * 1000) / 10 : undefined,
        situationalNotes: spreadSituationalAdj.notes.length > 0 ? spreadSituationalAdj.notes : undefined,
        // Store base Elo probability (before situational adjustments) and full breakdown
        baseEloProbability: Math.round(baseEloCoverProb * 1000) / 10,
        situationalBreakdown: {
          restDays: {
            // Show actual rest days info even if adjustment is 0
            value: spreadSituationalFactors.isBackToBack ? 'Back-to-back game' : 
                   spreadSituationalFactors.restAdvantage > 0 ? `+${spreadSituationalFactors.restAdvantage} days rest vs opponent` :
                   spreadSituationalFactors.restAdvantage < 0 ? `${spreadSituationalFactors.restAdvantage} days rest vs opponent` : 
                   `${spreadSituationalFactors.restDays || 3} days rest (equal)`,
            adjustment: Math.round((spreadSituationalAdj.breakdown.backToBack + spreadSituationalAdj.breakdown.restAdvantage) * 1000) / 10
          },
          travel: {
            // Fix: Show correct travel info based on whether team is home or away
            // isHomeTeam is true if this team is the home team, false if away
            value: isHomeTeam ? 'Home game (no travel)' :
                   spreadSituationalFactors.travelDistance === 'cross_country' ? `Cross-country travel (${spreadSituationalFactors.timezoneChange}hr TZ change)` :
                   spreadSituationalFactors.travelDistance === 'long' ? `Long travel (${spreadSituationalFactors.timezoneChange}hr TZ change)` :
                   spreadSituationalFactors.travelDistance === 'medium' ? 'Medium distance travel' :
                   spreadSituationalFactors.travelDistance === 'short' ? 'Short travel' :
                   'Away game (travel data unavailable)',
            adjustment: Math.round(spreadSituationalAdj.breakdown.travel * 1000) / 10
          },
          recentForm: {
            // Show actual form info even if neutral
            value: spreadSituationalFactors.formTrend === 'hot' ? 'Hot streak (winning)' :
                   spreadSituationalFactors.formTrend === 'cold' ? 'Cold streak (losing)' : 
                   'Recent form: neutral',
            adjustment: Math.round(spreadSituationalAdj.breakdown.recentForm * 1000) / 10
          },
          weather: {
            // Show weather info or explain why N/A
            value: spreadSituationalFactors.weatherImpact ? `${spreadSituationalFactors.weatherImpact.level} weather impact` : 
                   (eloLeague === 'NFL' || eloLeague === 'MLB' || eloLeague?.includes('soccer')) ? 'Weather: normal conditions' : 'Indoor sport (N/A)',
            adjustment: Math.round(spreadSituationalAdj.breakdown.weather * 1000) / 10
          },
          sharpMoney: {
            // Show line movement info even if no sharp action detected
            value: spreadSituationalFactors.sharpMoneyIndicator ? 'Sharp money detected' :
                   spreadSituationalFactors.lineMovementDirection === 'toward' ? 'Line moving toward this team' :
                   spreadSituationalFactors.lineMovementDirection === 'away' ? 'Line moving away from this team' : 
                   'No significant line movement',
            adjustment: Math.round(spreadSituationalAdj.breakdown.sharpMoney * 1000) / 10
          },
          motivation: {
            // Show motivation info or explain standard game
            value: spreadSituationalAdj.motivationAdjustment?.notes.length ? spreadSituationalAdj.motivationAdjustment.notes[0] : 'Regular season game',
            adjustment: Math.round(spreadSituationalAdj.breakdown.motivation * 1000) / 10
          },
          injuries: {
            // Show injury info
            value: injuries && injuries.length > 0 ? `${injuries.length} injuries tracked` : 'No major injuries reported',
            adjustment: 0
          }
        },
        calculatedAt: now
      })
    }
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
      
      // Calculate situational factors for totals (weather is especially important for outdoor sports)
      // For totals, use home team's lastGameDate and away team's as opponent
      const totalSituationalFactors = calculateSituationalFactors(
        game.homeTeam,
        game.awayTeam,
        eloLeague,
        true, // Use home team perspective for totals
        undefined, // teamRecord
        homeLastGameDate || undefined,  // lastGameDate from schedule data (home team)
        awayLastGameDate || undefined,  // opponentLastGameDate from schedule data (away team)
        weather,   // Weather data - critical for outdoor sports totals
        lineMovement,  // Line movement data for sharp money detection
        game.commenceTime ? new Date(game.commenceTime) : null
      )
      const totalSituationalAdj = calculateSituationalAdjustment(totalSituationalFactors, eloLeague, game.homeTeam, game.awayTeam)
      
      // Analyze OVER bets
      if (overEntries.length > 0) {
        const bestOverEntry = overEntries.reduce((best, curr) => 
          curr.outcome.price > best.outcome.price ? curr : best
        )
        
        // Calculate Elo-based over probability and apply situational adjustment
        const overResult = calculateTotalProbability(homeElo, awayElo, line, eloLeague, true)
        const baseEloOverProb = overResult.probability
        const eloOverProb = applyAdjustment(baseEloOverProb, totalSituationalAdj.totalAdjustment)
        
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
              situationalAdjustment: totalSituationalAdj.totalAdjustment !== 0 ? Math.round(totalSituationalAdj.totalAdjustment * 1000) / 10 : undefined,
              situationalNotes: totalSituationalAdj.notes.length > 0 ? totalSituationalAdj.notes : undefined,
              // Store base Elo probability (before situational adjustments) and full breakdown
              baseEloProbability: Math.round(baseEloOverProb * 1000) / 10,
              situationalBreakdown: {
                restDays: {
                  // Show actual rest days info even if adjustment is 0
                  value: totalSituationalFactors.isBackToBack ? 'Back-to-back game' : 
                         totalSituationalFactors.restAdvantage > 0 ? `+${totalSituationalFactors.restAdvantage} days rest vs opponent` :
                         totalSituationalFactors.restAdvantage < 0 ? `${totalSituationalFactors.restAdvantage} days rest vs opponent` : 
                         `${totalSituationalFactors.restDays || 3} days rest (equal)`,
                  adjustment: Math.round((totalSituationalAdj.breakdown.backToBack + totalSituationalAdj.breakdown.restAdvantage) * 1000) / 10
                },
                travel: {
                  // For totals, travel is analyzed from home team perspective
                  value: 'Game total bet (travel N/A)',
                  adjustment: Math.round(totalSituationalAdj.breakdown.travel * 1000) / 10
                },
                recentForm: {
                  // Show actual form info even if neutral
                  value: totalSituationalFactors.formTrend === 'hot' ? 'Hot streak (winning)' :
                         totalSituationalFactors.formTrend === 'cold' ? 'Cold streak (losing)' : 
                         'Recent form: neutral',
                  adjustment: Math.round(totalSituationalAdj.breakdown.recentForm * 1000) / 10
                },
                weather: {
                  // Show weather info or explain why N/A
                  value: totalSituationalFactors.weatherImpact ? `${totalSituationalFactors.weatherImpact.level} weather impact` : 
                         (eloLeague === 'NFL' || eloLeague === 'MLB' || eloLeague?.includes('soccer')) ? 'Weather: normal conditions' : 'Indoor sport (N/A)',
                  adjustment: Math.round(totalSituationalAdj.breakdown.weather * 1000) / 10
                },
                sharpMoney: {
                  // Show line movement info even if no sharp action detected
                  value: totalSituationalFactors.sharpMoneyIndicator ? 'Sharp money detected' :
                         totalSituationalFactors.lineMovementDirection === 'toward' ? 'Line moving toward this team' :
                         totalSituationalFactors.lineMovementDirection === 'away' ? 'Line moving away from this team' : 
                         'No significant line movement',
                  adjustment: Math.round(totalSituationalAdj.breakdown.sharpMoney * 1000) / 10
                },
                motivation: {
                  // Show motivation info or explain standard game
                  value: totalSituationalAdj.motivationAdjustment?.notes.length ? totalSituationalAdj.motivationAdjustment.notes[0] : 'Regular season game',
                  adjustment: Math.round(totalSituationalAdj.breakdown.motivation * 1000) / 10
                },
                injuries: {
                  // Show injury info
                  value: injuries && injuries.length > 0 ? `${injuries.length} injuries tracked` : 'No major injuries reported',
                  adjustment: 0
                }
              },
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
        
        // Calculate Elo-based under probability and apply situational adjustment
        const underResult = calculateTotalProbability(homeElo, awayElo, line, eloLeague, false)
        const baseEloUnderProb = underResult.probability
        const eloUnderProb = applyAdjustment(baseEloUnderProb, totalSituationalAdj.totalAdjustment)
        
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
              situationalAdjustment: totalSituationalAdj.totalAdjustment !== 0 ? Math.round(totalSituationalAdj.totalAdjustment * 1000) / 10 : undefined,
              situationalNotes: totalSituationalAdj.notes.length > 0 ? totalSituationalAdj.notes : undefined,
              // Store base Elo probability (before situational adjustments) and full breakdown
              baseEloProbability: Math.round(baseEloUnderProb * 1000) / 10,
              situationalBreakdown: {
                restDays: {
                  // Show actual rest days info even if adjustment is 0
                  value: totalSituationalFactors.isBackToBack ? 'Back-to-back game' : 
                         totalSituationalFactors.restAdvantage > 0 ? `+${totalSituationalFactors.restAdvantage} days rest vs opponent` :
                         totalSituationalFactors.restAdvantage < 0 ? `${totalSituationalFactors.restAdvantage} days rest vs opponent` : 
                         `${totalSituationalFactors.restDays || 3} days rest (equal)`,
                  adjustment: Math.round((totalSituationalAdj.breakdown.backToBack + totalSituationalAdj.breakdown.restAdvantage) * 1000) / 10
                },
                travel: {
                  // For totals, travel is analyzed from home team perspective
                  value: 'Game total bet (travel N/A)',
                  adjustment: Math.round(totalSituationalAdj.breakdown.travel * 1000) / 10
                },
                recentForm: {
                  // Show actual form info even if neutral
                  value: totalSituationalFactors.formTrend === 'hot' ? 'Hot streak (winning)' :
                         totalSituationalFactors.formTrend === 'cold' ? 'Cold streak (losing)' : 
                         'Recent form: neutral',
                  adjustment: Math.round(totalSituationalAdj.breakdown.recentForm * 1000) / 10
                },
                weather: {
                  // Show weather info or explain why N/A
                  value: totalSituationalFactors.weatherImpact ? `${totalSituationalFactors.weatherImpact.level} weather impact` : 
                         (eloLeague === 'NFL' || eloLeague === 'MLB' || eloLeague?.includes('soccer')) ? 'Weather: normal conditions' : 'Indoor sport (N/A)',
                  adjustment: Math.round(totalSituationalAdj.breakdown.weather * 1000) / 10
                },
                sharpMoney: {
                  // Show line movement info even if no sharp action detected
                  value: totalSituationalFactors.sharpMoneyIndicator ? 'Sharp money detected' :
                         totalSituationalFactors.lineMovementDirection === 'toward' ? 'Line moving toward this team' :
                         totalSituationalFactors.lineMovementDirection === 'away' ? 'Line moving away from this team' : 
                         'No significant line movement',
                  adjustment: Math.round(totalSituationalAdj.breakdown.sharpMoney * 1000) / 10
                },
                motivation: {
                  // Show motivation info or explain standard game
                  value: totalSituationalAdj.motivationAdjustment?.notes.length ? totalSituationalAdj.motivationAdjustment.notes[0] : 'Regular season game',
                  adjustment: Math.round(totalSituationalAdj.breakdown.motivation * 1000) / 10
                },
                injuries: {
                  // Show injury info
                  value: injuries && injuries.length > 0 ? `${injuries.length} injuries tracked` : 'No major injuries reported',
                  adjustment: 0
                }
              },
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
 * Analyze a single game with Elo but WITHOUT strict filters
 * Returns ALL bets (moneylines, spreads, totals) with Elo data for sport-specific queries
 * This ensures users can ask "best NHL bet" and get Elo-based recommendations
 * even if no bets pass the strict filters for "best bet of the day"
 * 
 * IMPORTANT: This function now analyzes ALL bet types (moneylines, spreads, totals)
 * to ensure sport-specific queries return the truly best bet, not just the best moneyline.
 */
async function analyzeGameForSportQuery(game: Game, injuries?: InjuryInfo[], homeLastGameDate?: string | null, awayLastGameDate?: string | null): Promise<RankedBet[]> {
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
  console.log(`[analyzeGameForSportQuery] Game: ${game.awayTeam} @ ${game.homeTeam}, sport=${game.sport}, sportName=${game.sportName}, eloLeague=${eloLeague || 'NONE'}`)
  
  let eloResult: { 
    probability: number
    homeRating: number
    awayRating: number
    confidence: string
    homeEffectiveRating?: number
    awayEffectiveRating?: number
  } | null = null
  
  if (eloLeague) {
    try {
      if (injuries && injuries.length > 0) {
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
            awayEffectiveRating: injuryResult.awayEffectiveRating
          }
        }
      } else {
        eloResult = await getEloWinProbabilityByName(eloLeague, game.homeTeam, game.awayTeam)
      }
    } catch (error) {
      console.error('[analyzeGameForSportQuery] Error fetching Elo:', error)
    }
  } else {
    console.log(`[analyzeGameForSportQuery] No eloLeague mapping for sport=${game.sport}`)
  }
  
  // Log Elo result
  if (eloResult) {
    console.log(`[analyzeGameForSportQuery] Elo result: homeRating=${eloResult.homeRating}, awayRating=${eloResult.awayRating}, confidence=${eloResult.confidence}`)
  } else {
    console.log(`[analyzeGameForSportQuery] Elo result: NULL`)
  }
  
  // Only return bets if we have Elo data
  // Note: We now accept 'very_low' confidence to ensure all sports have Elo-based recommendations
  if (!eloResult) {
    console.log(`[analyzeGameForSportQuery] No Elo data available for ${game.homeTeam} vs ${game.awayTeam} (${game.sportName})`)
    return []
  }
  
  if (eloResult.confidence === 'very_low') {
    console.log(`[analyzeGameForSportQuery] Using Elo with very_low confidence for ${game.homeTeam} vs ${game.awayTeam} (${game.sportName})`)
  }
  
  // ============================================
  // MONEYLINE ANALYSIS
  // ============================================
  // Analyze both teams - NO strict filters, just basic requirements
  for (const team of [game.homeTeam, game.awayTeam]) {
    // First try to get best price - this is required
    const bestPrice = findBestPrice(game, team)
    if (!bestPrice) {
      console.log(`[analyzeGameForSportQuery] No price found for ${team} in ${game.homeTeam} vs ${game.awayTeam}`)
      continue
    }
    
    // Only filter out extremely bad odds (worse than -500)
    if (bestPrice.price < -500) continue
    
    // Try to get consensus probability (requires 2+ books)
    // If not available, use the single book's implied probability
    const consensus = calculateConsensusProbability(game, team)
    const consensusProb = consensus?.consensusProb ?? bestPrice.impliedProb
    const bookPrices = consensus?.bookPrices ?? [{
      book: bestPrice.book,
      price: bestPrice.price,
      impliedProb: bestPrice.impliedProb,
      noVigProb: bestPrice.impliedProb
    }]
    
    const isHomeTeam = team === game.homeTeam
    const eloProbability = isHomeTeam ? eloResult.probability : (1 - eloResult.probability)
    let modelProbability = eloProbability
    
    const eloLeagueForSituational = SPORT_TO_ELO_LEAGUE[game.sport] || game.sport
    const opponentName = isHomeTeam ? game.awayTeam : game.homeTeam
    const teamLastGameDate = isHomeTeam ? homeLastGameDate : awayLastGameDate
    const opponentLastGameDateForTeam = isHomeTeam ? awayLastGameDate : homeLastGameDate
    
    const situationalFactors = calculateSituationalFactors(
      team,
      opponentName,
      eloLeagueForSituational,
      isHomeTeam,
      undefined,
      teamLastGameDate || undefined,
      opponentLastGameDateForTeam || undefined,
      null,
      null,
      game.commenceTime ? new Date(game.commenceTime) : null
    )
    
    const situationalAdj = calculateSituationalAdjustment(situationalFactors, eloLeagueForSituational, team, opponentName)
    modelProbability = applyAdjustment(modelProbability, situationalAdj.totalAdjustment)
    
    const edge = modelProbability - bestPrice.impliedProb
    const ev = calculateExpectedValue(bestPrice.price, modelProbability)
    const roi = calculateROI(ev)
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
      consensusProbability: Math.round(consensusProb * 1000) / 10,
      bestPrice: bestPrice.price,
      bestBook: bestPrice.book,
      impliedProbability: Math.round(bestPrice.impliedProb * 1000) / 10,
      edge: Math.round(edge * 1000) / 10,
      eloProbability: Math.round(eloProbability * 1000) / 10,
      eloConfidence: eloResult.confidence,
      homeElo: eloResult.homeRating,
      awayElo: eloResult.awayRating,
      expectedValue: Math.round(ev * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      allBookPrices: bookPrices.map(b => ({
        book: b.book,
        price: b.price,
        impliedProb: Math.round(b.impliedProb * 1000) / 10
      })),
      score,
      situationalAdjustment: situationalAdj.totalAdjustment !== 0 ? Math.round(situationalAdj.totalAdjustment * 1000) / 10 : undefined,
      situationalNotes: situationalAdj.notes.length > 0 ? situationalAdj.notes : undefined,
      calculatedAt: now
    })
  }
  
  // ============================================
  // SPREAD ANALYSIS - uses Elo-based cover probability
  // ============================================
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
      
      // ============================================
      // IMPROVED SPREAD FILTERING (System-wide)
      // ============================================
      
      // FILTER 1: Skip NHL puck lines entirely (use moneylines only)
      const minMarginEdge = MIN_SPREAD_MARGIN_EDGE[eloLeague] || 2
      if (minMarginEdge >= 999) {
        // NHL and other leagues that should use moneylines only
        return
      }
      
      // Find best price across all books
      const bestEntry = entries.reduce((best, curr) => 
        curr.outcome.price > best.outcome.price ? curr : best
      )
      
      // Only filter out extremely bad odds (worse than -500)
      if (bestEntry.outcome.price < -500) return
      
      // Determine if this is for home or away team
      const isHomeTeam = teamName === game.homeTeam || 
                         teamName.toLowerCase() === game.homeTeam.toLowerCase()
      
      // Use effective ratings if available (injury-adjusted), otherwise use base ratings
      const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
      const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
      
      // Calculate Elo-based spread cover probability
      const spreadFromHomePerspective = isHomeTeam ? point : -point
      
      const spreadResult = calculateSpreadCoverProbability(
        homeElo,
        awayElo,
        spreadFromHomePerspective,
        eloLeague,
        isHomeTeam
      )
      
      // FILTER 2: Check margin edge (difference between our expected margin and market spread)
      const expectedMargin = spreadResult.expectedMargin
      const marketSpread = spreadFromHomePerspective
      const marginEdge = Math.abs(expectedMargin - (-marketSpread))
      
      if (marginEdge < minMarginEdge) {
        // Edge too small - skip this spread bet
        return
      }
      
      const eloCoverProb = spreadResult.probability
      
      // Calculate implied probability from best price
      const impliedProb = americanToImpliedProbability(bestEntry.outcome.price)
      
      // Edge is Elo probability - implied probability (our model vs market)
      const edge = eloCoverProb - impliedProb
      
      // Calculate EV and ROI using Elo probability
      const ev = calculateExpectedValue(bestEntry.outcome.price, eloCoverProb)
      const roi = calculateROI(ev)
      
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
        consensusProbability: Math.round(eloCoverProb * 1000) / 10,
        bestPrice: bestEntry.outcome.price,
        bestBook: bestEntry.book,
        impliedProbability: Math.round(impliedProb * 1000) / 10,
        edge: Math.round(edge * 1000) / 10,
        eloProbability: Math.round(eloCoverProb * 1000) / 10,
        eloConfidence: spreadResult.confidence,
        homeElo: homeElo,
        awayElo: awayElo,
        expectedValue: Math.round(ev * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        allBookPrices,
        score,
        calculatedAt: now
      })
    })
  }
  
  // ============================================
  // TOTAL (OVER/UNDER) ANALYSIS - uses Elo-based total probability
  // ============================================
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
    
    // Use effective ratings if available (injury-adjusted), otherwise use base ratings
    const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
    const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
    
    // Evaluate each unique total line
    totalLines.forEach((entries, line) => {
      // Separate over and under entries
      const overEntries = entries.filter(e => e.outcome.name.toLowerCase() === 'over')
      const underEntries = entries.filter(e => e.outcome.name.toLowerCase() === 'under')
      
      // Analyze OVER bets
      if (overEntries.length > 0) {
        const bestOverEntry = overEntries.reduce((best, curr) => 
          curr.outcome.price > best.outcome.price ? curr : best
        )
        
        // Only filter out extremely bad odds (worse than -500)
        if (bestOverEntry.outcome.price >= -500) {
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
      
      // Analyze UNDER bets
      if (underEntries.length > 0) {
        const bestUnderEntry = underEntries.reduce((best, curr) => 
          curr.outcome.price > best.outcome.price ? curr : best
        )
        
        // Only filter out extremely bad odds (worse than -500)
        if (bestUnderEntry.outcome.price >= -500) {
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
export async function computeBestBets(
  games: Game[],
  weatherMap?: Map<string, WeatherData>,
  lineMovements?: LineMovement[],
  teamScheduleData?: TeamScheduleData | null
): Promise<BestBetResult> {
  const now = new Date().toISOString()
  const allRankedBets: RankedBet[] = []
  const allUnfilteredBets: FallbackBet[] = []
  const allEloBets: RankedBet[] = []  // ALL bets with Elo data (for sport-specific queries)
  
  // Analyze all games (now async to fetch Elo data)
  for (const game of games) {
    // Extract injury data from enriched game (if available)
    const enrichedGame = game as EnrichedGame
    const espnInjuries = enrichedGame.espnData?.injuries || []
    const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
    
    // Get weather and line movement for this specific game
    const gameWeather = weatherMap?.get(game.id) || null
    const gameLineMovement = lineMovements?.find(lm => lm.gameId === game.id) || null
    
    // Get last game dates for rest day calculations
    let homeLastGameDate: string | null = null
    let awayLastGameDate: string | null = null
    if (teamScheduleData) {
      const homeKey = normalizeScheduleTeamName(game.homeTeam)
      const awayKey = normalizeScheduleTeamName(game.awayTeam)
      homeLastGameDate = teamScheduleData.teams[homeKey]?.lastGameDate || null
      awayLastGameDate = teamScheduleData.teams[awayKey]?.lastGameDate || null
    }
    
    // Log injury data for debugging
    if (injuries.length > 0) {
      console.log(`[computeBestBets] ${game.homeTeam} vs ${game.awayTeam}: ${injuries.length} injuries found`)
      injuries.forEach(inj => console.log(`  - ${inj.player} (${inj.team}): ${inj.status}`))
    }
    
    // Log situational data for debugging
    if (gameWeather) {
      console.log(`[computeBestBets] ${game.homeTeam} vs ${game.awayTeam}: Weather data available`)
    }
    if (gameLineMovement && gameLineMovement.movement.sharpIndicator) {
      console.log(`[computeBestBets] ${game.homeTeam} vs ${game.awayTeam}: Sharp money indicator detected!`)
    }
    if (homeLastGameDate || awayLastGameDate) {
      console.log(`[computeBestBets] ${game.homeTeam} vs ${game.awayTeam}: Rest day data available`)
    }
    
    const bets = await analyzeGame(game, injuries, gameWeather, gameLineMovement, homeLastGameDate, awayLastGameDate)
    allRankedBets.push(...bets)
    
    // Also collect unfiltered bets for fallback/scoring
    const unfilteredBets = analyzeGameUnfiltered(game)
    allUnfilteredBets.push(...unfilteredBets)
    
    // Collect ALL Elo bets (without strict filters) for sport-specific queries
    // This ensures "best NHL bet" works even if no NHL bets pass strict filters
    const eloBets = await analyzeGameForSportQuery(game, injuries, homeLastGameDate, awayLastGameDate)
    allEloBets.push(...eloBets)
  }
  
  // ============================================
  // STAR PLAYER OUT FILTER
  // ============================================
  // Filter out bets where the recommended team has a star player OUT
  // This is a hard disqualifier - we don't want to recommend betting on
  // teams missing their best players (e.g., Jokic, LeBron, etc.)
  // CRITICAL: Apply this filter to BOTH allRankedBets AND allEloBets
  // allEloBets is used for sport-specific queries (e.g., "best NBA bet")
  const filteredRankedBets: RankedBet[] = []
  for (const bet of allRankedBets) {
    // Only check moneyline bets for star player injuries (spread/total are less affected)
    if (bet.betType === 'moneyline') {
      const enrichedGame = games.find(g => g.id === bet.gameId) as EnrichedGame | undefined
      const espnInjuries = enrichedGame?.espnData?.injuries || []
      const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
      
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED (ranked): ${bet.team} ML - star player ${starOut} is OUT`)
        continue // Skip this bet
      }
    }
    filteredRankedBets.push(bet)
  }
  
  // CRITICAL FIX: Also filter allEloBets for star player injuries
  // This ensures sport-specific queries (e.g., "best NBA bet today") don't recommend
  // teams with star players OUT. Previously only allRankedBets was filtered.
  const filteredEloBets: RankedBet[] = []
  for (const bet of allEloBets) {
    // Only check moneyline bets for star player injuries
    if (bet.betType === 'moneyline') {
      const enrichedGame = games.find(g => g.id === bet.gameId) as EnrichedGame | undefined
      const espnInjuries = enrichedGame?.espnData?.injuries || []
      const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
      
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED (elo): ${bet.team} ML - star player ${starOut} is OUT`)
        continue // Skip this bet
      }
    }
    filteredEloBets.push(bet)
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
  
  // ============================================
  // ELO REQUIREMENT: Only recommend bets with Elo data
  // ============================================
  // Elo is our core differentiator - we should only recommend bets
  // where our Elo model has analyzed the matchup. This ensures every
  // recommendation is powered by our proprietary Elo system.
  const eloPoweredBets = filteredRankedBets.filter(bet => bet.eloProbability !== undefined)
  
  const bestBet = eloPoweredBets[0] || null
  const runnerUp = eloPoweredBets[1] || null
  
  let reason: string | null = null
  if (!bestBet) {
    if (games.length === 0) {
      reason = 'No games available'
    } else if (filteredRankedBets.length > 0 && eloPoweredBets.length === 0) {
      reason = 'No games have Elo data available - our model requires Elo ratings to make recommendations'
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
  
  // Sort filteredEloBets by score for sport-specific queries
  // CRITICAL: Use filteredEloBets (with star player filter applied) instead of allEloBets
  filteredEloBets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  return {
    bestBet,
    runnerUp,
    allRankedBets: eloPoweredBets.slice(0, 10),  // Only Elo-powered bets
    allEloBets: filteredEloBets,  // Filtered bets with Elo data for sport-specific queries (star player filter applied)
    calculatedAt: now,
    gamesAnalyzed: games.length,
    gamesQualified: eloPoweredBets.length,  // Count of Elo-powered bets
    reason,
    closestMisses,
    mostLikelyWinners
  }
}

/**
 * Get sport emoji for professional formatting
 */
function getSportEmoji(sportName: string): string {
  const sport = sportName.toLowerCase()
  if (sport.includes('nba') || sport.includes('basketball') || sport.includes('ncaab')) return '🏀'
  if (sport.includes('nfl') || sport.includes('football') || sport.includes('ncaaf')) return '🏈'
  if (sport.includes('nhl') || sport.includes('hockey')) return '🏒'
  if (sport.includes('mlb') || sport.includes('baseball')) return '⚾'
  if (sport.includes('soccer') || sport.includes('mls') || sport.includes('epl') || sport.includes('premier')) return '⚽'
  return '🎯'
}

/**
 * Get sport-specific unit for totals (Goals, Points, Runs, etc.)
 * This ensures users know what they're betting over/under on
 */
function getTotalUnit(sportName: string): string {
  const sport = sportName.toLowerCase()
  if (sport.includes('nba') || sport.includes('basketball') || sport.includes('ncaab')) return 'Points'
  if (sport.includes('nfl') || sport.includes('football') || sport.includes('ncaaf')) return 'Points'
  if (sport.includes('nhl') || sport.includes('hockey')) return 'Goals'
  if (sport.includes('mlb') || sport.includes('baseball')) return 'Runs'
  if (sport.includes('soccer') || sport.includes('mls') || sport.includes('epl') || sport.includes('premier') || sport.includes('bundesliga') || sport.includes('la liga') || sport.includes('serie a') || sport.includes('ligue 1') || sport.includes('champions') || sport.includes('europa')) return 'Goals'
  return 'Total'  // Generic fallback
}

/**
 * Format the best bet result as a professional user-facing response
 * Clean, conversational formatting - no internal directives
 */
export function formatBestBetForContext(result: BestBetResult): string {
  const lines: string[] = []
  
  if (!result.bestBet) {
    // Get fallback data - already sorted by SCORE from computeBestBets
    const closestMisses = result.closestMisses ?? []
    const mostLikelyWinners = result.mostLikelyWinners ?? []
    
    // Select best available by SCORE
    let bestAvailable: FallbackBet | null = null
    
    if (closestMisses.length > 0) {
      bestAvailable = closestMisses[0]
    } else if (mostLikelyWinners.length > 0) {
      bestAvailable = mostLikelyWinners[0]
    }
    
    if (bestAvailable) {
      const isValuePlay = bestAvailable.isValuePlay
      const emoji = getSportEmoji(bestAvailable.sportName)
      const fbModelProbPercent = bestAvailable.eloProbability !== undefined ? bestAvailable.eloProbability : bestAvailable.consensusProbability
      const fbModelSource = bestAvailable.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
      
      lines.push(`${emoji} ${isValuePlay ? 'BEST BET TODAY' : 'TOP PICK TODAY'}`)
      lines.push('')
      lines.push(`**${bestAvailable.team} ML @ ${formatOdds(bestAvailable.bestPrice)}**`)
      lines.push(`${bestAvailable.awayTeam} @ ${bestAvailable.homeTeam} | ${bestAvailable.sportName}`)
      lines.push(`Score: ${bestAvailable.score}/100`)
      lines.push('')
      
      // WHY THIS BET section
      lines.push('**WHY THIS BET:**')
      lines.push('')
      if (bestAvailable.eloProbability !== undefined) {
        lines.push(`Our Elo model gives ${bestAvailable.team} a ${bestAvailable.eloProbability}% win probability, while the market odds (${formatOdds(bestAvailable.bestPrice)}) imply only ${bestAvailable.impliedProbability}%. That's a ${bestAvailable.edge}% edge.`)
      } else {
        lines.push(`Market consensus shows ${bestAvailable.team} with a ${bestAvailable.consensusProbability}% win probability. The best available odds (${formatOdds(bestAvailable.bestPrice)}) offer a ${bestAvailable.edge}% edge.`)
      }
      lines.push('')
      
      // Matchup context
      if (bestAvailable.homeElo && bestAvailable.awayElo) {
        const eloDiff = Math.abs(bestAvailable.homeElo - bestAvailable.awayElo)
        const favoredTeam = bestAvailable.homeElo > bestAvailable.awayElo ? bestAvailable.homeTeam : bestAvailable.awayTeam
        lines.push(`${bestAvailable.homeTeam} (Elo: ${bestAvailable.homeElo}) vs ${bestAvailable.awayTeam} (Elo: ${bestAvailable.awayElo}). The ${eloDiff}-point Elo difference favors ${favoredTeam}.`)
        lines.push('')
      }
      
      // Value breakdown
      lines.push('**VALUE:**')
      lines.push('')
      lines.push(`Win Probability: ${fbModelProbPercent}% (${fbModelSource})`)
      lines.push(`Expected Value: $${bestAvailable.expectedValue.toFixed(2)} per $100 bet`)
      lines.push(`ROI: ${bestAvailable.roi.toFixed(2)}%`)
      lines.push(`Edge: ${bestAvailable.edge}%`)
      lines.push('')
      
      // Score breakdown
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
      
      lines.push('**SCORE BREAKDOWN:** ' + `${bestAvailable.score}/100`)
      lines.push('')
      lines.push(`Probability: ${probScore.toFixed(1)}/45 points`)
      lines.push(`ROI: ${roiScore.toFixed(1)}/35 points`)
      lines.push(`Edge: ${edgeScore.toFixed(1)}/20 points`)
      lines.push('')
      
      if (bestAvailable.expectedValue < 0) {
        lines.push('*Note: This pick has negative expected value. Consider smaller bet size.*')
        lines.push('')
      }
      
      // Alternatives
      if (closestMisses.length > 1) {
        lines.push('**ALTERNATIVES:**')
        lines.push('')
        for (let i = 1; i < Math.min(4, closestMisses.length); i++) {
          const alt = closestMisses[i]
          lines.push(`#${i + 1}: ${alt.team} @ ${formatOdds(alt.bestPrice)} | ${alt.awayTeam} @ ${alt.homeTeam} | ${alt.sportName} (Score: ${alt.score}/100, ${alt.consensusProbability}% prob)`)
        }
        lines.push('')
      }
      
      lines.push(`Available at ${bestAvailable.bestBook}.`)
    } else {
      lines.push('🎯 NO RECOMMENDED BETS TODAY')
      lines.push('')
      lines.push('No games currently meet our value criteria. All available options have poor value or low probability.')
      lines.push('')
      lines.push('Check back later when more games are scheduled.')
    }
    
    return lines.join('\n')
  }
  
  const bet = result.bestBet
  const emoji = getSportEmoji(bet.sportName)
  
  // Format bet type display based on bet type
  let betTypeDisplay: string
  let pickDisplay: string
  if (bet.betType === 'total' && bet.line !== undefined) {
    const unit = getTotalUnit(bet.sportName)
    betTypeDisplay = `${bet.team} ${bet.line} ${unit}`
    pickDisplay = `${bet.team} ${bet.line} ${unit} @ ${formatOdds(bet.bestPrice)}`
  } else if (bet.betType === 'spread' && bet.line !== undefined) {
    betTypeDisplay = `${bet.line > 0 ? '+' : ''}${bet.line}`
    pickDisplay = `${bet.team} ${betTypeDisplay} @ ${formatOdds(bet.bestPrice)}`
  } else {
    betTypeDisplay = 'ML'
    pickDisplay = `${bet.team} ML @ ${formatOdds(bet.bestPrice)}`
  }
  
  lines.push(`${emoji} BEST BET TODAY`)
  lines.push('')
  lines.push(`**${pickDisplay}**`)
  lines.push(`${bet.awayTeam} @ ${bet.homeTeam} | ${bet.sportName} | ${formatTime(bet.commenceTime)}`)
  lines.push(`Score: ${bet.score}/100`)
  lines.push('')
  
  // Use MODEL probability (Elo when available, market consensus as fallback)
  const modelProbPercent = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  const modelSource = bet.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
  
  // Determine probability label based on bet type
  const isTotal = bet.betType === 'total'
  const isSpread = bet.betType === 'spread'
  const probLabel = isTotal 
    ? `${bet.team.toLowerCase()} probability` 
    : isSpread 
      ? 'cover probability'
      : 'win probability'
  
  // WHY THIS BET section - conversational explanation
  lines.push('**WHY THIS BET:**')
  lines.push('')
  if (bet.eloProbability !== undefined) {
    if (isTotal) {
      lines.push(`Our Elo model gives this game a ${bet.eloProbability}% probability of going ${bet.team.toLowerCase()}, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    } else if (isSpread) {
      lines.push(`Our Elo model gives ${bet.team} an ${bet.eloProbability}% probability to cover the spread, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    } else {
      lines.push(`Our Elo model gives ${bet.team} a ${bet.eloProbability}% win probability, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    }
  } else {
    lines.push(`Market consensus shows a ${bet.consensusProbability}% ${probLabel}. The best available odds (${formatOdds(bet.bestPrice)}) offer a ${bet.edge}% edge.`)
  }
  lines.push('')
  
  // Matchup context with Elo
  if (bet.homeElo && bet.awayElo) {
    lines.push('**MATCHUP:**')
    lines.push('')
    const eloDiff = Math.abs(bet.homeElo - bet.awayElo)
    const favoredTeam = bet.homeElo > bet.awayElo ? bet.homeTeam : bet.awayTeam
    if (isTotal) {
      const avgElo = Math.round((bet.homeElo + bet.awayElo) / 2)
      lines.push(`Combined Elo strength: ${avgElo} average (${bet.homeTeam}: ${bet.homeElo}, ${bet.awayTeam}: ${bet.awayElo}). Market line: ${bet.line}.`)
    } else {
      lines.push(`${bet.homeTeam} (Elo: ${bet.homeElo}) vs ${bet.awayTeam} (Elo: ${bet.awayElo}). The ${eloDiff}-point Elo difference favors ${favoredTeam}.`)
    }
    lines.push('')
  }
  
  // Situational factors breakdown - ALWAYS show all 7 factors
  lines.push('**SITUATIONAL FACTORS:**')
  lines.push('')
  if (bet.situationalBreakdown) {
    const formatAdj = (adj: number) => adj === 0 ? '0%' : `${adj > 0 ? '+' : ''}${adj.toFixed(1)}%`
    lines.push(`- Rest days: ${bet.situationalBreakdown.restDays.value} (${formatAdj(bet.situationalBreakdown.restDays.adjustment)})`)
    lines.push(`- Travel: ${bet.situationalBreakdown.travel.value} (${formatAdj(bet.situationalBreakdown.travel.adjustment)})`)
    lines.push(`- Recent form: ${bet.situationalBreakdown.recentForm.value} (${formatAdj(bet.situationalBreakdown.recentForm.adjustment)})`)
    lines.push(`- Weather: ${bet.situationalBreakdown.weather.value} (${formatAdj(bet.situationalBreakdown.weather.adjustment)})`)
    lines.push(`- Sharp money: ${bet.situationalBreakdown.sharpMoney.value} (${formatAdj(bet.situationalBreakdown.sharpMoney.adjustment)})`)
    lines.push(`- Motivation: ${bet.situationalBreakdown.motivation.value} (${formatAdj(bet.situationalBreakdown.motivation.adjustment)})`)
    lines.push(`- Injuries: ${bet.situationalBreakdown.injuries.value} (${formatAdj(bet.situationalBreakdown.injuries.adjustment)})`)
    lines.push('')
    const totalAdj = bet.situationalAdjustment ?? 0
    lines.push(`**Total adjustment: ${totalAdj > 0 ? '+' : ''}${totalAdj.toFixed(1)}%**`)
    if (bet.baseEloProbability !== undefined && bet.eloProbability !== undefined) {
      lines.push(`Base Elo probability: ${bet.baseEloProbability}% -> Adjusted: ${bet.eloProbability}%`)
    }
  } else if (bet.situationalNotes && bet.situationalNotes.length > 0) {
    // Fallback to old format if breakdown not available
    for (const note of bet.situationalNotes) {
      lines.push(`- ${note}`)
    }
    if (bet.situationalAdjustment !== undefined && bet.situationalAdjustment !== 0) {
      lines.push(`- Total adjustment: ${bet.situationalAdjustment > 0 ? '+' : ''}${bet.situationalAdjustment.toFixed(1)}%`)
    }
  } else {
    lines.push('- No significant situational factors detected')
  }
  lines.push('')
  
  // Value breakdown
  lines.push('**VALUE:**')
  lines.push('')
  lines.push(`${isTotal ? `${bet.team} Probability` : isSpread ? 'Cover Probability' : 'Win Probability'}: ${modelProbPercent}% (${modelSource})`)
  lines.push(`Expected Value: $${bet.expectedValue.toFixed(2)} per $100 bet`)
  lines.push(`ROI: ${bet.roi.toFixed(2)}%`)
  lines.push(`Edge: ${bet.edge}%`)
  lines.push('')
  
  // Score breakdown
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
  
  lines.push('**SCORE BREAKDOWN:** ' + `${bet.score}/100`)
  lines.push('')
  lines.push(`Probability: ${probScore.toFixed(1)}/45 points`)
  lines.push(`ROI: ${roiScore.toFixed(1)}/35 points`)
  lines.push(`Edge: ${edgeScore.toFixed(1)}/20 points`)
  lines.push('')
  
  // ALTERNATIVES: Show top 10 bets so LLM can respond to "what else?" questions
  // This enables conversational follow-ups like "can't bet that, what else?"
  const alternatives = result.allRankedBets?.slice(1, 10) || []
  if (alternatives.length > 0) {
    lines.push('**ALTERNATIVES (if user asks "what else?" or can\'t bet the top pick):**')
    lines.push('')
    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i]
      let altPickDisplay: string
      if (alt.betType === 'total' && alt.line !== undefined) {
        const altUnit = getTotalUnit(alt.sportName)
        altPickDisplay = `${alt.team} ${alt.line} ${altUnit} @ ${formatOdds(alt.bestPrice)}`
      } else if (alt.betType === 'spread' && alt.line !== undefined) {
        altPickDisplay = `${alt.team} ${alt.line > 0 ? '+' : ''}${alt.line} @ ${formatOdds(alt.bestPrice)}`
      } else {
        altPickDisplay = `${alt.team} ML @ ${formatOdds(alt.bestPrice)}`
      }
      const sportEmoji = getSportEmoji(alt.sportName)
      lines.push(`#${i + 2}: ${sportEmoji} ${altPickDisplay} | ${alt.awayTeam} @ ${alt.homeTeam} | ${alt.sportName} | Score: ${alt.score}/100 | ${alt.eloProbability || alt.consensusProbability}% prob | ${alt.bestBook}`)
    }
    lines.push('')
    lines.push('*Use these alternatives if user says they can\'t bet the top pick, wants a different sport, or asks "what else?"*')
    lines.push('')
  }
  
  lines.push(`Available at ${bet.bestBook}.`)
  
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
 * 
 * IMPORTANT: Now accepts optional injuries parameter to ensure injury-adjusted
 * Elo ratings are used when available. Previously this function called analyzeGame
 * without injuries, resulting in "dumb" analysis that ignored injury data.
 */
export async function analyzeSpecificGame(
  game: Game,
  injuries?: InjuryInfo[]
): Promise<GameAnalysisResult> {
  const now = new Date().toISOString()
  
  // Extract injury data from enriched game if not provided
  // This ensures we use injury data when available even if caller doesn't pass it
  let injuriesToUse = injuries
  if (!injuriesToUse) {
    const enrichedGame = game as EnrichedGame
    const espnInjuries = enrichedGame.espnData?.injuries || []
    if (espnInjuries.length > 0) {
      injuriesToUse = convertESPNInjuriesToInjuryInfo(espnInjuries)
      console.log(`[analyzeSpecificGame] Extracted ${injuriesToUse.length} injuries from enriched game data`)
    }
  }
  
  // Analyze the game to get all betting options
  // Pass injuries to ensure injury-adjusted Elo ratings are used
  const bets = await analyzeGame(game, injuriesToUse)
  
  // Prefer Elo-powered bets, but fall back to all bets if Elo isn't available
  // This ensures game-specific queries always return useful analysis
  const eloPoweredBets = bets.filter(bet => bet.eloProbability !== undefined)
  
  // Use Elo bets if available, otherwise use all bets (with market consensus)
  const betsToUse = eloPoweredBets.length > 0 ? eloPoweredBets : bets
  
  // Sort by score to find the best bet for this game
  const sortedBets = [...betsToUse].sort((a, b) => b.score - a.score)
  
  // Log for debugging
  if (eloPoweredBets.length === 0 && bets.length > 0) {
    console.log(`[analyzeSpecificGame] No Elo data for ${game.awayTeam} @ ${game.homeTeam} (${game.sport}), using market consensus for ${bets.length} bets`)
  } else if (bets.length === 0) {
    console.log(`[analyzeSpecificGame] No bets available for ${game.awayTeam} @ ${game.homeTeam} - game may have started or no odds`)
  }
  
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
  const emoji = getSportEmoji(result.game.sportName)
  
  lines.push(`${emoji} GAME ANALYSIS: ${result.game.awayTeam} @ ${result.game.homeTeam}`)
  lines.push('')
  lines.push(`${result.game.sportName} | ${formatTime(result.game.commenceTime)}`)
  lines.push('')
  
  if (!result.bestBet) {
    lines.push('No betting options available for this game. The game may have already started or odds are not available.')
    return lines.join('\n')
  }
  
  // Show the best bet for this game
  const bet = result.bestBet
  const isSpread = bet.betType === 'spread'
  const isTotal = bet.betType === 'total'
  
  // Format bet type display
  let pickDisplay: string
  if (isTotal) {
    pickDisplay = `${bet.team} ${bet.line} @ ${formatOdds(bet.bestPrice)}`
  } else if (isSpread && bet.line !== undefined) {
    pickDisplay = `${bet.team} ${bet.line > 0 ? '+' : ''}${bet.line} @ ${formatOdds(bet.bestPrice)}`
  } else {
    pickDisplay = `${bet.team} ML @ ${formatOdds(bet.bestPrice)}`
  }
  
  lines.push('**TOP PICK FOR THIS GAME:**')
  lines.push('')
  lines.push(`**${pickDisplay}**`)
  lines.push(`Score: ${bet.score}/100`)
  lines.push('')
  
  // Model probability
  const modelProbPercent = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  const modelSource = bet.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
  const probLabel = isTotal ? `${bet.team.toLowerCase()} probability` : isSpread ? 'cover probability' : 'win probability'
  
  // WHY THIS BET
  lines.push('**WHY THIS BET:**')
  lines.push('')
  if (bet.eloProbability !== undefined) {
    if (isSpread) {
      lines.push(`Our Elo model gives ${bet.team} an ${bet.eloProbability}% probability to cover the spread, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    } else if (isTotal) {
      lines.push(`Our Elo model gives this game a ${bet.eloProbability}% probability of going ${bet.team.toLowerCase()}, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    } else {
      lines.push(`Our Elo model gives ${bet.team} a ${bet.eloProbability}% win probability, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    }
  } else {
    lines.push(`Market consensus shows a ${bet.consensusProbability}% ${probLabel}. The best available odds (${formatOdds(bet.bestPrice)}) offer a ${bet.edge}% edge.`)
  }
  lines.push('')
  
  // Matchup context with Elo
  if (bet.homeElo != null && bet.awayElo != null) {
    lines.push('**MATCHUP:**')
    lines.push('')
    const eloDiff = Math.abs(bet.homeElo - bet.awayElo)
    const favoredTeam = bet.homeElo > bet.awayElo ? bet.homeTeam : bet.awayTeam
    if (isTotal) {
      const avgElo = Math.round((bet.homeElo + bet.awayElo) / 2)
      lines.push(`Combined Elo strength: ${avgElo} average (${bet.homeTeam}: ${bet.homeElo}, ${bet.awayTeam}: ${bet.awayElo}). Market line: ${bet.line}.`)
    } else {
      lines.push(`${bet.homeTeam} (Elo: ${bet.homeElo}) vs ${bet.awayTeam} (Elo: ${bet.awayElo}). The ${eloDiff}-point Elo difference favors ${favoredTeam}.`)
    }
    lines.push('')
  }
  
  // Situational factors breakdown - ALWAYS show all 7 factors
  lines.push('**SITUATIONAL FACTORS:**')
  lines.push('')
  if (bet.situationalBreakdown) {
    const formatAdj = (adj: number) => adj === 0 ? '0%' : `${adj > 0 ? '+' : ''}${adj.toFixed(1)}%`
    lines.push(`- Rest days: ${bet.situationalBreakdown.restDays.value} (${formatAdj(bet.situationalBreakdown.restDays.adjustment)})`)
    lines.push(`- Travel: ${bet.situationalBreakdown.travel.value} (${formatAdj(bet.situationalBreakdown.travel.adjustment)})`)
    lines.push(`- Recent form: ${bet.situationalBreakdown.recentForm.value} (${formatAdj(bet.situationalBreakdown.recentForm.adjustment)})`)
    lines.push(`- Weather: ${bet.situationalBreakdown.weather.value} (${formatAdj(bet.situationalBreakdown.weather.adjustment)})`)
    lines.push(`- Sharp money: ${bet.situationalBreakdown.sharpMoney.value} (${formatAdj(bet.situationalBreakdown.sharpMoney.adjustment)})`)
    lines.push(`- Motivation: ${bet.situationalBreakdown.motivation.value} (${formatAdj(bet.situationalBreakdown.motivation.adjustment)})`)
    lines.push(`- Injuries: ${bet.situationalBreakdown.injuries.value} (${formatAdj(bet.situationalBreakdown.injuries.adjustment)})`)
    lines.push('')
    const totalAdj = bet.situationalAdjustment ?? 0
    lines.push(`**Total adjustment: ${totalAdj > 0 ? '+' : ''}${totalAdj.toFixed(1)}%**`)
    if (bet.baseEloProbability !== undefined && bet.eloProbability !== undefined) {
      lines.push(`Base Elo probability: ${bet.baseEloProbability}% -> Adjusted: ${bet.eloProbability}%`)
    }
  } else if (bet.situationalNotes && bet.situationalNotes.length > 0) {
    // Fallback to old format if breakdown not available
    for (const note of bet.situationalNotes) {
      lines.push(`- ${note}`)
    }
    if (bet.situationalAdjustment !== undefined && bet.situationalAdjustment !== 0) {
      lines.push(`- Total adjustment: ${bet.situationalAdjustment > 0 ? '+' : ''}${bet.situationalAdjustment.toFixed(1)}%`)
    }
  } else {
    lines.push('- No significant situational factors detected')
  }
  lines.push('')
  
  // Value breakdown
  lines.push('**VALUE:**')
  lines.push('')
  lines.push(`${isTotal ? `${bet.team} Probability` : isSpread ? 'Cover Probability' : 'Win Probability'}: ${modelProbPercent}% (${modelSource})`)
  lines.push(`Market Probability: ${bet.impliedProbability}% (from ${formatOdds(bet.bestPrice)} odds)`)
  lines.push(`Edge: ${bet.edge}%`)
  lines.push(`Expected Value: $${bet.expectedValue.toFixed(2)} per $100 bet`)
  lines.push(`ROI: ${bet.roi.toFixed(2)}%`)
  lines.push('')
  
  // Score breakdown
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
  
  lines.push('**SCORE BREAKDOWN:** ' + `${bet.score}/100`)
  lines.push('')
  lines.push(`Probability: ${probScore.toFixed(1)}/45 points`)
  lines.push(`ROI: ${roiScore.toFixed(1)}/35 points`)
  lines.push(`Edge: ${edgeScore.toFixed(1)}/20 points`)
  lines.push('')
  
  // Other betting options for this game
  if (result.bets.length > 1) {
    lines.push('**OTHER OPTIONS:**')
    lines.push('')
    for (let i = 1; i < Math.min(result.bets.length, 5); i++) {
      const otherBet = result.bets[i]
      let otherDisplay: string
      if (otherBet.betType === 'total') {
        otherDisplay = `${otherBet.team} ${otherBet.line} @ ${formatOdds(otherBet.bestPrice)}`
      } else if (otherBet.betType === 'spread' && otherBet.line !== undefined) {
        otherDisplay = `${otherBet.team} ${otherBet.line > 0 ? '+' : ''}${otherBet.line} @ ${formatOdds(otherBet.bestPrice)}`
      } else {
        otherDisplay = `${otherBet.team} ML @ ${formatOdds(otherBet.bestPrice)}`
      }
      lines.push(`#${i + 1}: ${otherDisplay} (Score: ${otherBet.score}/100, ${otherBet.edge}% edge)`)
    }
    lines.push('')
  }
  
  lines.push(`Available at ${bet.bestBook}.`)
  
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
    
    // Handle double-stringify: cacheBestBet uses JSON.stringify(JSON.stringify(result))
    // So we need to parse twice if the result is still a string after first parse
    let parsed = JSON.parse(data.result)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return parsed as BestBetResult
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
/**
 * Calculate parlay value score for a bet
 * Balances probability with payout value - avoids heavy favorites with poor payouts
 * 
 * Formula: valueScore = edge * (1 + probabilityBonus)
 * - edge: model probability - implied probability (positive = value)
 * - probabilityBonus: small bonus for higher probability bets (0-0.3)
 * 
 * This prioritizes VALUE over raw probability, avoiding -1800 favorites
 */
function calculateParlayValueScore(bet: RankedBet): number {
  const modelProb = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  
  // Edge is the key metric - how much better is our model vs the market?
  const edge = bet.edge
  
  // Small probability bonus (0-0.3) to slightly prefer higher probability when edges are similar
  const probabilityBonus = Math.min(0.3, (modelProb - 50) / 100)
  
  // Value score: prioritize edge, with small probability bonus
  // A bet with 5% edge and 60% prob scores higher than 0% edge and 95% prob
  return edge * (1 + probabilityBonus)
}

/**
 * Minimum odds threshold for parlay legs
 * Bets worse than -400 (80% implied) are excluded - they add risk without meaningful payout
 */
const PARLAY_MIN_ODDS = -400

/**
 * Minimum probability for parlay legs
 * We still want reasonably likely outcomes, just not extreme favorites
 */
const PARLAY_MIN_PROBABILITY = 50

/**
 * Maximum probability for parlay legs
 * Exclude extreme favorites that destroy parlay value
 */
const PARLAY_MAX_PROBABILITY = 85

export function computeParlayOfTheDay(allRankedBets: RankedBet[]): ParlayResult {
  const now = new Date().toISOString()
  
  // Filter to only moneyline bets WITH Elo data for parlays
  // Elo is our core differentiator - every parlay leg must be Elo-powered
  const moneylineBets = allRankedBets.filter(bet => 
    bet.betType === 'moneyline' && bet.eloProbability !== undefined
  )
  
  if (moneylineBets.length < 2) {
    return {
      safeParlay: null,
      aggressiveParlay: null,
      combinedProbability: null,
      calculatedAt: now,
      reason: 'Not enough Elo-powered moneyline bets available for a parlay (need at least 2 from different games)'
    }
  }
  
  // Get model probability for a bet (always Elo since we filtered above)
  const getModelProb = (bet: RankedBet) => bet.eloProbability!
  
  // STEP 1: Filter out extreme favorites (poor parlay value)
  // Bets worse than -400 odds or >85% probability are excluded
  const valueBets = moneylineBets.filter(bet => {
    const prob = getModelProb(bet)
    const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS  // -400 or better (e.g., -300, -150, +100)
    const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
    const hasPositiveEdge = bet.edge > 0  // Our model sees value
    
    return hasReasonableOdds && hasReasonableProb && hasPositiveEdge
  })
  
  // STEP 2: If not enough value bets, fall back to moderate favorites (but still exclude extreme)
  let betsToUse = valueBets
  if (valueBets.length < 3) {
    // Relax the edge requirement but keep the odds/probability filters
    const moderateBets = moneylineBets.filter(bet => {
      const prob = getModelProb(bet)
      const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
      const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
      return hasReasonableOdds && hasReasonableProb
    })
    betsToUse = moderateBets.length >= 2 ? moderateBets : moneylineBets
  }
  
  // STEP 3: Sort by VALUE SCORE (not raw probability)
  // This prioritizes bets where our model has edge over the market
  const sortedBets = [...betsToUse].sort((a, b) => {
    const aValue = calculateParlayValueScore(a)
    const bValue = calculateParlayValueScore(b)
    return bValue - aValue
  })
  
  // Build safe parlay (2 legs) - pick top 2 VALUE bets from different games
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
 * Convert American odds to decimal odds
 */
function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return (americanOdds / 100) + 1
  } else {
    return (100 / Math.abs(americanOdds)) + 1
  }
}

/**
 * Convert decimal odds to American odds
 */
function decimalToAmerican(decimalOdds: number): number {
  if (decimalOdds >= 2) {
    return Math.round((decimalOdds - 1) * 100)
  } else {
    return Math.round(-100 / (decimalOdds - 1))
  }
}

/**
 * Calculate parlay odds from individual leg odds
 * Multiplies decimal odds together, then converts back to American
 */
function calculateParlayOdds(legs: RankedBet[]): number {
  const combinedDecimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.bestPrice), 1)
  return decimalToAmerican(combinedDecimal)
}

/**
 * Calculate payout per $100 bet from American odds
 */
function calculatePayout(americanOdds: number): number {
  if (americanOdds > 0) {
    return americanOdds + 100  // +550 pays $650 total ($550 profit + $100 stake)
  } else {
    return (100 / Math.abs(americanOdds)) * 100 + 100
  }
}

/**
 * Build a parlay with specified number of legs from ranked bets
 * Returns null if not enough qualifying bets available
 */
function buildParlayWithLegs(
  sortedBets: RankedBet[], 
  legCount: number, 
  usedGameIds: Set<string> = new Set()
): RankedBet[] | null {
  const parlay: RankedBet[] = []
  const localUsedGameIds = new Set(usedGameIds)
  
  for (const bet of sortedBets) {
    // Skip if we already have a bet from this game (correlation check)
    if (localUsedGameIds.has(bet.gameId)) continue
    
    parlay.push(bet)
    localUsedGameIds.add(bet.gameId)
    
    if (parlay.length === legCount) break
  }
  
  return parlay.length === legCount ? parlay : null
}

/**
 * Create an EnhancedParlayResult from legs
 */
function createEnhancedParlayResult(
  legs: RankedBet[],
  now: string,
  alternatives: EnhancedParlayResult['alternatives'] = {}
): EnhancedParlayResult {
  const getModelProb = (leg: RankedBet) => leg.eloProbability !== undefined ? leg.eloProbability : leg.consensusProbability
  
  // Combined probability (multiply individual probs)
  const combinedProbability = legs.reduce((acc, leg) => acc * (getModelProb(leg) / 100), 1) * 100
  
  // Parlay odds from individual leg odds
  const parlayOdds = calculateParlayOdds(legs)
  
  // Payout per $100 bet
  const parlayPayout = calculatePayout(parlayOdds)
  
  // Implied probability from parlay odds
  const impliedProbability = americanToImpliedProbability(parlayOdds)
  
  // Edge on the parlay (combined prob - implied prob)
  const parlayEdge = combinedProbability - impliedProbability
  
  // Expected value per $100 bet
  // EV = (probability * profit) - ((1 - probability) * stake)
  const profit = parlayPayout - 100
  const expectedValue = (combinedProbability / 100 * profit) - ((1 - combinedProbability / 100) * 100)
  
  return {
    legs,
    legCount: legs.length,
    combinedProbability: Math.round(combinedProbability * 10) / 10,
    parlayOdds,
    parlayPayout: Math.round(parlayPayout),
    impliedProbability: Math.round(impliedProbability * 10) / 10,
    parlayEdge: Math.round(parlayEdge * 10) / 10,
    expectedValue: Math.round(expectedValue * 10) / 10,
    calculatedAt: now,
    alternatives,
    reason: null
  }
}

/**
 * Compute an enhanced parlay with specified number of legs
 * Includes full analysis for conversational responses
 * 
 * @param allRankedBets - All ranked bets to choose from
 * @param requestedLegs - Number of legs requested (2-6)
 * @param includeAlternatives - Whether to include 2-leg and 4-leg alternatives
 */
export function computeEnhancedParlay(
  allRankedBets: RankedBet[],
  requestedLegs: number = 3,
  includeAlternatives: boolean = true
): EnhancedParlayResult | null {
  const now = new Date().toISOString()
  
  // Filter to only moneyline bets WITH Elo data for parlays
  const moneylineBets = allRankedBets.filter(bet => 
    bet.betType === 'moneyline' && bet.eloProbability !== undefined
  )
  
  if (moneylineBets.length < requestedLegs) {
    return null
  }
  
  const getModelProb = (bet: RankedBet) => bet.eloProbability!
  
  // Filter to value bets (reasonable odds, probability, positive edge)
  const valueBets = moneylineBets.filter(bet => {
    const prob = getModelProb(bet)
    const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
    const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
    const hasPositiveEdge = bet.edge > 0
    return hasReasonableOdds && hasReasonableProb && hasPositiveEdge
  })
  
  // Fall back to moderate bets if not enough value bets
  let betsToUse = valueBets
  if (valueBets.length < requestedLegs) {
    const moderateBets = moneylineBets.filter(bet => {
      const prob = getModelProb(bet)
      const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
      const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
      return hasReasonableOdds && hasReasonableProb
    })
    betsToUse = moderateBets.length >= requestedLegs ? moderateBets : moneylineBets
  }
  
  // Sort by value score (prioritizes edge over raw probability)
  const sortedBets = [...betsToUse].sort((a, b) => {
    const aValue = calculateParlayValueScore(a)
    const bValue = calculateParlayValueScore(b)
    return bValue - aValue
  })
  
  // Build the requested parlay
  const mainParlay = buildParlayWithLegs(sortedBets, requestedLegs)
  if (!mainParlay) {
    return null
  }
  
  // Build alternatives if requested
  const alternatives: EnhancedParlayResult['alternatives'] = {}
  
  if (includeAlternatives) {
    // 2-leg alternative (safer)
    if (requestedLegs !== 2) {
      const twoLegParlay = buildParlayWithLegs(sortedBets, 2)
      if (twoLegParlay) {
        alternatives.twoLeg = createEnhancedParlayResult(twoLegParlay, now)
      }
    }
    
    // 3-leg alternative
    if (requestedLegs !== 3) {
      const threeLegParlay = buildParlayWithLegs(sortedBets, 3)
      if (threeLegParlay) {
        alternatives.threeLeg = createEnhancedParlayResult(threeLegParlay, now)
      }
    }
    
    // 4-leg alternative (riskier)
    if (requestedLegs !== 4 && sortedBets.length >= 4) {
      const fourLegParlay = buildParlayWithLegs(sortedBets, 4)
      if (fourLegParlay) {
        alternatives.fourLeg = createEnhancedParlayResult(fourLegParlay, now)
      }
    }
  }
  
  return createEnhancedParlayResult(mainParlay, now, alternatives)
}

/**
 * Format enhanced parlay result for Claude's context
 * Uses conversational format as specified by user
 */
export function formatEnhancedParlayForContext(parlay: EnhancedParlayResult): string {
  const lines: string[] = []
  
  lines.push('=== PARLAY ANALYSIS ===')
  lines.push('')
  lines.push(`**${parlay.legCount}-Leg Parlay** | Parlay Odds: ${formatOdds(parlay.parlayOdds)} | Payout: $${parlay.parlayPayout} per $100`)
  lines.push('')
  
  // Individual legs with probabilities and edges
  for (let i = 0; i < parlay.legs.length; i++) {
    const leg = parlay.legs[i]
    const emoji = getSportEmoji(leg.sportName)
    const modelProb = leg.eloProbability !== undefined ? leg.eloProbability : leg.consensusProbability
    lines.push(`${emoji} **Leg ${i + 1}: ${leg.team} ML @ ${formatOdds(leg.bestPrice)}**`)
    lines.push(`   ${leg.awayTeam} @ ${leg.homeTeam}`)
    lines.push(`   Win probability: ${modelProb}% | Edge: ${leg.edge > 0 ? '+' : ''}${leg.edge}%`)
    lines.push(`   Available at: ${leg.bestBook}`)
    lines.push('')
  }
  
  // Parlay math
  lines.push('**PARLAY MATH:**')
  lines.push(`- Combined probability: ${parlay.combinedProbability}% (${parlay.legs.map(l => `${l.eloProbability || l.consensusProbability}%`).join(' × ')})`)
  lines.push(`- Parlay odds: ${formatOdds(parlay.parlayOdds)} (implied ${parlay.impliedProbability}%)`)
  lines.push(`- Parlay edge: ${parlay.parlayEdge > 0 ? '+' : ''}${parlay.parlayEdge}%`)
  lines.push(`- Expected value: $${parlay.expectedValue > 0 ? '+' : ''}${parlay.expectedValue} per $100 bet`)
  lines.push('')
  
  // Independence note
  lines.push('**WHY THIS WORKS:**')
  lines.push('- Each leg has positive edge individually')
  lines.push('- Games are independent (different matchups, no correlation)')
  const sports = Array.from(new Set(parlay.legs.map(l => l.sportName)))
  if (sports.length > 1) {
    lines.push(`- Multiple sports (${sports.join(', ')}) reduces correlation risk`)
  }
  lines.push('')
  
  // Alternatives
  if (Object.keys(parlay.alternatives).length > 0) {
    lines.push('**ALTERNATIVES:**')
    if (parlay.alternatives.twoLeg) {
      const alt = parlay.alternatives.twoLeg
      lines.push(`- 2-leg (safer): ${formatOdds(alt.parlayOdds)} odds, ${alt.combinedProbability}% prob, ${alt.parlayEdge > 0 ? '+' : ''}${alt.parlayEdge}% edge`)
    }
    if (parlay.alternatives.threeLeg) {
      const alt = parlay.alternatives.threeLeg
      lines.push(`- 3-leg: ${formatOdds(alt.parlayOdds)} odds, ${alt.combinedProbability}% prob, ${alt.parlayEdge > 0 ? '+' : ''}${alt.parlayEdge}% edge`)
    }
    if (parlay.alternatives.fourLeg) {
      const alt = parlay.alternatives.fourLeg
      lines.push(`- 4-leg (riskier): ${formatOdds(alt.parlayOdds)} odds, ${alt.combinedProbability}% prob, ${alt.parlayEdge > 0 ? '+' : ''}${alt.parlayEdge}% edge`)
    }
    lines.push('')
  }
  
  return lines.join('\n')
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
  
  if (!parlay.safeParlay) {
    lines.push('🎯 PARLAY OF THE DAY')
    lines.push('')
    lines.push('No parlay available today. Parlays require at least 2 games that meet our value criteria (55% probability, 3% edge, max -250 juice).')
    lines.push('')
    lines.push('Today\'s market doesn\'t have enough qualifying games to build a responsible parlay. Check back later when more games are scheduled.')
    return lines.join('\n')
  }
  
  lines.push('🎯 PARLAY OF THE DAY')
  lines.push('')
  lines.push(`**2-Leg Parlay** | Combined Win Probability: ${parlay.combinedProbability}%`)
  lines.push('')
  
  // Helper to format bet display based on bet type
  const formatBetDisplay = (leg: RankedBet): string => {
    if (leg.betType === 'spread' && leg.line !== undefined) {
      return `${leg.team} ${leg.line > 0 ? '+' : ''}${leg.line}`
    } else if (leg.betType === 'total' && leg.line !== undefined) {
      const unit = getTotalUnit(leg.sportName)
      return `${leg.team} ${leg.line} ${unit}`
    } else {
      return `${leg.team} ML`
    }
  }
  
  // Helper to get probability label based on bet type
  const getProbLabel = (leg: RankedBet): string => {
    if (leg.betType === 'spread') return 'cover probability'
    if (leg.betType === 'total') return `${leg.team.toLowerCase()} probability`
    return 'win probability'
  }
  
  for (let i = 0; i < parlay.safeParlay.length; i++) {
    const leg = parlay.safeParlay[i]
    const emoji = getSportEmoji(leg.sportName)
    const modelProb = leg.eloProbability !== undefined ? leg.eloProbability : leg.consensusProbability
    lines.push(`${emoji} **Leg ${i + 1}: ${formatBetDisplay(leg)} @ ${formatOdds(leg.bestPrice)}**`)
    lines.push(`${leg.awayTeam} @ ${leg.homeTeam} | ${modelProb}% ${getProbLabel(leg)}`)
    lines.push(`Available at ${leg.bestBook}`)
    lines.push('')
  }
  
  if (parlay.aggressiveParlay) {
    const getModelProb = (leg: RankedBet) => leg.eloProbability !== undefined ? leg.eloProbability : leg.consensusProbability
    const aggCombinedProb = parlay.aggressiveParlay.reduce((acc, leg) => acc * (getModelProb(leg) / 100), 1) * 100
    lines.push('---')
    lines.push('')
    lines.push(`**3-Leg Aggressive Parlay** | Combined Win Probability: ${Math.round(aggCombinedProb * 10) / 10}%`)
    lines.push('')
    
    for (let i = 0; i < parlay.aggressiveParlay.length; i++) {
      const leg = parlay.aggressiveParlay[i]
      const emoji = getSportEmoji(leg.sportName)
      const modelProb = getModelProb(leg)
      lines.push(`${emoji} Leg ${i + 1}: ${formatBetDisplay(leg)} @ ${formatOdds(leg.bestPrice)} | ${leg.awayTeam} @ ${leg.homeTeam} (${modelProb}%)`)
    }
    lines.push('')
  }
  
  lines.push('*Note: Parlay odds vary by sportsbook. Place all legs at one book for best pricing.*')
  
  return lines.join('\n')
}

/**
 * Format sport-specific best bets for Claude's context
 */
export function formatSportBestBetsForContext(sportBets: SportBestBets): string {
  const lines: string[] = []
  
  const sports = Object.keys(sportBets).sort()
  
  if (sports.length === 0) {
    lines.push('🎯 SPORT-SPECIFIC BEST BETS')
    lines.push('')
    lines.push('No sport-specific bets available at this time.')
    return lines.join('\n')
  }
  
  lines.push('🎯 BEST BETS BY SPORT')
  lines.push('')
  
  for (const sport of sports) {
    const bet = sportBets[sport]
    if (!bet) continue
    
    const emoji = getSportEmoji(bet.sportName)
    const modelProb = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
    
    lines.push(`${emoji} **${sport.toUpperCase()}:** ${bet.team} ML @ ${formatOdds(bet.bestPrice)}`)
    lines.push(`${bet.awayTeam} @ ${bet.homeTeam} | ${modelProb}% prob | ${bet.edge}% edge | Score: ${bet.score}/100`)
    lines.push('')
  }
  
  return lines.join('\n')
}

/**
 * Filter sport bets by inclusion/exclusion and format for deterministic response
 * Only returns bets that have Elo data
 */
export function getFilteredBestBetWithElo(
  sportBets: SportBestBets,
  excludeSports: string[] = [],
  includeSports: string[] = []
): { bet: RankedBet | null; availableSports: string[]; message: string } {
  // Sport name mapping for strict matching
  // Maps user-friendly names to all possible variations in the data
  const sportNameMap: Record<string, string[]> = {
    'nhl': ['nhl', 'hockey', 'icehockey', 'icehockeynhl', 'nationalhockeyleague'],
    'nba': ['nba', 'basketball', 'basketballnba', 'nationalbasketballassociation'],
    'nfl': ['nfl', 'football', 'americanfootball', 'americanfootballnfl', 'nationalfootballleague'],
    'mlb': ['mlb', 'baseball', 'baseballmlb', 'majorleaguebaseball'],
    'ncaab': ['ncaab', 'collegebasketball', 'basketballncaab', 'ncaa', 'ncaamen'],
    'ncaaf': ['ncaaf', 'collegefootball', 'americanfootballncaaf'],
    'soccer': ['soccer', 'football', 'epl', 'premierleague', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'mls', 'championsleague'],
  }
  
  // Normalize sport names for comparison (remove non-letters, lowercase)
  const normalizeForFilter = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const excludeNorm = excludeSports.map(normalizeForFilter)
  const includeNorm = includeSports.map(normalizeForFilter)
  
  // Check if a sport name matches a filter using strict matching
  // IMPORTANT: NBA and NCAAB are different sports and must NOT match each other
  const matchesSportFilter = (sportName: string, filterName: string): boolean => {
    const sportNorm = normalizeForFilter(sportName)
    const filterNorm = normalizeForFilter(filterName)
    
    // Direct match
    if (sportNorm === filterNorm) return true
    
    // STRICT MATCHING: NBA and NCAAB must be kept separate
    // If filter is specifically 'nba', only match NBA (not NCAAB)
    // If filter is specifically 'ncaab', only match NCAAB (not NBA)
    if (filterNorm === 'nba') {
      // Only match if sport is exactly NBA or basketball_nba
      return sportNorm === 'nba' || sportNorm === 'basketballnba' || sportNorm === 'basketball_nba'
    }
    if (filterNorm === 'ncaab') {
      // Only match if sport is exactly NCAAB or basketball_ncaab
      return sportNorm === 'ncaab' || sportNorm === 'basketballncaab' || sportNorm === 'basketball_ncaab'
    }
    if (filterNorm === 'nfl') {
      // Only match if sport is exactly NFL or americanfootball_nfl
      return sportNorm === 'nfl' || sportNorm === 'americanfootballnfl' || sportNorm === 'americanfootball_nfl'
    }
    if (filterNorm === 'ncaaf') {
      // Only match if sport is exactly NCAAF or americanfootball_ncaaf
      return sportNorm === 'ncaaf' || sportNorm === 'americanfootballncaaf' || sportNorm === 'americanfootball_ncaaf'
    }
    
    // For generic terms like 'basketball' or 'football', allow both pro and college
    if (filterNorm === 'basketball') {
      return sportNorm.includes('basketball') || sportNorm === 'nba' || sportNorm === 'ncaab'
    }
    if (filterNorm === 'football') {
      return sportNorm.includes('football') || sportNorm === 'nfl' || sportNorm === 'ncaaf'
    }
    
    // Check if the filter maps to known variations
    const filterVariations = sportNameMap[filterNorm] || [filterNorm]
    for (const variation of filterVariations) {
      if (sportNorm === variation) return true
      // Only use substring matching for non-ambiguous cases (not nba/ncaab or nfl/ncaaf)
      // e.g., "icehockey_nhl" should match "nhl" but "ncaab" should NOT match "nba"
      if (sportNorm.includes(variation) && variation.length >= 3) {
        // Exclude cases where substring matching would cause NBA/NCAAB or NFL/NCAAF confusion
        if (variation === 'nba' && sportNorm.includes('ncaab')) continue
        if (variation === 'nfl' && sportNorm.includes('ncaaf')) continue
        return true
      }
    }
    
    // Check reverse - if sportNorm maps to known variations that include filterNorm
    for (const [key, variations] of Object.entries(sportNameMap)) {
      if (variations.includes(sportNorm) && (key === filterNorm || variations.includes(filterNorm))) {
        return true
      }
    }
    
    return false
  }
  
  // Get all available sports with Elo data (only require eloProbability - homeElo/awayElo are nice-to-have for display)
  const sportsWithElo = Object.entries(sportBets)
    .filter(([, bet]) => bet && bet.eloProbability != null)
    .map(([sport]) => sport)
  
  console.log(`[getFilteredBestBetWithElo] Sports with Elo data: ${sportsWithElo.join(', ') || 'none'}`)
  console.log(`[getFilteredBestBetWithElo] Include filters: ${includeSports.join(', ') || 'none'}`)
  console.log(`[getFilteredBestBetWithElo] Exclude filters: ${excludeSports.join(', ') || 'none'}`)
  
  // Apply filters
  let filteredSports = sportsWithElo
  
  if (excludeNorm.length > 0) {
    filteredSports = filteredSports.filter(sport => {
      const shouldExclude = excludeNorm.some(ex => matchesSportFilter(sport, ex))
      if (shouldExclude) {
        console.log(`[getFilteredBestBetWithElo] Excluding sport: ${sport}`)
      }
      return !shouldExclude
    })
  }
  
  if (includeNorm.length > 0) {
    filteredSports = filteredSports.filter(sport => {
      const shouldInclude = includeNorm.some(inc => matchesSportFilter(sport, inc))
      console.log(`[getFilteredBestBetWithElo] Sport ${sport} matches include filter: ${shouldInclude}`)
      return shouldInclude
    })
  }
  
  console.log(`[getFilteredBestBetWithElo] Filtered sports: ${filteredSports.join(', ') || 'none'}`)
  
  // Find the best bet among filtered sports
  let bestBet: RankedBet | null = null
  for (const sport of filteredSports) {
    const bet = sportBets[sport]
    if (bet && (!bestBet || bet.score > bestBet.score)) {
      bestBet = bet
    }
  }
  
  if (!bestBet) {
    const filterDesc = excludeSports.length > 0 
      ? `excluding ${excludeSports.join(', ')}`
      : includeSports.length > 0 
        ? `for ${includeSports.join(', ')}`
        : ''
    return {
      bet: null,
      availableSports: sportsWithElo,
      message: `No Elo-based bets available ${filterDesc}. Sports with Elo data today: ${sportsWithElo.length > 0 ? sportsWithElo.join(', ') : 'none'}.`
    }
  }
  
  return {
    bet: bestBet,
    availableSports: sportsWithElo,
    message: ''
  }
}

/**
 * Format a filtered best bet for deterministic response (with full Elo details)
 * @param bet - The best bet to format
 * @param filterDescription - Description of the filter applied (e.g., "NBA")
 * @param alternatives - Optional list of alternative bets for "what else?" follow-ups
 */
export function formatFilteredBestBetResponse(bet: RankedBet, filterDescription: string = '', alternatives: RankedBet[] = []): string {
  const lines: string[] = []
  const emoji = getSportEmoji(bet.sportName)
  
  const isSpread = bet.betType === 'spread'
  const isTotal = bet.betType === 'total'
  
  // Format bet type display
  let pickDisplay: string
  if (isTotal) {
    pickDisplay = `${bet.team} ${bet.line} @ ${formatOdds(bet.bestPrice)}`
  } else if (isSpread && bet.line !== undefined) {
    pickDisplay = `${bet.team} ${bet.line > 0 ? '+' : ''}${bet.line} @ ${formatOdds(bet.bestPrice)}`
  } else {
    pickDisplay = `${bet.team} ML @ ${formatOdds(bet.bestPrice)}`
  }
  
  // Format header: "BEST NHL BET" instead of "BEST BET (NHL)"
  const headerText = filterDescription ? `BEST ${filterDescription.toUpperCase()} BET` : 'BEST BET'
  lines.push(`${emoji} ${headerText}`)
  lines.push('')
  lines.push(`**${pickDisplay}**`)
  lines.push(`${bet.awayTeam} @ ${bet.homeTeam} | ${bet.sportName} | ${formatTime(bet.commenceTime)}`)
  lines.push(`Score: ${bet.score}/100`)
  lines.push('')
  
  // Model probability
  const modelProbPercent = bet.eloProbability !== undefined ? bet.eloProbability : bet.consensusProbability
  const modelSource = bet.eloProbability !== undefined ? 'Elo Model' : 'Market Consensus'
  const probLabel = isTotal ? `${bet.team.toLowerCase()} probability` : isSpread ? 'cover probability' : 'win probability'
  
  // WHY THIS BET
  lines.push('**WHY THIS BET:**')
  lines.push('')
  if (bet.eloProbability !== undefined) {
    if (isSpread) {
      lines.push(`Our Elo model gives ${bet.team} an ${bet.eloProbability}% probability to cover the spread, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    } else if (isTotal) {
      lines.push(`Our Elo model gives this game a ${bet.eloProbability}% probability of going ${bet.team.toLowerCase()}, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    } else {
      lines.push(`Our Elo model gives ${bet.team} a ${bet.eloProbability}% win probability, while the market odds (${formatOdds(bet.bestPrice)}) imply only ${bet.impliedProbability}%. That's a ${bet.edge}% edge.`)
    }
  } else {
    lines.push(`Market consensus shows a ${bet.consensusProbability}% ${probLabel}. The best available odds (${formatOdds(bet.bestPrice)}) offer a ${bet.edge}% edge.`)
  }
  lines.push('')
  
  // Matchup context with Elo
  if (bet.homeElo != null && bet.awayElo != null) {
    const eloDiff = Math.abs(bet.homeElo - bet.awayElo)
    const favoredTeam = bet.homeElo > bet.awayElo ? bet.homeTeam : bet.awayTeam
    if (isTotal) {
      const avgElo = Math.round((bet.homeElo + bet.awayElo) / 2)
      lines.push(`Combined Elo strength: ${avgElo} average (${bet.homeTeam}: ${bet.homeElo}, ${bet.awayTeam}: ${bet.awayElo}). Market line: ${bet.line}.`)
    } else {
      lines.push(`${bet.homeTeam} (Elo: ${bet.homeElo}) vs ${bet.awayTeam} (Elo: ${bet.awayElo}). The ${eloDiff}-point Elo difference favors ${favoredTeam}.`)
    }
    lines.push('')
  }
  
  // Value breakdown
  lines.push('**VALUE:**')
  lines.push('')
  lines.push(`${isTotal ? `${bet.team} Probability` : isSpread ? 'Cover Probability' : 'Win Probability'}: ${modelProbPercent}% (${modelSource})`)
  lines.push(`Expected Value: $${bet.expectedValue.toFixed(2)} per $100 bet`)
  lines.push(`ROI: ${bet.roi.toFixed(2)}%`)
  lines.push(`Edge: ${bet.edge}%`)
  lines.push('')
  
  lines.push(`Available at ${bet.bestBook}.`)
  
  // ALTERNATIVES: Show top 10 bets so LLM can respond to "what else?" questions
  // This enables conversational follow-ups like "can't bet that, what else?"
  if (alternatives.length > 0) {
    lines.push('')
    lines.push('**ALTERNATIVES (if user asks "what else?" or can\'t bet the top pick):**')
    lines.push('')
    for (let i = 0; i < Math.min(9, alternatives.length); i++) {
      const alt = alternatives[i]
      let altPickDisplay: string
      if (alt.betType === 'total' && alt.line !== undefined) {
        const altUnit = getTotalUnit(alt.sportName)
        altPickDisplay = `${alt.team} ${alt.line} ${altUnit} @ ${formatOdds(alt.bestPrice)}`
      } else if (alt.betType === 'spread' && alt.line !== undefined) {
        altPickDisplay = `${alt.team} ${alt.line > 0 ? '+' : ''}${alt.line} @ ${formatOdds(alt.bestPrice)}`
      } else {
        altPickDisplay = `${alt.team} ML @ ${formatOdds(alt.bestPrice)}`
      }
      const sportEmoji = getSportEmoji(alt.sportName)
      lines.push(`#${i + 2}: ${sportEmoji} ${altPickDisplay} | ${alt.awayTeam} @ ${alt.homeTeam} | ${alt.sportName} | Score: ${alt.score}/100 | ${alt.eloProbability || alt.consensusProbability}% prob | ${alt.bestBook}`)
    }
    lines.push('')
    lines.push('*Use these alternatives if user says they can\'t bet the top pick, wants a different sport, or asks "what else?"*')
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
    
    // Handle double-stringify: cacheParlay uses JSON.stringify(JSON.stringify(parlay))
    let parsed = JSON.parse(data.result)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return parsed as ParlayResult
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
    
    // Handle double-stringify: cacheSportBets uses JSON.stringify(JSON.stringify(sportBets))
    let parsed = JSON.parse(data.result)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return parsed as SportBestBets
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
  
  // Model-based probability from player stats (when available)
  modelProbability?: number      // Our independent probability estimate
  modelAverage?: number          // Player's rolling average for this stat
  modelGamesPlayed?: number      // How many games our model has for this player
  modelEdge?: number             // Edge based on model probability vs implied
  
  // ENHANCED: New fields from improved player stats model
  reliabilityScore?: number      // 0-100, higher = more consistent player
  confidence?: 'high' | 'medium' | 'low'  // Based on sample size and reliability
  historicalHitRate?: number     // Actual hit rate from historical data
  adjustedAverage?: number       // Average after opponent/home-away adjustments
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
    
    // Try to get ENHANCED model probability for this player/stat/line
    // The enhanced model includes: historical hit rates, reliability scores, home/away adjustments
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
    
    // Calculate model-based edge using the enhanced probability
    const modelProbPercent = modelResult.probability * 100
    const modelEdge = modelProbPercent - prop.impliedProbability
    
    // Enhance the prop with ALL model data including new fields
    const enhancedProp: RankedProp = {
      ...prop,
      modelProbability: Math.round(modelProbPercent * 10) / 10,
      modelAverage: Math.round(modelResult.average * 10) / 10,
      modelGamesPlayed: modelResult.gamesPlayed,
      modelEdge: Math.round(modelEdge * 10) / 10,
      // NEW: Enhanced model fields
      reliabilityScore: modelResult.reliabilityScore,
      confidence: modelResult.confidence,
      historicalHitRate: Math.round(modelResult.historicalHitRate * 1000) / 10,
      adjustedAverage: Math.round(modelResult.adjustedAverage * 10) / 10,
    }
    
    // ENHANCED SCORING: Use reliability and confidence to boost/penalize
    let scoreMultiplier = 1.0
    
    // Boost score if model agrees with consensus (both show positive edge)
    if (modelEdge > 0 && prop.edge > 0) {
      scoreMultiplier *= 1.1  // 10% boost for agreement
    } else if (modelEdge > 5) {
      scoreMultiplier *= 1.05  // 5% boost for strong model edge
    }
    
    // Boost for high reliability players (more consistent = more predictable)
    if (modelResult.reliabilityScore >= 70) {
      scoreMultiplier *= 1.15  // 15% boost for very reliable players
    } else if (modelResult.reliabilityScore >= 60) {
      scoreMultiplier *= 1.08  // 8% boost for reliable players
    }
    
    // Boost for high confidence predictions
    if (modelResult.confidence === 'high') {
      scoreMultiplier *= 1.1  // 10% boost for high confidence
    } else if (modelResult.confidence === 'medium') {
      scoreMultiplier *= 1.05  // 5% boost for medium confidence
    }
    
    enhancedProp.score = prop.score * scoreMultiplier
    
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
      
      // Try to get ENHANCED model probability for this player
      // The enhanced model includes: historical hit rates, reliability scores, home/away adjustments
      let modelResult: EnhancedPropProbability | null = null
      
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
        
        // Calculate model-based values using ENHANCED model
        let modelProbability: number | undefined
        let modelAverage: number | undefined
        let modelGamesPlayed: number | undefined
        let modelEdge: number | undefined
        let reliabilityScore: number | undefined
        let confidence: 'high' | 'medium' | 'low' | undefined
        let historicalHitRate: number | undefined
        let adjustedAverage: number | undefined
        let score: number
        
        if (modelResult && modelResult.gamesPlayed >= 5) {
          // We have ENHANCED model data - use it as primary ranking
          // For Over: model probability is P(actual > line)
          // For Under: model probability is 1 - P(actual > line)
          const rawModelProb = side.pick === 'Over' ? modelResult.probability : (1 - modelResult.probability)
          modelProbability = Math.round(rawModelProb * 1000) / 10
          modelAverage = Math.round(modelResult.average * 10) / 10
          modelGamesPlayed = modelResult.gamesPlayed
          modelEdge = Math.round((modelProbability - side.bestImplied) * 10) / 10
          
          // NEW: Enhanced model fields
          reliabilityScore = modelResult.reliabilityScore
          confidence = modelResult.confidence
          historicalHitRate = Math.round(modelResult.historicalHitRate * 1000) / 10
          adjustedAverage = Math.round(modelResult.adjustedAverage * 10) / 10
          
          // ENHANCED SCORING: Use reliability and confidence
          let baseScore = modelProbability * 0.6 + Math.max(0, modelEdge) * 0.4
          
          // Boost for high reliability players (more consistent = more predictable)
          if (reliabilityScore >= 70) {
            baseScore *= 1.15  // 15% boost for very reliable players
          } else if (reliabilityScore >= 60) {
            baseScore *= 1.08  // 8% boost for reliable players
          }
          
          // Boost for high confidence predictions
          if (confidence === 'high') {
            baseScore *= 1.1  // 10% boost for high confidence
          } else if (confidence === 'medium') {
            baseScore *= 1.05  // 5% boost for medium confidence
          }
          
          score = baseScore
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
          modelEdge,
          // NEW: Enhanced model fields
          reliabilityScore,
          confidence,
          historicalHitRate,
          adjustedAverage
        })
      }
    }
  }
  
  // Sort by score (model-first ranking with reliability boost)
  allRankedProps.sort((a, b) => b.score - a.score)
  
  // Filter to only include props with reasonable probability and VALUE for parlays
  // - Minimum 40% probability (reasonable chance to hit)
  // - Maximum 85% probability (avoid extreme favorites with poor payout)
  // - Prefer positive edge (our model sees value)
  const viableProps = allRankedProps.filter(p => {
    const prob = p.modelProbability !== undefined ? p.modelProbability : p.consensusProbability
    const edge = p.modelEdge !== undefined ? p.modelEdge : p.edge
    const hasReasonableProb = prob >= 40 && prob <= 85
    const hasValue = edge > -5  // Allow slightly negative edge but not terrible value
    return hasReasonableProb && hasValue
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
  const rankedProps = modelFirstProps?.allRankedProps && modelFirstProps.allRankedProps.length > 0 
    ? modelFirstProps.allRankedProps 
    : result.allRankedProps || []
  
  // Find the best prop with positive edge
  const propsWithPositiveEdge = rankedProps.filter(p => {
    const edge = p.modelEdge !== undefined ? p.modelEdge : p.edge
    return edge > 0
  })
  
  const bestProp = propsWithPositiveEdge.length > 0 ? propsWithPositiveEdge[0] : null
  const runnerUp = propsWithPositiveEdge.length > 1 ? propsWithPositiveEdge[1] : null
  
  if (!bestProp) {
    // No props with positive edge
    if (rankedProps.length > 0) {
      lines.push('🎯 BEST PLAYER PROP')
      lines.push('')
      lines.push('No props with positive edge today. Here are the best available options ranked by our model:')
      lines.push('')
      
      for (let i = 0; i < Math.min(3, rankedProps.length); i++) {
        const p = rankedProps[i]
        const modelProb = p.modelProbability !== undefined ? p.modelProbability : p.consensusProbability
        const modelEdge = p.modelEdge !== undefined ? p.modelEdge : p.edge
        const sportName = SPORT_NAME_MAP[p.sport] || p.sport
        const emoji = getSportEmoji(sportName)
        
        lines.push(`${emoji} #${i + 1}: **${p.playerName} ${p.pick} ${p.line} ${p.marketDisplay}**`)
        lines.push(`${p.awayTeam} @ ${p.homeTeam} | ${modelProb}% prob | ${modelEdge}% edge`)
        lines.push(`Available at ${p.bestBook} @ ${formatOdds(p.bestPrice)}`)
        lines.push('')
      }
      
      lines.push('*Note: These props do not have positive edge. Consider smaller bet sizes.*')
    } else {
      lines.push('🎯 BEST PLAYER PROP')
      lines.push('')
      lines.push('No player props data available at this time.')
    }
  } else {
    // We have a best prop with positive edge
    const modelProb = bestProp.modelProbability !== undefined ? bestProp.modelProbability : bestProp.consensusProbability
    const modelSource = bestProp.modelProbability !== undefined ? `${bestProp.modelGamesPlayed} games` : `${bestProp.booksWithLine} books`
    const edgeToShow = bestProp.modelEdge !== undefined ? bestProp.modelEdge : bestProp.edge
    const sportName = SPORT_NAME_MAP[bestProp.sport] || bestProp.sport
    const emoji = getSportEmoji(sportName)
    
    lines.push(`${emoji} BEST PLAYER PROP`)
    lines.push('')
    lines.push(`**${bestProp.playerName} ${bestProp.pick} ${bestProp.line} ${bestProp.marketDisplay} @ ${formatOdds(bestProp.bestPrice)}**`)
    lines.push(`${bestProp.awayTeam} @ ${bestProp.homeTeam} | ${sportName}`)
    lines.push('')
    
    // WHY THIS PROP
    lines.push('**WHY THIS PROP:**')
    lines.push('')
    lines.push(`Our model gives this prop a ${modelProb}% probability (based on ${modelSource}), while the market odds (${formatOdds(bestProp.bestPrice)}) imply only ${bestProp.impliedProbability}%. That's a ${edgeToShow}% edge.`)
    lines.push('')
    
    // Player stats context
    if (bestProp.modelProbability !== undefined && bestProp.modelGamesPlayed !== undefined) {
      lines.push(`${bestProp.playerName} averages ${bestProp.modelAverage} ${bestProp.marketDisplay} over the last ${bestProp.modelGamesPlayed} games. The line is set at ${bestProp.line}.`)
      lines.push('')
    }
    
    // Value breakdown
    lines.push('**VALUE:**')
    lines.push('')
    lines.push(`Model Probability: ${modelProb}%`)
    lines.push(`Market Consensus: ${bestProp.consensusProbability}%`)
    lines.push(`Edge: +${edgeToShow}%`)
    lines.push('')
    
    // Runner-up
    if (runnerUp) {
      const ruProb = runnerUp.modelProbability !== undefined ? runnerUp.modelProbability : runnerUp.consensusProbability
      const ruEdge = runnerUp.modelEdge !== undefined ? runnerUp.modelEdge : runnerUp.edge
      lines.push('**ALTERNATIVE:**')
      lines.push('')
      lines.push(`#2: ${runnerUp.playerName} ${runnerUp.pick} ${runnerUp.line} ${runnerUp.marketDisplay} @ ${formatOdds(runnerUp.bestPrice)} (${ruProb}% prob, +${ruEdge}% edge)`)
      lines.push('')
    }
    
    lines.push(`Available at ${bestProp.bestBook}.`)
  }
  
  // Add top props list for parlay building
  if (rankedProps.length > 3) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('**TOP RANKED PROPS:**')
    lines.push('')
    for (let i = 0; i < Math.min(10, rankedProps.length); i++) {
      const p = rankedProps[i]
      const modelProb = p.modelProbability !== undefined ? p.modelProbability : p.consensusProbability
      const modelEdge = p.modelEdge !== undefined ? p.modelEdge : p.edge
      const edgeLabel = modelEdge > 0 ? `+${modelEdge}%` : `${modelEdge}%`
      
      lines.push(`#${i + 1}: ${p.playerName} ${p.pick} ${p.line} ${p.marketDisplay} | ${modelProb}% prob | ${edgeLabel} edge`)
    }
  }
  
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
    
    // Handle double-stringify: cacheBestProp uses JSON.stringify(JSON.stringify(result))
    let parsed = JSON.parse(data.result)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return parsed as BestPropResult
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
    
    // Handle double-stringify: cacheModelFirstProps uses JSON.stringify(JSON.stringify(result))
    let parsed = JSON.parse(data.result)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return parsed as BestPropResult
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
