/**
 * ESPN API Integration for Real-Time Sports Data
 * 
 * Provides real-time data that The Odds API doesn't have:
 * - Current rosters and who's playing
 * - Injury reports (out, questionable, probable)
 * - Starting lineups (especially goalies for NHL)
 * - Team records
 * - Recent news and updates
 * 
 * ESPN API is FREE and doesn't require authentication.
 */

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// ESPN sport/league mappings
const ESPN_SPORTS = [
  { sport: 'hockey', league: 'nhl', name: 'NHL' },
  { sport: 'basketball', league: 'nba', name: 'NBA' },
  { sport: 'football', league: 'nfl', name: 'NFL' },
  { sport: 'football', league: 'college-football', name: 'NCAAF' },
  { sport: 'basketball', league: 'mens-college-basketball', name: 'NCAAB' },
  { sport: 'baseball', league: 'mlb', name: 'MLB' },
]

// Cache for ESPN data (30 minutes)
const ESPN_CACHE_EXPIRY_MS = 30 * 60 * 1000
let espnCache: ESPNData | null = null
let espnCacheExpiry: Date | null = null

// Types for ESPN API responses
export interface ESPNInjury {
  team: string
  player: string
  status: string
  details: string
}

export interface ESPNProbable {
  team: string
  player: string
  position: string
}

export interface ESPNGameData {
  id: string
  name: string
  shortName: string
  date: string
  sport: string
  league: string
  homeTeam: {
    id: string
    name: string
    abbreviation: string
    record?: string
  }
  awayTeam: {
    id: string
    name: string
    abbreviation: string
    record?: string
  }
  injuries: ESPNInjury[]
  probables: ESPNProbable[]
  venue?: string
  broadcast?: string
  status: string
}

export interface ESPNData {
  games: ESPNGameData[]
  lastUpdated: string
  error: string | null
}

/**
 * Fetch scoreboard data for a specific sport/league from ESPN
 */
async function fetchESPNScoreboard(sport: string, league: string, leagueName: string): Promise<ESPNGameData[]> {
  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    })
    
    if (!response.ok) {
      console.error(`ESPN API error for ${sport}/${league}: ${response.status}`)
      return []
    }
    
    const data = await response.json()
    
    if (!data.events || !Array.isArray(data.events)) {
      return []
    }
    
    // Transform ESPN events to our format
    return data.events.map((event: ESPNEvent) => {
      const competition = event.competitions?.[0]
      if (!competition) return null
      
      const homeCompetitor = competition.competitors?.find((c: ESPNCompetitor) => c.homeAway === 'home')
      const awayCompetitor = competition.competitors?.find((c: ESPNCompetitor) => c.homeAway === 'away')
      
      if (!homeCompetitor || !awayCompetitor) return null
      
      // Extract injuries
      const injuries: ESPNInjury[] = []
      for (const competitor of competition.competitors || []) {
        if (competitor.injuries && Array.isArray(competitor.injuries)) {
          for (const injury of competitor.injuries) {
            injuries.push({
              team: competitor.team?.displayName || competitor.team?.name || 'Unknown',
              player: injury.athlete?.displayName || 'Unknown',
              status: injury.status || 'Unknown',
              details: injury.details?.detail || injury.type?.description || ''
            })
          }
        }
      }
      
      // Extract probables (starting pitchers, goalies, etc.)
      const probables: ESPNProbable[] = []
      for (const competitor of competition.competitors || []) {
        if (competitor.probables && Array.isArray(competitor.probables)) {
          for (const probable of competitor.probables) {
            probables.push({
              team: competitor.team?.displayName || competitor.team?.name || 'Unknown',
              player: probable.athlete?.displayName || 'Unknown',
              position: probable.position?.abbreviation || probable.position?.name || ''
            })
          }
        }
      }
      
      // Get team records
      const homeRecord = homeCompetitor.records?.[0]?.summary || null
      const awayRecord = awayCompetitor.records?.[0]?.summary || null
      
      return {
        id: event.id,
        name: event.name || `${awayCompetitor.team?.displayName} at ${homeCompetitor.team?.displayName}`,
        shortName: event.shortName || '',
        date: event.date,
        sport,
        league: leagueName,
        homeTeam: {
          id: homeCompetitor.team?.id || '',
          name: homeCompetitor.team?.displayName || homeCompetitor.team?.name || 'Unknown',
          abbreviation: homeCompetitor.team?.abbreviation || '',
          record: homeRecord,
        },
        awayTeam: {
          id: awayCompetitor.team?.id || '',
          name: awayCompetitor.team?.displayName || awayCompetitor.team?.name || 'Unknown',
          abbreviation: awayCompetitor.team?.abbreviation || '',
          record: awayRecord,
        },
        injuries,
        probables,
        venue: competition.venue?.fullName || null,
        broadcast: competition.broadcasts?.[0]?.names?.[0] || null,
        status: event.status?.type?.description || 'Scheduled',
      } as ESPNGameData
    }).filter(Boolean) as ESPNGameData[]
    
  } catch (error) {
    console.error(`Failed to fetch ESPN data for ${sport}/${league}:`, error)
    return []
  }
}

/**
 * Fetch all ESPN data for all supported sports
 */
export async function fetchAllESPNData(): Promise<ESPNData> {
  console.log('🔄 Fetching fresh ESPN data for all sports...')
  
  const allGames: ESPNGameData[] = []
  
  // Fetch all sports in parallel
  const promises = ESPN_SPORTS.map(({ sport, league, name }) => 
    fetchESPNScoreboard(sport, league, name)
  )
  
  const results = await Promise.all(promises)
  
  // Combine all games
  for (const games of results) {
    allGames.push(...games)
  }
  
  console.log(`📊 Fetched ${allGames.length} games from ESPN API`)
  
  return {
    games: allGames,
    lastUpdated: new Date().toISOString(),
    error: null
  }
}

/**
 * Get cached ESPN data or fetch fresh if expired
 */
export async function getCachedESPNData(): Promise<ESPNData> {
  const now = new Date()
  
  // Check if cache is still valid
  if (espnCache && espnCacheExpiry && espnCacheExpiry > now) {
    console.log('📦 Serving cached ESPN data')
    return espnCache
  }
  
  // Fetch fresh data
  try {
    const freshData = await fetchAllESPNData()
    
    // Update cache
    espnCache = freshData
    espnCacheExpiry = new Date(now.getTime() + ESPN_CACHE_EXPIRY_MS)
    
    return freshData
  } catch (error) {
    console.error('Failed to fetch ESPN data:', error)
    
    // Return stale cache if available
    if (espnCache) {
      return { ...espnCache, error: 'Using stale data - ESPN API temporarily unavailable' }
    }
    
    // Return empty data
    return {
      games: [],
      lastUpdated: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Format ESPN data for Claude's context
 */
export function formatESPNForContext(espnData: ESPNData): string {
  if (!espnData.games.length) {
    return `No ESPN game data currently available.${espnData.error ? ` Error: ${espnData.error}` : ''}`
  }
  
  const lines: string[] = []
  lines.push(`=== REAL-TIME INJURY & LINEUP DATA (ESPN) ===`)
  lines.push(`Last Updated: ${formatTimestamp(espnData.lastUpdated)}`)
  if (espnData.error) {
    lines.push(`⚠️ Warning: ${espnData.error}`)
  }
  lines.push('')
  
  // Group games by league
  const gamesByLeague = new Map<string, ESPNGameData[]>()
  for (const game of espnData.games) {
    const existing = gamesByLeague.get(game.league) || []
    existing.push(game)
    gamesByLeague.set(game.league, existing)
  }
  
  // Format each league
  for (const [league, games] of Array.from(gamesByLeague.entries())) {
    lines.push(`--- ${league} (${games.length} games) ---`)
    
    for (const game of games) {
      lines.push('')
      lines.push(`${game.awayTeam.name} @ ${game.homeTeam.name}`)
      
      // Team records
      if (game.homeTeam.record || game.awayTeam.record) {
        lines.push(`Records: ${game.awayTeam.name} (${game.awayTeam.record || 'N/A'}) vs ${game.homeTeam.name} (${game.homeTeam.record || 'N/A'})`)
      }
      
      // Starting goalies/pitchers
      if (game.probables.length > 0) {
        const starters = game.probables.map(p => `${p.player} (${p.position}) - ${p.team}`).join(', ')
        lines.push(`Starters: ${starters}`)
      }
      
      // Injuries
      if (game.injuries.length > 0) {
        lines.push(`Injuries:`)
        for (const injury of game.injuries.slice(0, 10)) { // Limit to 10 injuries per game
          lines.push(`  - ${injury.player} (${injury.team}): ${injury.status}${injury.details ? ` - ${injury.details}` : ''}`)
        }
        if (game.injuries.length > 10) {
          lines.push(`  ... and ${game.injuries.length - 10} more injuries`)
        }
      } else {
        lines.push(`Injuries: None reported`)
      }
      
      // Venue and broadcast
      if (game.venue) {
        lines.push(`Venue: ${game.venue}`)
      }
      if (game.broadcast) {
        lines.push(`TV: ${game.broadcast}`)
      }
    }
    
    lines.push('')
  }
  
  return lines.join('\n')
}

/**
 * Helper to format timestamp
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })
}

// ESPN API response types (internal)
interface ESPNEvent {
  id: string
  name?: string
  shortName?: string
  date: string
  status?: {
    type?: {
      description?: string
    }
  }
  competitions?: ESPNCompetition[]
}

interface ESPNCompetition {
  competitors?: ESPNCompetitor[]
  venue?: {
    fullName?: string
  }
  broadcasts?: Array<{
    names?: string[]
  }>
}

interface ESPNCompetitor {
  homeAway: 'home' | 'away'
  team?: {
    id?: string
    name?: string
    displayName?: string
    abbreviation?: string
  }
  records?: Array<{
    summary?: string
  }>
  injuries?: Array<{
    athlete?: {
      displayName?: string
    }
    status?: string
    details?: {
      detail?: string
    }
    type?: {
      description?: string
    }
  }>
  probables?: Array<{
    athlete?: {
      displayName?: string
    }
    position?: {
      abbreviation?: string
      name?: string
    }
  }>
}
