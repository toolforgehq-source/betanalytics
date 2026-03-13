/**
 * Elo Rating System for Sports Betting
 * 
 * This system learns over time by tracking game results and updating team ratings.
 * The longer the site runs, the more accurate the predictions become.
 * 
 * Key features:
 * - Team ratings start at 1500 and adjust based on game results
 * - Home advantage is factored in (~100 points for most sports)
 * - Ratings persist in Redis and update daily via cron job
 * - Provides win probability independent of sportsbook odds
 */

// ============================================
// ELO CONSTANTS
// ============================================

// Starting rating for new teams
const DEFAULT_RATING = 1500

// K-factor: how much ratings change per game
// Higher K = more reactive to recent results
// Lower K = more stable, slower to change
const K_FACTORS: Record<string, number> = {
  'NBA': 20,      // 82 games, moderate reactivity
  'NFL': 32,      // 17 games, higher reactivity needed
  'NHL': 20,      // 82 games
  'MLB': 8,       // 162 games, very stable (boosted to 16 early season, see getEffectiveKFactor)
  'NCAAB': 32,    // Fewer games, higher reactivity
  'NCAAF': 40,    // Very few games, highest reactivity
  // Soccer leagues
  'soccer_epl': 25,
  'soccer_spain_la_liga': 25,
  'soccer_germany_bundesliga': 25,
  'soccer_italy_serie_a': 25,
  'soccer_france_ligue_one': 25,
  'soccer_usa_mls': 25,
  'soccer_uefa_champs_league': 25,
}

// REMOVED: Per-game recency decay was compressing all ratings toward 1500
// and preventing dominant teams (e.g., Colorado Avalanche 38-9) from building
// proper Elo ratings. Standard Elo does NOT use per-game decay.
// Between-season regression (SEASON_REGRESSION_FACTOR) handles the need
// to account for roster changes and uncertainty between seasons.
//
// Minimum games threshold: teams with fewer than this many games
// should not be used for predictions (insufficient data)
const MIN_GAMES_FOR_PREDICTIONS = 5

// EARLY-SEASON K-FACTOR BOOST
// MLB's base K=8 is correct for mid-season stability, but at season start
// ratings are based on last year's regressed data and need to converge faster.
// For teams with fewer than 30 games played this season, boost K by 2x.
const EARLY_SEASON_K_BOOST: Record<string, { maxGames: number; multiplier: number }> = {
  'MLB': { maxGames: 30, multiplier: 2.0 },  // K=8 → K=16 for first 30 games
}

// RECENCY WEIGHTING: Recent games get a higher K-factor multiplier
// so Elo reacts more strongly to current form.
// - Games played within 7 days of last game: 1.15x K-factor (team is in rhythm)
// - Games played within 7-14 days: 1.0x (normal)
// - Games played after 14+ day gap: 0.85x (rust/uncertainty, trust result less)
// This helps Elo capture hot/cold streaks without the per-game decay problem.
const RECENCY_K_MULTIPLIER = {
  RECENT: 1.15,    // 0-7 days since last game
  NORMAL: 1.0,     // 7-14 days
  STALE: 0.85,     // 14+ days (long break, less informative)
}
const RECENCY_RECENT_DAYS = 7
const RECENCY_STALE_DAYS = 14

// Home advantage in Elo points (added to home team's rating for prediction)
// Calibrated to match real-world home win rates:
//   55 pts → 57.8%  (modern NBA)
//   80 pts → 61.3%  (college basketball)
//   60 pts → 58.5%  (European soccer)
const HOME_ADVANTAGE: Record<string, number> = {
  'NBA': 55,       // Modern NBA home win rate ~56-58% (was 100, way too high → 64%)
  'NFL': 48,       // ~2.5 points spread equivalent, ~57% home win rate
  'NHL': 30,       // ~54-55% home win rate, ~0.3 goals expected margin
  'MLB': 40,       // ~54-56% home win rate
  'NCAAB': 80,     // College home court is strong ~61-63% (was 100)
  'NCAAF': 65,     // College home field ~59-61% (was 80)
  'soccer_epl': 60,           // EPL home win rate ~55-58% (was 80)
  'soccer_spain_la_liga': 60, // La Liga similar to EPL (was 80)
  'soccer_germany_bundesliga': 60, // Bundesliga similar (was 80)
  'soccer_italy_serie_a': 60,      // Serie A similar (was 80)
  'soccer_france_ligue_one': 60,   // Ligue 1 similar (was 80)
  'soccer_usa_mls': 55,       // MLS slightly lower (was 70)
  'soccer_uefa_champs_league': 45, // Neutral-ish venues in later rounds (was 60)
}

// ============================================
// SPREAD & TOTAL PARAMETERS (Elo → Margin/Points)
// ============================================

// MARGIN_BETA: Converts Elo difference to expected point margin
// Formula: expectedMargin = MARGIN_BETA[league] * eloDiff
// These values are calibrated from historical data:
// - NFL: 25 Elo points ≈ 1 point margin → beta = 0.04
// - NBA: 28 Elo points ≈ 1 point margin → beta = 0.036
// - NHL: 100 Elo points ≈ 1 goal margin → beta = 0.01
const MARGIN_BETA: Record<string, number> = {
  'NBA': 0.036,      // 28 Elo pts = 1 point margin
  'NFL': 0.04,       // 25 Elo pts = 1 point margin
  'NHL': 0.01,       // 100 Elo pts = 1 goal margin
  'MLB': 0.008,      // 125 Elo pts = 1 run margin
  'NCAAB': 0.036,    // Similar to NBA
  'NCAAF': 0.04,     // Similar to NFL
  // Soccer - goals are harder to predict
  'soccer_epl': 0.008,
  'soccer_spain_la_liga': 0.008,
  'soccer_germany_bundesliga': 0.008,
  'soccer_italy_serie_a': 0.008,
  'soccer_france_ligue_one': 0.008,
  'soccer_usa_mls': 0.008,
  'soccer_uefa_champs_league': 0.008,
}

// MARGIN_SIGMA: Standard deviation of game margins (for Normal distribution)
// Used to calculate P(cover spread) = 1 - NormalCDF((spread - expectedMargin) / sigma)
const MARGIN_SIGMA: Record<string, number> = {
  'NBA': 12.0,       // NBA games have ~12 point std dev in margins
  'NFL': 13.5,       // NFL games have ~13.5 point std dev
  'NHL': 1.8,        // NHL games have ~1.8 goal std dev
  'MLB': 2.5,        // MLB games have ~2.5 run std dev
  'NCAAB': 11.0,     // College basketball slightly tighter
  'NCAAF': 16.0,     // College football more variance
  // Soccer - low scoring, high variance relative to mean
  'soccer_epl': 1.5,
  'soccer_spain_la_liga': 1.5,
  'soccer_germany_bundesliga': 1.6,
  'soccer_italy_serie_a': 1.4,
  'soccer_france_ligue_one': 1.5,
  'soccer_usa_mls': 1.6,
  'soccer_uefa_champs_league': 1.5,
}

// TOTAL_BASELINE: Average total points per game (league baseline)
// Used to estimate expected total from Elo ratings
const TOTAL_BASELINE: Record<string, number> = {
  'NBA': 224,        // NBA averages ~224 total points
  'NFL': 46,         // NFL averages ~46 total points
  'NHL': 6.0,        // NHL averages ~6 total goals
  'MLB': 8.5,        // MLB averages ~8.5 total runs
  'NCAAB': 145,      // College basketball ~145 total
  'NCAAF': 54,       // College football ~54 total
  // Soccer - low scoring
  'soccer_epl': 2.7,
  'soccer_spain_la_liga': 2.6,
  'soccer_germany_bundesliga': 3.0,
  'soccer_italy_serie_a': 2.5,
  'soccer_france_ligue_one': 2.6,
  'soccer_usa_mls': 2.8,
  'soccer_uefa_champs_league': 2.8,
}

// TOTAL_SIGMA: Standard deviation of total points (for Normal distribution)
const TOTAL_SIGMA: Record<string, number> = {
  'NBA': 22,         // NBA totals have ~22 point std dev
  'NFL': 13,         // NFL totals have ~13 point std dev
  'NHL': 2.0,        // NHL totals have ~2 goal std dev
  'MLB': 3.5,        // MLB totals have ~3.5 run std dev
  'NCAAB': 18,       // College basketball
  'NCAAF': 15,       // College football
  // Soccer
  'soccer_epl': 1.4,
  'soccer_spain_la_liga': 1.4,
  'soccer_germany_bundesliga': 1.5,
  'soccer_italy_serie_a': 1.3,
  'soccer_france_ligue_one': 1.4,
  'soccer_usa_mls': 1.5,
  'soccer_uefa_champs_league': 1.4,
}

// TOTAL_ELO_FACTOR: How much combined Elo strength affects total
// Higher combined Elo (both teams strong) → slightly higher scoring
// Formula: expectedTotal = baseline + TOTAL_ELO_FACTOR * (avgElo - 1500)
const TOTAL_ELO_FACTOR: Record<string, number> = {
  'NBA': 0.02,       // 50 Elo above average → +1 point total
  'NFL': 0.01,       // 100 Elo above average → +1 point total
  'NHL': 0.002,      // 500 Elo above average → +1 goal total
  'MLB': 0.003,      // 333 Elo above average → +1 run total
  'NCAAB': 0.02,
  'NCAAF': 0.01,
  'soccer_epl': 0.002,
  'soccer_spain_la_liga': 0.002,
  'soccer_germany_bundesliga': 0.002,
  'soccer_italy_serie_a': 0.002,
  'soccer_france_ligue_one': 0.002,
  'soccer_usa_mls': 0.002,
  'soccer_uefa_champs_league': 0.002,
}

// ============================================
// MARGIN OF VICTORY (MOV) ADJUSTMENT
// ============================================
// 
// Blowout wins should increase ratings more than close wins.
// This helps ratings converge to "true" values faster.
// 
// Formula: MOV multiplier = ln(abs(margin) + 1) * (2.2 / (eloDiff * 0.001 + 2.2))
// - The ln(margin + 1) rewards larger margins with diminishing returns
// - The second term prevents runaway ratings when a strong team blows out a weak team
// - Based on FiveThirtyEight's NFL Elo methodology
//
// Example multipliers:
// - 1 point margin: ~0.69x (close game, less movement)
// - 5 point margin: ~1.0x (normal game)
// - 10 point margin: ~1.2x (solid win)
// - 20 point margin: ~1.4x (blowout)
// - 40 point margin: ~1.6x (dominant, but capped)

// Enable/disable MOV adjustment per league
// Some leagues benefit more from MOV than others
const MOV_ENABLED: Record<string, boolean> = {
  'NBA': true,       // High-scoring, margin matters
  'NFL': true,       // FiveThirtyEight uses this successfully
  'NHL': true,       // Goals matter
  'MLB': true,       // Runs matter
  'NCAAB': true,     // Similar to NBA
  'NCAAF': true,     // Similar to NFL
  // Soccer - goals are rare, so MOV is less reliable
  'soccer_epl': false,
  'soccer_spain_la_liga': false,
  'soccer_germany_bundesliga': false,
  'soccer_italy_serie_a': false,
  'soccer_france_ligue_one': false,
  'soccer_usa_mls': false,
  'soccer_uefa_champs_league': false,
}

// MOV scaling factor per league (adjusts how much margin affects the multiplier)
// Higher = margin matters more, Lower = margin matters less
const MOV_SCALE: Record<string, number> = {
  'NBA': 1.0,        // Standard scaling
  'NFL': 1.0,        // Standard scaling
  'NHL': 2.5,        // Goals are worth more (scale up 1 goal to ~2.5 points equivalent)
  'MLB': 2.0,        // Runs are worth more
  'NCAAB': 1.0,
  'NCAAF': 1.0,
  'soccer_epl': 3.0,
  'soccer_spain_la_liga': 3.0,
  'soccer_germany_bundesliga': 3.0,
  'soccer_italy_serie_a': 3.0,
  'soccer_france_ligue_one': 3.0,
  'soccer_usa_mls': 3.0,
  'soccer_uefa_champs_league': 3.0,
}

/**
 * Calculate Margin of Victory multiplier for K-factor
 * Based on FiveThirtyEight's methodology
 * 
 * @param margin - Point/goal difference (absolute value)
 * @param eloDiff - Elo difference between winner and loser (positive = favorite won)
 * @param league - League for scaling
 * @returns Multiplier for K-factor (typically 0.5 to 2.0)
 */
function calculateMOVMultiplier(
  margin: number,
  eloDiff: number,
  league: string
): number {
  // If MOV is disabled for this league, return 1.0 (no adjustment)
  if (!MOV_ENABLED[league]) {
    return 1.0
  }
  
  const scale = MOV_SCALE[league] || 1.0
  const scaledMargin = Math.abs(margin) * scale
  
  // Natural log of margin + 1 (diminishing returns for blowouts)
  const marginFactor = Math.log(scaledMargin + 1)
  
  // Autocorrelation adjustment: prevents runaway ratings
  // When a strong team beats a weak team by a lot, we don't want to over-reward
  // The 2.2 constant is from FiveThirtyEight's research
  const autoCorr = 2.2 / (Math.abs(eloDiff) * 0.001 + 2.2)
  
  // Combine factors
  const multiplier = marginFactor * autoCorr
  
  // Clamp to reasonable range (0.5 to 2.0)
  return Math.max(0.5, Math.min(2.0, multiplier))
}

// ============================================
// SEASON REGRESSION
// ============================================
//
// At the end of each season (after playoffs), ratings should regress toward 1500.
// This accounts for roster changes, coaching changes, and general uncertainty.
//
// Regression factor: how much to regress toward 1500
// 0.0 = no regression (keep full rating)
// 0.5 = regress halfway to 1500
// 1.0 = full reset to 1500
//
// Formula: newRating = 1500 + (oldRating - 1500) * (1 - regressionFactor)

const SEASON_REGRESSION_FACTOR: Record<string, number> = {
  'NBA': 0.25,       // Regress 25% toward 1500 (rosters change moderately)
  'NFL': 0.33,       // Regress 33% (significant roster turnover)
  'NHL': 0.25,       // Similar to NBA
  'MLB': 0.20,       // Less regression (rosters more stable)
  'NCAAB': 0.40,     // High regression (players graduate/transfer)
  'NCAAF': 0.40,     // High regression (players graduate/transfer)
  // Soccer - less regression (rosters fairly stable)
  'soccer_epl': 0.20,
  'soccer_spain_la_liga': 0.20,
  'soccer_germany_bundesliga': 0.20,
  'soccer_italy_serie_a': 0.20,
  'soccer_france_ligue_one': 0.20,
  'soccer_usa_mls': 0.25,
  'soccer_uefa_champs_league': 0.15,  // Less regression for elite teams
}

// Approximate playoff end dates (month-day format)
// Regression should only happen AFTER playoffs end
// Format: { month: number (1-12), day: number }
const PLAYOFF_END_DATES: Record<string, { month: number; day: number }> = {
  'NBA': { month: 6, day: 20 },        // NBA Finals typically end mid-June
  'NFL': { month: 2, day: 15 },        // Super Bowl early February
  'NHL': { month: 6, day: 25 },        // Stanley Cup Finals late June
  'MLB': { month: 11, day: 5 },        // World Series early November
  'NCAAB': { month: 4, day: 10 },      // March Madness ends early April
  'NCAAF': { month: 1, day: 15 },      // CFP Championship mid-January
  // Soccer seasons vary, using approximate end dates
  'soccer_epl': { month: 5, day: 30 },
  'soccer_spain_la_liga': { month: 5, day: 30 },
  'soccer_germany_bundesliga': { month: 5, day: 25 },
  'soccer_italy_serie_a': { month: 5, day: 30 },
  'soccer_france_ligue_one': { month: 5, day: 30 },
  'soccer_usa_mls': { month: 12, day: 15 },  // MLS Cup mid-December
  'soccer_uefa_champs_league': { month: 6, day: 5 },
}

// Approximate season start dates (for detecting new season)
const SEASON_START_DATES: Record<string, { month: number; day: number }> = {
  'NBA': { month: 10, day: 20 },       // NBA season starts late October
  'NFL': { month: 9, day: 5 },         // NFL season starts early September
  'NHL': { month: 10, day: 10 },       // NHL season starts early October
  'MLB': { month: 3, day: 27 },        // MLB Opening Day 2026 is March 26, regression applied day before
  'NCAAB': { month: 11, day: 5 },      // College basketball starts early November
  'NCAAF': { month: 8, day: 25 },      // College football starts late August
  // Soccer seasons
  'soccer_epl': { month: 8, day: 15 },
  'soccer_spain_la_liga': { month: 8, day: 15 },
  'soccer_germany_bundesliga': { month: 8, day: 15 },
  'soccer_italy_serie_a': { month: 8, day: 20 },
  'soccer_france_ligue_one': { month: 8, day: 10 },
  'soccer_usa_mls': { month: 2, day: 25 },
  'soccer_uefa_champs_league': { month: 9, day: 15 },
}

/**
 * Check if we're in the offseason window where regression should be applied
 * Returns true if current date is between playoff end and season start
 */
function isInOffseason(league: string, date: Date = new Date()): boolean {
  const playoffEnd = PLAYOFF_END_DATES[league]
  const seasonStart = SEASON_START_DATES[league]
  
  if (!playoffEnd || !seasonStart) return false
  
  const month = date.getMonth() + 1  // getMonth() is 0-indexed
  const day = date.getDate()
  
  // Create comparison values (month * 100 + day for easy comparison)
  const current = month * 100 + day
  const playoffEndVal = playoffEnd.month * 100 + playoffEnd.day
  const seasonStartVal = seasonStart.month * 100 + seasonStart.day
  
  // Handle wrap-around (e.g., NFL: playoffs end Feb, season starts Sep)
  if (playoffEndVal < seasonStartVal) {
    // Normal case: offseason is between playoff end and season start
    return current > playoffEndVal && current < seasonStartVal
  } else {
    // Wrap-around case (e.g., MLS: playoffs end Dec, season starts Feb)
    return current > playoffEndVal || current < seasonStartVal
  }
}

/**
 * Apply season regression to a team's rating
 * Should only be called once per team per offseason
 * 
 * @param currentRating - Team's current Elo rating
 * @param league - League for regression factor
 * @returns New rating after regression toward 1500
 */
export function applySeasonRegression(
  currentRating: number,
  league: string
): number {
  const factor = SEASON_REGRESSION_FACTOR[league] || 0.25
  // newRating = 1500 + (oldRating - 1500) * (1 - factor)
  return Math.round(DEFAULT_RATING + (currentRating - DEFAULT_RATING) * (1 - factor))
}

/**
 * Apply season regression to all teams in a league
 * This should be called once after playoffs end for each league
 * 
 * @param league - League to regress
 * @returns Object with regression results
 */
export async function applyLeagueSeasonRegression(
  league: string
): Promise<{ teamsRegressed: number; averageChange: number } | null> {
  // Check if we're in the offseason
  if (!isInOffseason(league)) {
    console.log(`[Elo] Not in offseason for ${league}, skipping regression`)
    return null
  }
  
  const eloData = await getEloRatings()
  if (!eloData || !eloData.ratings) {
    console.log(`[Elo] No ratings data found for regression`)
    return null
  }
  
  let teamsRegressed = 0
  let totalChange = 0
  
  for (const team of Object.values(eloData.ratings)) {
    if (team.league !== league) continue
    
    const oldRating = team.rating
    const newRating = applySeasonRegression(oldRating, league)
    
    team.rating = newRating
    totalChange += Math.abs(newRating - oldRating)
    teamsRegressed++
  }
  
  if (teamsRegressed > 0) {
    eloData.lastUpdated = new Date().toISOString()
    await saveEloRatings(eloData)
    
    const averageChange = Math.round(totalChange / teamsRegressed)
    console.log(`[Elo] Applied season regression to ${league}: ${teamsRegressed} teams, avg change: ${averageChange} Elo`)
    
    return { teamsRegressed, averageChange }
  }
  
  return { teamsRegressed: 0, averageChange: 0 }
}

// ============================================
// TYPES
// ============================================

export interface TeamRating {
  teamId: string
  teamName: string
  league: string
  rating: number
  gamesPlayed: number
  lastUpdated: string
  // Margin tracking for team-specific variance (Fix 2)
  marginStats?: {
    totalMargin: number      // Sum of all margins (positive = wins, negative = losses)
    marginSquaredSum: number // Sum of squared margins (for variance calculation)
    marginCount: number      // Number of games with margin data
    avgMargin: number        // Average margin (totalMargin / marginCount)
    marginVariance: number   // Variance of margins
    marginStdDev: number     // Standard deviation of margins (team-specific sigma)
  }
  // Last 10 game results for form tracking (1 = win, 0 = loss, 0.5 = draw)
  // Most recent result is at the END of the array (push new, shift old)
  recentResults?: number[]
}

export interface EloRatings {
  ratings: Record<string, TeamRating>  // key: "league:teamId"
  lastUpdated: string
  gamesProcessed: number
}

export interface GameResult {
  gameId: string
  league: string
  homeTeamId: string
  homeTeamName: string
  awayTeamId: string
  awayTeamName: string
  homeScore: number
  awayScore: number
  date: string
}

// ============================================
// ELO SCALING FACTORS (per sport)
// ============================================
// The standard Elo formula uses 400 as the scaling divisor (from chess).
// But sports have MUCH more variance than chess — upsets happen far more often.
// Using 400 produces overconfident probabilities:
//   - 200-point Elo gap with 400 scale → 76% (too high for sports)
//   - 200-point Elo gap with 480 scale → 70% (matches real-world NBA data)
//   - 200-point Elo gap with 550 scale → 66% (matches NFL with high variance)
//
// These values are calibrated from historical win rates at various Elo gaps.
// Sources: FiveThirtyEight Elo methodology, historical sports databases.
const ELO_SCALE: Record<string, number> = {
  'NBA': 480,       // NBA: ~70% win rate for 200-point gap (was 76% with 400)
  'NFL': 550,       // NFL: highest variance sport, upsets common
  'NHL': 520,       // NHL: goaltending variance, parity
  'MLB': 550,       // MLB: most random major sport (best team wins ~60%)
  'NCAAB': 480,     // College basketball: similar to NBA but more blowouts
  'NCAAF': 500,     // College football: talent gaps but high variance
  // Soccer: moderate variance, draws common
  'soccer_epl': 500,
  'soccer_spain_la_liga': 500,
  'soccer_germany_bundesliga': 500,
  'soccer_italy_serie_a': 500,
  'soccer_france_ligue_one': 500,
  'soccer_usa_mls': 520,
  'soccer_uefa_champs_league': 520,
}

// ============================================
// ELO MATH
// ============================================

/**
 * Calculate expected score (win probability) based on rating difference
 * Uses the Elo formula with sport-specific scaling: E = 1 / (1 + 10^((Rb - Ra) / scale))
 * Wider scale = less extreme probabilities = better calibrated for sports
 */
export function calculateExpectedScore(ratingA: number, ratingB: number, scale: number = 400): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / scale))
}

/**
 * Calculate win probability for home team, including home advantage
 * Uses sport-specific Elo scaling to prevent overconfident probabilities
 */
export function calculateWinProbability(
  homeRating: number,
  awayRating: number,
  league: string,
  isNeutralSite: boolean = false
): number {
  // Zero out home advantage for neutral site games (e.g., March Madness, conference tournaments, bowl games)
  const homeAdvantage = isNeutralSite ? 0 : (HOME_ADVANTAGE[league] || 70)
  const adjustedHomeRating = homeRating + homeAdvantage
  const scale = ELO_SCALE[league] || 480
  return calculateExpectedScore(adjustedHomeRating, awayRating, scale)
}

/**
 * Calculate new rating after a game
 * @param currentRating - Team's current rating
 * @param expectedScore - Expected score (0-1, from calculateExpectedScore)
 * @param actualScore - Actual score (1 for win, 0.5 for draw, 0 for loss)
 * @param kFactor - How much to adjust (higher = more reactive)
 */
export function calculateNewRating(
  currentRating: number,
  expectedScore: number,
  actualScore: number,
  kFactor: number
): number {
  return currentRating + kFactor * (actualScore - expectedScore)
}

/**
 * Update ratings for both teams after a game
 * Now includes Margin of Victory (MOV) adjustment for more accurate rating changes
 */
export function updateRatingsAfterGame(
  homeRating: number,
  awayRating: number,
  homeScore: number,
  awayScore: number,
  league: string,
  recencyMultiplier: number = 1.0
): { newHomeRating: number; newAwayRating: number } {
  const baseKFactor = K_FACTORS[league] || 24
  const homeAdvantage = HOME_ADVANTAGE[league] || 70
  
  // Calculate expected scores (with home advantage for prediction)
  // Use sport-specific scaling for consistent probability calculation
  const adjustedHomeRating = homeRating + homeAdvantage
  const scale = ELO_SCALE[league] || 480
  const homeExpected = calculateExpectedScore(adjustedHomeRating, awayRating, scale)
  const awayExpected = 1 - homeExpected
  
  // Determine actual scores (1 = win, 0.5 = draw, 0 = loss)
  let homeActual: number
  let awayActual: number
  
  if (homeScore > awayScore) {
    homeActual = 1
    awayActual = 0
  } else if (homeScore < awayScore) {
    homeActual = 0
    awayActual = 1
  } else {
    // Draw (common in soccer)
    homeActual = 0.5
    awayActual = 0.5
  }
  
  // Calculate margin of victory
  const margin = Math.abs(homeScore - awayScore)
  
  // Calculate Elo difference from winner's perspective
  // Positive if favorite won, negative if underdog won
  let winnerEloDiff: number
  if (homeScore > awayScore) {
    // Home team won - Elo diff is home's advantage
    winnerEloDiff = adjustedHomeRating - awayRating
  } else if (awayScore > homeScore) {
    // Away team won - Elo diff is away's advantage (negative of home's)
    winnerEloDiff = awayRating - adjustedHomeRating
  } else {
    // Draw - no winner, use 0
    winnerEloDiff = 0
  }
  
  // Calculate MOV multiplier (blowouts = more rating change)
  const movMultiplier = calculateMOVMultiplier(margin, winnerEloDiff, league)
  
  // Apply MOV multiplier and recency multiplier to K-factor
  const adjustedKFactor = baseKFactor * movMultiplier * recencyMultiplier
  
  // Calculate new ratings (without home advantage - that's only for prediction)
  const newHomeRating = calculateNewRating(homeRating, homeExpected, homeActual, adjustedKFactor)
  const newAwayRating = calculateNewRating(awayRating, awayExpected, awayActual, adjustedKFactor)
  
  return {
    newHomeRating: Math.round(newHomeRating),
    newAwayRating: Math.round(newAwayRating)
  }
}

// ============================================
// REDIS STORAGE
// ============================================

const ELO_RATINGS_KEY = 'elo_ratings'
const ELO_PROCESSED_GAMES_KEY = 'elo_processed_games'

async function getRedisClient() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.warn('[Elo] Redis not configured')
    return null
  }
  
  return { url, token }
}

/**
 * Get all Elo ratings from Redis
 */
export async function getEloRatings(): Promise<EloRatings | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    // Use Upstash REST API format: POST with command array
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', ELO_RATINGS_KEY]),
      cache: 'no-store'  // Prevent Next.js from caching/deduping this request
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as EloRatings
  } catch (error) {
    console.error('[Elo] Error getting ratings:', error)
    return null
  }
}

/**
 * Save Elo ratings to Redis
 */
export async function saveEloRatings(ratings: EloRatings): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) {
    console.warn('[Elo] Redis not configured, cannot save ratings')
    return false
  }
  
  try {
    // Ensure ratings object has proper structure
    const safeRatings: EloRatings = {
      ratings: ratings.ratings || {},
      lastUpdated: ratings.lastUpdated || new Date().toISOString(),
      gamesProcessed: ratings.gamesProcessed || 0
    }
    
    // Use Upstash REST API format: POST with command array
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', ELO_RATINGS_KEY, JSON.stringify(safeRatings)])
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Elo] Failed to save ratings: ${response.status} - ${errorText}`)
      return false
    }
    
    const data = await response.json()
    if (data.error) {
      console.error(`[Elo] Redis error: ${data.error}`)
      return false
    }
    
    console.log(`[Elo] Saved ratings for ${Object.keys(safeRatings.ratings).length} teams`)
    return true
  } catch (error) {
    console.error('[Elo] Error saving ratings:', error)
    return false
  }
}

/**
 * Get set of already processed game IDs
 */
export async function getProcessedGameIds(): Promise<Set<string>> {
  const redis = await getRedisClient()
  if (!redis) return new Set()
  
  try {
    // Use Upstash REST API format: POST with command array
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', ELO_PROCESSED_GAMES_KEY]),
      cache: 'no-store'  // Prevent Next.js from caching/deduping this request
    })
    
    if (!response.ok) return new Set()
    
    const data = await response.json()
    if (!data.result) return new Set()
    
    const gameIds = JSON.parse(data.result) as string[]
    return new Set(gameIds)
  } catch (error) {
    console.error('[Elo] Error getting processed games:', error)
    return new Set()
  }
}

/**
 * Save processed game IDs to Redis
 */
export async function saveProcessedGameIds(gameIds: Set<string>): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    const gameIdsArray = Array.from(gameIds)
    // Use Upstash REST API format: POST with command array
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', ELO_PROCESSED_GAMES_KEY, JSON.stringify(gameIdsArray)])
    })
  } catch (error) {
    console.error('[Elo] Error saving processed games:', error)
  }
}

/**
 * Clear all Elo data from Redis (ratings + processed game IDs)
 * Used for full reset before re-backfilling from scratch
 */
export async function clearEloData(): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) return false
  
  try {
    // Delete ratings
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['DEL', ELO_RATINGS_KEY])
    })
    
    // Delete processed game IDs
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['DEL', ELO_PROCESSED_GAMES_KEY])
    })
    
    console.log('[Elo] Cleared all Elo data from Redis')
    return true
  } catch (error) {
    console.error('[Elo] Error clearing Elo data:', error)
    return false
  }
}

// ============================================
// ESPN INTEGRATION
// ============================================

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// Map our league names to ESPN endpoints
const LEAGUE_TO_ESPN: Record<string, { sport: string; league: string }> = {
  'NBA': { sport: 'basketball', league: 'nba' },
  'NFL': { sport: 'football', league: 'nfl' },
  'NHL': { sport: 'hockey', league: 'nhl' },
  'MLB': { sport: 'baseball', league: 'mlb' },
  'NCAAB': { sport: 'basketball', league: 'mens-college-basketball' },
  'NCAAF': { sport: 'football', league: 'college-football' },
  'soccer_epl': { sport: 'soccer', league: 'eng.1' },
  'soccer_spain_la_liga': { sport: 'soccer', league: 'esp.1' },
  'soccer_germany_bundesliga': { sport: 'soccer', league: 'ger.1' },
  'soccer_italy_serie_a': { sport: 'soccer', league: 'ita.1' },
  'soccer_france_ligue_one': { sport: 'soccer', league: 'fra.1' },
  'soccer_usa_mls': { sport: 'soccer', league: 'usa.1' },
  'soccer_uefa_champs_league': { sport: 'soccer', league: 'uefa.champions' },
}

/**
 * Fetch completed games from ESPN for a specific date
 */
async function fetchCompletedGames(
  sport: string,
  league: string,
  leagueName: string,
  date: string
): Promise<GameResult[]> {
  try {
    // For college sports, ESPN only returns top-25/featured games by default.
    // Adding groups=50 (D1) and limit=300 fetches ALL Division I games.
    const isCollege = leagueName === 'NCAAB' || leagueName === 'NCAAF'
    const collegeParams = isCollege ? '&groups=50&limit=300' : ''
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard?dates=${date}${collegeParams}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    
    if (!data.events || !Array.isArray(data.events)) return []
    
    const completedGames: GameResult[] = []
    
    for (const event of data.events) {
      // Only process completed games
      if (!event.status?.type?.completed) continue
      
      // Filter out preseason/spring training games (season type 1 = preseason, 2 = regular, 3 = postseason)
      // Spring training games are meaningless for Elo — starters play 3-5 innings, lineups rotate constantly
      const seasonType = event.season?.type
      if (seasonType !== undefined && seasonType !== 2 && seasonType !== 3) {
        continue
      }
      
      const competition = event.competitions?.[0]
      if (!competition) continue
      
      const homeTeam = competition.competitors?.find(
        (c: { homeAway: string }) => c.homeAway === 'home'
      )
      const awayTeam = competition.competitors?.find(
        (c: { homeAway: string }) => c.homeAway === 'away'
      )
      
      if (!homeTeam || !awayTeam) continue
      
      const homeScore = parseInt(homeTeam.score || '0', 10)
      const awayScore = parseInt(awayTeam.score || '0', 10)
      
      completedGames.push({
        gameId: event.id,
        league: leagueName,
        homeTeamId: homeTeam.team?.id || homeTeam.id,
        homeTeamName: homeTeam.team?.displayName || homeTeam.team?.name || 'Unknown',
        awayTeamId: awayTeam.team?.id || awayTeam.id,
        awayTeamName: awayTeam.team?.displayName || awayTeam.team?.name || 'Unknown',
        homeScore,
        awayScore,
        date: event.date
      })
    }
    
    return completedGames
  } catch (error) {
    console.error(`[Elo] Error fetching games for ${sport}/${league}:`, error)
    return []
  }
}

/**
 * Get date string in YYYYMMDD format for ESPN API
 */
function formatDateForESPN(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/**
 * Fetch all completed games from yesterday (for daily cron job)
 */
export async function fetchYesterdaysGames(): Promise<GameResult[]> {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = formatDateForESPN(yesterday)
  
  console.log(`[Elo] Fetching completed games for ${dateStr}...`)
  
  const allGames: GameResult[] = []
  
  for (const [leagueName, espnInfo] of Object.entries(LEAGUE_TO_ESPN)) {
    const games = await fetchCompletedGames(
      espnInfo.sport,
      espnInfo.league,
      leagueName,
      dateStr
    )
    allGames.push(...games)
    
    if (games.length > 0) {
      console.log(`[Elo] ${leagueName}: ${games.length} completed games`)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log(`[Elo] Total completed games: ${allGames.length}`)
  return allGames
}

/**
 * Backfill historical games from a date range
 * Used for initial setup to build ratings from season start
 * @param leagueFilter - Optional: only process specific league(s)
 */
export async function backfillHistoricalGames(
  startDate: Date,
  endDate: Date,
  leagueFilter?: string | string[]
): Promise<GameResult[]> {
  // Determine which leagues to process
  const leaguesToProcess = leagueFilter 
    ? (Array.isArray(leagueFilter) ? leagueFilter : [leagueFilter])
    : Object.keys(LEAGUE_TO_ESPN)
  
  console.log(`[Elo] Backfilling games from ${formatDateForESPN(startDate)} to ${formatDateForESPN(endDate)} for leagues: ${leaguesToProcess.join(', ')}...`)
  
  const allGames: GameResult[] = []
  const currentDate = new Date(startDate)
  
  while (currentDate <= endDate) {
    const dateStr = formatDateForESPN(currentDate)
    
    for (const leagueName of leaguesToProcess) {
      const espnInfo = LEAGUE_TO_ESPN[leagueName]
      if (!espnInfo) continue
      
      const games = await fetchCompletedGames(
        espnInfo.sport,
        espnInfo.league,
        leagueName,
        dateStr
      )
      allGames.push(...games)
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1)
    
    // Log progress every 7 days
    if (allGames.length > 0 && currentDate.getDate() % 7 === 0) {
      console.log(`[Elo] Progress: ${allGames.length} games fetched through ${dateStr}`)
    }
  }
  
  console.log(`[Elo] Backfill complete: ${allGames.length} total games`)
  return allGames
}

// Export the league list for use in debug endpoints
export const SUPPORTED_LEAGUES = Object.keys(LEAGUE_TO_ESPN)

// ============================================
// MAIN UPDATE FUNCTION
// ============================================

/**
 * Process game results and update Elo ratings
 * This is the main function called by the cron job
 */
export async function updateEloRatings(games: GameResult[]): Promise<EloRatings> {
  // Get existing ratings or initialize
  let eloData = await getEloRatings()
  if (!eloData || !eloData.ratings) {
    eloData = {
      ratings: {},
      lastUpdated: new Date().toISOString(),
      gamesProcessed: 0
    }
  }
  // Ensure ratings object exists (defensive)
  eloData.ratings = eloData.ratings || {}
  eloData.gamesProcessed = eloData.gamesProcessed || 0
  
  // Get already processed game IDs to avoid duplicates
  const processedIds = await getProcessedGameIds()
  
  // Sort games by date to process chronologically
  const sortedGames = [...games].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )
  
  let newGamesProcessed = 0
  
  for (const game of sortedGames) {
    // Skip if already processed
    if (processedIds.has(game.gameId)) continue
    
    const homeKey = `${game.league}:${game.homeTeamId}`
    const awayKey = `${game.league}:${game.awayTeamId}`
    
    // Get or initialize team ratings
    if (!eloData.ratings[homeKey]) {
      eloData.ratings[homeKey] = {
        teamId: game.homeTeamId,
        teamName: game.homeTeamName,
        league: game.league,
        rating: DEFAULT_RATING,
        gamesPlayed: 0,
        lastUpdated: game.date
      }
    }
    
    if (!eloData.ratings[awayKey]) {
      eloData.ratings[awayKey] = {
        teamId: game.awayTeamId,
        teamName: game.awayTeamName,
        league: game.league,
        rating: DEFAULT_RATING,
        gamesPlayed: 0,
        lastUpdated: game.date
      }
    }
    
    const homeTeam = eloData.ratings[homeKey]
    const awayTeam = eloData.ratings[awayKey]
    
    // RECENCY WEIGHTING: Apply K-factor multiplier based on days since last game
    // Teams in active rhythm (played recently) get higher K-factor so Elo reacts
    // more to their current form. Teams coming off long breaks get lower K-factor.
    const gameDate = new Date(game.date)
    const homeLastPlayed = new Date(homeTeam.lastUpdated)
    const awayLastPlayed = new Date(awayTeam.lastUpdated)
    const homeDaysSinceLast = Math.max(0, Math.floor((gameDate.getTime() - homeLastPlayed.getTime()) / (1000 * 60 * 60 * 24)))
    const awayDaysSinceLast = Math.max(0, Math.floor((gameDate.getTime() - awayLastPlayed.getTime()) / (1000 * 60 * 60 * 24)))
    
    // Average both teams' recency to get a single game-level multiplier
    // (both teams play the same game, so the K-factor should be symmetric)
    const homeRecency = homeDaysSinceLast <= RECENCY_RECENT_DAYS ? RECENCY_K_MULTIPLIER.RECENT
      : homeDaysSinceLast >= RECENCY_STALE_DAYS ? RECENCY_K_MULTIPLIER.STALE
      : RECENCY_K_MULTIPLIER.NORMAL
    const awayRecency = awayDaysSinceLast <= RECENCY_RECENT_DAYS ? RECENCY_K_MULTIPLIER.RECENT
      : awayDaysSinceLast >= RECENCY_STALE_DAYS ? RECENCY_K_MULTIPLIER.STALE
      : RECENCY_K_MULTIPLIER.NORMAL
    const recencyMultiplier = (homeRecency + awayRecency) / 2
    
    // EARLY-SEASON K-FACTOR BOOST: For leagues like MLB, use higher K-factor
    // when teams have played fewer than N games so ratings converge faster
    const earlySeasonBoost = EARLY_SEASON_K_BOOST[game.league]
    const earlySeasonMultiplier = earlySeasonBoost && 
      Math.max(homeTeam.gamesPlayed, awayTeam.gamesPlayed) < earlySeasonBoost.maxGames
      ? earlySeasonBoost.multiplier
      : 1.0
    
    // Update ratings with recency-weighted and early-season-boosted K-factor
    const { newHomeRating, newAwayRating } = updateRatingsAfterGame(
      homeTeam.rating,
      awayTeam.rating,
      game.homeScore,
      game.awayScore,
      game.league,
      recencyMultiplier * earlySeasonMultiplier
    )
    
    homeTeam.rating = newHomeRating
    homeTeam.gamesPlayed++
    homeTeam.lastUpdated = game.date
    
    awayTeam.rating = newAwayRating
    awayTeam.gamesPlayed++
    awayTeam.lastUpdated = game.date
    
    // Track last 10 game results for form tracking
    // 1 = win, 0 = loss, 0.5 = draw
    const homeResult = game.homeScore > game.awayScore ? 1 : game.homeScore < game.awayScore ? 0 : 0.5
    const awayResult = game.awayScore > game.homeScore ? 1 : game.awayScore < game.homeScore ? 0 : 0.5
    if (!homeTeam.recentResults) homeTeam.recentResults = []
    homeTeam.recentResults.push(homeResult)
    if (homeTeam.recentResults.length > 10) homeTeam.recentResults.shift()
    if (!awayTeam.recentResults) awayTeam.recentResults = []
    awayTeam.recentResults.push(awayResult)
    if (awayTeam.recentResults.length > 10) awayTeam.recentResults.shift()
    
    // FIX 2: Track margin statistics for team-specific variance
    // Margin is from the team's perspective (positive = win, negative = loss)
    const homeMargin = game.homeScore - game.awayScore
    const awayMargin = game.awayScore - game.homeScore
    
    // Update home team margin stats
    if (!homeTeam.marginStats) {
      homeTeam.marginStats = {
        totalMargin: 0,
        marginSquaredSum: 0,
        marginCount: 0,
        avgMargin: 0,
        marginVariance: 0,
        marginStdDev: MARGIN_SIGMA[game.league] || 12 // Default to league average
      }
    }
    homeTeam.marginStats.totalMargin += homeMargin
    homeTeam.marginStats.marginSquaredSum += homeMargin * homeMargin
    homeTeam.marginStats.marginCount++
    homeTeam.marginStats.avgMargin = homeTeam.marginStats.totalMargin / homeTeam.marginStats.marginCount
    // Calculate variance: E[X^2] - E[X]^2
    const homeAvgSquared = homeTeam.marginStats.marginSquaredSum / homeTeam.marginStats.marginCount
    homeTeam.marginStats.marginVariance = homeAvgSquared - (homeTeam.marginStats.avgMargin * homeTeam.marginStats.avgMargin)
    homeTeam.marginStats.marginStdDev = Math.sqrt(Math.max(0, homeTeam.marginStats.marginVariance))
    
    // Update away team margin stats
    if (!awayTeam.marginStats) {
      awayTeam.marginStats = {
        totalMargin: 0,
        marginSquaredSum: 0,
        marginCount: 0,
        avgMargin: 0,
        marginVariance: 0,
        marginStdDev: MARGIN_SIGMA[game.league] || 12 // Default to league average
      }
    }
    awayTeam.marginStats.totalMargin += awayMargin
    awayTeam.marginStats.marginSquaredSum += awayMargin * awayMargin
    awayTeam.marginStats.marginCount++
    awayTeam.marginStats.avgMargin = awayTeam.marginStats.totalMargin / awayTeam.marginStats.marginCount
    // Calculate variance: E[X^2] - E[X]^2
    const awayAvgSquared = awayTeam.marginStats.marginSquaredSum / awayTeam.marginStats.marginCount
    awayTeam.marginStats.marginVariance = awayAvgSquared - (awayTeam.marginStats.avgMargin * awayTeam.marginStats.avgMargin)
    awayTeam.marginStats.marginStdDev = Math.sqrt(Math.max(0, awayTeam.marginStats.marginVariance))
    
    // Mark game as processed
    processedIds.add(game.gameId)
    newGamesProcessed++
  }
  
  // Update metadata
  eloData.lastUpdated = new Date().toISOString()
  eloData.gamesProcessed += newGamesProcessed
  
  // Save to Redis
  await saveEloRatings(eloData)
  await saveProcessedGameIds(processedIds)
  
  console.log(`[Elo] Updated ratings: ${newGamesProcessed} new games processed, ${Object.keys(eloData.ratings).length} teams tracked`)
  
  return eloData
}

// ============================================
// LOOKUP FUNCTIONS
// ============================================

/**
 * Get Elo rating for a team
 */
export async function getTeamRating(
  league: string,
  teamId: string
): Promise<TeamRating | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  const key = `${league}:${teamId}`
  return eloData.ratings[key] || null
}

/**
 * FIX 2: Get team margin stats by team name
 * Returns the team's margin statistics for team-specific variance calculations
 */
export async function getTeamMarginStatsByName(
  league: string,
  teamName: string
): Promise<{
  marginStdDev: number
  avgMargin: number
  marginCount: number
} | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  // Find team by name (case-insensitive partial match)
  const teamKey = Object.keys(eloData.ratings).find(key => {
    const rating = eloData.ratings[key]
    return rating.league === league && 
           rating.teamName.toLowerCase().includes(teamName.toLowerCase())
  })
  
  if (!teamKey) return null
  
  const team = eloData.ratings[teamKey]
  if (!team.marginStats) {
    // Return league default if no margin stats yet
    return {
      marginStdDev: MARGIN_SIGMA[league] || 12,
      avgMargin: 0,
      marginCount: 0
    }
  }
  
  return {
    marginStdDev: team.marginStats.marginStdDev,
    avgMargin: team.marginStats.avgMargin,
    marginCount: team.marginStats.marginCount
  }
}

/**
 * Get last-10 game record for a team by name
 * Returns { wins, losses } or null if no data
 */
export async function getTeamLast10ByName(
  league: string,
  teamName: string
): Promise<{ wins: number; losses: number } | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  const teamKey = Object.keys(eloData.ratings).find(key => {
    const rating = eloData.ratings[key]
    return rating.league === league && 
           rating.teamName.toLowerCase().includes(teamName.toLowerCase())
  })
  
  if (!teamKey) return null
  
  const team = eloData.ratings[teamKey]
  if (!team.recentResults || team.recentResults.length === 0) return null
  
  const wins = team.recentResults.filter(r => r === 1).length
  const losses = team.recentResults.filter(r => r === 0).length
  return { wins, losses }
}

/**
 * Get Elo-based win probability for a matchup
 * Returns probability that home team wins
 */
export async function getEloWinProbability(
  league: string,
  homeTeamId: string,
  awayTeamId: string,
  isNeutralSite: boolean = false
): Promise<{ probability: number; homeRating: number; awayRating: number } | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  const homeKey = `${league}:${homeTeamId}`
  const awayKey = `${league}:${awayTeamId}`
  
  const homeRating = eloData.ratings[homeKey]?.rating || DEFAULT_RATING
  const awayRating = eloData.ratings[awayKey]?.rating || DEFAULT_RATING
  
  const probability = calculateWinProbability(homeRating, awayRating, league, isNeutralSite)
  
  return {
    probability,
    homeRating,
    awayRating
  }
}

/**
 * Get Elo-based win probability by team names (fuzzy match)
 * Used when we don't have exact team IDs
 * 
 * IMPORTANT: Returns null if EITHER team is not found in the cache.
 * This ensures we only return Elo data when we have real ratings for both teams.
 * Using default 1500 for missing teams would give meaningless predictions.
 */
export async function getEloWinProbabilityByName(
  league: string,
  homeTeamName: string,
  awayTeamName: string,
  isNeutralSite: boolean = false
): Promise<{ probability: number; homeRating: number; awayRating: number; confidence: string; homeFound: boolean; awayFound: boolean; homeGamesPlayed?: number; awayGamesPlayed?: number } | null> {
  console.log(`[Elo Lookup] Starting lookup for ${league}: ${homeTeamName} vs ${awayTeamName}`)
  
  const eloData = await getEloRatings()
  
  // If no Elo data in cache, return null - don't use default ratings
  // Using default 1500 for all teams would make all recommendations meaningless (all teams equal)
  // The caller should handle this case by showing a clear message to the user
  if (!eloData) {
    console.log(`[Elo Lookup] FAIL: No Elo data in cache at all - cache needs to be populated via /api/cron/update-elo?backfill=true`)
    return null
  }
  
  // Defensive: ensure ratings object exists
  const ratings = eloData.ratings || {}
  const totalTeams = Object.keys(ratings).length
  console.log(`[Elo Lookup] Cache has ${totalTeams} total teams, last updated: ${eloData.lastUpdated}`)
  
  // Find teams by name (case-insensitive partial match)
  const normalizeTeamName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const homeNorm = normalizeTeamName(homeTeamName)
  const awayNorm = normalizeTeamName(awayTeamName)
  
  // Count teams in this league for debugging
  const leagueTeams = Object.values(ratings).filter(r => r.league === league)
  console.log(`[Elo Lookup] Found ${leagueTeams.length} teams in ${league} cache`)
  if (leagueTeams.length > 0 && leagueTeams.length <= 5) {
    // If very few teams, log them all for debugging
    console.log(`[Elo Lookup] ${league} teams: ${leagueTeams.map(t => t.teamName).join(', ')}`)
  }
  
  let homeTeam: TeamRating | null = null
  let awayTeam: TeamRating | null = null
  
  for (const rating of Object.values(ratings)) {
    if (rating.league !== league) continue
    
    const teamNorm = normalizeTeamName(rating.teamName)
    
    if (teamNorm.includes(homeNorm) || homeNorm.includes(teamNorm)) {
      homeTeam = rating
      console.log(`[Elo Lookup] MATCHED home team: "${homeTeamName}" -> "${rating.teamName}" (Elo: ${rating.rating})`)
    }
    if (teamNorm.includes(awayNorm) || awayNorm.includes(teamNorm)) {
      awayTeam = rating
      console.log(`[Elo Lookup] MATCHED away team: "${awayTeamName}" -> "${rating.teamName}" (Elo: ${rating.rating})`)
    }
  }
  
  // CRITICAL: If either team is not found, return null
  // This prevents using default 1500 ratings which would give meaningless predictions
  // The caller should handle this by falling back to market consensus or showing a message
  if (!homeTeam || !awayTeam) {
    const missingTeams = []
    if (!homeTeam) missingTeams.push(`home: "${homeTeamName}" (normalized: "${homeNorm}")`)
    if (!awayTeam) missingTeams.push(`away: "${awayTeamName}" (normalized: "${awayNorm}")`)
    console.log(`[Elo Lookup] FAIL: Teams not found in ${league} cache: ${missingTeams.join(', ')}. Run backfill to populate.`)
    return null
  }
  
  const homeRating = homeTeam.rating
  const awayRating = awayTeam.rating
  
  // Confidence based on how many games we've seen
  const homeGames = homeTeam.gamesPlayed
  const awayGames = awayTeam.gamesPlayed
  const minGames = Math.min(homeGames, awayGames)
  
  // If either team has fewer than MIN_GAMES_FOR_PREDICTIONS games,
  // their rating is unreliable (e.g., KC Roos with 2 games).
  // Return null so callers fall back to market consensus.
  if (minGames < MIN_GAMES_FOR_PREDICTIONS) {
    console.log(`[Elo Lookup] INSUFFICIENT DATA: ${homeTeamName} (${homeGames} games) vs ${awayTeamName} (${awayGames} games) - need at least ${MIN_GAMES_FOR_PREDICTIONS} games each`)
    return null
  }
  
  const probability = calculateWinProbability(homeRating, awayRating, league, isNeutralSite)
  if (isNeutralSite) {
    console.log(`[Elo Lookup] NEUTRAL SITE: Home advantage zeroed out for ${homeTeamName} vs ${awayTeamName}`)
  }
  
  let confidence: string
  if (minGames >= 20) {
    confidence = 'high'
  } else if (minGames >= 10) {
    confidence = 'medium'
  } else if (minGames >= 5) {
    confidence = 'low'
  } else {
    confidence = 'very_low'
  }
  
  return {
    probability,
    homeRating,
    awayRating,
    confidence,
    homeFound: true,
    awayFound: true,
    homeGamesPlayed: homeGames,
    awayGamesPlayed: awayGames
  }
}

/**
 * Get Elo win probability with injury adjustments
 * This is the main function to use for predictions that account for injuries
 */
export async function getEloWinProbabilityWithInjuries(
  league: string,
  homeTeamName: string,
  awayTeamName: string,
  injuries: InjuryInfo[],
  homeTopScorers?: PlayerImportance[],
  awayTopScorers?: PlayerImportance[],
  homePitcher?: PitcherInfo | null,
  awayPitcher?: PitcherInfo | null,
  isNeutralSite: boolean = false
): Promise<{ 
  probability: number
  homeRating: number
  awayRating: number
  homeEffectiveRating: number
  awayEffectiveRating: number
  confidence: string
  homeAdjustments: string[]
  awayAdjustments: string[]
} | null> {
  // First get base Elo ratings
  const baseResult = await getEloWinProbabilityByName(league, homeTeamName, awayTeamName, isNeutralSite)
  if (!baseResult) return null
  
  // Calculate effective ratings with injury adjustments
  const homeEffective = calculateEffectiveElo(
    baseResult.homeRating,
    league,
    homeTeamName,
    injuries,
    homeTopScorers,
    homePitcher
  )
  
  const awayEffective = calculateEffectiveElo(
    baseResult.awayRating,
    league,
    awayTeamName,
    injuries,
    awayTopScorers,
    awayPitcher
  )
  
  // Calculate win probability using effective ratings
  const probability = calculateWinProbability(
    homeEffective.effectiveRating,
    awayEffective.effectiveRating,
    league,
    isNeutralSite
  )
  
  return {
    probability,
    homeRating: baseResult.homeRating,
    awayRating: baseResult.awayRating,
    homeEffectiveRating: homeEffective.effectiveRating,
    awayEffectiveRating: awayEffective.effectiveRating,
    confidence: baseResult.confidence,
    homeAdjustments: homeEffective.adjustments,
    awayAdjustments: awayEffective.adjustments
  }
}

/**
 * Get all ratings for a league (for display/debugging)
 */
export async function getLeagueRatings(league: string): Promise<TeamRating[]> {
  const eloData = await getEloRatings()
  if (!eloData) return []
  
  // Defensive: ensure ratings object exists
  const ratings = eloData.ratings || {}
  
  return Object.values(ratings)
    .filter(r => r.league === league)
    .sort((a, b) => b.rating - a.rating)
}

/**
 * Get Elo system stats (for debugging/display)
 */
export async function getEloStats(): Promise<{
  totalTeams: number
  totalGamesProcessed: number
  lastUpdated: string
  leagueCounts: Record<string, number>
} | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  // Defensive: ensure ratings object exists
  const ratings = eloData.ratings || {}
  
  const leagueCounts: Record<string, number> = {}
  for (const rating of Object.values(ratings)) {
    leagueCounts[rating.league] = (leagueCounts[rating.league] || 0) + 1
  }
  
  return {
    totalTeams: Object.keys(ratings).length,
    totalGamesProcessed: eloData.gamesProcessed || 0,
    lastUpdated: eloData.lastUpdated || new Date().toISOString(),
    leagueCounts
  }
}

// ============================================
// INJURY ADJUSTMENTS
// ============================================

/**
 * Injury status multipliers - how much of the penalty to apply
 * Out = 100%, Doubtful = 70%, Questionable = 15% (they usually play)
 */
const INJURY_STATUS_MULTIPLIER: Record<string, number> = {
  'out': 1.0,
  'injured reserve': 1.0,
  'ir': 1.0,
  'doubtful': 0.7,
  'questionable': 0.15,
  'probable': 0,
  'day-to-day': 0,
  'active': 0,
}

/**
 * Get the status multiplier for an injury status string
 */
function getStatusMultiplier(status: string): number {
  const normalizedStatus = status.toLowerCase().trim()
  
  // Check for exact matches first
  if (INJURY_STATUS_MULTIPLIER[normalizedStatus] !== undefined) {
    return INJURY_STATUS_MULTIPLIER[normalizedStatus]
  }
  
  // Check for partial matches
  for (const [key, value] of Object.entries(INJURY_STATUS_MULTIPLIER)) {
    if (normalizedStatus.includes(key)) {
      return value
    }
  }
  
  // Default: if status is unknown but player is on injury report, assume 50%
  return 0.5
}

/**
 * Injury data structure (matches ESPN injury format)
 */
export interface InjuryInfo {
  team: string
  player: string
  status: string
  details?: string
  position?: string
}

/**
 * MLB Pitcher info for starting pitcher adjustments
 */
export interface PitcherInfo {
  name: string
  team: string
  era?: number
}

/**
 * Player importance info from player stats
 */
export interface PlayerImportance {
  playerName: string
  teamName: string
  sport: string
  scoringAverage: number  // points for NBA/NCAAB, goals for NHL, yards for NFL
  isTopScorer: boolean    // true if in top 3 scorers for team
}

/**
 * Calculate injury adjustment for a team
 * Returns negative Elo points to subtract from team's rating
 * 
 * Rules:
 * - NFL/NCAAF: Starting QB out = -80 Elo
 * - NHL: Starting goalie out = -30 Elo
 * - NBA/NCAAB/NHL: Top 3 scorer out = -35 Elo each (star players have outsized impact)
 * - Fallback: -10 Elo per rotation player out (for sports without good player data)
 * - Status multipliers: Out=100%, Doubtful=70%, Questionable=15%
 * - Compounding: 3+ players OUT = extra -15 Elo, 5+ = extra -30 Elo (depth depletion)
 */
export function calculateInjuryAdjustment(
  league: string,
  teamName: string,
  injuries: InjuryInfo[],
  topScorers?: PlayerImportance[],
  isStartingQB?: (playerName: string, teamName: string) => boolean,
  isStartingGoalie?: (playerName: string, teamName: string) => boolean
): { adjustment: number; details: string[] } {
  let totalAdjustment = 0
  const details: string[] = []
  
  // Filter injuries for this team
  const teamInjuries = injuries.filter(inj => {
    const injTeamNorm = inj.team.toLowerCase().replace(/[^a-z0-9]/g, '')
    const teamNorm = teamName.toLowerCase().replace(/[^a-z0-9]/g, '')
    return injTeamNorm.includes(teamNorm) || teamNorm.includes(injTeamNorm)
  })
  
  if (teamInjuries.length === 0) {
    return { adjustment: 0, details: [] }
  }
  
  // Skip soccer - no adjustments per user request
  if (league.startsWith('soccer_')) {
    return { adjustment: 0, details: ['Soccer: no injury adjustments applied'] }
  }
  
  for (const injury of teamInjuries) {
    const statusMultiplier = getStatusMultiplier(injury.status)
    if (statusMultiplier === 0) continue  // Player is probable/active, skip
    
    const playerNameLower = injury.player.toLowerCase()
    const positionLower = (injury.position || injury.details || '').toLowerCase()
    
    // NFL/NCAAF: Check for starting QB
    if (league === 'NFL' || league === 'NCAAF') {
      const isQB = positionLower.includes('qb') || 
                   positionLower.includes('quarterback') ||
                   (isStartingQB && isStartingQB(injury.player, teamName))
      
      if (isQB) {
        // Only apply if it's likely the starting QB (first QB on injury list or explicitly marked)
        const qbPenalty = Math.round(-80 * statusMultiplier)
        totalAdjustment += qbPenalty
        details.push(`${injury.player} (QB, ${injury.status}): ${qbPenalty} Elo`)
        continue  // Don't double-count as top scorer
      }
    }
    
    // NHL: Check for starting goalie
    if (league === 'NHL') {
      const isGoalie = positionLower.includes('g') || 
                       positionLower.includes('goalie') ||
                       positionLower.includes('goaltender') ||
                       (isStartingGoalie && isStartingGoalie(injury.player, teamName))
      
      if (isGoalie) {
        const goaliePenalty = Math.round(-30 * statusMultiplier)
        totalAdjustment += goaliePenalty
        details.push(`${injury.player} (Goalie, ${injury.status}): ${goaliePenalty} Elo`)
        continue
      }
    }
    
    // Check if player is a top 3 scorer for the team
    if (topScorers && topScorers.length > 0) {
      const isTopScorer = topScorers.some(scorer => {
        const scorerNameNorm = scorer.playerName.toLowerCase().replace(/[^a-z]/g, '')
        const injuryNameNorm = playerNameLower.replace(/[^a-z]/g, '')
        return scorerNameNorm.includes(injuryNameNorm) || injuryNameNorm.includes(scorerNameNorm)
      })
      
      if (isTopScorer) {
        const topScorerPenalty = Math.round(-35 * statusMultiplier)
        totalAdjustment += topScorerPenalty
        details.push(`${injury.player} (Top Scorer, ${injury.status}): ${topScorerPenalty} Elo`)
        continue
      }
    }
    
    // Fallback: -10 Elo per rotation player out (for sports without good player data)
    // Only apply if status indicates they're actually out/doubtful
    if (statusMultiplier >= 0.5) {
      const fallbackPenalty = Math.round(-10 * statusMultiplier)
      totalAdjustment += fallbackPenalty
      details.push(`${injury.player} (${injury.status}): ${fallbackPenalty} Elo`)
    }
  }
  
  // Compounding penalty for depth depletion
  // When multiple players are OUT, the team's depth is severely compromised
  // This goes beyond individual player value — it changes the team's identity
  const outCount = teamInjuries.filter(inj => getStatusMultiplier(inj.status) >= 0.7).length
  if (outCount >= 5) {
    totalAdjustment += -30
    details.push(`Depth crisis: ${outCount} players OUT/Doubtful — extra -30 Elo`)
  } else if (outCount >= 3) {
    totalAdjustment += -15
    details.push(`Depth concern: ${outCount} players OUT/Doubtful — extra -15 Elo`)
  }
  
  return { adjustment: totalAdjustment, details }
}

/**
 * Calculate MLB starting pitcher adjustment
 * Good pitchers ADD Elo to the team
 * 
 * Rules:
 * - ERA < 3.0 = +20 Elo
 * - ERA < 3.8 = +10 Elo
 * - ERA >= 3.8 or unknown = +0 Elo
 */
export function calculatePitcherAdjustment(
  pitcher: PitcherInfo | null
): { adjustment: number; details: string } {
  if (!pitcher || pitcher.era === undefined) {
    return { adjustment: 0, details: 'No starting pitcher info available' }
  }
  
  if (pitcher.era < 3.0) {
    return { 
      adjustment: 20, 
      details: `${pitcher.name} (ERA ${pitcher.era.toFixed(2)}): +20 Elo (elite pitcher)` 
    }
  }
  
  if (pitcher.era < 3.8) {
    return { 
      adjustment: 10, 
      details: `${pitcher.name} (ERA ${pitcher.era.toFixed(2)}): +10 Elo (good pitcher)` 
    }
  }
  
  return { 
    adjustment: 0, 
    details: `${pitcher.name} (ERA ${pitcher.era.toFixed(2)}): +0 Elo (average pitcher)` 
  }
}

/**
 * Calculate effective Elo rating for a team, accounting for injuries and pitchers
 * This is used at prediction time - the stored Elo rating is NOT modified
 */
export function calculateEffectiveElo(
  baseRating: number,
  league: string,
  teamName: string,
  injuries: InjuryInfo[],
  topScorers?: PlayerImportance[],
  pitcher?: PitcherInfo | null,
  isStartingQB?: (playerName: string, teamName: string) => boolean,
  isStartingGoalie?: (playerName: string, teamName: string) => boolean
): { effectiveRating: number; baseRating: number; adjustments: string[] } {
  const adjustments: string[] = []
  let effectiveRating = baseRating
  
  // Apply injury adjustments
  const injuryResult = calculateInjuryAdjustment(
    league, 
    teamName, 
    injuries, 
    topScorers,
    isStartingQB,
    isStartingGoalie
  )
  
  if (injuryResult.adjustment !== 0) {
    effectiveRating += injuryResult.adjustment
    adjustments.push(...injuryResult.details)
  }
  
  // Apply MLB pitcher adjustment
  if (league === 'MLB' && pitcher) {
    const pitcherResult = calculatePitcherAdjustment(pitcher)
    if (pitcherResult.adjustment !== 0) {
      effectiveRating += pitcherResult.adjustment
      adjustments.push(pitcherResult.details)
    }
  }
  
  return {
    effectiveRating,
    baseRating,
    adjustments
  }
}

/**
 * Calculate win probability with injury adjustments
 * This is the main function to use for predictions that account for injuries
 */
export function calculateWinProbabilityWithInjuries(
  homeRating: number,
  awayRating: number,
  league: string,
  homeTeamName: string,
  awayTeamName: string,
  injuries: InjuryInfo[],
  homeTopScorers?: PlayerImportance[],
  awayTopScorers?: PlayerImportance[],
  homePitcher?: PitcherInfo | null,
  awayPitcher?: PitcherInfo | null,
  isNeutralSite: boolean = false
): { 
  probability: number
  homeEffectiveRating: number
  awayEffectiveRating: number
  homeAdjustments: string[]
  awayAdjustments: string[]
} {
  // Calculate effective ratings for both teams
  const homeEffective = calculateEffectiveElo(
    homeRating,
    league,
    homeTeamName,
    injuries,
    homeTopScorers,
    homePitcher
  )
  
  const awayEffective = calculateEffectiveElo(
    awayRating,
    league,
    awayTeamName,
    injuries,
    awayTopScorers,
    awayPitcher
  )
  
  // Calculate win probability using effective ratings
  const probability = calculateWinProbability(
    homeEffective.effectiveRating,
    awayEffective.effectiveRating,
    league,
    isNeutralSite
  )
  
  return {
    probability,
    homeEffectiveRating: homeEffective.effectiveRating,
    awayEffectiveRating: awayEffective.effectiveRating,
    homeAdjustments: homeEffective.adjustments,
    awayAdjustments: awayEffective.adjustments
  }
}

// ============================================
// ELO-BASED SPREAD & TOTAL PREDICTIONS
// ============================================

/**
 * Standard Normal CDF approximation (Abramowitz and Stegun formula 7.1.26)
 * Used for calculating probabilities from z-scores
 * 
 * This uses the error function (erf) approximation and converts to CDF:
 * CDF(x) = 0.5 * (1 + erf(x / sqrt(2)))
 */
function normalCDF(x: number): number {
  const a1 =  0.254829592
  const a2 = -0.284496736
  const a3 =  1.421413741
  const a4 = -1.453152027
  const a5 =  1.061405429
  const p  =  0.3275911

  // Save the sign of x
  const sign = x < 0 ? -1 : 1
  // CRITICAL: Divide by sqrt(2) to convert from standard normal z-score to erf argument
  x = Math.abs(x) / Math.sqrt(2)

  // A&S formula 7.1.26 for erf approximation
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return 0.5 * (1.0 + sign * y)
}

/**
 * Calculate expected margin of victory from Elo ratings
 * Positive = home team expected to win by that margin
 * Negative = away team expected to win by that margin
 * 
 * @param homeElo - Home team's Elo rating (can be effective rating with injury adjustments)
 * @param awayElo - Away team's Elo rating
 * @param league - League name for sport-specific parameters
 */
export function calculateExpectedMargin(
  homeElo: number,
  awayElo: number,
  league: string,
  isNeutralSite: boolean = false
): number {
  // Zero out home advantage for neutral site games
  const homeAdvantage = isNeutralSite ? 0 : (HOME_ADVANTAGE[league] || 70)
  const beta = MARGIN_BETA[league] || 0.03
  
  // Elo diff including home advantage
  const eloDiff = (homeElo + homeAdvantage) - awayElo
  
  // Convert to expected margin
  return beta * eloDiff
}

/**
 * Calculate probability of covering a spread using Elo ratings
 * 
 * @param homeElo - Home team's Elo rating
 * @param awayElo - Away team's Elo rating
 * @param spread - The spread line FROM HOME TEAM'S PERSPECTIVE
 *                 e.g., -3.5 means home is favored by 3.5 (must win by > 3.5 to cover)
 *                 e.g., +3.5 means home is underdog by 3.5 (can lose by up to 3 and cover)
 * @param league - League name for sport-specific parameters
 * @param forHome - If true, calculate P(home covers), else P(away covers)
 * @returns Probability of covering (0-1)
 */
export function calculateSpreadCoverProbability(
  homeElo: number,
  awayElo: number,
  spread: number,
  league: string,
  forHome: boolean = true,
  teamSpecificSigma?: number,  // FIX 2: Optional team-specific sigma for variance adjustment
  isNeutralSite: boolean = false
): { probability: number; expectedMargin: number; confidence: string; sigmaUsed: number } {
  // FIX 2: Use team-specific sigma if provided and valid, otherwise use league default
  // Team-specific sigma accounts for blowout risk (bad teams have higher variance)
  const leagueSigma = MARGIN_SIGMA[league] || 12
  
  // Only use team-specific sigma if it's reasonable (within 50%-200% of league average)
  // This prevents extreme values from skewing predictions
  let sigma = leagueSigma
  if (teamSpecificSigma && teamSpecificSigma > 0) {
    const minSigma = leagueSigma * 0.5
    const maxSigma = leagueSigma * 2.0
    if (teamSpecificSigma >= minSigma && teamSpecificSigma <= maxSigma) {
      // Blend team-specific sigma with league average (70% team, 30% league)
      // This smooths out noise while still accounting for team variance
      sigma = teamSpecificSigma * 0.7 + leagueSigma * 0.3
    }
  }
  
  const expectedMargin = calculateExpectedMargin(homeElo, awayElo, league, isNeutralSite)
  
  // SPREAD SEMANTICS (from home team's perspective):
  // - Home -3.5: Home must win by > 3.5 to cover → P(margin > 3.5)
  // - Home +3.5: Home can lose by up to 3 and cover → P(margin > -3.5)
  // 
  // The threshold for home covering is: -spread
  // (If spread is -3.5, threshold is 3.5; if spread is +3.5, threshold is -3.5)
  //
  // For away covering: it's the complement of home covering
  
  const threshold = -spread  // Convert spread to threshold
  
  let probability: number
  if (forHome) {
    // Home covers if actual margin > threshold
    // P(margin > threshold) = 1 - NormalCDF((threshold - expectedMargin) / sigma)
    const zScore = (threshold - expectedMargin) / sigma
    probability = 1 - normalCDF(zScore)
  } else {
    // Away covers if home doesn't cover (margin <= threshold)
    // P(margin <= threshold) = NormalCDF((threshold - expectedMargin) / sigma)
    const zScore = (threshold - expectedMargin) / sigma
    probability = normalCDF(zScore)
  }
  
  // Determine confidence based on how far from 50% the probability is
  // FIX 2: Higher sigma (more variance) reduces confidence
  const edgeFromEven = Math.abs(probability - 0.5)
  const sigmaFactor = leagueSigma / sigma  // Higher sigma = lower confidence
  const adjustedEdge = edgeFromEven * sigmaFactor
  
  let confidence: string
  if (adjustedEdge > 0.15) {
    confidence = 'high'
  } else if (adjustedEdge > 0.08) {
    confidence = 'medium'
  } else {
    confidence = 'low'
  }
  
  return {
    probability: Math.max(0.01, Math.min(0.99, probability)), // Clamp to avoid extreme values
    expectedMargin,
    confidence,
    sigmaUsed: sigma  // FIX 2: Return the sigma used for transparency
  }
}

/**
 * Calculate expected total points from Elo ratings
 * Uses league baseline + adjustment based on combined team strength
 * 
 * @param homeElo - Home team's Elo rating
 * @param awayElo - Away team's Elo rating
 * @param league - League name for sport-specific parameters
 */
export function calculateExpectedTotal(
  homeElo: number,
  awayElo: number,
  league: string,
  marketLine?: number
): number {
  const baseline = TOTAL_BASELINE[league] || 200
  const eloFactor = TOTAL_ELO_FACTOR[league] || 0.01
  
  // Average Elo of both teams relative to baseline (1500)
  const avgElo = (homeElo + awayElo) / 2
  const eloAboveAverage = avgElo - 1500
  
  // Pure Elo-based expected total (league baseline + small Elo adjustment)
  const eloExpectedTotal = baseline + eloFactor * eloAboveAverage
  
  // FIX: If we have a market line, anchor to it instead of using the crude baseline
  // The market line already accounts for matchup-specific context (pace, offense/defense, etc.)
  // We use the market line as our primary anchor and only apply a small Elo-based adjustment
  // This prevents the model from creating artificial edges by disagreeing with matchup-specific lines
  if (marketLine !== undefined && marketLine > 0) {
    // Calculate how much our Elo model thinks the total should deviate from the league baseline
    const eloDeviation = eloExpectedTotal - baseline
    
    // Apply only the Elo deviation (not the full baseline disagreement) to the market line
    // Weight: 85% market line, 15% Elo adjustment — market is much better at setting game-specific totals
    const eloAdjustment = eloDeviation * 0.15
    return marketLine + eloAdjustment
  }
  
  // Fallback: no market line available, use pure Elo estimate
  return eloExpectedTotal
}

/**
 * Calculate probability of total going over/under a line using Elo ratings
 * 
 * @param homeElo - Home team's Elo rating
 * @param awayElo - Away team's Elo rating
 * @param totalLine - The total line (e.g., 224.5)
 * @param league - League name for sport-specific parameters
 * @param isOver - If true, calculate P(over), else P(under)
 * @returns Probability of over/under (0-1)
 */
export function calculateTotalProbability(
  homeElo: number,
  awayElo: number,
  totalLine: number,
  league: string,
  isOver: boolean = true,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _isNeutralSite: boolean = false  // Reserved for future use — totals don't use HOME_ADVANTAGE directly
): { probability: number; expectedTotal: number; confidence: string } {
  const sigma = TOTAL_SIGMA[league] || 15
  // FIX 3: Pass the market line to anchor expected total to matchup-specific context
  const expectedTotal = calculateExpectedTotal(homeElo, awayElo, league, totalLine)
  
  // P(over) = P(total > line) = 1 - NormalCDF((line - expectedTotal) / sigma)
  // P(under) = P(total < line) = NormalCDF((line - expectedTotal) / sigma)
  
  const zScore = (totalLine - expectedTotal) / sigma
  let probability: number
  
  if (isOver) {
    probability = 1 - normalCDF(zScore)
  } else {
    probability = normalCDF(zScore)
  }
  
  // Determine confidence based on how far from 50% the probability is
  const edgeFromEven = Math.abs(probability - 0.5)
  let confidence: string
  if (edgeFromEven > 0.15) {
    confidence = 'high'
  } else if (edgeFromEven > 0.08) {
    confidence = 'medium'
  } else {
    confidence = 'low'
  }
  
  return {
    probability: Math.max(0.01, Math.min(0.99, probability)), // Clamp to avoid extreme values
    expectedTotal,
    confidence
  }
}

/**
 * Get Elo-based spread cover probability by team names
 * Convenience function that looks up Elo ratings and calculates spread probability
 */
export async function getEloSpreadProbabilityByName(
  league: string,
  homeTeamName: string,
  awayTeamName: string,
  spread: number,
  forHome: boolean = true,
  isNeutralSite: boolean = false
): Promise<{
  probability: number
  expectedMargin: number
  homeRating: number
  awayRating: number
  confidence: string
  sigmaUsed?: number
  teamMarginStdDev?: number
} | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  // Find teams by name (case-insensitive partial match)
  const homeKey = Object.keys(eloData.ratings).find(key => {
    const rating = eloData.ratings[key]
    return rating.league === league && 
           rating.teamName.toLowerCase().includes(homeTeamName.toLowerCase())
  })
  
  const awayKey = Object.keys(eloData.ratings).find(key => {
    const rating = eloData.ratings[key]
    return rating.league === league && 
           rating.teamName.toLowerCase().includes(awayTeamName.toLowerCase())
  })
  
  if (!homeKey || !awayKey) return null
  
  const homeTeam = eloData.ratings[homeKey]
  const awayTeam = eloData.ratings[awayKey]
  
  // FIX 2: Get team-specific sigma for the team we're betting on
  // For spread bets, use the sigma of the team that needs to cover
  const bettingTeam = forHome ? homeTeam : awayTeam
  const teamMarginStdDev = bettingTeam.marginStats?.marginStdDev
  
  const result = calculateSpreadCoverProbability(
    homeTeam.rating, 
    awayTeam.rating, 
    spread, 
    league, 
    forHome,
    teamMarginStdDev,  // FIX 2: Pass team-specific sigma
    isNeutralSite
  )
  
  return {
    ...result,
    homeRating: homeTeam.rating,
    awayRating: awayTeam.rating,
    teamMarginStdDev  // FIX 2: Include for transparency
  }
}

/**
 * Get Elo-based total probability by team names
 * Convenience function that looks up Elo ratings and calculates total probability
 */
export async function getEloTotalProbabilityByName(
  league: string,
  homeTeamName: string,
  awayTeamName: string,
  totalLine: number,
  isOver: boolean = true,
  isNeutralSite: boolean = false
): Promise<{
  probability: number
  expectedTotal: number
  homeRating: number
  awayRating: number
  confidence: string
} | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  // Find teams by name (case-insensitive partial match)
  const homeKey = Object.keys(eloData.ratings).find(key => {
    const rating = eloData.ratings[key]
    return rating.league === league && 
           rating.teamName.toLowerCase().includes(homeTeamName.toLowerCase())
  })
  
  const awayKey = Object.keys(eloData.ratings).find(key => {
    const rating = eloData.ratings[key]
    return rating.league === league && 
           rating.teamName.toLowerCase().includes(awayTeamName.toLowerCase())
  })
  
  if (!homeKey || !awayKey) return null
  
  const homeRating = eloData.ratings[homeKey].rating
  const awayRating = eloData.ratings[awayKey].rating
  
  const result = calculateTotalProbability(homeRating, awayRating, totalLine, league, isOver, isNeutralSite)
  
  return {
    ...result,
    homeRating,
    awayRating
  }
}
