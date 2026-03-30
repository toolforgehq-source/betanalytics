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
import type { ESPNInjury, ESPNProbable } from './espn'
import { getPlayerPropProbability, getPlayerStatsData, type PlayerStats, type EnhancedPropProbability } from './player-stats'
import { trackBestBet, trackParlay, trackSportBet, trackPropBet } from './recommendation-tracking'
import { 
  getEloWinProbabilityByName, 
  getEloWinProbabilityWithInjuries,
  calculateSpreadCoverProbability,
  calculateTotalProbability,
  getTeamMarginStatsByName,
  getTeamLast10ByName,
  type InjuryInfo,
  type PlayerImportance,
  type PitcherInfo
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
  
  // Injury disqualification flag (set when team has severe injuries)
  injuryDisqualified?: boolean
  
  // Confidence tier for tiered pick system
  confidenceTier?: 'lock' | 'strong' | 'value'
  
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
// Raised back to 4%: lowering to 2% let through too many marginal picks with tiny edges
// that weren't real, tanking the win rate. 4% provides a meaningful buffer that survives
// real-world variance. Markets are efficient — a 2% edge is often just noise.
const MIN_EDGE = 0.04             // 4% minimum edge for "qualified" moneyline bets

// Spread-specific thresholds (more relaxed since spreads are ~50% probability)
const MIN_SPREAD_PROBABILITY = 0.48  // 48% minimum for spreads (they're designed to be ~50%)
const MIN_SPREAD_EDGE = 0.01         // 1% minimum edge for spreads (edges are smaller from line shopping)
const MIN_SPREAD_ROI = 0.5           // 0.5% minimum ROI for spreads

// Total-specific thresholds (FIX 2: tighter filters to prevent inflated totals edges from dominating)
const MIN_TOTAL_PROBABILITY = 0.53   // 53% minimum for totals — slightly above moneyline to be more selective
const MIN_TOTAL_EDGE = 0.03          // 3% minimum edge for totals — aligned with moneyline selectivity
const MIN_TOTAL_ROI = 1.5            // 1.5% minimum ROI for totals — higher bar since totals are noisier

// SANITY CHECK: Maximum edge threshold
// Real market inefficiencies rarely exceed 3-5%. Even the best models in the world
// (FiveThirtyEight, Pinnacle sharp lines) find edges in the 2-6% range.
// Anything above 8% is almost certainly a data error or model miscalibration.
// Previous value of 15% was far too high — it let through phantom edges that destroyed win rate.
const MAX_SANE_EDGE = 0.08           // 8% maximum edge - anything higher is flagged as suspicious

// ============================================
// ELO CONFIDENCE BLENDING
// ============================================
// When the Elo model has low confidence (few games processed), the ratings are unreliable.
// A team at default ~1500 + home advantage creates ~64% win probability regardless of actual strength.
// This creates absurd "edges" (50%+) against market odds for underdogs the model knows nothing about.
//
// Fix: Blend Elo probability with market consensus based on confidence level.
// High confidence = trust Elo heavily. Low confidence = lean on market pricing.
// WIN PCT FIX: More conservative blending — sports markets are extremely efficient.
// ELO CALIBRATION FIX: With sport-specific scaling (elo.ts) and static compression
// (calibration.ts) now preventing overconfident probabilities, Elo deserves meaningful
// weight again. But market consensus is still extremely efficient — the best sports
// models in the world (FiveThirtyEight, etc.) still give markets 40-50% weight.
//
// Previous weights (75/60/40/25) were too aggressive with uncalibrated Elo:
//   - High confidence Elo was producing 81% when reality was ~70%
//   - 75% weight amplified this into massive phantom edges
//   - The filters then SELECTED for maximum Elo error → 14.8% win rate
//
// Now that Elo is calibrated (scaling + compression), these weights produce
// a balanced blend where Elo provides genuine edge over pure market pricing.
const ELO_CONFIDENCE_WEIGHTS: Record<string, number> = {
  'high': 0.55,      // >= 20 games: 55% Elo, 45% market (balanced — Elo has real data)
  'medium': 0.45,    // >= 10 games: 45% Elo, 55% market (market slightly leads)
  'low': 0.30,       // >= 5 games:  30% Elo, 70% market (lean heavily on market)
  'very_low': 0.15,  // < 5 games:   15% Elo, 85% market (Elo barely trusted)
}

function blendWithMarket(
  eloProbability: number,
  marketProbability: number,
  confidence: string
): number {
  const eloWeight = ELO_CONFIDENCE_WEIGHTS[confidence] ?? 0.50
  return eloWeight * eloProbability + (1 - eloWeight) * marketProbability
}

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
  'NCAAB': 2,      // Lowered from 4: market-anchored margins are naturally smaller, so 2pt edge is meaningful
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
 * Extract starting pitcher info from ESPN probables data
 * Returns PitcherInfo for a specific team, or null if not available
 */
function extractPitcherInfo(probables: ESPNProbable[], teamName: string): PitcherInfo | null {
  if (!probables || probables.length === 0) return null
  
  const teamNorm = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
  const pitcher = probables.find(p => {
    const pTeamNorm = p.team.toLowerCase().replace(/[^a-z0-9]/g, '')
    return pTeamNorm.includes(teamNorm) || teamNorm.includes(pTeamNorm)
  })
  
  if (!pitcher) return null
  
  return {
    name: pitcher.player,
    team: pitcher.team,
    era: pitcher.era
  }
}

/**
 * Build injury display info for the situational breakdown
 * Shows WHO is out (not just a count) and the approximate probability impact
 */
function buildInjuryDisplay(
  teamName: string,
  injuries: InjuryInfo[] | undefined,
  eloResult: { homeRating: number; awayRating: number; homeEffectiveRating?: number; awayEffectiveRating?: number } | null,
  isHomeTeam: boolean
): { value: string; adjustment: number } {
  if (!injuries || injuries.length === 0) {
    return { value: 'No major injuries reported', adjustment: 0 }
  }
  
  // Filter injuries for this specific team
  const teamNorm = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
  const teamInjuries = injuries.filter(inj => {
    const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
    return injTeamNorm.includes(teamNorm) || teamNorm.includes(injTeamNorm)
  })
  
  // Get key OUT/Doubtful players
  const keyOut = teamInjuries
    .filter(i => {
      const s = i.status.toLowerCase()
      return s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir'
    })
    .map(i => `${i.player} (${i.status})`)
  
  // Calculate Elo adjustment (effective - base)
  let eloAdjustment = 0
  if (eloResult) {
    if (isHomeTeam && eloResult.homeEffectiveRating !== undefined) {
      eloAdjustment = eloResult.homeEffectiveRating - eloResult.homeRating
    } else if (!isHomeTeam && eloResult.awayEffectiveRating !== undefined) {
      eloAdjustment = eloResult.awayEffectiveRating - eloResult.awayRating
    }
  }
  
  // Convert Elo adjustment to approximate probability change (~0.14% per Elo point)
  const probAdjustment = Math.round(eloAdjustment * 0.14 * 10) / 10
  
  let value: string
  if (keyOut.length > 0) {
    value = `KEY OUT: ${keyOut.join(', ')}`
    if (eloAdjustment !== 0) {
      value += ` (Elo impact: ${eloAdjustment > 0 ? '+' : ''}${eloAdjustment} pts)`
    }
  } else if (teamInjuries.length > 0) {
    value = `${teamInjuries.length} injuries tracked (minor/questionable)`
  } else {
    value = `${injuries.length} total injuries in game`
  }
  
  return { value, adjustment: probAdjustment }
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
  roi: number,             // percentage (e.g., 5.0 = 5%)
  spreadSize?: number,     // absolute spread size (e.g., 21.5)
  eloGap?: number,         // absolute Elo difference between teams (e.g., 351)
  sport?: string,          // sport key (e.g., 'basketball_ncaab', 'icehockey_nhl')
  betType?: string,        // bet type (e.g., 'moneyline', 'spread', 'total')
  isUnderdog?: boolean,    // true if betting on underdog getting points (spread > 0)
  americanOdds?: number    // American odds (e.g., -150, +200) for Kelly calculation
): number {
  // ============================================
  // KELLY CRITERION SCORING
  // ============================================
  // Kelly fraction f* = (bp - q) / b is the mathematically optimal bet sizing.
  // It naturally accounts for BOTH edge AND odds payoff structure:
  //   - Heavy favorites (-345) get low Kelly fractions (tiny payout)
  //   - Big underdogs (+650) get low Kelly fractions (low win probability)
  //   - Sweet spot: moderate odds with real edges get HIGH Kelly fractions
  //
  // Previous weights: 30 prob / 15 ROI / 55 edge (pure edge was misleading)
  // New weights: 40 Kelly / 25 prob / 15 edge / 10 ROI
  // Kelly replaces edge as primary signal because it captures edge + odds together
  // ============================================
  
  // ============================================
  // KELLY SCORE: 40 points maximum (PRIMARY component)
  // ============================================
  // Kelly fraction typically ranges from 0% to ~25% for good bets.
  // Normalize: 15% Kelly fraction = max score (40 points)
  // Formula: min(40, (kellyFraction / 0.15) * 40)
  //
  // Examples (probability, odds → Kelly → score):
  //   65%, -150 → Kelly 12.5% → 33.3 points
  //   60%, -110 → Kelly 10.5% → 28.0 points
  //   55%, +110 → Kelly  7.6% → 20.3 points
  //   80%, -345 → Kelly 11.0% → 29.3 points (moderate despite heavy juice)
  //   20%, +650 → Kelly  7.7% → 20.5 points (penalized for low prob)
  //   70%, -200 → Kelly 15.0% → 40.0 points (max — great Kelly bet)
  let kellyScore = 0
  if (americanOdds !== undefined && americanOdds !== 0) {
    let b: number
    if (americanOdds > 0) {
      b = americanOdds / 100
    } else {
      b = 100 / Math.abs(americanOdds)
    }
    const p = winProbability
    const q = 1 - p
    const kellyFraction = Math.max(0, (b * p - q) / b)
    kellyScore = Math.min(40, (kellyFraction / 0.15) * 40)
  }
  
  // ============================================
  // PROBABILITY SCORE: 25 points maximum (was 30)
  // ============================================
  // Formula: ((Win Probability - 50) / 40) × 25
  // 50% = 0 points, 60% = 6.25 points, 70% = 12.5 points, 90% = 25 points
  const probPercent = winProbability * 100  // Convert to 0-100 scale
  const probScore = Math.max(0, Math.min(25, ((probPercent - 50) / 40) * 25))
  
  // ============================================
  // ROI SCORE: 10 points maximum (was 15, can go negative!)
  // ============================================
  // Different formulas for positive vs negative ROI:
  // - Positive ROI: Score = 5 + (ROI / 20) × 5
  // - Negative ROI: Score = 5 + (ROI / 10) × 5 (penalized more heavily)
  // 
  // Examples:
  // +20% ROI = 10 points (max)
  // +5% ROI = 6.25 points
  // 0% ROI = 5 points
  // -4% ROI = 3 points
  // -10% ROI = 0 points
  let roiScore: number
  if (roi >= 0) {
    roiScore = 5 + (roi / 20) * 5
  } else {
    roiScore = 5 + (roi / 10) * 5
  }
  roiScore = Math.max(-10, Math.min(10, roiScore))
  
  // ============================================
  // EDGE SCORE: 15 points maximum (was 55, can go negative!)
  // ============================================
  // Edge is still valuable but now secondary to Kelly fraction.
  // Formula: (Edge / 10) × 15
  // +10% edge = 15 points (max)
  // +5% edge = 7.5 points
  // +3% edge = 4.5 points
  // 0% edge = 0 points
  // -5% edge = -7.5 points
  const edgePercent = edge * 100  // Convert to percentage
  const edgeScore = Math.max(-15, Math.min(15, (edgePercent / 10) * 15))
  
  // ============================================
  // SPREAD QUALITY BONUS: up to +10 points
  // ============================================
  // Tight spreads (≤ 10 pts) with good cover probability (55%+) are where
  // our Elo model is most accurate. These bets deserve a scoring boost because:
  // 1. Elo predicts close games much better than blowouts
  // 2. Tight spreads have more reliable cover rates historically
  // 3. 55%+ cover prob on a tight spread is a genuine, bankable edge
  //
  // Formula: probability bonus + spread tightness bonus
  // - Probability part: (coverProb% - 55) * 1.0 (rewards higher probability)
  // - Tightness part: (10 - spreadSize) * 0.5 (rewards tighter spreads)
  // Examples:
  //   -3.5 spread, 57.7% prob = (2.7) + (3.25) = +5.95
  //   -5.5 spread, 57.6% prob = (2.6) + (2.25) = +4.85
  //   -1.5 spread, 60.0% prob = (5.0) + (4.25) = +9.25
  //   +7.5 spread, 58.0% prob = (3.0) + (1.25) = +4.25
  //   +21.5 spread = no bonus (> 10 pts)
  let spreadQualityBonus = 0
  if (spreadSize !== undefined && spreadSize > 0 && spreadSize <= 10 && probPercent >= 55) {
    const probBonus = (probPercent - 55) * 1.0
    const tightnessBonus = (10 - spreadSize) * 0.5
    spreadQualityBonus = Math.min(10, probBonus + tightnessBonus)
  }
  
  // ============================================
  // SPREAD SIZE PENALTY: up to -20 points
  // ============================================
  // Large spreads on bad teams look like "value" but are unreliable.
  // Elo cover probability is less accurate on huge spreads because:
  // 1. Bad teams get blown out more often than Elo predicts
  // 2. Garbage time scoring inflates cover rates in historical data
  // 3. Vegas is better at pricing blowout games than close ones
  //
  // Penalty kicks in at spreads > 10 points:
  // 10 pts = 0 penalty, 15 pts = -5, 20 pts = -10, 25 pts = -15, 30+ pts = -20
  let spreadPenalty = 0
  if (spreadSize !== undefined && spreadSize > 10) {
    spreadPenalty = -Math.min(20, (spreadSize - 10) * 1.0)
  }
  
  // ============================================
  // ELO GAP PENALTY: up to -15 points
  // ============================================
  // When the Elo gap between teams is massive (300+), the model's probability
  // estimates become less reliable. Prefer games between more evenly matched teams.
  //
  // Penalty kicks in at Elo gap > 200:
  // 200 = 0, 300 = -5, 400 = -10, 500+ = -15
  let eloGapPenalty = 0
  if (eloGap !== undefined && eloGap > 200) {
    eloGapPenalty = -Math.min(15, (eloGap - 200) * 0.05)
  }
  
  // ============================================
  // UNDERDOG BLOWOUT PENALTY: up to -12 points
  // ============================================
  // Historical data: 3 of 12 losses were underdogs getting points that got
  // destroyed by 17-19 points (La Salle +5.5 lost by 19, SFA +2.5 lost by 17,
  // Miss State +7.5 lost by 18). The model gave these scores of 79-87.
  // When an underdog faces a team with a large Elo advantage, the spread
  // cover probability is unreliable — the better team can pull away at any time.
  //
  // Penalty applies when: isUnderdog=true AND eloGap > 150
  // Formula: -((eloGap - 150) * 0.04), capped at -12
  // Examples:
  //   eloGap 200, underdog = -(50 * 0.04) = -2 points
  //   eloGap 300, underdog = -(150 * 0.04) = -6 points
  //   eloGap 400, underdog = -(250 * 0.04) = -10 points
  //   eloGap 500+, underdog = -12 points (cap)
  let underdogBlowoutPenalty = 0
  if (isUnderdog && eloGap !== undefined && eloGap > 150) {
    underdogBlowoutPenalty = -Math.min(12, (eloGap - 150) * 0.04)
  }
  
  // ============================================
  // MONEYLINE PENALTY: -5 points
  // ============================================
  // Historical data: Moneylines are 5-4 (55.6%) with -13.4% ROI.
  // Spreads are 13-8 (61.9%) with +17.3% ROI.
  // Moneyline losses are expensive (full unit lost) while wins on favorites
  // pay less than a unit. This penalty pushes spreads into the top 4 over MLs.
  let moneylinePenalty = 0
  if (betType === 'moneyline') {
    moneylinePenalty = -5
  }
  
  // ============================================
  // SPORT PERFORMANCE MULTIPLIER
  // ============================================
  // Historical data by sport:
  //   NCAAB: 18-9 (67%) — model works well here
  //   NHL: 1-2 (33%) — model doesn't work for hockey
  //   La Liga/Soccer: 0-1 (0%) — model doesn't work for soccer
  // Apply a score multiplier so NCAAB picks naturally outrank non-NCAAB picks
  // unless the non-NCAAB edge is massive enough to overcome the penalty.
  let sportMultiplier = 1.0
  if (sport) {
    const sportLower = sport.toLowerCase()
    if (sportLower.includes('hockey') || sportLower.includes('nhl')) {
      sportMultiplier = 0.7  // 30% penalty for hockey — model doesn't work well here (1-2, 33%)
    } else if (sportLower.includes('soccer') || sportLower.includes('la_liga') || sportLower.includes('epl') || sportLower.includes('bundesliga') || sportLower.includes('serie_a') || sportLower.includes('ligue')) {
      sportMultiplier = 0.5  // 50% penalty for soccer — model doesn't work for soccer (0-1, 0%)
    }
    // NCAAB, NBA, NFL, MLB all stay at 1.0 (default)
  }
  
  // ============================================
  // TOTAL SCORE
  // ============================================
  // Base: kellyScore + probScore + roiScore + edgeScore (-50 to 90)
  // Bonus: spreadQualityBonus (+10 max for tight spreads with good prob)
  // Penalties: spreadPenalty (-20 max) + eloGapPenalty (-15 max) + moneylinePenalty (-5) + underdogBlowoutPenalty (-12 max)
  // Sport multiplier applied to final score to bias toward proven sports
  const rawScore = kellyScore + probScore + roiScore + edgeScore + spreadQualityBonus + spreadPenalty + eloGapPenalty + moneylinePenalty + underdogBlowoutPenalty
  return Math.round(rawScore * sportMultiplier)
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
  
  const normalizedTeam = team.toLowerCase()
  const isHomeTeam = team === game.homeTeam
  const isAwayTeam = team === game.awayTeam
  const isDraw = normalizedTeam === 'draw' || normalizedTeam === 'tie' || normalizedTeam === 'x'

  if (!isHomeTeam && !isAwayTeam && !isDraw) {
    return null
  }
  
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
    let teamNoVigProb: number
    let teamOutcome = homeOutcome
    let teamImplied = homeImplied

    if (isAwayTeam) {
      teamNoVigProb = noVig.away
      teamOutcome = awayOutcome
      teamImplied = awayImplied
    } else if (isDraw) {
      teamNoVigProb = noVig.draw
      teamOutcome = drawOutcome
      teamImplied = drawImplied
    } else {
      teamNoVigProb = noVig.home
      teamOutcome = homeOutcome
      teamImplied = homeImplied
    }
    
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
  
  const normalizedTeam = team.toLowerCase()
  const isDraw = normalizedTeam === 'draw' || normalizedTeam === 'tie' || normalizedTeam === 'x'
  
  for (const ml of game.moneylines) {
    const outcome = isDraw
      ? ml.outcomes.find(o => {
        const name = o.name.toLowerCase()
        return name === 'draw' || name === 'tie' || name === 'x'
      })
      : ml.outcomes.find(o => o.name === team)
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
  const isNeutralSite = game.isNeutralSite === true
  console.log(`[analyzeGame] Game: ${game.awayTeam} @ ${game.homeTeam}, sport="${game.sport}", eloLeague="${eloLeague || 'NONE'}"${isNeutralSite ? ', NEUTRAL SITE' : ''}`)
  
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
        
        // Extract starting pitcher data from ESPN probables (MLB)
        const enrichedGame = game as EnrichedGame
        const probables = enrichedGame.espnData?.probables || []
        const homePitcher = extractPitcherInfo(probables, game.homeTeam)
        const awayPitcher = extractPitcherInfo(probables, game.awayTeam)
        if (homePitcher || awayPitcher) {
          console.log(`[analyzeGame] Pitcher data: home=${homePitcher?.name || 'N/A'} (ERA ${homePitcher?.era ?? 'N/A'}), away=${awayPitcher?.name || 'N/A'} (ERA ${awayPitcher?.era ?? 'N/A'})`)
        }
        
        const injuryResult = await getEloWinProbabilityWithInjuries(
          eloLeague,
          game.homeTeam,
          game.awayTeam,
          injuries,
          homeTopScorers,
          awayTopScorers,
          homePitcher ?? undefined,
          awayPitcher ?? undefined,
          isNeutralSite
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
        eloResult = await getEloWinProbabilityByName(eloLeague, game.homeTeam, game.awayTeam, isNeutralSite)
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
      eloProbability = isHomeTeam ? eloResult.probability : (1 - eloResult.probability)
      eloConfidence = eloResult.confidence
      homeElo = eloResult.homeRating
      awayElo = eloResult.awayRating
      
      modelProbability = blendWithMarket(eloProbability, consensus.consensusProb, eloResult.confidence)
      
      if (eloResult.confidence === 'very_low' || eloResult.confidence === 'low') {
        console.log(`[analyzeGame] Blending Elo (${(eloProbability * 100).toFixed(1)}%) with market (${(consensus.consensusProb * 100).toFixed(1)}%) at ${eloResult.confidence} confidence → ${(modelProbability * 100).toFixed(1)}% for ${team} in ${game.homeTeam} vs ${game.awayTeam}`)
      }
    }
    
    // Calculate situational factors and apply adjustment to model probability
    // This accounts for back-to-back games, rest advantage, travel fatigue, etc.
    const eloLeagueForSituational = SPORT_TO_ELO_LEAGUE[game.sport] || game.sport
    const opponentName = isHomeTeam ? game.awayTeam : game.homeTeam
    
    // Get the correct lastGameDate based on which team we're analyzing
    const teamLastGameDate = isHomeTeam ? homeLastGameDate : awayLastGameDate
    const opponentLastGameDate = isHomeTeam ? awayLastGameDate : homeLastGameDate
    
    // Fetch last-10 record from Elo tracking for form analysis
    const teamLast10 = await getTeamLast10ByName(eloLeagueForSituational, team)
    
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
      game.commenceTime ? new Date(game.commenceTime) : null,
      teamLast10  // Last 10 game record from Elo tracking
    )
    
    const situationalAdj = calculateSituationalAdjustment(situationalFactors, eloLeagueForSituational, team, opponentName)
    
    // WIN PCT FIX: Apply calibration to moneyline probability (was only applied to spreads)
    // This corrects for systematic over/under-confidence based on historical accuracy
    const calibratedModelProbability = await getCalibratedProbability(modelProbability, game.sport)
    
    // Apply situational adjustment to calibrated model probability
    const adjustedModelProbability = applyAdjustment(calibratedModelProbability, situationalAdj.totalAdjustment)
    
    // Log significant situational adjustments
    if (Math.abs(situationalAdj.totalAdjustment) >= 0.02) {
      console.log(`[analyzeGame] Situational adjustment for ${team}: ${(situationalAdj.totalAdjustment * 100).toFixed(1)}%`)
      situationalAdj.notes.forEach(note => console.log(`  - ${note}`))
    }
    
    const edge = adjustedModelProbability - bestPrice.impliedProb
    
    if (edge > MAX_SANE_EDGE) {
      console.warn(`[analyzeGame] SANITY CHECK FAILED: ${team} ML has edge ${(edge * 100).toFixed(1)}% > ${(MAX_SANE_EDGE * 100).toFixed(0)}% max. Skipping.`)
      continue
    }
    
    // ELO CONFIDENCE GATE: Only recommend moneylines when Elo has enough data
    // 'very_low' = <5 games, 'low' = 5-9 games — these are essentially guesses.
    // With so few games, Elo hasn't converged and the blend is 70-85% market anyway.
    // Recommending based on unreliable Elo adds noise and hurts win rate.
    if (eloConfidence === 'very_low' || eloConfidence === 'low') {
      console.log(`[analyzeGame] Confidence gate rejection: ${team} ML — Elo confidence '${eloConfidence}' too low for moneyline`)
      continue
    }
    
    // MULTI-SIGNAL CONFIRMATION: Reject bets where signals disagree
    // This is the single most impactful filter for win percentage.
    // A bet should only be recommended when MULTIPLE independent signals agree:
    //   1. Elo model favors this team (eloProbability > 50%)
    //   2. Market consensus isn't too far off (consensus > 45%)
    //   3. Situational factors aren't negative (no back-to-back + travel fatigue against you)
    //   4. Sharp money isn't against you
    //
    // The old system would recommend a bet purely on edge size — even if Elo said 55%
    // but sharp money was moving the line against the team. Multi-signal kills these.
    if (eloProbability !== undefined && eloProbability < 0.50) {
      // Elo says this team is the underdog — don't recommend their ML even if market disagrees
      console.log(`[analyzeGame] Multi-signal rejection: ${team} ML — Elo probability ${(eloProbability * 100).toFixed(1)}% < 50%`)
      continue
    }
    if (consensus.consensusProb < 0.45) {
      // Market consensus says this team has less than 45% chance — too risky for ML
      console.log(`[analyzeGame] Multi-signal rejection: ${team} ML — market consensus ${(consensus.consensusProb * 100).toFixed(1)}% < 45%`)
      continue
    }
    if (situationalAdj.totalAdjustment < -0.03) {
      // Significant situational headwinds (B2B + travel + cold streak, etc.)
      console.log(`[analyzeGame] Multi-signal rejection: ${team} ML — situational adjustment ${(situationalAdj.totalAdjustment * 100).toFixed(1)}% < -3%`)
      continue
    }
    // Sharp money contra-filter: if sharp money is explicitly against this team, skip
    if (situationalFactors.sharpMoneyIndicator && situationalFactors.lineMovementDirection === 'away') {
      console.log(`[analyzeGame] Multi-signal rejection: ${team} ML — sharp money moving against`)
      continue
    }
    
    // CLV CHECK: If the line has moved significantly against our pick, skip
    // Closing Line Value is the #1 predictor of long-term betting profitability.
    // If the market is moving AWAY from our recommended side, sharps disagree with us.
    // We use line movement data (opening vs current) as a proxy for CLV direction.
    if (lineMovement) {
      const mlChange = isHomeTeam ? lineMovement.movement.homeMLChange : lineMovement.movement.awayMLChange
      // If our team's ML odds have gotten worse (more negative for favorites, less positive for dogs)
      // by a large margin, the market is moving against us
      if (mlChange !== undefined && mlChange < -15) {
        console.log(`[analyzeGame] CLV rejection: ${team} ML — line moved ${mlChange} against us (worse odds)`)
        continue
      }
    }
    
    // CONFERENCE STRENGTH DISCOUNT: For NCAAB/NCAAF, penalize teams near default Elo
    // Teams near 1500 Elo in college leagues often play in weak conferences.
    // Their Elo is inflated because they beat other weak teams.
    // When they face stronger competition, the model overestimates them.
    if ((eloLeague === 'NCAAB' || eloLeague === 'NCAAF') && homeElo && awayElo) {
      const teamElo = isHomeTeam ? homeElo : awayElo
      const opponentElo = isHomeTeam ? awayElo : homeElo
      // If BOTH teams are near default (1450-1550), neither has enough differentiation
      // to generate a reliable edge. Skip these "mid-major vs mid-major" matchups.
      if (teamElo > 1440 && teamElo < 1560 && opponentElo > 1440 && opponentElo < 1560) {
        console.log(`[analyzeGame] Conference strength rejection: ${team} ML — both teams near default Elo (${teamElo} vs ${opponentElo}), no reliable edge`)
        continue
      }
    }
    
    const ev = calculateExpectedValue(bestPrice.price, adjustedModelProbability)
    const roi = calculateROI(ev)
    
    if (adjustedModelProbability < MIN_PROBABILITY) continue
    if (edge < MIN_EDGE) continue
    if (ev <= 0) continue
    if (roi < 1) continue
    
    // Calculate score using EV-based scoring system with adjusted probability
    const eloGapForScore = homeElo && awayElo ? Math.abs(homeElo - awayElo) : undefined
    const score = calculateBetScore(adjustedModelProbability, edge, roi, undefined, eloGapForScore, game.sport, 'moneyline', undefined, bestPrice.price)
    
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
      eloProbability: eloProbability ? Math.round(adjustedModelProbability * 1000) / 10 : undefined,
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
        injuries: buildInjuryDisplay(team, injuries, eloResult, isHomeTeam)
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
      
      // WIN PCT FIX: Removed broken spread direction validation.
      // The old check compared raw Elo (without home advantage) to spread direction.
      // This incorrectly rejected valid home-favorite spread bets:
      //   Example: Home Elo 1480 vs Away 1500 → raw Elo says Away is better
      //   But with +55 NBA home advantage, Home effective = 1535 > 1500 → Home IS the Elo favorite
      //   Old code rejected Home -3.5 because "lower raw Elo but negative spread"
      // These disagreements between raw Elo and market are exactly where edges come from.
      // The MAX_SANE_EDGE filter (15%) is sufficient to catch truly bad data.
      
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
        teamSpecificSigma,  // FIX 2: Pass team-specific sigma for variance adjustment
        isNeutralSite
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
      const calibratedEloCoverProb = await getCalibratedProbability(rawEloCoverProb, game.sport)
      
      // FIX: Blend spread cover probability with market consensus (like moneylines and totals already do)
      // Without blending, the raw Elo model can disagree with the market by 10+ points on large
      // spreads (e.g., Duke -17.5 vs Notre Dame), producing inflated edges (30%+) that aren't real.
      const marketCoverProb = americanToImpliedProbability(bestEntry.outcome.price)
      const baseEloCoverProb = eloResult.confidence
        ? blendWithMarket(calibratedEloCoverProb, marketCoverProb, eloResult.confidence)
        : calibratedEloCoverProb
      
      // Apply situational factors to spread cover probability
      const opponentName = isHomeTeam ? game.awayTeam : game.homeTeam
      // Get the correct lastGameDate based on which team we're analyzing
      const spreadTeamLastGameDate = isHomeTeam ? homeLastGameDate : awayLastGameDate
      const spreadOpponentLastGameDate = isHomeTeam ? awayLastGameDate : homeLastGameDate
      
      // Fetch last-10 record for spread team
      const spreadTeamLast10 = await getTeamLast10ByName(eloLeague, teamName)
      
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
        game.commenceTime ? new Date(game.commenceTime) : null,
        spreadTeamLast10  // Last 10 game record from Elo tracking
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
        console.warn(`[analyzeGame] SANITY CHECK FAILED: ${teamName} spread ${point} has edge ${(edge * 100).toFixed(1)}% > ${(MAX_SANE_EDGE * 100).toFixed(0)}% max. Skipping.`)
        continue
      }
      
      // MULTI-SIGNAL: Reject spreads with major situational headwinds
      if (spreadSituationalAdj.totalAdjustment < -0.04) {
        console.log(`[analyzeGame] Multi-signal rejection: ${teamName} spread — situational ${(spreadSituationalAdj.totalAdjustment * 100).toFixed(1)}% < -4%`)
        continue
      }
      // MULTI-SIGNAL: Sharp money contra-filter for spreads
      if (spreadSituationalFactors.sharpMoneyIndicator && spreadSituationalFactors.lineMovementDirection === 'away') {
        console.log(`[analyzeGame] Multi-signal rejection: ${teamName} spread — sharp money moving against`)
        continue
      }
      
      // CLV CHECK for spreads: If spread line has moved significantly against our pick, skip
      if (lineMovement && lineMovement.movement.spreadChange !== undefined) {
        // For spreads, a negative spreadChange means the line moved toward the favorite
        // If we're betting the favorite and the spread got bigger (more points to cover), that's bad
        // If we're betting the underdog and the spread shrank (less points cushion), that's bad
        const spreadMoved = Math.abs(lineMovement.movement.spreadChange)
        if (spreadMoved >= 2.0 && lineMovement.movement.sharpIndicator) {
          console.log(`[analyzeGame] CLV rejection: ${teamName} spread — line moved ${spreadMoved} pts with sharp indicator`)
          continue
        }
      }
      
      // CONFERENCE STRENGTH for spreads: Skip college games where both teams are near default Elo
      if ((eloLeague === 'NCAAB' || eloLeague === 'NCAAF') && homeElo && awayElo) {
        if (homeElo > 1440 && homeElo < 1560 && awayElo > 1440 && awayElo < 1560) {
          console.log(`[analyzeGame] Conference strength rejection: ${teamName} spread — both teams near default Elo (${homeElo} vs ${awayElo})`)
          continue
        }
      }
      
      // Check juice constraint
      if (bestEntry.outcome.price < MAX_JUICE_ODDS) continue
      
      // Calculate score — penalize large spreads and huge Elo gaps
      const spreadSizeForScore = Math.abs(point)
      const eloGapForScore = homeElo && awayElo ? Math.abs(homeElo - awayElo) : undefined
      const score = calculateBetScore(eloCoverProb, edge, roi, spreadSizeForScore, eloGapForScore, game.sport, 'spread', point > 0, bestEntry.outcome.price)
      
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
          injuries: buildInjuryDisplay(teamName, injuries, eloResult, isHomeTeam)
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
    // WIN PCT FIX: Changed from forEach to for...of because we now use await inside (calibration)
    for (const [line, entries] of Array.from(totalLines.entries())) {
      // Separate over and under entries
      const overEntries = entries.filter(e => e.outcome.name.toLowerCase() === 'over')
      const underEntries = entries.filter(e => e.outcome.name.toLowerCase() === 'under')
      
      // Use effective ratings if available (injury-adjusted), otherwise use base ratings
      const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
      const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
      
      // Calculate situational factors for totals (weather is especially important for outdoor sports)
      // For totals, use home team's lastGameDate and away team's as opponent
      const totalHomeLast10 = await getTeamLast10ByName(eloLeague, game.homeTeam)
      
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
        game.commenceTime ? new Date(game.commenceTime) : null,
        totalHomeLast10  // Last 10 game record from Elo tracking
      )
      const totalSituationalAdj = calculateSituationalAdjustment(totalSituationalFactors, eloLeague, game.homeTeam, game.awayTeam)
      
      // PACE-OF-PLAY ADJUSTMENT: Use margin stats as a scoring pace proxy
      // Teams with high average margins (both positive for winners and negative for losers) 
      // tend to be in high-scoring games. We use the combined absolute margin to estimate
      // whether a game is likely to be high or low scoring relative to the total line.
      // This is the best proxy we have without external pace-of-play data.
      const homeMarginStats = await getTeamMarginStatsByName(eloLeague, game.homeTeam)
      const awayMarginStats = await getTeamMarginStatsByName(eloLeague, game.awayTeam)
      let paceAdjustment = 0
      if (homeMarginStats && awayMarginStats && homeMarginStats.marginCount >= 5 && awayMarginStats.marginCount >= 5) {
        // Combined average margin magnitude tells us about game scoring environment
        // High margin teams (both winning big or losing big) are in high-scoring games
        const homeAvgAbsMargin = Math.abs(homeMarginStats.avgMargin)
        const awayAvgAbsMargin = Math.abs(awayMarginStats.avgMargin)
        const combinedMarginMagnitude = homeAvgAbsMargin + awayAvgAbsMargin
        
        // League-specific pace thresholds
        const paceThresholds: Record<string, { high: number; low: number }> = {
          'NBA': { high: 16, low: 8 },      // NBA: high scoring, wide margins
          'NCAAB': { high: 18, low: 8 },     // College: even wider margins
          'NFL': { high: 14, low: 6 },       // NFL: tighter margins
          'NCAAF': { high: 20, low: 8 },     // College football: blowouts common
          'NHL': { high: 4, low: 1.5 },      // Hockey: tight margins
          'MLB': { high: 6, low: 2 },        // Baseball: moderate margins
        }
        const thresholds = paceThresholds[eloLeague] || { high: 14, low: 6 }
        
        if (combinedMarginMagnitude >= thresholds.high) {
          // Both teams in high-scoring environments → slight over bias (+1.5%)
          paceAdjustment = 0.015
        } else if (combinedMarginMagnitude <= thresholds.low) {
          // Both teams in low-scoring environments → slight under bias (-1.5%)
          paceAdjustment = -0.015
        }
        // Between thresholds: no adjustment (neutral pace)
      }
      
      // Analyze OVER bets
      if (overEntries.length > 0) {
        const bestOverEntry = overEntries.reduce((best, curr) => 
          curr.outcome.price > best.outcome.price ? curr : best
        )
        
        // Calculate Elo-based over probability and apply situational adjustment
        const overResult = calculateTotalProbability(homeElo, awayElo, line, eloLeague, true, isNeutralSite)
        const baseEloOverProb = overResult.probability
        
        // FIX 1: Blend totals probability with market consensus (like moneylines do)
        // The market implied probability is the best proxy for "consensus" on totals
        const marketOverProb = americanToImpliedProbability(bestOverEntry.outcome.price)
        const blendedOverProb = eloResult.confidence 
          ? blendWithMarket(baseEloOverProb, marketOverProb, eloResult.confidence)
          : baseEloOverProb
        // WIN PCT FIX: Apply calibration to totals (was only applied to spreads)
        const calibratedOverProb = await getCalibratedProbability(blendedOverProb, game.sport)
        // Apply pace adjustment: positive pace = high-scoring game = boosts over probability
        const paceAdjustedOverProb = applyAdjustment(calibratedOverProb, paceAdjustment)
        const eloOverProb = applyAdjustment(paceAdjustedOverProb, totalSituationalAdj.totalAdjustment)
        
        // Calculate implied probability from best price
        const impliedProb = marketOverProb
        
        // Edge is blended probability - implied probability
        const edge = eloOverProb - impliedProb
        
        // Calculate EV and ROI
        const ev = calculateExpectedValue(bestOverEntry.outcome.price, eloOverProb)
        const roi = calculateROI(ev)
        
        // FIX 2: Apply tighter total-specific thresholds to prevent inflated edges from dominating
        // SANITY CHECK: Reject bets with impossibly large edges (likely calculation errors)
        if (edge > MAX_SANE_EDGE) {
          console.warn(`[analyzeGame] SANITY CHECK FAILED: Over ${line} has edge ${(edge * 100).toFixed(1)}% > ${(MAX_SANE_EDGE * 100).toFixed(0)}% max. Skipping.`)
        // MULTI-SIGNAL: Reject totals with major situational headwinds
        } else if (totalSituationalAdj.totalAdjustment < -0.04) {
          console.log(`[analyzeGame] Multi-signal rejection: Over ${line} — situational ${(totalSituationalAdj.totalAdjustment * 100).toFixed(1)}% < -4%`)
        // MULTI-SIGNAL: Sharp money contra-filter for totals
        } else if (totalSituationalFactors.sharpMoneyIndicator && totalSituationalFactors.lineMovementDirection === 'away') {
          console.log(`[analyzeGame] Multi-signal rejection: Over ${line} — sharp money moving against`)
        } else if (eloOverProb >= MIN_TOTAL_PROBABILITY && edge >= MIN_TOTAL_EDGE && ev > 0 && roi >= MIN_TOTAL_ROI) {
          if (bestOverEntry.outcome.price >= MAX_JUICE_ODDS) {
            const score = calculateBetScore(eloOverProb, edge, roi, undefined, undefined, game.sport, 'total', undefined, bestOverEntry.outcome.price)
            
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
                injuries: buildInjuryDisplay(game.homeTeam, injuries, eloResult, true)
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
        const underResult = calculateTotalProbability(homeElo, awayElo, line, eloLeague, false, isNeutralSite)
        const baseEloUnderProb = underResult.probability
        
        // FIX 1: Blend totals probability with market consensus (like moneylines do)
        const marketUnderProb = americanToImpliedProbability(bestUnderEntry.outcome.price)
        const blendedUnderProb = eloResult.confidence 
          ? blendWithMarket(baseEloUnderProb, marketUnderProb, eloResult.confidence)
          : baseEloUnderProb
        // WIN PCT FIX: Apply calibration to totals (was only applied to spreads)
        const calibratedUnderProb = await getCalibratedProbability(blendedUnderProb, game.sport)
        // Apply pace adjustment: negative pace = low-scoring game = boosts under probability
        const paceAdjustedUnderProb = applyAdjustment(calibratedUnderProb, -paceAdjustment)
        const eloUnderProb = applyAdjustment(paceAdjustedUnderProb, totalSituationalAdj.totalAdjustment)
        
        // Calculate implied probability from best price
        const impliedProb = marketUnderProb
        
        // Edge is blended probability - implied probability
        const edge = eloUnderProb - impliedProb
        
        // Calculate EV and ROI
        const ev = calculateExpectedValue(bestUnderEntry.outcome.price, eloUnderProb)
        const roi = calculateROI(ev)
        
        // FIX 2: Apply tighter total-specific thresholds to prevent inflated edges from dominating
        // SANITY CHECK: Reject bets with impossibly large edges (likely calculation errors)
        if (edge > MAX_SANE_EDGE) {
          console.warn(`[analyzeGame] SANITY CHECK FAILED: Under ${line} has edge ${(edge * 100).toFixed(1)}% > ${(MAX_SANE_EDGE * 100).toFixed(0)}% max. Skipping.`)
        // MULTI-SIGNAL: Reject totals with major situational headwinds
        } else if (totalSituationalAdj.totalAdjustment < -0.04) {
          console.log(`[analyzeGame] Multi-signal rejection: Under ${line} — situational ${(totalSituationalAdj.totalAdjustment * 100).toFixed(1)}% < -4%`)
        // MULTI-SIGNAL: Sharp money contra-filter for totals
        } else if (totalSituationalFactors.sharpMoneyIndicator && totalSituationalFactors.lineMovementDirection === 'away') {
          console.log(`[analyzeGame] Multi-signal rejection: Under ${line} — sharp money moving against`)
        } else if (eloUnderProb >= MIN_TOTAL_PROBABILITY && edge >= MIN_TOTAL_EDGE && ev > 0 && roi >= MIN_TOTAL_ROI) {
          if (bestUnderEntry.outcome.price >= MAX_JUICE_ODDS) {
            const score = calculateBetScore(eloUnderProb, edge, roi, undefined, undefined, game.sport, 'total', undefined, bestUnderEntry.outcome.price)
            
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
                injuries: buildInjuryDisplay(game.homeTeam, injuries, eloResult, true)
              },
              calculatedAt: now
            })
          }
        }
      }
    }
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
async function analyzeGameForSportQuery(game: Game, injuries?: InjuryInfo[], homeLastGameDate?: string | null, awayLastGameDate?: string | null, skipStartedCheck?: boolean): Promise<RankedBet[]> {
  const rankedBets: RankedBet[] = []
  const now = new Date().toISOString()
  
  // Skip games that have already started (unless caller explicitly opts out, e.g. specific game queries)
  if (!skipStartedCheck && new Date(game.commenceTime) < new Date()) {
    return []
  }
  
  // Check what odds data we have — don't require moneylines for spread/total analysis
  const hasMoneylines = game.moneylines && game.moneylines.length > 0
  const hasSpreads = game.spreads && game.spreads.length > 0
  const hasTotals = game.totals && game.totals.length > 0
  
  if (!hasMoneylines && !hasSpreads && !hasTotals) {
    console.log(`[analyzeGameForSportQuery] No odds data at all for ${game.awayTeam} @ ${game.homeTeam}`)
    return []
  }
  
  if (!hasMoneylines) {
    console.log(`[analyzeGameForSportQuery] No moneylines for ${game.awayTeam} @ ${game.homeTeam}, but has spreads=${hasSpreads} totals=${hasTotals} — proceeding with available data`)
  }
  
  // Get Elo prediction for this game (if available)
  const eloLeague = SPORT_TO_ELO_LEAGUE[game.sport]
  const isNeutralSite = game.isNeutralSite === true
  console.log(`[analyzeGameForSportQuery] Game: ${game.awayTeam} @ ${game.homeTeam}, sport=${game.sport}, sportName=${game.sportName}, eloLeague=${eloLeague || 'NONE'}${isNeutralSite ? ', NEUTRAL SITE' : ''}`)
  
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
        
        // Extract starting pitcher data from ESPN probables (MLB)
        const enrichedGame = game as EnrichedGame
        const probables = enrichedGame.espnData?.probables || []
        const homePitcher = extractPitcherInfo(probables, game.homeTeam)
        const awayPitcher = extractPitcherInfo(probables, game.awayTeam)
        if (homePitcher || awayPitcher) {
          console.log(`[analyzeGameForSportQuery] Pitcher data: home=${homePitcher?.name || 'N/A'} (ERA ${homePitcher?.era ?? 'N/A'}), away=${awayPitcher?.name || 'N/A'} (ERA ${awayPitcher?.era ?? 'N/A'})`)
        }
        
        const injuryResult = await getEloWinProbabilityWithInjuries(
          eloLeague,
          game.homeTeam,
          game.awayTeam,
          injuries,
          homeTopScorers,
          awayTopScorers,
          homePitcher ?? undefined,
          awayPitcher ?? undefined,
          isNeutralSite
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
        eloResult = await getEloWinProbabilityByName(eloLeague, game.homeTeam, game.awayTeam, isNeutralSite)
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
  
  // For specific game queries (skipStartedCheck=true), proceed even without Elo
  // The caller (analyzeSpecificGame) fetches Elo independently and includes it in the result
  // For sport-wide queries, Elo is required to produce meaningful recommendations
  if (!eloResult && !skipStartedCheck) {
    console.log(`[analyzeGameForSportQuery] No Elo data available for ${game.homeTeam} vs ${game.awayTeam} (${game.sportName}) — skipping (not a specific game query)`)
    return []
  }
  
  if (!eloResult) {
    console.log(`[analyzeGameForSportQuery] No Elo data for ${game.homeTeam} vs ${game.awayTeam} — continuing anyway for specific game query`)
  }
  
  if (eloResult?.confidence === 'very_low') {
    console.log(`[analyzeGameForSportQuery] Using Elo with very_low confidence for ${game.homeTeam} vs ${game.awayTeam} (${game.sportName})`)
  }
  
  // ============================================
  // MONEYLINE ANALYSIS
  // ============================================
  // Analyze both teams - NO strict filters, just basic requirements
  // Only run if we have moneyline data
  if (!hasMoneylines) {
    console.log(`[analyzeGameForSportQuery] Skipping moneyline analysis — no moneyline odds available`)
  }
  for (const team of [game.homeTeam, game.awayTeam]) {
    if (!hasMoneylines) break
    // For sport-wide queries, require Elo (it's our value-add over raw market odds)
    // For specific game queries, proceed with market consensus if no Elo
    if (!eloResult && !skipStartedCheck) break
    
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
    
    // Calculate model probability: blend Elo with market if Elo available, else pure market consensus
    let modelProbability: number
    let eloProbability: number | undefined
    
    if (eloResult) {
      eloProbability = isHomeTeam ? eloResult.probability : (1 - eloResult.probability)
      modelProbability = blendWithMarket(eloProbability, consensusProb, eloResult.confidence)
      
      if (eloResult.confidence === 'very_low' || eloResult.confidence === 'low') {
        console.log(`[analyzeGameForSportQuery] Blending Elo (${(eloProbability * 100).toFixed(1)}%) with market (${(consensusProb * 100).toFixed(1)}%) at ${eloResult.confidence} confidence → ${(modelProbability * 100).toFixed(1)}% for ${team}`)
      }
    } else {
      // No Elo — use pure market consensus for specific game queries
      modelProbability = consensusProb
      console.log(`[analyzeGameForSportQuery] No Elo, using market consensus (${(consensusProb * 100).toFixed(1)}%) for ${team} in ${game.homeTeam} vs ${game.awayTeam}`)
    }
    
    const eloLeagueForSituational = SPORT_TO_ELO_LEAGUE[game.sport] || game.sport
    const opponentName = isHomeTeam ? game.awayTeam : game.homeTeam
    const teamLastGameDate = isHomeTeam ? homeLastGameDate : awayLastGameDate
    const opponentLastGameDateForTeam = isHomeTeam ? awayLastGameDate : homeLastGameDate
    
    // Fetch last-10 record for sport query team
    const sportQueryTeamLast10 = await getTeamLast10ByName(eloLeagueForSituational, team)
    
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
      game.commenceTime ? new Date(game.commenceTime) : null,
      sportQueryTeamLast10  // Last 10 game record from Elo tracking
    )
    
    const situationalAdj = calculateSituationalAdjustment(situationalFactors, eloLeagueForSituational, team, opponentName)
    modelProbability = applyAdjustment(modelProbability, situationalAdj.totalAdjustment)
    
    const edge = modelProbability - bestPrice.impliedProb
    
    if (edge > MAX_SANE_EDGE) {
      console.warn(`[analyzeGameForSportQuery] SANITY CHECK FAILED: ${team} ML has edge ${(edge * 100).toFixed(1)}% > 25% max. Skipping.`)
      continue
    }
    
    const ev = calculateExpectedValue(bestPrice.price, modelProbability)
    const roi = calculateROI(ev)
    const sportQueryEloGap = eloResult?.homeRating && eloResult?.awayRating ? Math.abs(eloResult.homeRating - eloResult.awayRating) : undefined
    const score = calculateBetScore(modelProbability, edge, roi, undefined, sportQueryEloGap, game.sport, 'moneyline', undefined, bestPrice.price)
    
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
      eloProbability: eloProbability !== undefined ? Math.round(modelProbability * 1000) / 10 : undefined,
      eloConfidence: eloResult?.confidence,
      homeElo: eloResult?.homeRating,
      awayElo: eloResult?.awayRating,
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
  // SPREAD ANALYSIS - uses Elo-based cover probability when available
  // For specific game queries without Elo, uses market implied probability
  // ============================================
  // For sport-wide queries, require Elo (it's our value-add)
  const hasSpreadData = game.spreads && game.spreads.length > 0
  const canAnalyzeSpreads = hasSpreadData && (eloResult || skipStartedCheck)
  if (canAnalyzeSpreads) {
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
      
      // FILTER 1: Skip NHL puck lines entirely (use moneylines only) — only when we have Elo
      if (eloResult) {
        const minMarginEdge = MIN_SPREAD_MARGIN_EDGE[eloLeague] || 2
        if (minMarginEdge >= 999) {
          return
        }
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
      
      const marketCoverProb = americanToImpliedProbability(bestEntry.outcome.price)
      
      let coverProb: number
      let spreadConfidence: string | undefined
      let homeEloRating: number | undefined
      let awayEloRating: number | undefined
      let hasEloAnalysis = false
      
      if (eloResult) {
        // Full Elo analysis
        const homeElo = eloResult.homeEffectiveRating ?? eloResult.homeRating
        const awayElo = eloResult.awayEffectiveRating ?? eloResult.awayRating
        homeEloRating = homeElo
        awayEloRating = awayElo
        
        const spreadFromHomePerspective = isHomeTeam ? point : -point
        
        const spreadResult = calculateSpreadCoverProbability(
          homeElo,
          awayElo,
          spreadFromHomePerspective,
          eloLeague,
          isHomeTeam,
          undefined,  // teamSpecificSigma
          isNeutralSite
        )
        
        // FILTER 2: Check margin edge — only when we have Elo
        const minMarginEdge = MIN_SPREAD_MARGIN_EDGE[eloLeague] || 2
        const expectedMargin = spreadResult.expectedMargin
        const marketSpread = spreadFromHomePerspective
        const marginEdge = Math.abs(expectedMargin - (-marketSpread))
        
        if (marginEdge < minMarginEdge) {
          return
        }
        
        const rawEloCoverProb = spreadResult.probability
        coverProb = eloResult.confidence
          ? blendWithMarket(rawEloCoverProb, marketCoverProb, eloResult.confidence)
          : rawEloCoverProb
        spreadConfidence = spreadResult.confidence
        hasEloAnalysis = true
      } else {
        // No Elo — use market implied probability for specific game queries
        coverProb = marketCoverProb
        console.log(`[analyzeGameForSportQuery] No Elo for spread analysis, using market implied prob (${(marketCoverProb * 100).toFixed(1)}%) for ${teamName} ${point > 0 ? '+' : ''}${point}`)
      }
      
      const impliedProb = marketCoverProb
      const edge = coverProb - impliedProb
      
      // SANITY CHECK: Reject spreads with impossibly large edges (likely Elo miscalibration)
      // This was missing from the sport query path, allowing 20%+ phantom edges through
      if (edge > MAX_SANE_EDGE) {
        console.warn(`[analyzeGameForSportQuery] SANITY CHECK FAILED: ${teamName} spread ${point > 0 ? '+' : ''}${point} has edge ${(edge * 100).toFixed(1)}% > ${(MAX_SANE_EDGE * 100).toFixed(0)}% max. Skipping.`)
        return
      }
      
      const ev = calculateExpectedValue(bestEntry.outcome.price, coverProb)
      const roi = calculateROI(ev)
      const sportQuerySpreadSize = Math.abs(point)
      const sportQuerySpreadEloGap = homeEloRating && awayEloRating ? Math.abs(homeEloRating - awayEloRating) : undefined
      const score = calculateBetScore(coverProb, edge, roi, sportQuerySpreadSize, sportQuerySpreadEloGap, game.sport, 'spread', point > 0, bestEntry.outcome.price)
      
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
        consensusProbability: Math.round(coverProb * 1000) / 10,
        bestPrice: bestEntry.outcome.price,
        bestBook: bestEntry.book,
        impliedProbability: Math.round(impliedProb * 1000) / 10,
        edge: Math.round(edge * 1000) / 10,
        eloProbability: hasEloAnalysis ? Math.round(coverProb * 1000) / 10 : undefined,
        eloConfidence: spreadConfidence,
        homeElo: homeEloRating,
        awayElo: awayEloRating,
        expectedValue: Math.round(ev * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        allBookPrices,
        score,
        calculatedAt: now
      })
    })
  }
  
  // ============================================
  // TOTAL (OVER/UNDER) ANALYSIS - uses Elo-based total probability when available
  // For specific game queries without Elo, uses market implied probability
  // ============================================
  const hasTotalData = game.totals && game.totals.length > 0
  const canAnalyzeTotals = hasTotalData && (eloResult || skipStartedCheck)
  if (canAnalyzeTotals) {
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
    const homeEloForTotals = eloResult ? (eloResult.homeEffectiveRating ?? eloResult.homeRating) : undefined
    const awayEloForTotals = eloResult ? (eloResult.awayEffectiveRating ?? eloResult.awayRating) : undefined
    
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
          const marketOverProb = americanToImpliedProbability(bestOverEntry.outcome.price)
          
          let overProb: number
          let overConfidence: string | undefined
          let hasEloTotal = false
          
          if (eloResult && homeEloForTotals !== undefined && awayEloForTotals !== undefined) {
            // Full Elo analysis
            const overResult = calculateTotalProbability(homeEloForTotals, awayEloForTotals, line, eloLeague, true, isNeutralSite)
            const baseEloOverProb = overResult.probability
            overProb = eloResult.confidence 
              ? blendWithMarket(baseEloOverProb, marketOverProb, eloResult.confidence)
              : baseEloOverProb
            overConfidence = overResult.confidence
            hasEloTotal = true
          } else {
            // No Elo — use market implied probability
            overProb = marketOverProb
            console.log(`[analyzeGameForSportQuery] No Elo for total analysis, using market implied prob (${(marketOverProb * 100).toFixed(1)}%) for Over ${line}`)
          }
          
          const impliedProb = marketOverProb
          const edge = overProb - impliedProb
          const ev = calculateExpectedValue(bestOverEntry.outcome.price, overProb)
          const roi = calculateROI(ev)
          const score = calculateBetScore(overProb, edge, roi, undefined, undefined, game.sport, 'total', undefined, bestOverEntry.outcome.price)
          
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
            consensusProbability: Math.round(overProb * 1000) / 10,
            bestPrice: bestOverEntry.outcome.price,
            bestBook: bestOverEntry.book,
            impliedProbability: Math.round(impliedProb * 1000) / 10,
            edge: Math.round(edge * 1000) / 10,
            eloProbability: hasEloTotal ? Math.round(overProb * 1000) / 10 : undefined,
            eloConfidence: overConfidence,
            homeElo: homeEloForTotals,
            awayElo: awayEloForTotals,
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
          const marketUnderProb = americanToImpliedProbability(bestUnderEntry.outcome.price)
          
          let underProb: number
          let underConfidence: string | undefined
          let hasEloTotal = false
          
          if (eloResult && homeEloForTotals !== undefined && awayEloForTotals !== undefined) {
            // Full Elo analysis
            const underResult = calculateTotalProbability(homeEloForTotals, awayEloForTotals, line, eloLeague, false, isNeutralSite)
            const baseEloUnderProb = underResult.probability
            underProb = eloResult.confidence 
              ? blendWithMarket(baseEloUnderProb, marketUnderProb, eloResult.confidence)
              : baseEloUnderProb
            underConfidence = underResult.confidence
            hasEloTotal = true
          } else {
            // No Elo — use market implied probability
            underProb = marketUnderProb
            console.log(`[analyzeGameForSportQuery] No Elo for total analysis, using market implied prob (${(marketUnderProb * 100).toFixed(1)}%) for Under ${line}`)
          }
          
          const impliedProb = marketUnderProb
          const edge = underProb - impliedProb
          const ev = calculateExpectedValue(bestUnderEntry.outcome.price, underProb)
          const roi = calculateROI(ev)
          const score = calculateBetScore(underProb, edge, roi, undefined, undefined, game.sport, 'total', undefined, bestUnderEntry.outcome.price)
          
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
            consensusProbability: Math.round(underProb * 1000) / 10,
            bestPrice: bestUnderEntry.outcome.price,
            bestBook: bestUnderEntry.book,
            impliedProbability: Math.round(impliedProb * 1000) / 10,
            edge: Math.round(edge * 1000) / 10,
            eloProbability: hasEloTotal ? Math.round(underProb * 1000) / 10 : undefined,
            eloConfidence: underConfidence,
            homeElo: homeEloForTotals,
            awayElo: awayEloForTotals,
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
    if (teamScheduleData && teamScheduleData.teams) {
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
    const enrichedGame = games.find(g => g.id === bet.gameId) as EnrichedGame | undefined
    const espnInjuries = enrichedGame?.espnData?.injuries || []
    const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
    
    // Count key players OUT/Doubtful for the bet's team
    const teamNorm = bet.team.toLowerCase().replace(/[^a-z0-9]/g, '')
    const teamOutCount = injuries.filter(inj => {
      const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
      const isTeam = injTeamNorm.includes(teamNorm) || teamNorm.includes(injTeamNorm)
      const s = inj.status.toLowerCase()
      const isOut = s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir'
      return isTeam && isOut
    }).length
    
    // DISQUALIFY moneyline bets if star player is OUT
    if (bet.betType === 'moneyline') {
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED (ranked): ${bet.team} ML - star player ${starOut} is OUT`)
        continue
      }
    }
    
    // DISQUALIFY spread bets if star player is OUT or 3+ key players are OUT
    // A team missing its star or multiple rotation players is fundamentally different
    if (bet.betType === 'spread') {
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED (ranked): ${bet.team} spread - star player ${starOut} is OUT`)
        continue
      }
      if (teamOutCount >= 3) {
        console.log(`[computeBestBets] DISQUALIFIED (ranked): ${bet.team} spread - ${teamOutCount} key players OUT (depth crisis)`)
        continue
      }
    }
    
    // DISQUALIFY totals bets if EITHER team has 3+ key players OUT
    // Missing multiple players dramatically changes scoring dynamics
    if (bet.betType === 'total') {
      const homeTeamNorm = (enrichedGame?.homeTeam || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const awayTeamNorm = (enrichedGame?.awayTeam || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const homeOutCount = injuries.filter(inj => {
        const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
        const isTeam = injTeamNorm.includes(homeTeamNorm) || homeTeamNorm.includes(injTeamNorm)
        const s = inj.status.toLowerCase()
        return isTeam && (s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir')
      }).length
      const awayOutCount = injuries.filter(inj => {
        const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
        const isTeam = injTeamNorm.includes(awayTeamNorm) || awayTeamNorm.includes(injTeamNorm)
        const s = inj.status.toLowerCase()
        return isTeam && (s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir')
      }).length
      if (homeOutCount >= 4 || awayOutCount >= 4) {
        console.log(`[computeBestBets] DISQUALIFIED (ranked): ${bet.homeTeam} vs ${bet.awayTeam} total - home ${homeOutCount} / away ${awayOutCount} key players OUT`)
        continue
      }
    }
    
    filteredRankedBets.push(bet)
  }
  
  // CRITICAL FIX: Also filter allEloBets for star player injuries
  // This ensures sport-specific queries (e.g., "best NBA bet today") don't recommend
  // teams with star players OUT. Previously only allRankedBets was filtered.
  const filteredEloBets: RankedBet[] = []
  for (const bet of allEloBets) {
    const enrichedGame = games.find(g => g.id === bet.gameId) as EnrichedGame | undefined
    const espnInjuries = enrichedGame?.espnData?.injuries || []
    const injuries = convertESPNInjuriesToInjuryInfo(espnInjuries)
    
    // Count key players OUT/Doubtful for the bet's team
    const teamNorm = bet.team.toLowerCase().replace(/[^a-z0-9]/g, '')
    const teamOutCount = injuries.filter(inj => {
      const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
      const isTeam = injTeamNorm.includes(teamNorm) || teamNorm.includes(injTeamNorm)
      const s = inj.status.toLowerCase()
      const isOut = s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir'
      return isTeam && isOut
    }).length
    
    // DISQUALIFY moneyline bets if star player is OUT
    if (bet.betType === 'moneyline') {
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED (elo): ${bet.team} ML - star player ${starOut} is OUT`)
        continue
      }
    }
    
    // DISQUALIFY spread bets if star player is OUT or 3+ key players are OUT
    if (bet.betType === 'spread') {
      const starOut = await getStarPlayerOut(bet.team, bet.sport, injuries)
      if (starOut) {
        console.log(`[computeBestBets] DISQUALIFIED (elo): ${bet.team} spread - star player ${starOut} is OUT`)
        continue
      }
      if (teamOutCount >= 3) {
        console.log(`[computeBestBets] DISQUALIFIED (elo): ${bet.team} spread - ${teamOutCount} key players OUT (depth crisis)`)
        continue
      }
    }
    
    // DISQUALIFY totals bets if EITHER team has 4+ key players OUT
    if (bet.betType === 'total') {
      const homeTeamNorm = (enrichedGame?.homeTeam || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const awayTeamNorm = (enrichedGame?.awayTeam || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const homeOutCount = injuries.filter(inj => {
        const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
        const isTeam = injTeamNorm.includes(homeTeamNorm) || homeTeamNorm.includes(injTeamNorm)
        const s = inj.status.toLowerCase()
        return isTeam && (s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir')
      }).length
      const awayOutCount = injuries.filter(inj => {
        const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
        const isTeam = injTeamNorm.includes(awayTeamNorm) || awayTeamNorm.includes(injTeamNorm)
        const s = inj.status.toLowerCase()
        return isTeam && (s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir')
      }).length
      if (homeOutCount >= 4 || awayOutCount >= 4) {
        console.log(`[computeBestBets] DISQUALIFIED (elo): ${bet.homeTeam} vs ${bet.awayTeam} total - home ${homeOutCount} / away ${awayOutCount} key players OUT`)
        continue
      }
    }
    
    filteredEloBets.push(bet)
  }
  
  // Sort ranked bets by score (desc), then by game time (asc) for stable tiebreaker
  filteredRankedBets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  // Build Elo-powered fallback bets from filteredEloBets
  // This ensures fallback recommendations are also backed by our Elo model
  const eloFallbackBets: FallbackBet[] = filteredEloBets.map(bet => {
    const prob = bet.eloProbability !== undefined ? bet.eloProbability / 100 : bet.consensusProbability / 100
    const disqualifyReasons: string[] = []
    if (bet.bestPrice < MAX_JUICE_ODDS) {
      disqualifyReasons.push(`Odds ${bet.bestPrice} worse than -250 limit`)
    }
    if (prob < MIN_PROBABILITY) {
      disqualifyReasons.push(`Probability ${(prob * 100).toFixed(1)}% < 52% min`)
    }
    if (bet.roi < MIN_ROI) {
      disqualifyReasons.push(`ROI ${bet.roi.toFixed(1)}% worse than -4.5% floor`)
    }
    const isValuePlay = prob >= VALUE_PLAY_MIN_PROB && bet.roi >= VALUE_PLAY_MIN_ROI
    return {
      gameId: bet.gameId,
      sport: bet.sport,
      sportName: bet.sportName,
      homeTeam: bet.homeTeam,
      awayTeam: bet.awayTeam,
      commenceTime: bet.commenceTime,
      team: bet.team,
      consensusProbability: bet.consensusProbability,
      bestPrice: bet.bestPrice,
      bestBook: bet.bestBook,
      impliedProbability: bet.impliedProbability,
      edge: bet.edge,
      expectedValue: bet.expectedValue,
      roi: bet.roi,
      score: bet.score,
      disqualifyReasons,
      isValuePlay,
      eloProbability: bet.eloProbability,
      eloConfidence: bet.eloConfidence,
      homeElo: bet.homeElo,
      awayElo: bet.awayElo,
    }
  })

  // Sort Elo-powered fallback bets by score for fallback selection
  eloFallbackBets.sort((a, b) => {
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
  
  // ============================================
  // TIERED CONFIDENCE SYSTEM
  // ============================================
  // Simple score-based tiering: the top 4 picks by score get premium labels.
  // The score already incorporates probability, edge, Kelly fraction, ROI,
  // sport penalties, and situational factors — no need for extra quality gates.
  //
  // LOCK OF THE DAY: #1 pick by score (max 1/day)
  // STRONG PLAY: #2-4 picks by score (max 3/day)
  // VALUE SPOT: everything else (internal only)
  
  const MAX_LOCKS = 1
  const MAX_STRONG = 3
  let lockCount = 0
  let strongCount = 0
  
  // Sort by score descending BEFORE tiering so the best picks get lock/strong slots first.
  // Without this, the order of processing determines who gets the limited lock slots,
  // which could promote a Score 73 pick to Lock while demoting a Score 82 pick to Strong.
  const sortedEloPoweredBets = [...eloPoweredBets].sort((a, b) => b.score - a.score)
  
  // Bets are already sorted by score descending. Assign tiers purely by rank.
  const tieredBets: RankedBet[] = sortedEloPoweredBets.map(bet => {
    let tier: 'lock' | 'strong' | 'value'
    if (lockCount < MAX_LOCKS) {
      tier = 'lock'
      lockCount++
    } else if (strongCount < MAX_STRONG) {
      tier = 'strong'
      strongCount++
    } else {
      tier = 'value'
    }
    
    return { ...bet, confidenceTier: tier }
  })
  
  // Sort: locks first, then strong, then value, each sub-sorted by score
  const tierOrder: Record<string, number> = { lock: 0, strong: 1, value: 2 }
  tieredBets.sort((a, b) => {
    const tierDiff = (tierOrder[a.confidenceTier || 'value'] || 2) - (tierOrder[b.confidenceTier || 'value'] || 2)
    if (tierDiff !== 0) return tierDiff
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  const bestBet = tieredBets[0] || null
  const runnerUp = tieredBets[1] || null
  
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
  
  if (!bestBet && eloFallbackBets.length > 0) {
    // Attempt 1: Standard filters - find bets that pass all filters
    let passingBets = eloFallbackBets.filter(b => passesFilters(b, false, MIN_ROI, false))
    
    // Attempt 2: Relax ROI to -6%
    if (passingBets.length === 0) {
      passingBets = eloFallbackBets.filter(b => passesFilters(b, false, FALLBACK_ROI_RELAXED_1, false))
    }
    
    // Attempt 3: Relax ROI to -8%
    if (passingBets.length === 0) {
      passingBets = eloFallbackBets.filter(b => passesFilters(b, false, FALLBACK_ROI_RELAXED_2, false))
    }
    
    // Attempt 4: Relax odds to -300
    if (passingBets.length === 0) {
      passingBets = eloFallbackBets.filter(b => passesFilters(b, true, FALLBACK_ROI_RELAXED_2, false))
    }
    
    // Attempt 5: Relax prob to 50%
    if (passingBets.length === 0) {
      passingBets = eloFallbackBets.filter(b => passesFilters(b, true, FALLBACK_ROI_RELAXED_2, true))
    }
    
    // closestMisses = bets that passed progressive filters, sorted by score
    closestMisses = passingBets.slice(0, 5)
    
    // mostLikelyWinners = highest score bets with reasonable odds (for context)
    // Sort by score (which weights edge, probability, and ROI) not raw probability,
    // so a 64.9% pick with 12.6% edge ranks above a 68% pick with 2.4% edge
    mostLikelyWinners = eloFallbackBets
      .filter(b => b.bestPrice >= MAX_JUICE_ODDS)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
  }
  
  // Sort filteredEloBets by score for sport-specific queries
  // CRITICAL: Use filteredEloBets (with star player filter applied) instead of allEloBets
  filteredEloBets.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  // ============================================
  // TIER allEloBets TOO (for model picks page)
  // ============================================
  // The strict analyzeGame() filters (confidence gate, multi-signal, CLV, conference strength)
  // reject many picks that the relaxed analyzeGameForSportQuery() accepts.
  // We need to tier allEloBets so the cron can store Lock/Strong picks from BOTH sources.
  //
  // CRITICAL FIX: Share the global lockCount/strongCount from the strict pass above.
  // Previously each pass had independent counters, so 2 locks from strict + 2 locks from
  // relaxed = 4 locks total, exceeding the intended cap. Now we use the same counters
  // so the combined total across both sources respects MAX_LOCKS and MAX_STRONG.
  const eloPoweredEloBets = filteredEloBets.filter(bet => bet.eloProbability !== undefined)
  
  // The strict pass already consumed lock/strong slots via the shared lockCount/strongCount
  // counters. For picks that appear in both strict and relaxed paths, we copy the strict
  // tier to keep them consistent.
  
  // Sort by score descending BEFORE tiering (same fix as strict bets above)
  const sortedEloPoweredEloBets = [...eloPoweredEloBets].sort((a, b) => b.score - a.score)
  
  // Bets are already sorted by score descending. Assign tiers purely by rank,
  // sharing the global lockCount/strongCount from the strict pass above.
  const tieredEloBets: RankedBet[] = sortedEloPoweredEloBets.map(bet => {
    // If this pick was already tiered in the strict pass, copy that tier to stay consistent
    const strictMatch = tieredBets.find(b => b.gameId === bet.gameId && b.team === bet.team && b.betType === bet.betType)
    if (strictMatch) {
      return { ...bet, confidenceTier: strictMatch.confidenceTier }
    }
    
    let tier: 'lock' | 'strong' | 'value'
    if (lockCount < MAX_LOCKS) {
      tier = 'lock'
      lockCount++
    } else if (strongCount < MAX_STRONG) {
      tier = 'strong'
      strongCount++
    } else {
      tier = 'value'
    }
    
    return { ...bet, confidenceTier: tier }
  })
  
  // Sort tieredEloBets: locks first, then strong, then value
  tieredEloBets.sort((a, b) => {
    const tierDiff = (tierOrder[a.confidenceTier || 'value'] || 2) - (tierOrder[b.confidenceTier || 'value'] || 2)
    if (tierDiff !== 0) return tierDiff
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  console.log(`[computeBestBets] Pre-global tiered strict bets: ${tieredBets.filter(b => b.confidenceTier === 'lock').length} locks, ${tieredBets.filter(b => b.confidenceTier === 'strong').length} strong, ${tieredBets.filter(b => b.confidenceTier === 'value').length} value`)
  console.log(`[computeBestBets] Pre-global tiered elo bets: ${tieredEloBets.filter(b => b.confidenceTier === 'lock').length} locks, ${tieredEloBets.filter(b => b.confidenceTier === 'strong').length} strong, ${tieredEloBets.filter(b => b.confidenceTier === 'value').length} value`)
  
  // ============================================
  // GLOBAL RE-TIERING: Ensure the BEST bets globally get lock/strong slots
  // ============================================
  // Problem: The strict path may assign strong slots to lower-quality bets (e.g., 
  // Northwestern score 53) via its shared counter, preventing higher-quality elo-only 
  // bets (e.g., Memphis score 81, 68% prob, 15% edge) from qualifying.
  //
  // Solution: Merge both paths, deduplicate (prefer strict version for consistency
  // with picks API display), sort by score, and re-tier from scratch. Then propagate
  // the new tiers back to both lists. This guarantees tier assignment uses the same
  // scores/data the user sees on the picks page.
  
  // Step 1: Merge + deduplicate
  // IMPORTANT: For bets that appear in both paths, prefer the STRICT path version.
  // The picks API also prefers strict over elo for display, so the tier assignment
  // must use the same version the user will see. Otherwise a bet can get Lock based
  // on its elo-path score (e.g., 89) but display with its strict-path score (e.g., 72),
  // making it look like a weaker bet got Lock over a stronger one.
  const allBetsMap = new Map<string, RankedBet>()
  // Add elo bets first
  for (const bet of tieredEloBets) {
    const key = `${bet.gameId}:${bet.team}:${bet.betType}`
    allBetsMap.set(key, bet)
  }
  // Then override with strict bets (strict takes priority for duplicates)
  for (const bet of tieredBets) {
    const key = `${bet.gameId}:${bet.team}:${bet.betType}`
    allBetsMap.set(key, bet)
  }
  
  // Step 2: Sort by score descending
  const allMergedBets = Array.from(allBetsMap.values()).sort((a, b) => b.score - a.score)
  
  // Step 3: Re-tier with fresh counters
  let globalLockCount = 0
  let globalStrongCount = 0
  const globalTierMap = new Map<string, 'lock' | 'strong' | 'value'>()
  
  // Assign tiers by score rank WITH same-game dedup — only 1 pick per gameId
  // can be Lock or Strong. This prevents correlated losses when the model likes
  // multiple bet types on the same game (e.g., Radford ML + Radford -2.5).
  // allMergedBets is already sorted by score descending.
  const globalTopTierGameIds = new Set<string>()
  for (const bet of allMergedBets) {
    const key = `${bet.gameId}:${bet.team}:${bet.betType}`
    
    // If this game already has a pick in Lock/Strong, skip to value tier
    if (globalTopTierGameIds.has(bet.gameId)) {
      globalTierMap.set(key, 'value')
      continue
    }
    
    if (globalLockCount < MAX_LOCKS) {
      globalTierMap.set(key, 'lock')
      globalLockCount++
      globalTopTierGameIds.add(bet.gameId)
    } else if (globalStrongCount < MAX_STRONG) {
      globalTierMap.set(key, 'strong')
      globalStrongCount++
      globalTopTierGameIds.add(bet.gameId)
    } else {
      globalTierMap.set(key, 'value')
    }
  }
  
  // Step 4: Propagate global tiers back to both lists
  for (const bet of tieredBets) {
    const key = `${bet.gameId}:${bet.team}:${bet.betType}`
    bet.confidenceTier = globalTierMap.get(key) || 'value'
  }
  for (const bet of tieredEloBets) {
    const key = `${bet.gameId}:${bet.team}:${bet.betType}`
    bet.confidenceTier = globalTierMap.get(key) || 'value'
  }
  
  // Re-sort both lists after tier update: locks first, then strong, then value
  tieredBets.sort((a, b) => {
    const tierDiff = (tierOrder[a.confidenceTier || 'value'] || 2) - (tierOrder[b.confidenceTier || 'value'] || 2)
    if (tierDiff !== 0) return tierDiff
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  tieredEloBets.sort((a, b) => {
    const tierDiff = (tierOrder[a.confidenceTier || 'value'] || 2) - (tierOrder[b.confidenceTier || 'value'] || 2)
    if (tierDiff !== 0) return tierDiff
    if (b.score !== a.score) return b.score - a.score
    return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
  })
  
  console.log(`[computeBestBets] Global re-tier: ${globalLockCount} locks, ${globalStrongCount} strong (from ${allMergedBets.length} unique bets)`)
  
  return {
    bestBet,
    runnerUp,
    allRankedBets: tieredBets,  // Tiered picks: lock > strong > value (from strict analyzeGame)
    allEloBets: tieredEloBets,  // Tiered picks from relaxed analyzeGameForSportQuery (star player filter applied)
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
  
  // Situational factors breakdown (rest days and injuries omitted from chat context - still used in Elo)
  lines.push('**SITUATIONAL FACTORS:**')
  lines.push('')
  if (bet.situationalBreakdown) {
    const formatAdj = (adj: number) => adj === 0 ? '0%' : `${adj > 0 ? '+' : ''}${adj.toFixed(1)}%`
    lines.push(`- Travel: ${bet.situationalBreakdown.travel.value} (${formatAdj(bet.situationalBreakdown.travel.adjustment)})`)
    lines.push(`- Recent form: ${bet.situationalBreakdown.recentForm.value} (${formatAdj(bet.situationalBreakdown.recentForm.adjustment)})`)
    lines.push(`- Weather: ${bet.situationalBreakdown.weather.value} (${formatAdj(bet.situationalBreakdown.weather.adjustment)})`)
    lines.push(`- Sharp money: ${bet.situationalBreakdown.sharpMoney.value} (${formatAdj(bet.situationalBreakdown.sharpMoney.adjustment)})`)
    lines.push(`- Motivation: ${bet.situationalBreakdown.motivation.value} (${formatAdj(bet.situationalBreakdown.motivation.adjustment)})`)
    lines.push('')
    const totalAdj = bet.situationalAdjustment ?? 0
    lines.push(`**Total adjustment: ${totalAdj > 0 ? '+' : ''}${totalAdj.toFixed(1)}%**`)
    if (bet.baseEloProbability !== undefined && bet.eloProbability !== undefined) {
      lines.push(`Base Elo probability: ${bet.baseEloProbability}% -> Adjusted: ${bet.eloProbability}%`)
    }
  } else if (bet.situationalNotes && bet.situationalNotes.length > 0) {
    for (const note of bet.situationalNotes) {
      if (/rest|injur/i.test(note)) continue
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
  // Raw Elo data — included even when no bets pass filters so LLM always has context
  eloData?: {
    homeRating: number
    awayRating: number
    homeWinProbability: number
    confidence: string
  }
  // Injury data for display in analysis
  injuries?: InjuryInfo[]
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
  
  // Always fetch Elo data independently so we can include it even if bet analysis fails
  const eloLeague = SPORT_TO_ELO_LEAGUE[game.sport]
  const isNeutralSite = game.isNeutralSite === true
  let eloData: GameAnalysisResult['eloData'] = undefined
  if (eloLeague) {
    try {
      const eloResult = await getEloWinProbabilityByName(eloLeague, game.homeTeam, game.awayTeam, isNeutralSite)
      if (eloResult) {
        eloData = {
          homeRating: eloResult.homeRating,
          awayRating: eloResult.awayRating,
          homeWinProbability: eloResult.probability,
          confidence: eloResult.confidence
        }
        console.log(`[analyzeSpecificGame] Elo data: ${game.homeTeam}=${eloResult.homeRating}, ${game.awayTeam}=${eloResult.awayRating}, homeWinProb=${(eloResult.probability * 100).toFixed(1)}%`)
      }
    } catch (err) {
      console.error(`[analyzeSpecificGame] Failed to fetch Elo data:`, err)
    }
  }

  // Use relaxed analysis (analyzeGameForSportQuery) instead of strict best-bet analysis (analyzeGame)
  // This ensures specific game queries always return full analysis (moneyline, spread, total)
  // even if no bets pass the strict "best bet of the day" filters.
  // Also skip the "started game" check — when a user asks about a specific game, they want analysis
  // regardless of whether it has started (the game may have JUST started or the time might be slightly off).
  const bets = await analyzeGameForSportQuery(game, injuriesToUse, null, null, true)
  
  console.log(`[analyzeSpecificGame] ${game.awayTeam} @ ${game.homeTeam}: ${bets.length} bets from relaxed analysis`)
  if (injuriesToUse && injuriesToUse.length > 0) {
    console.log(`[analyzeSpecificGame] ${injuriesToUse.length} injuries being passed to result for display`)
  }
  
  // If relaxed analysis also returned nothing (no Elo data or no moneyline odds),
  // try the strict analysis as a last resort (it handles market consensus fallback)
  let betsToUse = bets
  if (bets.length === 0) {
    console.log(`[analyzeSpecificGame] Relaxed analysis returned 0 bets, trying strict analysis as fallback`)
    const strictBets = await analyzeGame(game, injuriesToUse)
    betsToUse = strictBets
  }
  
  // FALLBACK 3: If both relaxed and strict analysis returned nothing,
  // build market-consensus bets from whatever raw odds data we have.
  // This ensures we ALWAYS return analysis for a specific game query.
  if (betsToUse.length === 0) {
    console.log(`[analyzeSpecificGame] Both analyses returned 0 bets, building market-consensus fallback bets`)
    const fallbackBets: RankedBet[] = []
    
    // Build moneyline bets from raw odds
    for (const ml of game.moneylines) {
      for (const outcome of ml.outcomes) {
        const impliedProb = americanToImpliedProbability(outcome.price)
        const isHome = outcome.name === game.homeTeam
        const eloProbRaw = eloData ? (isHome ? eloData.homeWinProbability : 1 - eloData.homeWinProbability) : undefined
        const modelProb = eloProbRaw !== undefined ? eloProbRaw * 100 : impliedProb * 100
        const edge = modelProb - impliedProb * 100
        const ev = calculateExpectedValue(outcome.price, modelProb / 100)
        const betRoi = calculateROI(ev)
        fallbackBets.push({
          gameId: game.id,
          sport: game.sport,
          sportName: game.sportName || game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          commenceTime: game.commenceTime,
          team: outcome.name,
          betType: 'moneyline',
          consensusProbability: impliedProb * 100,
          bestPrice: outcome.price,
          bestBook: ml.bookmaker,
          impliedProbability: impliedProb * 100,
          edge: Math.round(edge * 10) / 10,
          eloProbability: eloProbRaw !== undefined ? Math.round(modelProb * 10) / 10 : undefined,
          eloConfidence: eloData?.confidence,
          homeElo: eloData?.homeRating,
          awayElo: eloData?.awayRating,
          expectedValue: ev,
          roi: betRoi,
          allBookPrices: [{ book: ml.bookmaker, price: outcome.price, impliedProb: impliedProb * 100 }],
          score: Math.max(0, Math.round(edge * 2 + modelProb)),
          calculatedAt: now
        })
      }
    }
    
    // Build spread bets from raw odds
    for (const sp of game.spreads) {
      for (const outcome of sp.outcomes) {
        const impliedProb = americanToImpliedProbability(outcome.price)
        const spEv = calculateExpectedValue(outcome.price, impliedProb)
        const spRoi = calculateROI(spEv)
        fallbackBets.push({
          gameId: game.id,
          sport: game.sport,
          sportName: game.sportName || game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          commenceTime: game.commenceTime,
          team: outcome.name,
          betType: 'spread',
          line: outcome.point,
          consensusProbability: impliedProb * 100,
          bestPrice: outcome.price,
          bestBook: sp.bookmaker,
          impliedProbability: impliedProb * 100,
          edge: 0,
          eloConfidence: eloData?.confidence,
          homeElo: eloData?.homeRating,
          awayElo: eloData?.awayRating,
          expectedValue: spEv,
          roi: spRoi,
          allBookPrices: [{ book: sp.bookmaker, price: outcome.price, impliedProb: impliedProb * 100 }],
          score: Math.round(impliedProb * 50),
          calculatedAt: now
        })
      }
    }
    
    // Build total bets from raw odds
    for (const tot of game.totals) {
      for (const outcome of tot.outcomes) {
        const impliedProb = americanToImpliedProbability(outcome.price)
        const totEv = calculateExpectedValue(outcome.price, impliedProb)
        const totRoi = calculateROI(totEv)
        fallbackBets.push({
          gameId: game.id,
          sport: game.sport,
          sportName: game.sportName || game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          commenceTime: game.commenceTime,
          team: outcome.name,
          betType: 'total',
          line: outcome.point,
          consensusProbability: impliedProb * 100,
          bestPrice: outcome.price,
          bestBook: tot.bookmaker,
          impliedProbability: impliedProb * 100,
          edge: 0,
          eloConfidence: eloData?.confidence,
          homeElo: eloData?.homeRating,
          awayElo: eloData?.awayRating,
          expectedValue: totEv,
          roi: totRoi,
          allBookPrices: [{ book: tot.bookmaker, price: outcome.price, impliedProb: impliedProb * 100 }],
          score: Math.round(impliedProb * 50),
          calculatedAt: now
        })
      }
    }
    
    if (fallbackBets.length > 0) {
      console.log(`[analyzeSpecificGame] Market-consensus fallback produced ${fallbackBets.length} bets`)
      betsToUse = fallbackBets
    }
  }
  
  // Prefer Elo-powered bets, but fall back to all bets if Elo isn't available
  const eloPoweredBets = betsToUse.filter(bet => bet.eloProbability !== undefined)
  const finalBets = eloPoweredBets.length > 0 ? eloPoweredBets : betsToUse
  
  // ============================================
  // INJURY DISQUALIFICATION for specific game analysis
  // ============================================
  // Penalize bets on teams with severe injuries so they don't become the bestBet.
  // This mirrors the disqualification logic in computeBestBets but applies it
  // at the data layer so the LLM never sees a depleted team as the top pick.
  const getTeamOutCountForBet = (teamName: string): number => {
    if (!injuriesToUse || injuriesToUse.length === 0) return 0
    const tn = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
    return injuriesToUse.filter(inj => {
      const it = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
      const s = inj.status.toLowerCase()
      const isOut = s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir'
      return isOut && (it.includes(tn) || tn.includes(it))
    }).length
  }
  
  // Apply heavy score penalty to bets on severely injured teams
  // This ensures they sort BELOW non-injured alternatives
  const penalizedBets = finalBets.map(bet => {
    const isTotal = bet.betType === 'total'
    
    if (!isTotal) {
      // For ML/spread bets: penalize if the bet's team has 3+ OUT players
      const teamOutCount = getTeamOutCountForBet(bet.team)
      if (teamOutCount >= 3) {
        const penalty = teamOutCount >= 5 ? 80 : teamOutCount >= 4 ? 60 : 40
        const newScore = Math.max(0, bet.score - penalty)
        console.log(`[analyzeSpecificGame] INJURY PENALTY: ${bet.team} ${bet.betType} score ${bet.score} -> ${newScore} (${teamOutCount} players OUT)`)
        return { ...bet, score: newScore, injuryDisqualified: true }
      }
    } else {
      // For totals: penalize if either team has 4+ OUT players
      const homeOutCount = getTeamOutCountForBet(game.homeTeam)
      const awayOutCount = getTeamOutCountForBet(game.awayTeam)
      if (homeOutCount >= 4 || awayOutCount >= 4) {
        const maxOut = Math.max(homeOutCount, awayOutCount)
        const penalty = maxOut >= 5 ? 60 : 40
        const newScore = Math.max(0, bet.score - penalty)
        console.log(`[analyzeSpecificGame] INJURY PENALTY: ${bet.team} total score ${bet.score} -> ${newScore} (home ${homeOutCount} / away ${awayOutCount} OUT)`)
        return { ...bet, score: newScore, injuryDisqualified: true }
      }
    }
    
    return bet
  })
  
  // Sort by score to find the best bet for this game
  const sortedBets = [...penalizedBets].sort((a, b) => b.score - a.score)
  
  // Log for debugging
  if (eloPoweredBets.length === 0 && betsToUse.length > 0) {
    console.log(`[analyzeSpecificGame] No Elo data for ${game.awayTeam} @ ${game.homeTeam} (${game.sport}), using market consensus for ${betsToUse.length} bets`)
  } else if (betsToUse.length === 0) {
    console.log(`[analyzeSpecificGame] No bets available for ${game.awayTeam} @ ${game.homeTeam} - no odds data at all`)
  } else {
    console.log(`[analyzeSpecificGame] Returning ${sortedBets.length} bets for ${game.awayTeam} @ ${game.homeTeam}`)
    if (sortedBets[0]) {
      console.log(`[analyzeSpecificGame] Best bet: ${sortedBets[0].team} ${sortedBets[0].betType} (score: ${sortedBets[0].score})`)
    }
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
    calculatedAt: now,
    eloData,
    injuries: injuriesToUse
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
  
  // INJURY WARNING — show prominent injury info when key players are OUT
  if (result.injuries && result.injuries.length > 0) {
    const getTeamInjuries = (teamName: string) => {
      const tn = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
      return result.injuries!.filter(inj => {
        const it = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
        const s = inj.status.toLowerCase()
        const isOut = s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir'
        return isOut && (it.includes(tn) || tn.includes(it))
      })
    }
    
    const homeOut = getTeamInjuries(result.game.homeTeam)
    const awayOut = getTeamInjuries(result.game.awayTeam)
    
    if (homeOut.length > 0 || awayOut.length > 0) {
      lines.push('**INJURY REPORT:**')
      lines.push('')
      if (homeOut.length > 0) {
        const names = homeOut.map(i => `${i.player} (${i.status})`).join(', ')
        const severity = homeOut.length >= 4 ? 'SEVERE' : homeOut.length >= 2 ? 'SIGNIFICANT' : 'NOTABLE'
        lines.push(`${result.game.homeTeam}: ${severity} — ${homeOut.length} key player${homeOut.length > 1 ? 's' : ''} OUT: ${names}`)
      }
      if (awayOut.length > 0) {
        const names = awayOut.map(i => `${i.player} (${i.status})`).join(', ')
        const severity = awayOut.length >= 4 ? 'SEVERE' : awayOut.length >= 2 ? 'SIGNIFICANT' : 'NOTABLE'
        lines.push(`${result.game.awayTeam}: ${severity} — ${awayOut.length} key player${awayOut.length > 1 ? 's' : ''} OUT: ${names}`)
      }
      // Add warning if severe injuries detected
      const maxOut = Math.max(homeOut.length, awayOut.length)
      if (maxOut >= 3) {
        lines.push('')
        lines.push(`⚠️ CAUTION: ${maxOut >= 4 ? 'This team is severely depleted.' : 'Multiple key players missing.'} Our Elo model adjusts for injuries, but the market may have already priced these absences into the line. Exercise extra caution with any bets involving the short-handed team.`)
      }
      lines.push('')
    }
  }
  
  // INJURY DISQUALIFICATION for specific game analysis
  // If the top-scored bet is on a severely injured team, swap to a better alternative
  // This mirrors the disqualification logic in computeBestBets
  if (result.bestBet && result.injuries && result.injuries.length > 0) {
    const getTeamOutCount = (teamName: string): number => {
      const tn = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
      return result.injuries!.filter(inj => {
        const it = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
        const s = inj.status.toLowerCase()
        const isOut = s === 'out' || s.includes('out') || s === 'doubtful' || s === 'injured reserve' || s === 'ir'
        return isOut && (it.includes(tn) || tn.includes(it))
      }).length
    }
    
    const bestBetTeam = result.bestBet.team
    const bestBetTeamOutCount = getTeamOutCount(bestBetTeam)
    const isTotal = result.bestBet.betType === 'total'
    
    // For non-total bets: if the recommended team has 3+ players OUT, find an alternative
    // For total bets: if either team has 4+ OUT, flag the total as unreliable
    if (!isTotal && bestBetTeamOutCount >= 3) {
      // Find the best bet that ISN'T on the depleted team
      const altBet = result.bets.find(b => {
        if (b.betType === 'total') return false  // skip totals for this swap
        const bTeamOut = getTeamOutCount(b.team)
        return bTeamOut < 3 && b !== result.bestBet
      })
      
      if (altBet) {
        // Swap the recommendation to the non-injured alternative
        lines.push(`**⚠️ INJURY DISQUALIFICATION:** Our model initially favored ${bestBetTeam}, but with ${bestBetTeamOutCount} key players OUT, this pick is disqualified. Recommending the opponent's side instead.`)
        lines.push('')
        // Replace the best bet with the alternative
        result = { ...result, bestBet: altBet }
      } else {
        // No good alternative — warn strongly
        lines.push(`**⚠️ INJURY WARNING:** ${bestBetTeam} has ${bestBetTeamOutCount} key players OUT. Our model's recommendation is based on historical Elo data and may not fully reflect this team's current depleted state. The line may already be priced in. Exercise extreme caution.`)
        lines.push('')
      }
    } else if (isTotal) {
      const homeOutCount = getTeamOutCount(result.game.homeTeam)
      const awayOutCount = getTeamOutCount(result.game.awayTeam)
      if (homeOutCount >= 4 || awayOutCount >= 4) {
        const depletedTeam = homeOutCount >= 4 ? result.game.homeTeam : result.game.awayTeam
        const outCount = Math.max(homeOutCount, awayOutCount)
        lines.push(`**⚠️ INJURY WARNING:** ${depletedTeam} has ${outCount} key players OUT. Totals bets are unreliable when a team is this depleted — scoring dynamics change dramatically. Exercise extreme caution.`)
        lines.push('')
      }
    }
  }
  
  if (!result.bestBet) {
    // Even without specific bets, provide Elo analysis if available
    if (result.eloData) {
      const homeProb = (result.eloData.homeWinProbability * 100).toFixed(1)
      const awayProb = ((1 - result.eloData.homeWinProbability) * 100).toFixed(1)
      const favoredTeam = result.eloData.homeWinProbability > 0.5 ? result.game.homeTeam : result.game.awayTeam
      const favoredProb = result.eloData.homeWinProbability > 0.5 ? homeProb : awayProb
      lines.push('**ELO ANALYSIS (no specific bet lines available):**')
      lines.push('')
      lines.push(`${result.game.homeTeam} Elo Rating: ${result.eloData.homeRating}`)
      lines.push(`${result.game.awayTeam} Elo Rating: ${result.eloData.awayRating}`)
      lines.push(`Elo Win Probability: ${result.game.homeTeam} ${homeProb}% | ${result.game.awayTeam} ${awayProb}%`)
      lines.push(`Confidence: ${result.eloData.confidence}`)
      lines.push('')
      lines.push(`Our Elo model favors **${favoredTeam}** at ${favoredProb}%.`)
      lines.push('')
      lines.push('Note: Specific bet lines (spread, moneyline, total) may not be available yet or the game may have started. The Elo analysis above still reflects our model\'s assessment of this matchup.')
    } else {
      lines.push('Specific bet lines (spread, moneyline, total) may not be posted yet for this game, and our Elo model doesn\'t have enough data for this matchup yet.')
      lines.push('')
      lines.push('I can still help — ask me for the best bet of the day across all sports, or pick another game to analyze.')
    }
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
  
  // Check if this is an injury-impacted game with no good value
  const hasDisqualifiedBets = result.bets.some(b => b.injuryDisqualified)
  const bestBetNegativeEV = bet.edge < -3 && bet.expectedValue < -5
  
  if (hasDisqualifiedBets && bestBetNegativeEV) {
    lines.push('**⚠️ INJURY-IMPACTED GAME — NO STRONG VALUE:**')
    lines.push('')
    lines.push(`Due to severe injuries, bets on the depleted team have been removed. The remaining best option (${pickDisplay}) has negative expected value (${bet.edge}% edge, $${bet.expectedValue.toFixed(2)} EV per $100). This game may be best to skip — the market has already priced in the injuries and there is no edge on either side.`)
    lines.push('')
    lines.push('If you still want to bet this game, here is the analysis:')
    lines.push('')
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
  
  // Situational factors breakdown (rest days and injuries omitted from chat context - still used in Elo)
  lines.push('**SITUATIONAL FACTORS:**')
  lines.push('')
  if (bet.situationalBreakdown) {
    const formatAdj = (adj: number) => adj === 0 ? '0%' : `${adj > 0 ? '+' : ''}${adj.toFixed(1)}%`
    lines.push(`- Travel: ${bet.situationalBreakdown.travel.value} (${formatAdj(bet.situationalBreakdown.travel.adjustment)})`)
    lines.push(`- Recent form: ${bet.situationalBreakdown.recentForm.value} (${formatAdj(bet.situationalBreakdown.recentForm.adjustment)})`)
    lines.push(`- Weather: ${bet.situationalBreakdown.weather.value} (${formatAdj(bet.situationalBreakdown.weather.adjustment)})`)
    lines.push(`- Sharp money: ${bet.situationalBreakdown.sharpMoney.value} (${formatAdj(bet.situationalBreakdown.sharpMoney.adjustment)})`)
    lines.push(`- Motivation: ${bet.situationalBreakdown.motivation.value} (${formatAdj(bet.situationalBreakdown.motivation.adjustment)})`)
    lines.push('')
    const totalAdj = bet.situationalAdjustment ?? 0
    lines.push(`**Total adjustment: ${totalAdj > 0 ? '+' : ''}${totalAdj.toFixed(1)}%**`)
    if (bet.baseEloProbability !== undefined && bet.eloProbability !== undefined) {
      lines.push(`Base Elo probability: ${bet.baseEloProbability}% -> Adjusted: ${bet.eloProbability}%`)
    }
  } else if (bet.situationalNotes && bet.situationalNotes.length > 0) {
    for (const note of bet.situationalNotes) {
      if (/rest|injur/i.test(note)) continue
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
  // HARD CONSTRAINT: Strip disqualified bets entirely — don't even show them to the LLM
  const validOthers = result.bets.filter(b => b !== result.bestBet && !b.injuryDisqualified)
  const disqualifiedCount = result.bets.filter(b => b.injuryDisqualified).length
  
  if (validOthers.length > 0) {
    lines.push('**OTHER OPTIONS:**')
    lines.push('')
    let idx = 2
    for (const otherBet of validOthers.slice(0, 4)) {
      let otherDisplay: string
      if (otherBet.betType === 'total') {
        otherDisplay = `${otherBet.team} ${otherBet.line} @ ${formatOdds(otherBet.bestPrice)}`
      } else if (otherBet.betType === 'spread' && otherBet.line !== undefined) {
        otherDisplay = `${otherBet.team} ${otherBet.line > 0 ? '+' : ''}${otherBet.line} @ ${formatOdds(otherBet.bestPrice)}`
      } else {
        otherDisplay = `${otherBet.team} ML @ ${formatOdds(otherBet.bestPrice)}`
      }
      lines.push(`#${idx}: ${otherDisplay} (Score: ${otherBet.score}/100, ${otherBet.edge}% edge)`)
      idx++
    }
    if (disqualifiedCount > 0) {
      lines.push('')
      lines.push(`(${disqualifiedCount} additional bet${disqualifiedCount > 1 ? 's' : ''} removed — team has multiple key players OUT)`)
    }
    lines.push('')
  } else if (disqualifiedCount > 0) {
    lines.push('**OTHER OPTIONS:** None available — all alternatives involve an injury-depleted team.')
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
 * Calculate seconds until 2 AM ET (next occurrence).
 * Daily picks stay visible until 2 AM ET, then the cache expires and
 * the next cron run starts fresh for the new day.
 * Minimum TTL is 1 hour to avoid edge cases right around 2 AM.
 */
function getSecondsUntil2amET(): number {
  const now = new Date()
  // Get current time in ET
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etNow = new Date(etStr)
  
  // Build next 2 AM ET
  const next2am = new Date(etNow)
  next2am.setHours(2, 0, 0, 0)
  
  // If it's already past 2 AM today, target 2 AM tomorrow
  if (etNow.getHours() >= 2) {
    next2am.setDate(next2am.getDate() + 1)
  }
  
  const diffMs = next2am.getTime() - etNow.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  
  // Minimum 1 hour TTL to avoid edge cases
  return Math.max(diffSeconds, 3600)
}

// Bump this version whenever the best-bet algorithm changes materially
// (e.g. injury disqualification, scoring changes, filter changes).
// Cached results with a different version are automatically invalidated.
const BEST_BET_CACHE_VERSION = 3  // v3: spread quality bonus + spread/Elo penalties

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
      body: JSON.stringify(JSON.stringify({ ...result, _cacheVersion: BEST_BET_CACHE_VERSION }))
    })
    
    // Set TTL to expire at 2 AM ET — picks stay visible for the full day.
    // This prevents the cache from expiring mid-evening and losing all daily picks.
    const ttlSeconds = getSecondsUntil2amET()
    await fetch(`${redis.url}/expire/${BEST_BET_CACHE_KEY}/${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    console.log(`[cacheBestBet] TTL set to ${ttlSeconds}s (expires at ~2 AM ET)`)
    
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
 * Get cached best bet from Redis.
 * Cached in-memory for 2 minutes — the cron only updates this hourly,
 * so a short TTL avoids redundant fetches across page views within the same
 * serverless instance lifetime.
 */
export async function getCachedBestBet(): Promise<BestBetResult | null> {
  const { cachedRead } = await import('@/lib/redis-cache')
  return cachedRead('bestBet:cached', 120, async () => {
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
      // Invalidate if cache version doesn't match (algorithm changed)
      if (parsed._cacheVersion !== BEST_BET_CACHE_VERSION) {
        console.log(`[getCachedBestBet] Cache version mismatch (cached: ${parsed._cacheVersion}, current: ${BEST_BET_CACHE_VERSION}), invalidating`)
        return null
      }
      
      return parsed as BestBetResult
    } catch (error) {
      console.error('[getCachedBestBet] Error getting cached best bet:', error)
      return null
    }
  })
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
  
  const eloBets = allRankedBets.filter(bet => bet.eloProbability !== undefined)
  
  if (eloBets.length < 2) {
    return {
      safeParlay: null,
      aggressiveParlay: null,
      combinedProbability: null,
      calculatedAt: now,
      reason: 'Not enough Elo-powered bets available for a parlay (need at least 2 from different games)'
    }
  }
  
  const getModelProb = (bet: RankedBet) => bet.eloProbability!
  
  // STEP 1: Filter out extreme favorites (poor parlay value)
  // Bets worse than -400 odds or >85% probability are excluded
  const valueBets = eloBets.filter(bet => {
    const prob = getModelProb(bet)
    const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
    const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
    const hasPositiveEdge = bet.edge > 0
    
    return hasReasonableOdds && hasReasonableProb && hasPositiveEdge
  })
  
  let betsToUse = valueBets
  if (valueBets.length < 3) {
    const moderateBets = eloBets.filter(bet => {
      const prob = getModelProb(bet)
      const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
      const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
      return hasReasonableOdds && hasReasonableProb
    })
    betsToUse = moderateBets.length >= 2 ? moderateBets : eloBets
  }
  
  const sortedBets = [...betsToUse].sort((a, b) => b.score - a.score)
  
  const safeParlay = buildParlayWithLegs(sortedBets, 2) || []
  const aggressiveParlay = buildParlayWithLegs(sortedBets, 3) || []
  
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
/**
 * Check if two bets are correlated (same league/conference increases correlation).
 * Correlated parlays are penalized by sportsbooks and reduce true independence.
 */
function areLegsCorrelated(a: RankedBet, b: RankedBet): boolean {
  // Same game = fully correlated (already blocked by gameId check)
  if (a.gameId === b.gameId) return true
  
  // Same sport + same bet type (e.g., two NBA totals) = moderately correlated
  // Sportsbooks flag these as correlated parlays
  if (a.sport === b.sport && a.betType === b.betType && a.betType === 'total') return true
  
  return false
}

function buildParlayWithLegs(
  sortedBets: RankedBet[], 
  legCount: number, 
  usedGameIds: Set<string> = new Set()
): RankedBet[] | null {
  const parlay: RankedBet[] = []
  const localUsedGameIds = new Set(usedGameIds)
  const usedSports = new Set<string>()
  
  for (const bet of sortedBets) {
    if (localUsedGameIds.has(bet.gameId)) continue
    
    // Check correlation with existing legs
    const isCorrelated = parlay.some(leg => areLegsCorrelated(leg, bet))
    if (isCorrelated) continue
    
    // Prefer cross-sport diversification: if we already have 2+ legs from the
    // same sport, skip unless we have no other options
    if (usedSports.has(bet.sport) && parlay.length >= 2) {
      // Count how many legs are already from this sport
      const sameLeagueCount = parlay.filter(l => l.sport === bet.sport).length
      if (sameLeagueCount >= 2) continue // Max 2 legs from same sport
    }
    
    parlay.push(bet)
    localUsedGameIds.add(bet.gameId)
    usedSports.add(bet.sport)
    
    if (parlay.length === legCount) break
  }
  
  // If diversification was too strict, fall back to just gameId dedup
  if (parlay.length < legCount) {
    parlay.length = 0
    localUsedGameIds.clear()
    Array.from(usedGameIds).forEach(id => localUsedGameIds.add(id))
    
    for (const bet of sortedBets) {
      if (localUsedGameIds.has(bet.gameId)) continue
      parlay.push(bet)
      localUsedGameIds.add(bet.gameId)
      if (parlay.length === legCount) break
    }
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
  
  const eloBets = allRankedBets.filter(bet => bet.eloProbability !== undefined)
  
  if (eloBets.length < requestedLegs) {
    return null
  }
  
  const getModelProb = (bet: RankedBet) => bet.eloProbability!
  
  const valueBets = eloBets.filter(bet => {
    const prob = getModelProb(bet)
    const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
    const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
    const hasPositiveEdge = bet.edge > 0
    return hasReasonableOdds && hasReasonableProb && hasPositiveEdge
  })
  
  let betsToUse = valueBets
  if (valueBets.length < requestedLegs) {
    const moderateBets = eloBets.filter(bet => {
      const prob = getModelProb(bet)
      const hasReasonableOdds = bet.bestPrice >= PARLAY_MIN_ODDS
      const hasReasonableProb = prob >= PARLAY_MIN_PROBABILITY && prob <= PARLAY_MAX_PROBABILITY
      return hasReasonableOdds && hasReasonableProb
    })
    betsToUse = moderateBets.length >= requestedLegs ? moderateBets : eloBets
  }
  
  const sortedBets = [...betsToUse].sort((a, b) => b.score - a.score)
  
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
    let legDisplay: string
    if (leg.betType === 'total') {
      legDisplay = `${leg.team} ${leg.line} @ ${formatOdds(leg.bestPrice)}`
    } else if (leg.betType === 'spread' && leg.line !== undefined) {
      legDisplay = `${leg.team} ${leg.line > 0 ? '+' : ''}${leg.line} @ ${formatOdds(leg.bestPrice)}`
    } else {
      legDisplay = `${leg.team} ML @ ${formatOdds(leg.bestPrice)}`
    }
    const probLabel = leg.betType === 'total' ? `${leg.team.toLowerCase()} probability` : leg.betType === 'spread' ? 'Cover probability' : 'Win probability'
    lines.push(`${emoji} **Leg ${i + 1}: ${legDisplay}**`)
    lines.push(`   ${leg.awayTeam} @ ${leg.homeTeam}`)
    lines.push(`   ${probLabel}: ${modelProb}% | Edge: ${leg.edge > 0 ? '+' : ''}${leg.edge}%`)
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
    
    // Analyze each group — include single-book props so sports with fewer
    // bookmakers (NHL, NCAAB, NCAAF, MLB) aren't excluded entirely.
    // The scoring formula already weights multi-book consensus higher.
    const propGroupEntries = Array.from(propGroups.entries())
    for (const [key, props] of propGroupEntries) {
      
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
// Must stay in sync with MARKET_TO_STAT_TYPE in player-prop-analysis.ts
// and SPORT_STATS in player-stats.ts
const MARKET_TO_STAT: Record<string, string> = {
  // NBA / NCAAB stats
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threePointersMade',
  'player_steals': 'steals',
  'player_blocks': 'blocks',
  // NFL / NCAAF stats
  'player_pass_yds': 'passingYards',
  'player_rush_yds': 'rushingYards',
  'player_reception_yds': 'receivingYards',
  'player_receptions': 'receptions',
  'player_pass_tds': 'passingTouchdowns',
  // NHL stats
  'player_goals': 'goals',
  'player_shots_on_goal': 'shots',
  'player_power_play_points': 'powerPlayPoints',
  // MLB stats
  'player_hits': 'hits',
  'player_home_runs': 'homeRuns',
  'player_rbis': 'rbis',
  'player_strikeouts': 'strikeouts',
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
        homeConsensus.consensusProb,
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
        awayConsensus.consensusProb,
        allPrices,
        game.awayTeam
      ))
    }
  }

  // For 3-way markets (soccer), include Draw moneyline too
  if (isThreeWayMarket(game)) {
    const drawConsensus = calculateConsensusProbability(game, 'Draw')
    if (drawConsensus) {
      const bestPrice = findBestPrice(game, 'Draw')
      if (bestPrice) {
        const allPrices = game.moneylines
          .flatMap(ml => ml.outcomes
            .filter(o => {
              const name = o.name.toLowerCase()
              return name === 'draw' || name === 'tie' || name === 'x'
            })
            .map(o => ({ book: ml.bookmaker, price: o.price })))

        allBets.push(createBetCard(
          'moneyline',
          'Draw',
          bestPrice.price,
          bestPrice.book,
          drawConsensus.consensusProb,
          allPrices,
          'Draw'
        ))
      }
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
