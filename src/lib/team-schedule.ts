import { kvGet, kvSet, isDbConfigured } from '@/lib/pg-kv'

/**
 * Team Schedule Tracking Module
 * 
 * Tracks each team's last game date for rest day calculations.
 * This data is used by the situational factors system to:
 * 1. Detect back-to-back games (team played yesterday)
 * 2. Calculate rest advantage between teams
 * 3. Apply appropriate probability adjustments
 * 
 * Data is fetched from ESPN's scoreboard API and cached in Postgres.
 */

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// Redis cache key for team schedules
const TEAM_SCHEDULE_CACHE_KEY = 'team_last_game_dates'

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

// ============================================
// TYPES
// ============================================

export interface TeamLastGame {
  teamName: string
  teamId: string
  lastGameDate: string  // ISO date string
  opponent: string
  wasHome: boolean
  league: string
}

export interface TeamScheduleData {
  teams: Record<string, TeamLastGame>  // Key: normalized team name
  lastUpdated: string
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normalize team name for consistent lookups
 */
export function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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


// ============================================
// ESPN DATA FETCHING
// ============================================

interface CompletedGame {
  gameId: string
  date: string
  homeTeam: { id: string; name: string }
  awayTeam: { id: string; name: string }
  league: string
}

/**
 * Fetch completed games from ESPN for a specific date
 */
async function fetchCompletedGamesForDate(
  sport: string,
  league: string,
  leagueName: string,
  dateStr: string
): Promise<CompletedGame[]> {
  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard?dates=${dateStr}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    
    if (!data.events || !Array.isArray(data.events)) return []
    
    const completedGames: CompletedGame[] = []
    
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
      
      completedGames.push({
        gameId: event.id,
        date: event.date,
        homeTeam: {
          id: homeTeam.team?.id || homeTeam.id || '',
          name: homeTeam.team?.displayName || homeTeam.team?.name || 'Unknown'
        },
        awayTeam: {
          id: awayTeam.team?.id || awayTeam.id || '',
          name: awayTeam.team?.displayName || awayTeam.team?.name || 'Unknown'
        },
        league: leagueName
      })
    }
    
    return completedGames
  } catch (error) {
    console.error(`[TeamSchedule] Error fetching games for ${sport}/${league} on ${dateStr}:`, error)
    return []
  }
}

/**
 * Fetch completed games from the last N days for all leagues
 * This builds a map of each team's most recent game
 */
export async function fetchRecentCompletedGames(daysBack: number = 7): Promise<CompletedGame[]> {
  console.log(`[TeamSchedule] Fetching completed games from last ${daysBack} days...`)
  
  const allGames: CompletedGame[] = []
  const today = new Date()
  
  // Fetch games for each day going back
  for (let i = 1; i <= daysBack; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = formatDateForESPN(date)
    
    // Fetch from all leagues in parallel
    const promises = Object.entries(LEAGUE_TO_ESPN).map(async ([leagueName, espnInfo]) => {
      const games = await fetchCompletedGamesForDate(
        espnInfo.sport,
        espnInfo.league,
        leagueName,
        dateStr
      )
      return games
    })
    
    const results = await Promise.all(promises)
    for (const games of results) {
      allGames.push(...games)
    }
    
    // Small delay between days to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  console.log(`[TeamSchedule] Found ${allGames.length} completed games in last ${daysBack} days`)
  return allGames
}

/**
 * Build team schedule data from completed games
 * For each team, find their most recent game
 */
export function buildTeamScheduleData(completedGames: CompletedGame[]): TeamScheduleData {
  const teams: Record<string, TeamLastGame> = {}
  
  // Sort games by date (newest first) so we process most recent games first
  const sortedGames = [...completedGames].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )
  
  for (const game of sortedGames) {
    // Process home team
    const homeKey = normalizeTeamName(game.homeTeam.name)
    if (!teams[homeKey]) {
      teams[homeKey] = {
        teamName: game.homeTeam.name,
        teamId: game.homeTeam.id,
        lastGameDate: game.date,
        opponent: game.awayTeam.name,
        wasHome: true,
        league: game.league
      }
    }
    
    // Process away team
    const awayKey = normalizeTeamName(game.awayTeam.name)
    if (!teams[awayKey]) {
      teams[awayKey] = {
        teamName: game.awayTeam.name,
        teamId: game.awayTeam.id,
        lastGameDate: game.date,
        opponent: game.homeTeam.name,
        wasHome: false,
        league: game.league
      }
    }
  }
  
  console.log(`[TeamSchedule] Built schedule data for ${Object.keys(teams).length} teams`)
  
  return {
    teams,
    lastUpdated: new Date().toISOString()
  }
}

// ============================================
// REDIS CACHING
// ============================================

/**
 * Cache team schedule data to Postgres
 */
export async function cacheTeamScheduleData(data: TeamScheduleData): Promise<void> {
  if (!isDbConfigured()) return
  
  try {
    await kvSet(TEAM_SCHEDULE_CACHE_KEY, JSON.stringify(data), 24 * 60 * 60)
    console.log(`[TeamSchedule] Cached schedule data for ${Object.keys(data.teams).length} teams`)
  } catch (error) {
    console.error('[TeamSchedule] Error caching schedule data:', error)
  }
}

/**
 * Get cached team schedule data from Postgres
 */
export async function getCachedTeamScheduleData(): Promise<TeamScheduleData | null> {
  if (!isDbConfigured()) return null
  
  try {
    const result = await kvGet(TEAM_SCHEDULE_CACHE_KEY)
    if (!result) return null
    return JSON.parse(result) as TeamScheduleData
  } catch (error) {
    console.error('[TeamSchedule] Error getting cached schedule data:', error)
    return null
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Get the last game date for a team
 * Returns ISO date string or null if not found
 */
export async function getTeamLastGameDate(teamName: string): Promise<string | null> {
  const scheduleData = await getCachedTeamScheduleData()
  if (!scheduleData) return null
  
  const key = normalizeTeamName(teamName)
  const teamData = scheduleData.teams[key]
  
  return teamData?.lastGameDate || null
}

/**
 * Get last game dates for multiple teams at once (more efficient)
 * Returns a map of team name -> last game date
 */
export async function getTeamsLastGameDates(teamNames: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  
  const scheduleData = await getCachedTeamScheduleData()
  if (!scheduleData) return result
  
  for (const teamName of teamNames) {
    const key = normalizeTeamName(teamName)
    const teamData = scheduleData.teams[key]
    if (teamData?.lastGameDate) {
      result.set(teamName, teamData.lastGameDate)
    }
  }
  
  return result
}

/**
 * Calculate rest days for a team (days since last game)
 * Returns number of days, or null if unknown
 */
export function calculateRestDays(lastGameDate: string | null, gameDate?: Date): number | null {
  if (!lastGameDate) return null
  
  const lastGame = new Date(lastGameDate)
  const targetDate = gameDate || new Date()
  
  const diffMs = targetDate.getTime() - lastGame.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  return diffDays
}

/**
 * Check if a team is on a back-to-back (played yesterday)
 */
export function isBackToBack(lastGameDate: string | null, gameDate?: Date): boolean {
  const restDays = calculateRestDays(lastGameDate, gameDate)
  return restDays !== null && restDays <= 1
}

/**
 * Get rest day summary for display
 */
export function getRestDaySummary(restDays: number | null): string {
  if (restDays === null) return 'Unknown rest'
  if (restDays <= 1) return 'Back-to-back'
  if (restDays === 2) return '1 day rest'
  if (restDays === 3) return '2 days rest'
  return `${restDays - 1} days rest`
}

/**
 * Update team schedule data (called by cron job)
 * Fetches recent games and updates the cache
 */
export async function updateTeamScheduleData(): Promise<TeamScheduleData> {
  console.log('[TeamSchedule] Updating team schedule data...')
  
  // Fetch completed games from last 7 days
  const completedGames = await fetchRecentCompletedGames(7)
  
  // Build schedule data
  const scheduleData = buildTeamScheduleData(completedGames)
  
  // Cache to Postgres
  await cacheTeamScheduleData(scheduleData)
  
  console.log(`[TeamSchedule] Update complete: ${Object.keys(scheduleData.teams).length} teams tracked`)
  
  return scheduleData
}
