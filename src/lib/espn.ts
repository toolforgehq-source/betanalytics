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

// Roster cache (6 hours - rosters don't change often)
const ROSTER_CACHE_EXPIRY_MS = 6 * 60 * 60 * 1000
const rosterCache = new Map<string, { data: ESPNRoster; expiry: Date }>()

// Types for ESPN API responses
export interface ESPNRosterPlayer {
  name: string
  position: string
  jersey: string | null
}

export interface ESPNRoster {
  teamId: string
  teamName: string
  players: ESPNRosterPlayer[]
  keyPlayers: {
    qbs: string[]
    rbs: string[]
    wrs: string[]
    goalies?: string[]
  }
}

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
    roster?: ESPNRoster
  }
  awayTeam: {
    id: string
    name: string
    abbreviation: string
    record?: string
    roster?: ESPNRoster
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
 * Fetch roster for a specific team from ESPN
 * Returns key players (QBs, RBs, WRs for football; goalies for hockey)
 */
async function fetchTeamRoster(sport: string, league: string, teamId: string, teamName: string): Promise<ESPNRoster | null> {
  // Check cache first
  const cacheKey = `${sport}/${league}/${teamId}`
  const cached = rosterCache.get(cacheKey)
  if (cached && cached.expiry > new Date()) {
    return cached.data
  }
  
  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/teams/${teamId}/roster`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    })
    
    if (!response.ok) {
      console.error(`ESPN roster API error for team ${teamId}: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    const players: ESPNRosterPlayer[] = []
    const keyPlayers: ESPNRoster['keyPlayers'] = {
      qbs: [],
      rbs: [],
      wrs: [],
      goalies: []
    }
    
    // Process athletes by position group
    if (data.athletes && Array.isArray(data.athletes)) {
      for (const group of data.athletes) {
        if (group.items && Array.isArray(group.items)) {
          for (const player of group.items) {
            const playerData: ESPNRosterPlayer = {
              name: player.fullName || player.displayName || 'Unknown',
              position: player.position?.abbreviation || player.position?.name || 'Unknown',
              jersey: player.jersey || null
            }
            players.push(playerData)
            
            // Track key players by position
            const pos = playerData.position.toUpperCase()
            if (pos === 'QB') {
              keyPlayers.qbs.push(playerData.name)
            } else if (pos === 'RB' || pos === 'HB' || pos === 'FB') {
              keyPlayers.rbs.push(playerData.name)
            } else if (pos === 'WR' || pos === 'TE') {
              keyPlayers.wrs.push(playerData.name)
            } else if (pos === 'G' || pos === 'GOALIE') {
              keyPlayers.goalies?.push(playerData.name)
            }
          }
        }
      }
    }
    
    const roster: ESPNRoster = {
      teamId,
      teamName,
      players,
      keyPlayers
    }
    
    // Cache the roster
    rosterCache.set(cacheKey, {
      data: roster,
      expiry: new Date(Date.now() + ROSTER_CACHE_EXPIRY_MS)
    })
    
    return roster
    
  } catch (error) {
    console.error(`Failed to fetch roster for team ${teamId}:`, error)
    return null
  }
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
 * Fetch all ESPN data for all supported sports, including rosters
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
  
  // Fetch rosters for all teams in today's games (in parallel, limited to avoid rate limiting)
  // Only fetch for games happening in the next 24 hours to limit API calls
  const now = new Date()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  
  const upcomingGames = allGames.filter(game => {
    const gameDate = new Date(game.date)
    return gameDate >= now && gameDate <= tomorrow
  })
  
  console.log(`📋 Fetching rosters for ${upcomingGames.length} upcoming games...`)
  
  // Collect unique team IDs to fetch
  const teamsToFetch: Array<{ sport: string; league: string; teamId: string; teamName: string; gameIndex: number; isHome: boolean }> = []
  
  for (let i = 0; i < upcomingGames.length; i++) {
    const game = upcomingGames[i]
    const sportConfig = ESPN_SPORTS.find(s => s.name === game.league)
    if (!sportConfig) continue
    
    if (game.homeTeam.id) {
      teamsToFetch.push({
        sport: sportConfig.sport,
        league: sportConfig.league,
        teamId: game.homeTeam.id,
        teamName: game.homeTeam.name,
        gameIndex: allGames.indexOf(game),
        isHome: true
      })
    }
    if (game.awayTeam.id) {
      teamsToFetch.push({
        sport: sportConfig.sport,
        league: sportConfig.league,
        teamId: game.awayTeam.id,
        teamName: game.awayTeam.name,
        gameIndex: allGames.indexOf(game),
        isHome: false
      })
    }
  }
  
  // Fetch rosters in batches of 5 to avoid rate limiting
  const BATCH_SIZE = 5
  for (let i = 0; i < teamsToFetch.length; i += BATCH_SIZE) {
    const batch = teamsToFetch.slice(i, i + BATCH_SIZE)
    const rosterPromises = batch.map(team => 
      fetchTeamRoster(team.sport, team.league, team.teamId, team.teamName)
        .then(roster => ({ ...team, roster }))
    )
    
    const rosterResults = await Promise.all(rosterPromises)
    
    // Attach rosters to games
    for (const result of rosterResults) {
      if (result.roster && result.gameIndex >= 0) {
        if (result.isHome) {
          allGames[result.gameIndex].homeTeam.roster = result.roster
        } else {
          allGames[result.gameIndex].awayTeam.roster = result.roster
        }
      }
    }
  }
  
  const gamesWithRosters = allGames.filter(g => g.homeTeam.roster || g.awayTeam.roster).length
  console.log(`📊 Attached rosters to ${gamesWithRosters} games`)
  
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
 * Includes CURRENT ROSTERS so Claude knows who actually plays for each team
 */
export function formatESPNForContext(espnData: ESPNData): string {
  if (!espnData.games.length) {
    return `No ESPN game data currently available.${espnData.error ? ` Error: ${espnData.error}` : ''}`
  }
  
  const lines: string[] = []
  lines.push(`=== REAL-TIME ROSTER, INJURY & LINEUP DATA (ESPN) ===`)
  lines.push(`Last Updated: ${formatTimestamp(espnData.lastUpdated)}`)
  if (espnData.error) {
    lines.push(`⚠️ Warning: ${espnData.error}`)
  }
  lines.push('')
  lines.push(`CRITICAL: The roster data below shows CURRENT players on each team.`)
  lines.push(`DO NOT mention any player whose name does not appear in the roster below.`)
  lines.push(`If you're unsure about a player, say "I cannot verify current roster status."`)
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
      lines.push(`🏈 ${game.awayTeam.name} @ ${game.homeTeam.name}`)
      
      // Team records
      if (game.homeTeam.record || game.awayTeam.record) {
        lines.push(`Records: ${game.awayTeam.name} (${game.awayTeam.record || 'N/A'}) vs ${game.homeTeam.name} (${game.homeTeam.record || 'N/A'})`)
      }
      
      // AWAY TEAM ROSTER (key players)
      if (game.awayTeam.roster) {
        lines.push(``)
        lines.push(`📋 ${game.awayTeam.name} CURRENT ROSTER (Key Players):`)
        const roster = game.awayTeam.roster
        if (roster.keyPlayers.qbs.length > 0) {
          lines.push(`  QBs: ${roster.keyPlayers.qbs.join(', ')}`)
        }
        if (roster.keyPlayers.rbs.length > 0) {
          lines.push(`  RBs: ${roster.keyPlayers.rbs.slice(0, 5).join(', ')}`)
        }
        if (roster.keyPlayers.wrs.length > 0) {
          lines.push(`  WRs/TEs: ${roster.keyPlayers.wrs.slice(0, 8).join(', ')}`)
        }
        if (roster.keyPlayers.goalies && roster.keyPlayers.goalies.length > 0) {
          lines.push(`  Goalies: ${roster.keyPlayers.goalies.join(', ')}`)
        }
      }
      
      // HOME TEAM ROSTER (key players)
      if (game.homeTeam.roster) {
        lines.push(``)
        lines.push(`📋 ${game.homeTeam.name} CURRENT ROSTER (Key Players):`)
        const roster = game.homeTeam.roster
        if (roster.keyPlayers.qbs.length > 0) {
          lines.push(`  QBs: ${roster.keyPlayers.qbs.join(', ')}`)
        }
        if (roster.keyPlayers.rbs.length > 0) {
          lines.push(`  RBs: ${roster.keyPlayers.rbs.slice(0, 5).join(', ')}`)
        }
        if (roster.keyPlayers.wrs.length > 0) {
          lines.push(`  WRs/TEs: ${roster.keyPlayers.wrs.slice(0, 8).join(', ')}`)
        }
        if (roster.keyPlayers.goalies && roster.keyPlayers.goalies.length > 0) {
          lines.push(`  Goalies: ${roster.keyPlayers.goalies.join(', ')}`)
        }
      }
      
      // Starting goalies/pitchers
      if (game.probables.length > 0) {
        const starters = game.probables.map(p => `${p.player} (${p.position}) - ${p.team}`).join(', ')
        lines.push(`Confirmed Starters: ${starters}`)
      }
      
      // Injuries
      if (game.injuries.length > 0) {
        lines.push(`Injuries:`)
        for (const injury of game.injuries.slice(0, 10)) {
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
