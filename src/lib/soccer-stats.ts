/**
 * Soccer Stats Integration
 * Fetches league standings and team stats from Football-data.org API
 * 
 * Supported Leagues:
 * - Premier League (PL)
 * - La Liga (PD)
 * - Bundesliga (BL1)
 * - Serie A (SA)
 * - Ligue 1 (FL1)
 * - Champions League (CL)
 */

const FOOTBALL_DATA_API_BASE = 'https://api.football-data.org/v4'

// League codes for Football-data.org
const LEAGUE_CODES: Record<string, { code: string; name: string }> = {
  'soccer_epl': { code: 'PL', name: 'English Premier League' },
  'soccer_spain_la_liga': { code: 'PD', name: 'La Liga' },
  'soccer_germany_bundesliga': { code: 'BL1', name: 'Bundesliga' },
  'soccer_italy_serie_a': { code: 'SA', name: 'Serie A' },
  'soccer_france_ligue_one': { code: 'FL1', name: 'Ligue 1' },
  'soccer_uefa_champs_league': { code: 'CL', name: 'Champions League' },
}

export interface TeamStanding {
  position: number
  team: string
  playedGames: number
  won: number
  draw: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  form: string // Last 5 games: W, D, L
}

export interface LeagueStandings {
  league: string
  leagueCode: string
  season: string
  standings: TeamStanding[]
  lastUpdated: string
}

export interface SoccerStatsData {
  leagues: LeagueStandings[]
  lastUpdated: string
  error: string | null
}

// In-memory cache for soccer stats (refresh every 4 hours)
let soccerStatsCache: SoccerStatsData | null = null
let lastFetchTime: number = 0
const CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

/**
 * Fetch standings for a specific league
 */
async function fetchLeagueStandings(leagueCode: string, leagueName: string): Promise<LeagueStandings | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  
  if (!apiKey) {
    console.log('[Soccer Stats] No FOOTBALL_DATA_API_KEY configured')
    return null
  }
  
  try {
    const response = await fetch(`${FOOTBALL_DATA_API_BASE}/competitions/${leagueCode}/standings`, {
      headers: {
        'X-Auth-Token': apiKey,
      },
      cache: 'no-store',
    })
    
    if (!response.ok) {
      console.log(`[Soccer Stats] Failed to fetch ${leagueName}: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    // Extract standings from response
    const standingsTable = data.standings?.find((s: { type: string }) => s.type === 'TOTAL')?.table || []
    
    const standings: TeamStanding[] = standingsTable.map((team: {
      position: number
      team: { name: string }
      playedGames: number
      won: number
      draw: number
      lost: number
      points: number
      goalsFor: number
      goalsAgainst: number
      goalDifference: number
      form: string | null
    }) => ({
      position: team.position,
      team: team.team.name,
      playedGames: team.playedGames,
      won: team.won,
      draw: team.draw,
      lost: team.lost,
      points: team.points,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
      goalDifference: team.goalDifference,
      form: team.form || 'N/A',
    }))
    
    return {
      league: leagueName,
      leagueCode,
      season: data.season?.startDate?.substring(0, 4) + '/' + data.season?.endDate?.substring(0, 4) || 'Current',
      standings,
      lastUpdated: new Date().toISOString(),
    }
  } catch (error) {
    console.error(`[Soccer Stats] Error fetching ${leagueName}:`, error)
    return null
  }
}

/**
 * Fetch all soccer league standings
 */
export async function fetchAllSoccerStats(): Promise<SoccerStatsData> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  
  if (!apiKey) {
    return {
      leagues: [],
      lastUpdated: new Date().toISOString(),
      error: 'FOOTBALL_DATA_API_KEY not configured',
    }
  }
  
  // Fetch all leagues in parallel with rate limiting consideration
  // Football-data.org free tier has 10 requests/minute limit
  const leagueEntries = Object.entries(LEAGUE_CODES)
  const results: LeagueStandings[] = []
  
  // Fetch sequentially to avoid rate limits
  for (const [, { code, name }] of leagueEntries) {
    const standings = await fetchLeagueStandings(code, name)
    if (standings) {
      results.push(standings)
    }
    // Small delay between requests to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  
  return {
    leagues: results,
    lastUpdated: new Date().toISOString(),
    error: results.length === 0 ? 'Failed to fetch any league standings' : null,
  }
}

/**
 * Get cached soccer stats or fetch fresh data
 */
export async function getCachedSoccerStats(): Promise<SoccerStatsData> {
  const now = Date.now()
  
  // Return cached data if still valid
  if (soccerStatsCache && (now - lastFetchTime) < CACHE_TTL) {
    return soccerStatsCache
  }
  
  // Fetch fresh data
  const freshData = await fetchAllSoccerStats()
  
  // Update cache
  soccerStatsCache = freshData
  lastFetchTime = now
  
  return freshData
}

/**
 * Format soccer stats for Claude's context
 */
export function formatSoccerStatsForContext(data: SoccerStatsData): string {
  if (!data.leagues.length) {
    return '\n=== SOCCER LEAGUE STANDINGS ===\nNo soccer standings data available.\n'
  }
  
  const lines: string[] = []
  lines.push('\n=== SOCCER LEAGUE STANDINGS ===')
  lines.push(`Last Updated: ${new Date(data.lastUpdated).toLocaleString()}`)
  lines.push('')
  lines.push('Use this data to analyze team form, home/away performance, and league position when recommending soccer bets.')
  lines.push('')
  
  for (const league of data.leagues) {
    lines.push(`--- ${league.league} (${league.season}) ---`)
    lines.push('Pos | Team | P | W | D | L | GF | GA | GD | Pts | Form')
    lines.push('-'.repeat(80))
    
    // Show top 10 and bottom 5 teams for context
    const topTeams = league.standings.slice(0, 10)
    const bottomTeams = league.standings.slice(-5)
    
    for (const team of topTeams) {
      lines.push(
        `${team.position.toString().padStart(2)} | ${team.team.padEnd(25).substring(0, 25)} | ${team.playedGames.toString().padStart(2)} | ${team.won.toString().padStart(2)} | ${team.draw.toString().padStart(2)} | ${team.lost.toString().padStart(2)} | ${team.goalsFor.toString().padStart(2)} | ${team.goalsAgainst.toString().padStart(2)} | ${team.goalDifference >= 0 ? '+' : ''}${team.goalDifference.toString().padStart(2)} | ${team.points.toString().padStart(3)} | ${team.form}`
      )
    }
    
    if (league.standings.length > 15) {
      lines.push('...')
      for (const team of bottomTeams) {
        if (team.position > 10) {
          lines.push(
            `${team.position.toString().padStart(2)} | ${team.team.padEnd(25).substring(0, 25)} | ${team.playedGames.toString().padStart(2)} | ${team.won.toString().padStart(2)} | ${team.draw.toString().padStart(2)} | ${team.lost.toString().padStart(2)} | ${team.goalsFor.toString().padStart(2)} | ${team.goalsAgainst.toString().padStart(2)} | ${team.goalDifference >= 0 ? '+' : ''}${team.goalDifference.toString().padStart(2)} | ${team.points.toString().padStart(3)} | ${team.form}`
          )
        }
      }
    }
    
    lines.push('')
  }
  
  lines.push('SOCCER BETTING INSIGHTS:')
  lines.push('- Teams in top 4 positions are typically fighting for Champions League spots')
  lines.push('- Teams in bottom 3 positions are in relegation danger (more desperate, unpredictable)')
  lines.push('- Form column shows last 5 results: W=Win, D=Draw, L=Loss')
  lines.push('- Goal difference (GD) indicates attacking vs defensive strength')
  lines.push('')
  
  return lines.join('\n')
}

/**
 * Get team form and position for a specific team
 */
export function getTeamInfo(data: SoccerStatsData, teamName: string): TeamStanding | null {
  const normalizedSearch = teamName.toLowerCase()
  
  for (const league of data.leagues) {
    const team = league.standings.find(t => 
      t.team.toLowerCase().includes(normalizedSearch) ||
      normalizedSearch.includes(t.team.toLowerCase())
    )
    if (team) {
      return team
    }
  }
  
  return null
}
