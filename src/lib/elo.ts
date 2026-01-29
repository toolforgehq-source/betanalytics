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
  'MLB': 8,       // 162 games, very stable
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

// Recency decay factor: applied before each game update to shrink ratings toward baseline
// This makes recent games more impactful than older games
// decay^30 gives the relative weight of a game 30 games ago vs a recent game
// 0.98^30 = 0.55 (game 30 ago has 55% weight of recent game)
// 0.97^30 = 0.40 (game 30 ago has 40% weight)
// 0.95^30 = 0.21 (game 30 ago has 21% weight)
// Higher decay = more stability, lower decay = more recency bias
const RECENCY_DECAY: Record<string, number> = {
  'NBA': 0.98,      // 82 games - moderate recency, ~55% weight at 30 games ago
  'NFL': 0.96,      // 17 games - higher recency needed, ~29% weight at 30 games ago
  'NHL': 0.98,      // 82 games - moderate recency
  'MLB': 0.99,      // 162 games - very stable, ~74% weight at 30 games ago
  'NCAAB': 0.97,    // Fewer games - more recency, ~40% weight at 30 games ago
  'NCAAF': 0.95,    // Very few games - highest recency, ~21% weight at 30 games ago
  // Soccer leagues - moderate recency
  'soccer_epl': 0.98,
  'soccer_spain_la_liga': 0.98,
  'soccer_germany_bundesliga': 0.98,
  'soccer_italy_serie_a': 0.98,
  'soccer_france_ligue_one': 0.98,
  'soccer_usa_mls': 0.98,
  'soccer_uefa_champs_league': 0.98,
}

// Home advantage in Elo points (added to home team's rating for prediction)
const HOME_ADVANTAGE: Record<string, number> = {
  'NBA': 100,
  'NFL': 48,      // ~2.5 points spread equivalent
  'NHL': 30,      // ~54-55% home win rate, ~0.3 goals expected margin
  'MLB': 40,
  'NCAAB': 100,
  'NCAAF': 80,
  // Soccer - home advantage is significant
  'soccer_epl': 80,
  'soccer_spain_la_liga': 80,
  'soccer_germany_bundesliga': 80,
  'soccer_italy_serie_a': 80,
  'soccer_france_ligue_one': 80,
  'soccer_usa_mls': 70,
  'soccer_uefa_champs_league': 60,  // Neutral-ish venues in later rounds
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
// TYPES
// ============================================

export interface TeamRating {
  teamId: string
  teamName: string
  league: string
  rating: number
  gamesPlayed: number
  lastUpdated: string
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
// ELO MATH
// ============================================

/**
 * Calculate expected score (win probability) based on rating difference
 * Uses the standard Elo formula: E = 1 / (1 + 10^((Rb - Ra) / 400))
 */
export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * Calculate win probability for home team, including home advantage
 */
export function calculateWinProbability(
  homeRating: number,
  awayRating: number,
  league: string
): number {
  const homeAdvantage = HOME_ADVANTAGE[league] || 70
  const adjustedHomeRating = homeRating + homeAdvantage
  return calculateExpectedScore(adjustedHomeRating, awayRating)
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
 */
export function updateRatingsAfterGame(
  homeRating: number,
  awayRating: number,
  homeScore: number,
  awayScore: number,
  league: string
): { newHomeRating: number; newAwayRating: number } {
  const kFactor = K_FACTORS[league] || 24
  const homeAdvantage = HOME_ADVANTAGE[league] || 70
  
  // Calculate expected scores (with home advantage for prediction)
  const adjustedHomeRating = homeRating + homeAdvantage
  const homeExpected = calculateExpectedScore(adjustedHomeRating, awayRating)
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
  
  // Calculate new ratings (without home advantage - that's only for prediction)
  const newHomeRating = calculateNewRating(homeRating, homeExpected, homeActual, kFactor)
  const newAwayRating = calculateNewRating(awayRating, awayExpected, awayActual, kFactor)
  
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
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard?dates=${date}`
    
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
    
    // Apply recency decay before updating - this shrinks ratings toward baseline (1500)
    // so that older games have less impact on the current rating
    // Formula: rating = baseline + (rating - baseline) * decay
    const decay = RECENCY_DECAY[game.league] || 0.98
    homeTeam.rating = Math.round(DEFAULT_RATING + (homeTeam.rating - DEFAULT_RATING) * decay)
    awayTeam.rating = Math.round(DEFAULT_RATING + (awayTeam.rating - DEFAULT_RATING) * decay)
    
    // Update ratings
    const { newHomeRating, newAwayRating } = updateRatingsAfterGame(
      homeTeam.rating,
      awayTeam.rating,
      game.homeScore,
      game.awayScore,
      game.league
    )
    
    homeTeam.rating = newHomeRating
    homeTeam.gamesPlayed++
    homeTeam.lastUpdated = game.date
    
    awayTeam.rating = newAwayRating
    awayTeam.gamesPlayed++
    awayTeam.lastUpdated = game.date
    
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
 * Get Elo-based win probability for a matchup
 * Returns probability that home team wins
 */
export async function getEloWinProbability(
  league: string,
  homeTeamId: string,
  awayTeamId: string
): Promise<{ probability: number; homeRating: number; awayRating: number } | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
  const homeKey = `${league}:${homeTeamId}`
  const awayKey = `${league}:${awayTeamId}`
  
  const homeRating = eloData.ratings[homeKey]?.rating || DEFAULT_RATING
  const awayRating = eloData.ratings[awayKey]?.rating || DEFAULT_RATING
  
  const probability = calculateWinProbability(homeRating, awayRating, league)
  
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
  awayTeamName: string
): Promise<{ probability: number; homeRating: number; awayRating: number; confidence: string; homeFound: boolean; awayFound: boolean } | null> {
  const eloData = await getEloRatings()
  
  // If no Elo data in cache, return null - don't use default ratings
  // Using default 1500 for all teams would make all recommendations meaningless (all teams equal)
  // The caller should handle this case by showing a clear message to the user
  if (!eloData) {
    console.log(`[Elo] No Elo data in cache - cache needs to be populated via /api/cron/update-elo?backfill=true`)
    return null
  }
  
  // Defensive: ensure ratings object exists
  const ratings = eloData.ratings || {}
  
  // Find teams by name (case-insensitive partial match)
  const normalizeTeamName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const homeNorm = normalizeTeamName(homeTeamName)
  const awayNorm = normalizeTeamName(awayTeamName)
  
  let homeTeam: TeamRating | null = null
  let awayTeam: TeamRating | null = null
  
  for (const rating of Object.values(ratings)) {
    if (rating.league !== league) continue
    
    const teamNorm = normalizeTeamName(rating.teamName)
    
    if (teamNorm.includes(homeNorm) || homeNorm.includes(teamNorm)) {
      homeTeam = rating
    }
    if (teamNorm.includes(awayNorm) || awayNorm.includes(teamNorm)) {
      awayTeam = rating
    }
  }
  
  // CRITICAL: If either team is not found, return null
  // This prevents using default 1500 ratings which would give meaningless predictions
  // The caller should handle this by falling back to market consensus or showing a message
  if (!homeTeam || !awayTeam) {
    const missingTeams = []
    if (!homeTeam) missingTeams.push(`home: ${homeTeamName}`)
    if (!awayTeam) missingTeams.push(`away: ${awayTeamName}`)
    console.log(`[Elo] Teams not found in ${league} cache: ${missingTeams.join(', ')}. Run backfill to populate.`)
    return null
  }
  
  const homeRating = homeTeam.rating
  const awayRating = awayTeam.rating
  
  const probability = calculateWinProbability(homeRating, awayRating, league)
  
  // Confidence based on how many games we've seen
  const homeGames = homeTeam.gamesPlayed
  const awayGames = awayTeam.gamesPlayed
  const minGames = Math.min(homeGames, awayGames)
  
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
    awayFound: true
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
  awayPitcher?: PitcherInfo | null
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
  const baseResult = await getEloWinProbabilityByName(league, homeTeamName, awayTeamName)
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
    league
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
 * - NBA/NCAAB/NHL: Top 3 scorer out = -20 Elo each
 * - Fallback: -5 Elo per starter out (for sports without good player data)
 * - Status multipliers: Out=100%, Doubtful=70%, Questionable=15%
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
        const topScorerPenalty = Math.round(-20 * statusMultiplier)
        totalAdjustment += topScorerPenalty
        details.push(`${injury.player} (Top Scorer, ${injury.status}): ${topScorerPenalty} Elo`)
        continue
      }
    }
    
    // Fallback: -5 Elo per injured player (for starters/significant players)
    // Only apply if status indicates they're actually out/doubtful
    if (statusMultiplier >= 0.5) {
      const fallbackPenalty = Math.round(-5 * statusMultiplier)
      totalAdjustment += fallbackPenalty
      details.push(`${injury.player} (${injury.status}): ${fallbackPenalty} Elo`)
    }
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
  awayPitcher?: PitcherInfo | null
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
    league
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
  league: string
): number {
  const homeAdvantage = HOME_ADVANTAGE[league] || 70
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
  forHome: boolean = true
): { probability: number; expectedMargin: number; confidence: string } {
  const sigma = MARGIN_SIGMA[league] || 12
  const expectedMargin = calculateExpectedMargin(homeElo, awayElo, league)
  
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
    expectedMargin,
    confidence
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
  league: string
): number {
  const baseline = TOTAL_BASELINE[league] || 200
  const eloFactor = TOTAL_ELO_FACTOR[league] || 0.01
  
  // Average Elo of both teams relative to baseline (1500)
  const avgElo = (homeElo + awayElo) / 2
  const eloAboveAverage = avgElo - 1500
  
  // Higher combined Elo → slightly higher expected total
  // (Better teams tend to score more)
  return baseline + eloFactor * eloAboveAverage
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
  isOver: boolean = true
): { probability: number; expectedTotal: number; confidence: string } {
  const sigma = TOTAL_SIGMA[league] || 15
  const expectedTotal = calculateExpectedTotal(homeElo, awayElo, league)
  
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
  forHome: boolean = true
): Promise<{
  probability: number
  expectedMargin: number
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
  
  const result = calculateSpreadCoverProbability(homeRating, awayRating, spread, league, forHome)
  
  return {
    ...result,
    homeRating,
    awayRating
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
  isOver: boolean = true
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
  
  const result = calculateTotalProbability(homeRating, awayRating, totalLine, league, isOver)
  
  return {
    ...result,
    homeRating,
    awayRating
  }
}
