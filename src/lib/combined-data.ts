/**
 * Combined Sports Data Module
 * 
 * Merges data from multiple sources for comprehensive multi-sport coverage:
 * 1. The Odds API - betting odds, spreads, totals, moneylines (45+ sports)
 * 2. ESPN API - injuries, lineups, rosters, team records
 * 3. Player Props - from The Odds API for NBA, NFL, NHL, NCAAF, NCAAB
 * 
 * This gives Claude complete, real-time information to make
 * accurate betting recommendations without relying on training data.
 * 
 * COMPREHENSIVE COVERAGE:
 * - Tier 1: NBA, NFL, NHL, NCAAB, NCAAF, MLB
 * - Tier 2: EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League
 * - Tier 3: UFC/MMA, Boxing
 * - Tier 4: Golf, Tennis, Cricket, Rugby, AFL, F1, NASCAR, and more
 */

import { getCurrentOdds, fetchAllOdds, formatOddsForContext, fetchSportPlayerProps, formatPlayerPropsForContext, type Game, type GamePlayerProps } from './odds'
import { getCachedESPNData, formatESPNForContext, type ESPNGameData, type ESPNInjury, type ESPNProbable } from './espn'
import { getWeatherForGames, formatWeatherForContext } from './weather'

export interface EnrichedGame extends Game {
  espnData?: {
    homeRecord?: string
    awayRecord?: string
    injuries: ESPNInjury[]
    probables: ESPNProbable[]
    venue?: string
    broadcast?: string
  }
}

export interface CombinedSportsData {
  games: EnrichedGame[]
  oddsLastUpdated: string
  espnLastUpdated: string
  totalGames: number
  espnError: string | null
  oddsError: string | null
}

/**
 * Match games between Odds API and ESPN data
 * Uses fuzzy team name matching since APIs use different naming conventions
 */
function matchGames(oddsGame: Game, espnGame: ESPNGameData): boolean {
  // Normalize team names for comparison
  const normalize = (name: string) => name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
  
  const oddsHome = normalize(oddsGame.homeTeam)
  const oddsAway = normalize(oddsGame.awayTeam)
  const espnHome = normalize(espnGame.homeTeam.name)
  const espnAway = normalize(espnGame.awayTeam.name)
  
  // Check for exact matches first
  if (oddsHome === espnHome && oddsAway === espnAway) {
    return true
  }
  
  // Check for partial matches (team name contains the other)
  const homeMatch = oddsHome.includes(espnHome) || espnHome.includes(oddsHome) ||
    oddsHome.split(' ').some(word => espnHome.includes(word) && word.length > 3) ||
    espnHome.split(' ').some(word => oddsHome.includes(word) && word.length > 3)
  
  const awayMatch = oddsAway.includes(espnAway) || espnAway.includes(oddsAway) ||
    oddsAway.split(' ').some(word => espnAway.includes(word) && word.length > 3) ||
    espnAway.split(' ').some(word => oddsAway.includes(word) && word.length > 3)
  
  return homeMatch && awayMatch
}

/**
 * Map Odds API sport names to ESPN league names
 * Comprehensive mapping for all supported sports
 */
function mapSportToLeague(sportName: string): string {
  const mapping: Record<string, string> = {
    // Tier 1 - Major US Sports
    'NBA': 'NBA',
    'NFL': 'NFL',
    'NCAAF': 'NCAAF',
    'NHL': 'NHL',
    'NCAAB': 'NCAAB',
    'MLB': 'MLB',
    // Tier 2 - Soccer
    'English Premier League': 'EPL',
    'La Liga': 'ESP.1',
    'Bundesliga': 'GER.1',
    'Serie A': 'ITA.1',
    'Ligue 1': 'FRA.1',
    'MLS': 'MLS',
    'UEFA Champions League': 'UEFA.CHAMPIONS',
    'UEFA Europa League': 'UEFA.EUROPA',
    'Liga MX': 'MEX.1',
    'Brazil Serie A': 'BRA.1',
    'Argentina Primera': 'ARG.1',
    // Tier 3 - Combat Sports
    'UFC/MMA': 'MMA',
    'Boxing': 'BOXING',
    // Tier 4 - Other Sports
    'Euroleague': 'EUROLEAGUE',
    'NBL (Australia)': 'NBL',
    'AHL': 'AHL',
    'SHL (Sweden)': 'SHL',
    'NRL': 'NRL',
    'AFL': 'AFL',
    'Six Nations': 'SIXNATIONS',
  }
  return mapping[sportName] || sportName
}

/**
 * Get combined sports data from both APIs
 */
export async function getCombinedSportsData(): Promise<CombinedSportsData> {
  // Fetch both sources in parallel
  const [initialOddsData, espnData] = await Promise.all([
    getCurrentOdds(),
    getCachedESPNData()
  ])
  
  // If cache returned empty odds, force fetch fresh data
  let oddsData = initialOddsData
  if (!oddsData?.games?.length) {
    console.log('[getCombinedSportsData] Cache empty, fetching fresh odds...')
    oddsData = await fetchAllOdds()
  }
  
  // Enrich odds games with ESPN data
  const enrichedGames: EnrichedGame[] = oddsData.games.map(oddsGame => {
    // Find matching ESPN game
    const espnLeague = mapSportToLeague(oddsGame.sportName)
    const espnGame = espnData.games.find(eg => 
      eg.league === espnLeague && matchGames(oddsGame, eg)
    )
    
    if (espnGame) {
      return {
        ...oddsGame,
        espnData: {
          homeRecord: espnGame.homeTeam.record,
          awayRecord: espnGame.awayTeam.record,
          injuries: espnGame.injuries,
          probables: espnGame.probables,
          venue: espnGame.venue,
          broadcast: espnGame.broadcast,
        }
      }
    }
    
    return oddsGame
  })
  
  return {
    games: enrichedGames,
    oddsLastUpdated: oddsData.lastUpdated,
    espnLastUpdated: espnData.lastUpdated,
    totalGames: enrichedGames.length,
    espnError: espnData.error,
    oddsError: oddsData.isStale ? 'Odds data may be stale' : null
  }
}

/**
 * Format combined data for Claude's context
 * This is the main function to use in the chat API
 */
export async function formatCombinedDataForContext(): Promise<string> {
  // Fetch odds, ESPN data, and player props for ALL sports in parallel
  const [initialOddsData, espnData, nbaProps, nflProps, nhlProps, ncaafProps, ncaabProps] = await Promise.all([
    getCurrentOdds(),
    getCachedESPNData(),
    fetchSportPlayerProps('basketball_nba').catch(() => [] as GamePlayerProps[]),
    fetchSportPlayerProps('americanfootball_nfl').catch(() => [] as GamePlayerProps[]),
    fetchSportPlayerProps('icehockey_nhl').catch(() => [] as GamePlayerProps[]),
    fetchSportPlayerProps('americanfootball_ncaaf').catch(() => [] as GamePlayerProps[]),
    fetchSportPlayerProps('basketball_ncaab').catch(() => [] as GamePlayerProps[])
  ])
  
  // Combine all props from all sports
  const allProps = [...nbaProps, ...nflProps, ...nhlProps, ...ncaafProps, ...ncaabProps]
  
  // If cache returned empty odds, force fetch fresh data
  let oddsData = initialOddsData
  if (!oddsData?.games?.length) {
    console.log('[formatCombinedDataForContext] Cache empty, fetching fresh odds...')
    oddsData = await fetchAllOdds()
  }
  
  // Fetch weather for outdoor games (NFL, NCAAF, MLB, MLS, Soccer)
  const outdoorGames = oddsData.games
    .filter(g => ['NFL', 'NCAAF', 'MLB', 'MLS', 'English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1'].includes(g.sportName))
    .map(g => ({ id: g.id, homeTeam: g.homeTeam, awayTeam: g.awayTeam, sport: g.sportName }))
  
  const weatherMap = await getWeatherForGames(outdoorGames).catch(() => new Map())
  
  const lines: string[] = []
  
  // Header with data freshness info
  lines.push('=== REAL-TIME SPORTS DATA ===')
  lines.push('')
  lines.push('You have access to CURRENT data from FOUR sources:')
  lines.push(`1. BETTING ODDS (The Odds API) - Last updated: ${formatTimestamp(oddsData?.lastUpdated || new Date().toISOString())}${oddsData?.isStale ? ' ⚠️ STALE' : ''}`)
  lines.push(`2. INJURIES & LINEUPS (ESPN API) - Last updated: ${formatTimestamp(espnData?.lastUpdated || new Date().toISOString())}${espnData?.error ? ' ⚠️ ' + espnData.error : ''}`)
  lines.push(`3. PLAYER PROPS (The Odds API) - NBA: ${nbaProps.length}, NFL: ${nflProps.length}, NHL: ${nhlProps.length}, NCAAF: ${ncaafProps.length}, NCAAB: ${ncaabProps.length} games`)
  lines.push(`4. WEATHER (OpenWeatherMap) - ${weatherMap.size} outdoor games with weather data`)
  lines.push('')
  
  // Critical instructions for Claude
  lines.push('CRITICAL INSTRUCTIONS:')
  lines.push('- ALWAYS check injury data before recommending a bet')
  lines.push('- ALWAYS verify starting goalies for NHL games')
  lines.push('- ALWAYS reference current team records')
  lines.push('- NEVER cite players who may have been traded - use ESPN data to verify rosters')
  lines.push('- If key player is injured, factor that into your analysis')
  lines.push('- For OUTDOOR games (NFL, MLB, MLS): ALWAYS check weather conditions below')
  lines.push('')
  
  // Player props confidence rules
  lines.push('PLAYER PROPS CONFIDENCE RULES:')
  lines.push('- If a player has props listed below → HIGH confidence they will play (sportsbooks expect them to play)')
  lines.push('- If player is a star (LeBron, Curry, etc.) but no props yet → MEDIUM confidence, recommend with disclaimer')
  lines.push('- If player is NOT listed and not a star → LOW confidence, suggest waiting for lineup confirmation')
  lines.push('- For MORNING requests (before props posted): Focus on star players, add "verify lineup before game" disclaimer')
  lines.push('- For AFTERNOON/EVENING requests: Use props data for high-confidence recommendations')
  lines.push('')
  
  // Add odds data
  lines.push(formatOddsForContext(oddsData))
  lines.push('')
  
  // Add weather data for outdoor games
  if (weatherMap.size > 0) {
    lines.push(formatWeatherForContext(weatherMap, outdoorGames))
  }
  
  // Add player props data for ALL sports
  if (allProps.length > 0) {
    lines.push(formatPlayerPropsForContext(allProps))
  } else {
    lines.push('\n=== PLAYER PROPS ===')
    lines.push('No player props currently available. Props are typically posted by sportsbooks in the morning/early afternoon.')
    lines.push('For prop recommendations without props data: Focus on star players who always start when healthy.')
    lines.push('')
  }
  
  // Add ESPN data
  lines.push(formatESPNForContext(espnData))
  
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
