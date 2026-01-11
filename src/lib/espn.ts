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

// Cache for ESPN data (5 minutes - injuries are critical for betting decisions)
const ESPN_CACHE_EXPIRY_MS = 5 * 60 * 1000
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

// ============================================
// ESPN ODDS TYPES AND FUNCTIONS
// ESPN provides FREE betting odds from DraftKings via the pickcenter endpoint
// This replaces the need for The Odds API for game lines (spreads, totals, moneylines)
// ============================================

export interface ESPNOdds {
  gameId: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  provider: string
  spread: number | null
  spreadOdds: { home: number; away: number } | null
  overUnder: number | null
  overUnderOdds: { over: number; under: number } | null
  moneyline: { home: number; away: number } | null
  homeFavorite: boolean
  gameStatus: 'pre' | 'in' | 'post'
  statusDetail: string
}

export interface ESPNOddsData {
  games: ESPNOdds[]
  lastUpdated: string
  error: string | null
}

// Extended ESPN sports list for odds (includes more sports)
const ESPN_ODDS_SPORTS = [
  // Tier 1: Major US Sports
  { sport: 'basketball', league: 'nba', name: 'NBA' },
  { sport: 'football', league: 'nfl', name: 'NFL' },
  { sport: 'hockey', league: 'nhl', name: 'NHL' },
  { sport: 'basketball', league: 'mens-college-basketball', name: 'NCAAB' },
  { sport: 'football', league: 'college-football', name: 'NCAAF' },
  { sport: 'baseball', league: 'mlb', name: 'MLB' },
  // Tier 2: Soccer
  { sport: 'soccer', league: 'eng.1', name: 'English Premier League' },
  { sport: 'soccer', league: 'esp.1', name: 'La Liga' },
  { sport: 'soccer', league: 'ger.1', name: 'Bundesliga' },
  { sport: 'soccer', league: 'ita.1', name: 'Serie A' },
  { sport: 'soccer', league: 'fra.1', name: 'Ligue 1' },
  { sport: 'soccer', league: 'usa.1', name: 'MLS' },
  { sport: 'soccer', league: 'uefa.champions', name: 'UEFA Champions League' },
  // Tier 3: Combat Sports
  { sport: 'mma', league: 'ufc', name: 'UFC' },
  // Tier 4: Other Sports
  { sport: 'golf', league: 'pga', name: 'PGA Tour' },
  { sport: 'tennis', league: 'atp', name: 'ATP Tennis' },
]

// Cache for ESPN odds (15 minutes - can refresh more often since it's free)
const ESPN_ODDS_CACHE_EXPIRY_MS = 15 * 60 * 1000
let espnOddsCache: ESPNOddsData | null = null
let espnOddsCacheExpiry: Date | null = null

/**
 * Fetch odds for a single game from ESPN summary endpoint
 */
async function fetchESPNGameOdds(sport: string, league: string, eventId: string, leagueName: string): Promise<ESPNOdds | null> {
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${eventId}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    
    // Get pickcenter data (betting odds)
    const pickcenter = data.pickcenter?.[0]
    if (!pickcenter) {
      return null
    }
    
    // Get game info
    const header = data.header
    const competition = header?.competitions?.[0]
    const homeTeam = competition?.competitors?.find((c: { homeAway: string }) => c.homeAway === 'home')
    const awayTeam = competition?.competitors?.find((c: { homeAway: string }) => c.homeAway === 'away')
    
    if (!homeTeam || !awayTeam) {
      return null
    }
    
    // Get game status from header
    const gameState = header?.competitions?.[0]?.status?.type?.state || 'pre'
    const statusDetail = header?.competitions?.[0]?.status?.type?.shortDetail || ''
    
    return {
      gameId: eventId,
      sport,
      league: leagueName,
      homeTeam: homeTeam.team?.displayName || homeTeam.team?.name || 'Unknown',
      awayTeam: awayTeam.team?.displayName || awayTeam.team?.name || 'Unknown',
      commenceTime: header?.competitions?.[0]?.date || new Date().toISOString(),
      provider: pickcenter.provider?.name || 'DraftKings',
      spread: pickcenter.spread ?? null,
      spreadOdds: pickcenter.homeTeamOdds?.spreadOdds && pickcenter.awayTeamOdds?.spreadOdds ? {
        home: pickcenter.homeTeamOdds.spreadOdds,
        away: pickcenter.awayTeamOdds.spreadOdds
      } : null,
      overUnder: pickcenter.overUnder ?? null,
      overUnderOdds: pickcenter.overOdds && pickcenter.underOdds ? {
        over: pickcenter.overOdds,
        under: pickcenter.underOdds
      } : null,
      moneyline: pickcenter.homeTeamOdds?.moneyLine && pickcenter.awayTeamOdds?.moneyLine ? {
        home: pickcenter.homeTeamOdds.moneyLine,
        away: pickcenter.awayTeamOdds.moneyLine
      } : null,
      homeFavorite: pickcenter.homeTeamOdds?.favorite ?? false,
      gameStatus: gameState as 'pre' | 'in' | 'post',
      statusDetail: statusDetail
    }
  } catch (error) {
    console.error(`Failed to fetch ESPN odds for event ${eventId}:`, error)
    return null
  }
}

/**
 * Fetch all game IDs from ESPN scoreboard for a sport
 */
async function fetchESPNGameIds(sport: string, league: string): Promise<string[]> {
  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) {
      return []
    }
    
    const data = await response.json()
    
    if (!data.events || !Array.isArray(data.events)) {
      return []
    }
    
    // Filter to upcoming/scheduled games only (not completed)
    return data.events
      .filter((event: { status?: { type?: { completed?: boolean } } }) => !event.status?.type?.completed)
      .map((event: { id: string }) => event.id)
  } catch (error) {
    console.error(`Failed to fetch ESPN game IDs for ${sport}/${league}:`, error)
    return []
  }
}

/**
 * Fetch all ESPN odds for all supported sports
 * This is FREE and can be called frequently
 */
export async function fetchAllESPNOdds(): Promise<ESPNOddsData> {
  console.log('🔄 Fetching ESPN odds for all sports (FREE)...')
  
  const allOdds: ESPNOdds[] = []
  
  // Fetch game IDs for all sports in parallel
  const gameIdPromises = ESPN_ODDS_SPORTS.map(async ({ sport, league, name }) => {
    const gameIds = await fetchESPNGameIds(sport, league)
    return { sport, league, name, gameIds }
  })
  
  const sportsWithGameIds = await Promise.all(gameIdPromises)
  
  // Fetch odds for each game (limit to 10 games per sport to avoid too many requests)
  for (const { sport, league, name, gameIds } of sportsWithGameIds) {
    const limitedGameIds = gameIds.slice(0, 10)
    
    if (limitedGameIds.length === 0) {
      console.log(`📊 ${name}: No upcoming games`)
      continue
    }
    
    // Fetch odds for each game in parallel
    const oddsPromises = limitedGameIds.map(gameId => 
      fetchESPNGameOdds(sport, league, gameId, name)
    )
    
    const oddsResults = await Promise.all(oddsPromises)
    const validOdds = oddsResults.filter((o): o is ESPNOdds => o !== null)
    
    allOdds.push(...validOdds)
    console.log(`📊 ${name}: ${validOdds.length} games with odds`)
  }
  
  const oddsData: ESPNOddsData = {
    games: allOdds,
    lastUpdated: new Date().toISOString(),
    error: null
  }
  
  // Update cache
  espnOddsCache = oddsData
  espnOddsCacheExpiry = new Date(Date.now() + ESPN_ODDS_CACHE_EXPIRY_MS)
  
  console.log(`✅ ESPN odds fetched: ${allOdds.length} total games with odds`)
  
  return oddsData
}

/**
 * Get cached ESPN odds or fetch fresh if expired
 */
export async function getCachedESPNOdds(): Promise<ESPNOddsData> {
  // Check if cache is valid
  if (espnOddsCache && espnOddsCacheExpiry && espnOddsCacheExpiry > new Date()) {
    console.log(`📊 Using cached ESPN odds (${espnOddsCache.games.length} games)`)
    return espnOddsCache
  }
  
  // Fetch fresh data
  return fetchAllESPNOdds()
}

/**
 * Format game time in ET timezone
 */
function formatGameTimeET(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York'
  }) + ' ET'
}

/**
 * Get status label for display
 */
function getStatusLabel(status: 'pre' | 'in' | 'post', detail: string): string {
  switch (status) {
    case 'pre': return 'SCHEDULED'
    case 'in': return `IN PROGRESS (${detail || 'Live'})`
    case 'post': return 'FINAL'
  }
}

/**
 * Format ESPN odds for Claude's context
 */
export function formatESPNOddsForContext(oddsData: ESPNOddsData): string {
  if (!oddsData?.games?.length) {
    return `\n=== ESPN BETTING ODDS ===\nNo betting odds currently available from ESPN.\n`
  }
  
  // Get current time in ET for "today" calculation
  const now = new Date()
  const etFormatter = new Intl.DateTimeFormat('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const todayET = etFormatter.format(now)
  
  const lines: string[] = []
  lines.push(`\n=== ESPN BETTING ODDS (${oddsData.games.length} games) ===`)
  lines.push(`Source: ${oddsData.games[0]?.provider || 'DraftKings'} via ESPN (FREE)`)
  lines.push(`Last Updated: ${formatTimestamp(oddsData.lastUpdated)}`)
  lines.push(`Current Time (ET): ${now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`)
  lines.push(``)
  lines.push(`GAME STATUS KEY: SCHEDULED = not started yet, IN PROGRESS = currently playing, FINAL = completed`)
  lines.push(`IMPORTANT: When user asks for "tonight's game" or "today's game", only show games that are:`)
  lines.push(`  1. Status = SCHEDULED (not started yet)`)
  lines.push(`  2. Game time is TODAY in ET timezone`)
  lines.push(`  Do NOT include IN PROGRESS or FINAL games when asked about "tonight's game".`)
  lines.push(``)
  
  // Group by league
  const byLeague: Record<string, ESPNOdds[]> = {}
  for (const game of oddsData.games) {
    if (!byLeague[game.league]) {
      byLeague[game.league] = []
    }
    byLeague[game.league].push(game)
  }
  
  for (const league of Object.keys(byLeague)) {
    const games = byLeague[league]
    lines.push(`--- ${league} (${games.length} games) ---`)
    
    for (const game of games) {
      // Format game time and check if it's today
      const gameTimeET = formatGameTimeET(game.commenceTime)
      const gameDateET = etFormatter.format(new Date(game.commenceTime))
      const isToday = gameDateET === todayET
      const todayLabel = isToday ? '[TODAY]' : '[NOT TODAY]'
      
      // Get status label
      const statusLabel = getStatusLabel(game.gameStatus, game.statusDetail)
      
      lines.push(`${game.awayTeam} @ ${game.homeTeam}`)
      lines.push(`  Time: ${gameTimeET} ${todayLabel} | Status: ${statusLabel}`)
      
      const oddsInfo: string[] = []
      
      if (game.spread !== null) {
        const spreadTeam = game.homeFavorite ? game.homeTeam : game.awayTeam
        const spreadValue = game.homeFavorite ? game.spread : -game.spread
        oddsInfo.push(`Spread: ${spreadTeam} ${spreadValue > 0 ? '+' : ''}${spreadValue}`)
      }
      
      if (game.overUnder !== null) {
        oddsInfo.push(`O/U: ${game.overUnder}`)
      }
      
      if (game.moneyline) {
        oddsInfo.push(`ML: ${game.homeTeam} ${game.moneyline.home > 0 ? '+' : ''}${game.moneyline.home} / ${game.awayTeam} ${game.moneyline.away > 0 ? '+' : ''}${game.moneyline.away}`)
      }
      
      if (oddsInfo.length > 0) {
        lines.push(`  ${oddsInfo.join(' | ')}`)
      }
      lines.push(``)
    }
  }
  
  return lines.join('\n')
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
      headers: { 'Accept': 'application/json' },
      cache: 'no-store', // Disable Next.js fetch caching
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
 * Fetch injuries for a specific game from ESPN summary endpoint
 * The scoreboard endpoint doesn't include injuries, but the summary endpoint does
 */
async function fetchGameInjuries(sport: string, league: string, eventId: string): Promise<ESPNInjury[]> {
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${eventId}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) {
      return []
    }
    
    const data = await response.json()
    
    const injuries: ESPNInjury[] = []
    
    // Extract injuries from the summary endpoint
    if (data.injuries && Array.isArray(data.injuries)) {
      for (const teamInjuries of data.injuries) {
        const teamName = teamInjuries.team?.displayName || 'Unknown'
        if (teamInjuries.injuries && Array.isArray(teamInjuries.injuries)) {
          for (const injury of teamInjuries.injuries) {
            injuries.push({
              team: teamName,
              player: injury.athlete?.displayName || injury.athlete?.fullName || 'Unknown',
              status: injury.status || 'Unknown',
              details: injury.type?.description || injury.details?.detail || ''
            })
          }
        }
      }
    }
    
    return injuries
  } catch (error) {
    console.error(`Failed to fetch injuries for event ${eventId}:`, error)
    return []
  }
}

/**
 * Fetch scoreboard data for a specific sport/league from ESPN
 */
async function fetchESPNScoreboard(sport: string, league: string, leagueName: string): Promise<ESPNGameData[]> {
  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store', // Disable Next.js fetch caching
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
  
  // Fetch injuries from summary endpoint for upcoming games
  // The scoreboard endpoint doesn't include injuries, but the summary endpoint does
  console.log(`🏥 Fetching injuries for ${upcomingGames.length} upcoming games...`)
  
  const INJURY_BATCH_SIZE = 5
  for (let i = 0; i < upcomingGames.length; i += INJURY_BATCH_SIZE) {
    const batch = upcomingGames.slice(i, i + INJURY_BATCH_SIZE)
    const injuryPromises = batch.map(async (game) => {
      const sportConfig = ESPN_SPORTS.find(s => s.name === game.league)
      if (!sportConfig) return { gameId: game.id, injuries: [] }
      
      const injuries = await fetchGameInjuries(sportConfig.sport, sportConfig.league, game.id)
      return { gameId: game.id, injuries }
    })
    
    const injuryResults = await Promise.all(injuryPromises)
    
    // Attach injuries to games
    for (const result of injuryResults) {
      const gameIndex = allGames.findIndex(g => g.id === result.gameId)
      if (gameIndex >= 0 && result.injuries.length > 0) {
        allGames[gameIndex].injuries = result.injuries
      }
    }
  }
  
  const gamesWithInjuries = allGames.filter(g => g.injuries.length > 0).length
  console.log(`🏥 Attached injuries to ${gamesWithInjuries} games`)
  
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
  if (!espnData?.games?.length) {
    return `No ESPN game data currently available.${espnData?.error ? ` Error: ${espnData.error}` : ''}`
  }
  
  // Format last updated time in ET for user-friendly display
  const lastUpdatedET = new Date(espnData.lastUpdated).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) + ' ET'
  
  const lines: string[] = []
  lines.push(`=== REAL-TIME ROSTER, INJURY & LINEUP DATA (ESPN) ===`)
  lines.push(`⏰ Data freshness: Updated as of ${lastUpdatedET} (refreshes every 5 minutes)`)
  if (espnData.error) {
    lines.push(`⚠️ Warning: ${espnData.error}`)
  }
  lines.push('')
  lines.push(`CRITICAL: The roster and injury data below is CURRENT as of ${lastUpdatedET}.`)
  lines.push(`When discussing injuries, mention "as of ${lastUpdatedET}" so users know the data is fresh.`)
  lines.push(`DO NOT mention any player whose name does not appear in the roster below.`)
  lines.push(`If injury list is empty, say "ESPN reports no significant injuries as of ${lastUpdatedET}."`)
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
        lines.push(`🏥 INJURY REPORT (${game.injuries.length} players):`)
        for (const injury of game.injuries.slice(0, 15)) {
          lines.push(`  - ${injury.player} (${injury.team}): ${injury.status}${injury.details ? ` - ${injury.details}` : ''}`)
        }
        if (game.injuries.length > 15) {
          lines.push(`  ... and ${game.injuries.length - 15} more injuries`)
        }
      } else {
        lines.push(`🏥 INJURY REPORT: No significant injuries reported by ESPN. Both teams appear healthy.`)
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
