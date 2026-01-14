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

// Home advantage in Elo points (added to home team's rating for prediction)
const HOME_ADVANTAGE: Record<string, number> = {
  'NBA': 100,
  'NFL': 48,      // ~2.5 points spread equivalent
  'NHL': 60,
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
    const response = await fetch(`${redis.url}/get/${ELO_RATINGS_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
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
export async function saveEloRatings(ratings: EloRatings): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    // Ensure ratings object has proper structure
    const safeRatings: EloRatings = {
      ratings: ratings.ratings || {},
      lastUpdated: ratings.lastUpdated || new Date().toISOString(),
      gamesProcessed: ratings.gamesProcessed || 0
    }
    
    await fetch(`${redis.url}/set/${ELO_RATINGS_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(safeRatings))
    })
    
    console.log(`[Elo] Saved ratings for ${Object.keys(safeRatings.ratings).length} teams`)
  } catch (error) {
    console.error('[Elo] Error saving ratings:', error)
  }
}

/**
 * Get set of already processed game IDs
 */
export async function getProcessedGameIds(): Promise<Set<string>> {
  const redis = await getRedisClient()
  if (!redis) return new Set()
  
  try {
    const response = await fetch(`${redis.url}/get/${ELO_PROCESSED_GAMES_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
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
    await fetch(`${redis.url}/set/${ELO_PROCESSED_GAMES_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(gameIdsArray))
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
 */
export async function backfillHistoricalGames(
  startDate: Date,
  endDate: Date
): Promise<GameResult[]> {
  console.log(`[Elo] Backfilling games from ${formatDateForESPN(startDate)} to ${formatDateForESPN(endDate)}...`)
  
  const allGames: GameResult[] = []
  const currentDate = new Date(startDate)
  
  while (currentDate <= endDate) {
    const dateStr = formatDateForESPN(currentDate)
    
    for (const [leagueName, espnInfo] of Object.entries(LEAGUE_TO_ESPN)) {
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
 */
export async function getEloWinProbabilityByName(
  league: string,
  homeTeamName: string,
  awayTeamName: string
): Promise<{ probability: number; homeRating: number; awayRating: number; confidence: string } | null> {
  const eloData = await getEloRatings()
  if (!eloData) return null
  
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
  
  const homeRating = homeTeam?.rating || DEFAULT_RATING
  const awayRating = awayTeam?.rating || DEFAULT_RATING
  
  const probability = calculateWinProbability(homeRating, awayRating, league)
  
  // Confidence based on how many games we've seen
  const homeGames = homeTeam?.gamesPlayed || 0
  const awayGames = awayTeam?.gamesPlayed || 0
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
    confidence
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
