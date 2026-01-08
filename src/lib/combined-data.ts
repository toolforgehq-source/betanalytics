/**
 * Combined Sports Data Module
 * 
 * Merges data from two sources:
 * 1. The Odds API - betting odds, spreads, totals, moneylines
 * 2. ESPN API - injuries, lineups, rosters, team records
 * 
 * This gives Claude complete, real-time information to make
 * accurate betting recommendations without relying on training data.
 */

import { getCurrentOdds, formatOddsForContext, type Game } from './odds'
import { getCachedESPNData, formatESPNForContext, type ESPNGameData, type ESPNInjury, type ESPNProbable } from './espn'

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
 */
function mapSportToLeague(sportName: string): string {
  const mapping: Record<string, string> = {
    'NBA': 'NBA',
    'NFL': 'NFL',
    'NCAAF': 'NCAAF',
    'NHL': 'NHL',
    'NCAAB': 'NCAAB',
    'MLB': 'MLB',
    'MMA/UFC': 'MMA',
    'MLS': 'MLS',
    'English Premier League': 'EPL',
  }
  return mapping[sportName] || sportName
}

/**
 * Get combined sports data from both APIs
 */
export async function getCombinedSportsData(): Promise<CombinedSportsData> {
  // Fetch both sources in parallel
  const [oddsData, espnData] = await Promise.all([
    getCurrentOdds(),
    getCachedESPNData()
  ])
  
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
  const [oddsData, espnData] = await Promise.all([
    getCurrentOdds(),
    getCachedESPNData()
  ])
  
  const lines: string[] = []
  
  // Header with data freshness info
  lines.push('=== REAL-TIME SPORTS DATA ===')
  lines.push('')
  lines.push('You have access to CURRENT data from two sources:')
  lines.push(`1. BETTING ODDS (The Odds API) - Last updated: ${formatTimestamp(oddsData.lastUpdated)}${oddsData.isStale ? ' ⚠️ STALE' : ''}`)
  lines.push(`2. INJURIES & LINEUPS (ESPN API) - Last updated: ${formatTimestamp(espnData.lastUpdated)}${espnData.error ? ' ⚠️ ' + espnData.error : ''}`)
  lines.push('')
  
  // Critical instructions for Claude
  lines.push('CRITICAL INSTRUCTIONS:')
  lines.push('- ALWAYS check injury data before recommending a bet')
  lines.push('- ALWAYS verify starting goalies for NHL games')
  lines.push('- ALWAYS reference current team records')
  lines.push('- NEVER cite players who may have been traded - use ESPN data to verify rosters')
  lines.push('- If key player is injured, factor that into your analysis')
  lines.push('')
  
  // Add odds data
  lines.push(formatOddsForContext(oddsData))
  lines.push('')
  
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
