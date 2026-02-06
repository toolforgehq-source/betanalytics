/**
 * Player Stats Tracking System
 * 
 * Tracks historical player performance for prop bet predictions.
 * Similar to the Elo system but for individual player statistics.
 * 
 * Features:
 * - Fetches player game logs from ESPN
 * - Tracks rolling averages with recency weighting
 * - Adjusts for opponent defensive strength
 * - Calculates probability of hitting over/under lines
 * - Pace/game environment adjustments (NEW)
 * - Usage adjustments for teammate injuries (NEW)
 */

import { getPaceAdjustment, getUsageAdjustment } from './prop-enhancements'

// ============================================
// TYPES
// ============================================

export interface PlayerGameLog {
  gameId: string
  date: string
  opponent: string
  opponentId: string
  isHome: boolean
  minutes: number
  // Basketball stats
  points?: number
  rebounds?: number
  assists?: number
  threePointersMade?: number
  steals?: number
  blocks?: number
  // Football stats
  passingYards?: number
  rushingYards?: number
  receivingYards?: number
  passingTouchdowns?: number
  rushingTouchdowns?: number
  receivingTouchdowns?: number
  receptions?: number
  // Hockey stats
  goals?: number
  hockeyAssists?: number
  shots?: number
  saves?: number
  // Baseball stats
  hits?: number
  homeRuns?: number
  rbis?: number
  totalBases?: number
  runsScored?: number
  strikeouts?: number  // For pitchers
  earnedRuns?: number  // For pitchers
  inningsPitched?: number  // For pitchers
}

export interface HitRateData {
  overHits: number
  underHits: number
  totalGames: number
  hitRate: number  // Percentage of times player hits OVER their average
}

export interface PlayerStats {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  sport: string
  position: string
  gameLogs: PlayerGameLog[]
  // Rolling averages (last 10 games, weighted toward recent)
  averages: {
    minutes?: number
    points?: number
    rebounds?: number
    assists?: number
    threePointersMade?: number
    passingYards?: number
    rushingYards?: number
    receivingYards?: number
    goals?: number
    hockeyAssists?: number
    shots?: number
    saves?: number
    hits?: number
    homeRuns?: number
    rbis?: number
    strikeouts?: number
  }
  // Standard deviations for probability calculations
  stdDevs: {
    points?: number
    rebounds?: number
    assists?: number
    threePointersMade?: number
    passingYards?: number
    rushingYards?: number
    receivingYards?: number
    goals?: number
    hockeyAssists?: number
    shots?: number
    saves?: number
    hits?: number
    homeRuns?: number
    rbis?: number
    strikeouts?: number
  }
  // Historical hit rates - how often player hits OVER their average for each stat
  hitRates?: {
    points?: HitRateData
    rebounds?: HitRateData
    assists?: HitRateData
    threePointersMade?: HitRateData
    passingYards?: HitRateData
    rushingYards?: HitRateData
    receivingYards?: HitRateData
    goals?: HitRateData
    hockeyAssists?: HitRateData
    shots?: HitRateData
    saves?: HitRateData
    hits?: HitRateData
    homeRuns?: HitRateData
    rbis?: HitRateData
    strikeouts?: HitRateData
  }
  // Reliability score (0-100) - higher = more consistent/predictable
  // Based on coefficient of variation (lower variance = higher reliability)
  reliabilityScore?: number
  // Home/Away performance splits
  homeAwgMultiplier?: number  // e.g., 1.05 means player scores 5% more at home
  gamesPlayed: number
  lastUpdated: string
}

export interface TeamDefenseRating {
  teamId: string
  teamName: string
  sport: string
  // How much this team allows vs league average (1.0 = average, 1.1 = allows 10% more)
  pointsAllowedFactor?: number
  reboundsAllowedFactor?: number
  assistsAllowedFactor?: number
  passingYardsAllowedFactor?: number
  rushingYardsAllowedFactor?: number
  receivingYardsAllowedFactor?: number
  goalsAllowedFactor?: number
  shotsAllowedFactor?: number
  hitsAllowedFactor?: number
  gamesTracked: number
  lastUpdated: string
}

export interface PlayerStatsData {
  players: Record<string, PlayerStats>  // keyed by `${sport}_${playerId}`
  teamDefense: Record<string, TeamDefenseRating>  // keyed by `${sport}_${teamId}`
  lastUpdated: string
  gamesProcessed: number
}

// ============================================
// CONSTANTS
// ============================================

const PLAYER_STATS_KEY = 'player_stats_v1'
const PLAYER_PROCESSED_GAMES_KEY = 'player_stats_processed_games_v1'

// Number of recent games to use for rolling averages
const ROLLING_WINDOW = 10

// Recency weight decay (more recent games weighted higher)
// Weight for game i (0 = most recent): weight = RECENCY_DECAY ^ i
const RECENCY_DECAY = 0.85

// Sport-specific stat mappings
const SPORT_STATS: Record<string, string[]> = {
  NBA: ['points', 'rebounds', 'assists', 'threePointersMade'],
  NCAAB: ['points', 'rebounds', 'assists', 'threePointersMade'],
  NFL: ['passingYards', 'rushingYards', 'receivingYards', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns'],
  NCAAF: ['passingYards', 'rushingYards', 'receivingYards', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns'],
  NHL: ['goals', 'hockeyAssists', 'shots', 'saves'],
  MLB: ['hits', 'homeRuns', 'rbis', 'totalBases', 'strikeouts'],
}

// ESPN sport/league mappings for player stats
const ESPN_PLAYER_SPORTS = [
  { sport: 'basketball', league: 'nba', name: 'NBA' },
  { sport: 'basketball', league: 'mens-college-basketball', name: 'NCAAB' },
  { sport: 'football', league: 'nfl', name: 'NFL' },
  { sport: 'football', league: 'college-football', name: 'NCAAF' },
  { sport: 'hockey', league: 'nhl', name: 'NHL' },
  { sport: 'baseball', league: 'mlb', name: 'MLB' },
]

// On-demand cache key prefix (15 minute TTL)
const ON_DEMAND_CACHE_PREFIX = 'player_ondemand_'
const ON_DEMAND_CACHE_TTL = 900 // 15 minutes in seconds

// ============================================
// REDIS HELPERS
// ============================================

async function getRedisClient() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.warn('[PlayerStats] Redis not configured')
    return null
  }
  
  return { url, token }
}

export async function getPlayerStatsData(): Promise<PlayerStatsData | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', PLAYER_STATS_KEY]),
      cache: 'no-store'
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as PlayerStatsData
  } catch (error) {
    console.error('[PlayerStats] Error getting player stats:', error)
    return null
  }
}

export async function savePlayerStatsData(statsData: PlayerStatsData): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) {
    console.warn('[PlayerStats] Redis not configured, cannot save')
    return false
  }
  
  try {
    const safeData: PlayerStatsData = {
      players: statsData.players || {},
      teamDefense: statsData.teamDefense || {},
      lastUpdated: statsData.lastUpdated || new Date().toISOString(),
      gamesProcessed: statsData.gamesProcessed || 0
    }
    
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', PLAYER_STATS_KEY, JSON.stringify(safeData)])
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[PlayerStats] Failed to save: ${response.status} - ${errorText}`)
      return false
    }
    
    const data = await response.json()
    if (data.error) {
      console.error(`[PlayerStats] Redis error: ${data.error}`)
      return false
    }
    
    console.log(`[PlayerStats] Saved stats for ${Object.keys(safeData.players).length} players`)
    return true
  } catch (error) {
    console.error('[PlayerStats] Error saving:', error)
    return false
  }
}

async function getProcessedPlayerGameIds(): Promise<Set<string>> {
  const redis = await getRedisClient()
  if (!redis) return new Set()
  
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', PLAYER_PROCESSED_GAMES_KEY]),
      cache: 'no-store'
    })
    
    if (!response.ok) return new Set()
    
    const data = await response.json()
    if (!data.result) return new Set()
    
    const gameIds = JSON.parse(data.result) as string[]
    return new Set(gameIds)
  } catch (error) {
    console.error('[PlayerStats] Error getting processed games:', error)
    return new Set()
  }
}

async function saveProcessedPlayerGameIds(gameIds: Set<string>): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    const gameIdsArray = Array.from(gameIds)
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', PLAYER_PROCESSED_GAMES_KEY, JSON.stringify(gameIdsArray)])
    })
  } catch (error) {
    console.error('[PlayerStats] Error saving processed games:', error)
  }
}

/**
 * Clear processed games list to allow re-processing
 * Useful for backfilling or fixing data issues
 */
export async function clearProcessedGames(): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) return false
  
  try {
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['DEL', PLAYER_PROCESSED_GAMES_KEY])
    })
    console.log('[PlayerStats] Cleared processed games list')
    return true
  } catch (error) {
    console.error('[PlayerStats] Error clearing processed games:', error)
    return false
  }
}

// ============================================
// ON-DEMAND PLAYER STATS FETCHING
// ============================================

interface ESPNPlayerSearchResult {
  id: string
  displayName: string
  position?: string
  team?: {
    id: string
    displayName: string
  }
}

interface ESPNGameLogEntry {
  date: string
  opponent: string
  opponentId: string
  isHome: boolean
  stats: Record<string, number>
}

/**
 * Search for a player on ESPN by name
 * Returns player ID and basic info if found
 * Uses multiple search strategies for different sports
 */
async function searchESPNPlayer(
  playerName: string,
  sport: string
): Promise<ESPNPlayerSearchResult | null> {
  const sportConfig = ESPN_PLAYER_SPORTS.find(s => s.name === sport)
  if (!sportConfig) {
    console.log(`[OnDemand] Unknown sport: ${sport}`)
    return null
  }
  
  console.log(`[OnDemand] Searching ESPN for player: ${playerName} in ${sport}`)
  
  // Strategy 1: Try the general search API first (works well for NFL, NBA)
  try {
    const searchUrl = `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=10&type=player`
    
    const response = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (response.ok) {
      const data = await response.json()
      const players = data.results?.filter((r: { type: string }) => r.type === 'player') || []
      
      for (const result of players) {
        const items = result.contents || []
        for (const item of items) {
          const league = item.league?.slug?.toLowerCase() || ''
          if (league === sportConfig.league || 
              (sport === 'NBA' && league === 'nba') ||
              (sport === 'NFL' && league === 'nfl') ||
              (sport === 'NHL' && league === 'nhl') ||
              (sport === 'MLB' && league === 'mlb') ||
              (sport === 'NCAAB' && (league === 'mens-college-basketball' || league === 'ncaam')) ||
              (sport === 'NCAAF' && (league === 'college-football' || league === 'ncaaf'))) {
            
            console.log(`[OnDemand] Found player via general search: ${item.displayName} (ID: ${item.id}) in ${league}`)
            
            return {
              id: item.id,
              displayName: item.displayName,
              position: item.position,
              team: item.team ? {
                id: item.team.id,
                displayName: item.team.displayName
              } : undefined
            }
          }
        }
      }
    }
  } catch {
    console.log(`[OnDemand] General search failed, trying sport-specific search`)
  }
  
  // Strategy 2: Try sport-specific autocomplete API (works better for NHL, MLB)
  try {
    const autocompleteUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${sportConfig.sport}/${sportConfig.league}/athletes?limit=10&active=true&search=${encodeURIComponent(playerName)}`
    
    const response = await fetch(autocompleteUrl, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (response.ok) {
      const data = await response.json()
      const athletes = data.items || data.athletes || []
      
      if (athletes.length > 0) {
        const athlete = athletes[0]
        console.log(`[OnDemand] Found player via sport-specific search: ${athlete.displayName || athlete.fullName} (ID: ${athlete.id})`)
        
        return {
          id: athlete.id,
          displayName: athlete.displayName || athlete.fullName,
          position: athlete.position?.abbreviation || athlete.position,
          team: athlete.team ? {
            id: athlete.team.id,
            displayName: athlete.team.displayName || athlete.team.name
          } : undefined
        }
      }
    }
  } catch {
    console.log(`[OnDemand] Sport-specific search failed`)
  }
  
  // Strategy 3: Try the site search API with sport filter
  try {
    const siteSearchUrl = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.sport}/${sportConfig.league}/athletes?limit=100`
    
    const response = await fetch(siteSearchUrl, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (response.ok) {
      const data = await response.json()
      const athletes = data.items || data.athletes || []
      
      // Search for matching player name
      const normalizedSearch = playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      
      for (const athlete of athletes) {
        const athleteName = (athlete.displayName || athlete.fullName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        
        if (athleteName.includes(normalizedSearch) || normalizedSearch.includes(athleteName) ||
            athleteName.split(' ').some((part: string) => normalizedSearch.includes(part) || part.includes(normalizedSearch))) {
          
          console.log(`[OnDemand] Found player via roster search: ${athlete.displayName || athlete.fullName} (ID: ${athlete.id})`)
          
          return {
            id: athlete.id,
            displayName: athlete.displayName || athlete.fullName,
            position: athlete.position?.abbreviation || athlete.position,
            team: athlete.team ? {
              id: athlete.team.id,
              displayName: athlete.team.displayName || athlete.team.name
            } : undefined
          }
        }
      }
    }
  } catch {
    console.log(`[OnDemand] Roster search failed`)
  }
  
  console.log(`[OnDemand] No matching player found for ${playerName} in ${sport} after all search strategies`)
  return null
}

/**
 * Fetch a player's recent game logs from ESPN
 * Returns last 10 games with stats
 */
async function fetchESPNPlayerGameLogs(
  playerId: string,
  sport: string
): Promise<ESPNGameLogEntry[]> {
  const sportConfig = ESPN_PLAYER_SPORTS.find(s => s.name === sport)
  if (!sportConfig) return []
  
  try {
    // ESPN player game log API
    const url = `https://site.web.api.espn.com/apis/common/v3/sports/${sportConfig.sport}/${sportConfig.league}/athletes/${playerId}/gamelog`
    
    console.log(`[OnDemand] Fetching game logs for player ${playerId} from ${url}`)
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) {
      console.log(`[OnDemand] Failed to fetch game logs: ${response.status}`)
      return []
    }
    
    const data = await response.json()
    
    const gameLogs: ESPNGameLogEntry[] = []
    
    // Parse the game log data - structure varies by sport
    const seasonTypes = data.seasonTypes || []
    
    for (const seasonType of seasonTypes) {
      const categories = seasonType.categories || []
      
      for (const category of categories) {
        const events = category.events || []
        const labels = category.labels || []
        
        for (const event of events) {
          const stats: Record<string, number> = {}
          const eventStats = event.stats || []
          
          // Map stats to labels
          for (let i = 0; i < Math.min(labels.length, eventStats.length); i++) {
            const label = labels[i]?.toLowerCase() || ''
            const value = parseFloat(eventStats[i]) || 0
            
            // Map ESPN labels to our stat names
            if (sport === 'NBA' || sport === 'NCAAB') {
              if (label === 'pts') stats.points = value
              else if (label === 'reb') stats.rebounds = value
              else if (label === 'ast') stats.assists = value
              else if (label === '3pm') stats.threePointersMade = value
              else if (label === 'min') stats.minutes = value
            } else if (sport === 'NFL' || sport === 'NCAAF') {
              if (label === 'yds' || label === 'pass yds') stats.passingYards = value
              else if (label === 'rush yds') stats.rushingYards = value
              else if (label === 'rec yds') stats.receivingYards = value
              else if (label === 'td' || label === 'pass td') stats.passingTouchdowns = value
              else if (label === 'rush td') stats.rushingTouchdowns = value
              else if (label === 'rec td') stats.receivingTouchdowns = value
              else if (label === 'rec') stats.receptions = value
            } else if (sport === 'NHL') {
              if (label === 'g') stats.goals = value
              else if (label === 'a') stats.hockeyAssists = value
              else if (label === 's' || label === 'sog') stats.shots = value
              else if (label === 'sv') stats.saves = value
              else if (label === 'toi') stats.minutes = value
            } else if (sport === 'MLB') {
              if (label === 'h') stats.hits = value
              else if (label === 'hr') stats.homeRuns = value
              else if (label === 'rbi') stats.rbis = value
              else if (label === 'tb') stats.totalBases = value
              else if (label === 'k' || label === 'so') stats.strikeouts = value
              else if (label === 'r') stats.runsScored = value
            }
          }
          
          // Only add if we have meaningful stats
          if (Object.keys(stats).length > 0) {
            gameLogs.push({
              date: event.eventDate || new Date().toISOString(),
              opponent: event.opponent?.displayName || 'Unknown',
              opponentId: event.opponent?.id || '',
              isHome: event.homeAway === 'home',
              stats
            })
          }
        }
      }
    }
    
    // Sort by date (most recent first) and take last 10
    gameLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    
    console.log(`[OnDemand] Found ${gameLogs.length} game logs for player ${playerId}`)
    
    return gameLogs.slice(0, 10)
  } catch (error) {
    console.error(`[OnDemand] Error fetching game logs:`, error)
    return []
  }
}

/**
 * Calculate on-demand player stats from game logs
 */
function calculateOnDemandStats(
  gameLogs: ESPNGameLogEntry[],
  statType: string
): { average: number; stdDev: number; recentTrend: number; hitRate: number; gamesPlayed: number } | null {
  if (gameLogs.length < 3) {
    console.log(`[OnDemand] Not enough games (${gameLogs.length}) for reliable stats`)
    return null
  }
  
  // Extract stat values
  const values = gameLogs
    .map(log => log.stats[statType])
    .filter((v): v is number => v !== undefined && !isNaN(v))
  
  if (values.length < 3) {
    console.log(`[OnDemand] Not enough ${statType} values (${values.length})`)
    return null
  }
  
  // Calculate weighted average (more recent games weighted higher)
  let weightedSum = 0
  let totalWeight = 0
  for (let i = 0; i < values.length; i++) {
    const weight = Math.pow(RECENCY_DECAY, i)
    weightedSum += values[i] * weight
    totalWeight += weight
  }
  const average = weightedSum / totalWeight
  
  // Calculate standard deviation
  const squaredDiffs = values.map(v => Math.pow(v - average, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length
  const stdDev = Math.sqrt(avgSquaredDiff) || average * 0.3
  
  // Calculate recent trend (last 3 games vs overall average)
  const recentValues = values.slice(0, 3)
  const recentAvg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length
  const recentTrend = recentAvg / average // >1 means trending up
  
  // Calculate hit rate (how often player exceeds their average)
  const overCount = values.filter(v => v > average).length
  const hitRate = overCount / values.length
  
  console.log(`[OnDemand] Calculated stats for ${statType}: avg=${average.toFixed(1)}, stdDev=${stdDev.toFixed(1)}, trend=${recentTrend.toFixed(2)}, hitRate=${(hitRate * 100).toFixed(0)}%`)
  
  return {
    average,
    stdDev,
    recentTrend,
    hitRate,
    gamesPlayed: values.length
  }
}

/**
 * Get or create on-demand cache for a player
 */
async function getOnDemandCache(cacheKey: string): Promise<PlayerStats | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', cacheKey]),
      cache: 'no-store'
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as PlayerStats
  } catch {
    return null
  }
}

/**
 * Save on-demand player stats to cache with TTL
 */
async function saveOnDemandCache(cacheKey: string, stats: PlayerStats): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SETEX', cacheKey, ON_DEMAND_CACHE_TTL, JSON.stringify(stats)])
    })
    console.log(`[OnDemand] Cached player stats for ${stats.playerName} (TTL: ${ON_DEMAND_CACHE_TTL}s)`)
  } catch (error) {
    console.error('[OnDemand] Error caching player stats:', error)
  }
}

/**
 * Fetch player stats on-demand from ESPN
 * This is the main entry point for on-demand fetching
 */
export async function fetchPlayerStatsOnDemand(
  playerName: string,
  sport: string
): Promise<PlayerStats | null> {
  console.log(`[OnDemand] Fetching stats on-demand for ${playerName} in ${sport}`)
  
  // Check on-demand cache first
  const cacheKey = `${ON_DEMAND_CACHE_PREFIX}${sport}_${playerName.toLowerCase().replace(/\s+/g, '_')}`
  const cached = await getOnDemandCache(cacheKey)
  if (cached) {
    console.log(`[OnDemand] Found cached stats for ${playerName}`)
    return cached
  }
  
  // Search for player on ESPN
  const playerInfo = await searchESPNPlayer(playerName, sport)
  if (!playerInfo) {
    console.log(`[OnDemand] Could not find player ${playerName} on ESPN`)
    return null
  }
  
  // Fetch game logs
  const gameLogs = await fetchESPNPlayerGameLogs(playerInfo.id, sport)
  if (gameLogs.length < 3) {
    console.log(`[OnDemand] Not enough game data for ${playerName} (found ${gameLogs.length} games)`)
    return null
  }
  
  // Build PlayerStats object
  const statTypes = SPORT_STATS[sport] || []
  const averages: Record<string, number> = {}
  const stdDevs: Record<string, number> = {}
  const hitRates: Record<string, HitRateData> = {}
  
  for (const statType of statTypes) {
    const stats = calculateOnDemandStats(gameLogs, statType)
    if (stats) {
      averages[statType] = stats.average
      stdDevs[statType] = stats.stdDev
      hitRates[statType] = {
        overHits: Math.round(stats.hitRate * stats.gamesPlayed),
        underHits: stats.gamesPlayed - Math.round(stats.hitRate * stats.gamesPlayed),
        totalGames: stats.gamesPlayed,
        hitRate: stats.hitRate * 100
      }
    }
  }
  
  // Convert game logs to our format
  const playerGameLogs: PlayerGameLog[] = gameLogs.map(log => ({
    gameId: `ondemand_${log.date}`,
    date: log.date,
    opponent: log.opponent,
    opponentId: log.opponentId,
    isHome: log.isHome,
    minutes: log.stats.minutes || 0,
    points: log.stats.points,
    rebounds: log.stats.rebounds,
    assists: log.stats.assists,
    threePointersMade: log.stats.threePointersMade,
    passingYards: log.stats.passingYards,
    rushingYards: log.stats.rushingYards,
    receivingYards: log.stats.receivingYards,
    passingTouchdowns: log.stats.passingTouchdowns,
    rushingTouchdowns: log.stats.rushingTouchdowns,
    receivingTouchdowns: log.stats.receivingTouchdowns,
    receptions: log.stats.receptions,
    goals: log.stats.goals,
    hockeyAssists: log.stats.hockeyAssists,
    shots: log.stats.shots,
    saves: log.stats.saves,
    hits: log.stats.hits,
    homeRuns: log.stats.homeRuns,
    rbis: log.stats.rbis,
    totalBases: log.stats.totalBases,
    runsScored: log.stats.runsScored,
    strikeouts: log.stats.strikeouts,
  }))
  
  // Calculate reliability score based on coefficient of variation
  const cvValues: number[] = []
  for (const statType of statTypes) {
    if (averages[statType] && stdDevs[statType]) {
      const cv = stdDevs[statType] / averages[statType]
      cvValues.push(cv)
    }
  }
  const avgCV = cvValues.length > 0 ? cvValues.reduce((a, b) => a + b, 0) / cvValues.length : 0.5
  const reliabilityScore = Math.max(0, Math.min(100, 100 - (avgCV * 100)))
  
  const playerStats: PlayerStats = {
    playerId: playerInfo.id,
    playerName: playerInfo.displayName,
    teamId: playerInfo.team?.id || '',
    teamName: playerInfo.team?.displayName || '',
    sport,
    position: playerInfo.position || '',
    gameLogs: playerGameLogs,
    averages: averages as PlayerStats['averages'],
    stdDevs: stdDevs as PlayerStats['stdDevs'],
    hitRates: hitRates as PlayerStats['hitRates'],
    reliabilityScore,
    gamesPlayed: gameLogs.length,
    lastUpdated: new Date().toISOString()
  }
  
  // Cache for future requests
  await saveOnDemandCache(cacheKey, playerStats)
  
  console.log(`[OnDemand] Successfully fetched stats for ${playerInfo.displayName}: ${gameLogs.length} games`)
  
  return playerStats
}

// ============================================
// ESPN DATA FETCHING
// ============================================

interface ESPNBoxscoreAthlete {
  athlete: {
    id: string
    displayName: string
    position?: { abbreviation: string }
  }
  stats: string[]
  didNotPlay?: boolean
}

interface ESPNBoxscoreTeam {
  team: {
    id: string
    displayName: string
  }
  statistics: Array<{
    names: string[]
    athletes: ESPNBoxscoreAthlete[]
  }>
}

/**
 * Fetch player box score data from a completed ESPN game
 */
async function fetchGameBoxScore(
  sport: string, 
  league: string, 
  gameId: string,
  sportName: string
): Promise<{ players: PlayerGameLog[], gameDate: string, homeTeamId: string, awayTeamId: string } | null> {
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    
    // Check if game is completed
    const gameStatus = data.header?.competitions?.[0]?.status?.type?.completed
    if (!gameStatus) return null
    
    const gameDate = data.header?.competitions?.[0]?.date || new Date().toISOString()
    const boxscore = data.boxscore
    if (!boxscore?.players) return null
    
    const players: PlayerGameLog[] = []
    
    // Get home/away team info
    const competitors = data.header?.competitions?.[0]?.competitors || []
    const homeTeam = competitors.find((c: { homeAway: string }) => c.homeAway === 'home')
    const awayTeam = competitors.find((c: { homeAway: string }) => c.homeAway === 'away')
    
    if (!homeTeam || !awayTeam) return null
    
    const homeTeamId = homeTeam.team?.id || ''
    const awayTeamId = awayTeam.team?.id || ''
    
    // Process each team's players
    for (const teamData of boxscore.players as ESPNBoxscoreTeam[]) {
      const teamId = teamData.team?.id
      const isHome = teamId === homeTeamId
      const opponentId = isHome ? awayTeamId : homeTeamId
      const opponentName = isHome ? awayTeam.team?.displayName : homeTeam.team?.displayName
      
      // Get the statistics array (different structure per sport)
      // NHL uses 'keys' instead of 'names' for stat names
      for (const statGroup of teamData.statistics || []) {
        const statNames = statGroup.names || (statGroup as unknown as { keys?: string[] }).keys || []
        
        for (const athlete of statGroup.athletes || []) {
          if (athlete.didNotPlay) continue
          
          const stats = athlete.stats || []
          const playerLog: PlayerGameLog = {
            gameId,
            date: gameDate,
            opponent: opponentName || 'Unknown',
            opponentId,
            isHome,
            minutes: 0,
          }
          
          // Map stats based on sport
          if (sportName === 'NBA' || sportName === 'NCAAB') {
            // Basketball stat order: MIN, FG, 3PT, FT, OREB, DREB, REB, AST, STL, BLK, TO, PF, +/-, PTS
            const minIndex = statNames.indexOf('MIN')
            const ptsIndex = statNames.indexOf('PTS')
            const rebIndex = statNames.indexOf('REB')
            const astIndex = statNames.indexOf('AST')
            const threePtIndex = statNames.indexOf('3PT')
            
            if (minIndex >= 0) {
              const minStr = stats[minIndex] || '0'
              const [mins, secs] = minStr.split(':').map(Number)
              playerLog.minutes = mins + (secs || 0) / 60
            }
            if (ptsIndex >= 0) playerLog.points = parseInt(stats[ptsIndex]) || 0
            if (rebIndex >= 0) playerLog.rebounds = parseInt(stats[rebIndex]) || 0
            if (astIndex >= 0) playerLog.assists = parseInt(stats[astIndex]) || 0
            if (threePtIndex >= 0) {
              const threePt = stats[threePtIndex] || '0-0'
              playerLog.threePointersMade = parseInt(threePt.split('-')[0]) || 0
            }
          } else if (sportName === 'NFL' || sportName === 'NCAAF') {
            // Football - stats vary by position group
            // Passing: C/ATT, YDS, AVG, TD, INT, SACKS, QBR, RTG
            // Rushing: CAR, YDS, AVG, TD, LONG
            // Receiving: REC, YDS, AVG, TD, LONG, TGTS
            const ydsIndex = statNames.indexOf('YDS')
            const tdIndex = statNames.indexOf('TD')
            const recIndex = statNames.indexOf('REC')
            const carIndex = statNames.indexOf('CAR')
            
            if (ydsIndex >= 0) {
              const yards = parseInt(stats[ydsIndex]) || 0
              // Determine if passing, rushing, or receiving based on stat group
              if (carIndex >= 0) {
                playerLog.rushingYards = yards
                if (tdIndex >= 0) playerLog.rushingTouchdowns = parseInt(stats[tdIndex]) || 0
              } else if (recIndex >= 0) {
                playerLog.receivingYards = yards
                playerLog.receptions = parseInt(stats[recIndex]) || 0
                if (tdIndex >= 0) playerLog.receivingTouchdowns = parseInt(stats[tdIndex]) || 0
              } else {
                playerLog.passingYards = yards
                if (tdIndex >= 0) playerLog.passingTouchdowns = parseInt(stats[tdIndex]) || 0
              }
            }
          } else if (sportName === 'NHL') {
            // Hockey stats - ESPN uses full key names: goals, assists, shotsTotal, timeOnIce
            // Try both short labels (G, A, S, TOI) and full keys (goals, assists, shotsTotal, timeOnIce)
            const gIndex = statNames.indexOf('goals') >= 0 ? statNames.indexOf('goals') : statNames.indexOf('G')
            const aIndex = statNames.indexOf('assists') >= 0 ? statNames.indexOf('assists') : statNames.indexOf('A')
            const sIndex = statNames.indexOf('shotsTotal') >= 0 ? statNames.indexOf('shotsTotal') : statNames.indexOf('S')
            const toiIndex = statNames.indexOf('timeOnIce') >= 0 ? statNames.indexOf('timeOnIce') : statNames.indexOf('TOI')
            const svIndex = statNames.indexOf('saves') >= 0 ? statNames.indexOf('saves') : statNames.indexOf('SV')
            
            if (toiIndex >= 0) {
              const toiStr = stats[toiIndex] || '0:00'
              const [mins, secs] = toiStr.split(':').map(Number)
              playerLog.minutes = mins + (secs || 0) / 60
            }
            if (gIndex >= 0) playerLog.goals = parseInt(stats[gIndex]) || 0
            if (aIndex >= 0) playerLog.hockeyAssists = parseInt(stats[aIndex]) || 0
            if (sIndex >= 0) playerLog.shots = parseInt(stats[sIndex]) || 0
            if (svIndex >= 0) playerLog.saves = parseInt(stats[svIndex]) || 0
          } else if (sportName === 'MLB') {
            // Baseball batting: AB, R, H, 2B, 3B, HR, RBI, BB, SO, SB, AVG, OBP, SLG
            // Baseball pitching: IP, H, R, ER, BB, K, HR, PC-ST, ERA
            const hIndex = statNames.indexOf('H')
            const hrIndex = statNames.indexOf('HR')
            const rbiIndex = statNames.indexOf('RBI')
            const kIndex = statNames.indexOf('K')
            const ipIndex = statNames.indexOf('IP')
            
            if (hIndex >= 0) playerLog.hits = parseInt(stats[hIndex]) || 0
            if (hrIndex >= 0) playerLog.homeRuns = parseInt(stats[hrIndex]) || 0
            if (rbiIndex >= 0) playerLog.rbis = parseInt(stats[rbiIndex]) || 0
            if (kIndex >= 0) playerLog.strikeouts = parseInt(stats[kIndex]) || 0
            if (ipIndex >= 0) {
              const ip = parseFloat(stats[ipIndex]) || 0
              playerLog.inningsPitched = ip
            }
          }
          
          // Only add if player has meaningful stats
          const hasStats = playerLog.minutes > 0 || 
            playerLog.points || playerLog.passingYards || playerLog.rushingYards || 
            playerLog.receivingYards || playerLog.goals || playerLog.hits
          
          if (hasStats) {
            // Add player ID to the log for tracking
            (playerLog as PlayerGameLog & { playerId: string; playerName: string; position: string }).playerId = athlete.athlete?.id
            ;(playerLog as PlayerGameLog & { playerId: string; playerName: string; position: string }).playerName = athlete.athlete?.displayName
            ;(playerLog as PlayerGameLog & { playerId: string; playerName: string; position: string }).position = athlete.athlete?.position?.abbreviation || ''
            players.push(playerLog)
          }
        }
      }
    }
    
    return { players, gameDate, homeTeamId, awayTeamId }
  } catch (error) {
    console.error(`[PlayerStats] Error fetching box score for ${gameId}:`, error)
    return null
  }
}

/**
 * Fetch completed games from ESPN for a date range
 */
async function fetchCompletedGamesForDate(
  sport: string,
  league: string,
  sportName: string,
  date: Date
): Promise<string[]> {
  try {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${dateStr}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    
    if (!data.events) return []
    
    // Return only completed game IDs
    return data.events
      .filter((event: { status?: { type?: { completed?: boolean } } }) => event.status?.type?.completed)
      .map((event: { id: string }) => event.id)
  } catch (error) {
    console.error(`[PlayerStats] Error fetching games for ${sportName} on ${date}:`, error)
    return []
  }
}

// ============================================
// STATISTICS CALCULATIONS
// ============================================

/**
 * Calculate weighted rolling average with recency bias
 */
function calculateWeightedAverage(values: number[]): number {
  if (values.length === 0) return 0
  
  let weightedSum = 0
  let totalWeight = 0
  
  // Most recent games first
  for (let i = 0; i < Math.min(values.length, ROLLING_WINDOW); i++) {
    const weight = Math.pow(RECENCY_DECAY, i)
    weightedSum += values[i] * weight
    totalWeight += weight
  }
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

/**
 * Calculate standard deviation for probability calculations
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return mean * 0.3  // Default to 30% of mean if not enough data
  
  const squaredDiffs = values.slice(0, ROLLING_WINDOW).map(v => Math.pow(v - mean, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length
  return Math.sqrt(avgSquaredDiff)
}

/**
 * Update player's rolling averages, standard deviations, hit rates, and reliability score
 */
function updatePlayerAverages(player: PlayerStats): void {
  const logs = player.gameLogs.slice(0, ROLLING_WINDOW)
  
  // Calculate averages for each stat type based on sport
  const statTypes = SPORT_STATS[player.sport] || []
  
  // Initialize hit rates if not exists
  if (!player.hitRates) {
    player.hitRates = {}
  }
  
  // Track coefficient of variation for reliability score
  const coefficientsOfVariation: number[] = []
  
  for (const stat of statTypes) {
    const values = logs
      .map(log => {
        const logRecord = log as unknown as Record<string, number | undefined>
        return logRecord[stat]
      })
      .filter((v): v is number => v !== undefined && v !== null)
    
    if (values.length > 0) {
      const avg = calculateWeightedAverage(values)
      const stdDev = calculateStdDev(values, avg)
      
      ;(player.averages as Record<string, number>)[stat] = avg
      ;(player.stdDevs as Record<string, number>)[stat] = stdDev
      
      // Calculate coefficient of variation (lower = more consistent)
      if (avg > 0) {
        const cv = stdDev / avg
        coefficientsOfVariation.push(cv)
      }
      
      // Calculate hit rates - how often player goes OVER their average
      // This is more useful than normal distribution for betting
      const hitRateData = calculateHitRate(values, avg)
      ;(player.hitRates as Record<string, HitRateData>)[stat] = hitRateData
    }
  }
  
  // Calculate reliability score (0-100)
  // Based on average coefficient of variation across all stats
  // Lower CV = more consistent = higher reliability
  if (coefficientsOfVariation.length > 0) {
    const avgCV = coefficientsOfVariation.reduce((a, b) => a + b, 0) / coefficientsOfVariation.length
    // Convert CV to reliability score: CV of 0 = 100, CV of 1 = 0
    // Most players have CV between 0.2 and 0.6
    player.reliabilityScore = Math.max(0, Math.min(100, Math.round((1 - avgCV) * 100)))
  }
  
  // Calculate home/away performance multiplier
  const homeLogs = logs.filter(log => log.isHome)
  const awayLogs = logs.filter(log => !log.isHome)
  
  if (homeLogs.length >= 2 && awayLogs.length >= 2) {
    // Calculate average performance at home vs away for the primary stat
    const primaryStat = statTypes[0]
    if (primaryStat) {
      const homeValues = homeLogs
        .map(log => (log as unknown as Record<string, number | undefined>)[primaryStat])
        .filter((v): v is number => v !== undefined && v !== null)
      const awayValues = awayLogs
        .map(log => (log as unknown as Record<string, number | undefined>)[primaryStat])
        .filter((v): v is number => v !== undefined && v !== null)
      
      if (homeValues.length > 0 && awayValues.length > 0) {
        const homeAvg = homeValues.reduce((a, b) => a + b, 0) / homeValues.length
        const awayAvg = awayValues.reduce((a, b) => a + b, 0) / awayValues.length
        
        if (awayAvg > 0) {
          // Multiplier > 1 means player performs better at home
          player.homeAwgMultiplier = Math.round((homeAvg / awayAvg) * 100) / 100
        }
      }
    }
  }
  
  // Also calculate minutes average
  const minuteValues = logs.map(log => log.minutes).filter(m => m > 0)
  if (minuteValues.length > 0) {
    player.averages.minutes = calculateWeightedAverage(minuteValues)
  }
}

/**
 * Calculate hit rate - how often a player goes OVER a given threshold
 * Uses the player's average as the threshold (simulating typical betting lines)
 */
function calculateHitRate(values: number[], threshold: number): HitRateData {
  let overHits = 0
  let underHits = 0
  
  for (const value of values) {
    if (value > threshold) {
      overHits++
    } else {
      underHits++
    }
  }
  
  const totalGames = values.length
  const hitRate = totalGames > 0 ? Math.round((overHits / totalGames) * 100) : 50
  
  return {
    overHits,
    underHits,
    totalGames,
    hitRate
  }
}

// ============================================
// PROBABILITY CALCULATIONS
// ============================================

/**
 * Calculate probability of a player going over a line
 * Uses normal distribution approximation
 */
export function calculateOverProbability(
  playerAvg: number,
  playerStdDev: number,
  line: number,
  opponentFactor: number = 1.0
): number {
  // Adjust average for opponent strength
  const adjustedAvg = playerAvg * opponentFactor
  
  // Use normal distribution CDF
  // P(X > line) = 1 - P(X <= line) = 1 - Phi((line - mean) / stdDev)
  const z = (line - adjustedAvg) / (playerStdDev || adjustedAvg * 0.3)
  
  // Approximate normal CDF using error function approximation
  const probability = 1 - normalCDF(z)
  
  // Clamp to reasonable range
  return Math.max(0.05, Math.min(0.95, probability))
}

/**
 * Normal CDF approximation
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  
  const sign = z < 0 ? -1 : 1
  z = Math.abs(z) / Math.sqrt(2)
  
  const t = 1.0 / (1.0 + p * z)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z)
  
  return 0.5 * (1.0 + sign * y)
}

/**
 * Enhanced probability result with all model data
 */
export interface EnhancedPropProbability {
  probability: number           // Combined probability (best estimate)
  statisticalProb: number       // From normal distribution model
  historicalHitRate: number     // From actual hit rate data
  average: number               // Player's weighted average
  stdDev: number                // Standard deviation
  gamesPlayed: number           // Number of games in sample
  reliabilityScore: number      // 0-100, higher = more consistent
  homeAwayAdjustment: number    // Multiplier for home/away
  opponentAdjustment: number    // Multiplier for opponent defense
  backToBackAdjustment?: number // Multiplier for back-to-back fatigue
  paceAdjustment?: number       // Multiplier for game pace/environment
  usageAdjustment?: number      // Multiplier for teammate injuries affecting usage
  adjustedAverage: number       // Average after all adjustments
  confidence: 'high' | 'medium' | 'low'  // Based on sample size and reliability
  // Additional context
  paceDescription?: string      // Human-readable pace context
  usageDescription?: string     // Human-readable usage context
}

/**
 * Get probability for a specific player prop
 * 
 * ENHANCED MODEL that combines:
 * 1. Statistical probability (normal distribution)
 * 2. Historical hit rates (actual over/under performance)
 * 3. Opponent defensive adjustments
 * 4. Home/away adjustments
 * 5. Reliability weighting
 * 6. Pace/game environment adjustment (NEW)
 * 7. Usage adjustment for teammate injuries (NEW)
 */
export async function getPlayerPropProbability(
  playerName: string,
  sport: string,
  statType: string,
  line: number,
  opponentTeamId?: string,
  isHomeGame?: boolean,
  isBackToBack?: boolean,
  // NEW: Game context for pace and usage adjustments
  gameContext?: {
    homeTeam?: string
    awayTeam?: string
    playerTeam?: string
  }
): Promise<EnhancedPropProbability | null> {
  const statsData = await getPlayerStatsData()
  if (!statsData) {
    console.log(`[PlayerStats] No stats data available in Redis`)
    return null
  }
  
  console.log(`[PlayerStats] Looking for player: "${playerName}" in sport: "${sport}"`)
  console.log(`[PlayerStats] Total players in database: ${Object.keys(statsData.players).length}`)
  
  // Normalize player name for matching (remove accents, special chars)
  const normalizeForMatch = (name: string): string => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9\s]/g, '') // Remove special chars
      .trim()
  }
  
  const normalizedSearchName = normalizeForMatch(playerName)
  
  // Find player by name (case-insensitive, accent-insensitive search)
  const playerKey = Object.keys(statsData.players).find(key => {
    const player = statsData.players[key]
    if (player.sport !== sport) return false
    
    const normalizedPlayerName = normalizeForMatch(player.playerName)
    
    // Try multiple matching strategies
    // 1. Exact match after normalization
    if (normalizedPlayerName === normalizedSearchName) return true
    
    // 2. Contains match (search name in player name)
    if (normalizedPlayerName.includes(normalizedSearchName)) return true
    
    // 3. Contains match (player name in search name)
    if (normalizedSearchName.includes(normalizedPlayerName)) return true
    
    // 4. First/last name match
    const searchParts = normalizedSearchName.split(/\s+/)
    const playerParts = normalizedPlayerName.split(/\s+/)
    
    // If searching for "Luka", match "Luka Doncic"
    if (searchParts.length === 1 && playerParts.some(p => p === searchParts[0])) return true
    
    // If searching for "Doncic", match "Luka Doncic"
    if (searchParts.length === 1 && playerParts.some(p => p === searchParts[0])) return true
    
    return false
  })
  
  let player: PlayerStats | null = null
  
  if (!playerKey) {
    console.log(`[PlayerStats] Player "${playerName}" not found in ${sport} database, trying on-demand fetch`)
    
    // Try on-demand fetching from ESPN
    const onDemandPlayer = await fetchPlayerStatsOnDemand(playerName, sport)
    if (!onDemandPlayer) {
      // Log some sample player names for debugging
      const samplePlayers = Object.values(statsData.players)
        .filter(p => p.sport === sport)
        .slice(0, 5)
        .map(p => p.playerName)
      console.log(`[PlayerStats] Sample ${sport} players in database: ${samplePlayers.join(', ')}`)
      console.log(`[PlayerStats] On-demand fetch also failed for ${playerName}`)
      return null
    }
    
    player = onDemandPlayer
    console.log(`[PlayerStats] Found player via on-demand fetch: ${player.playerName}`)
  } else {
    player = statsData.players[playerKey]
    console.log(`[PlayerStats] Found player in cache: ${player.playerName}`)
  }
  const avg = (player.averages as Record<string, number>)[statType]
  const stdDev = (player.stdDevs as Record<string, number>)[statType]
  
  if (avg === undefined) return null
  
  // Get opponent defensive factor if available
  let opponentAdjustment = 1.0
  if (opponentTeamId) {
    const defenseKey = `${sport}_${opponentTeamId}`
    const defense = statsData.teamDefense[defenseKey]
    if (defense) {
      const factorKey = `${statType}AllowedFactor` as keyof TeamDefenseRating
      opponentAdjustment = (defense[factorKey] as number) || 1.0
    }
  }
  
  // Get home/away adjustment
  let homeAwayAdjustment = 1.0
  if (isHomeGame !== undefined && player.homeAwgMultiplier) {
    // If home game, apply home multiplier; if away, apply inverse
    homeAwayAdjustment = isHomeGame ? player.homeAwgMultiplier : (1 / player.homeAwgMultiplier)
  }
  
  // Get back-to-back fatigue adjustment
  // Players typically perform 3-5% worse on back-to-back games
  let backToBackAdjustment = 1.0
  if (isBackToBack) {
    // Sport-specific fatigue factors for player props
    const fatigueFactor: Record<string, number> = {
      'NBA': 0.95,      // -5% for NBA (high minutes, physical)
      'NCAAB': 0.96,    // -4% for college basketball
      'NHL': 0.96,      // -4% for NHL
      'MLB': 0.98,      // -2% for MLB (less physical)
    }
    backToBackAdjustment = fatigueFactor[sport] || 0.97  // Default -3%
  }
  
  // NEW: Get pace/game environment adjustment from ESPN game totals
  let paceAdjustment = 1.0
  let paceDescription: string | undefined
  if (gameContext?.homeTeam && gameContext?.awayTeam) {
    const paceResult = await getPaceAdjustment(gameContext.homeTeam, gameContext.awayTeam, sport)
    if (paceResult) {
      paceAdjustment = paceResult.paceMultiplier
      paceDescription = paceResult.paceDescription
    }
  }
  
  // NEW: Get usage adjustment based on teammate injuries
  let usageAdjustment = 1.0
  let usageDescription: string | undefined
  if (gameContext?.playerTeam) {
    const usageResult = await getUsageAdjustment(sport, gameContext.playerTeam, player.position)
    if (usageResult) {
      usageAdjustment = usageResult.usageMultiplier
      usageDescription = usageResult.description
    }
  }
  
  // Calculate adjusted average with all factors
  const adjustedAverage = avg * opponentAdjustment * homeAwayAdjustment * backToBackAdjustment * paceAdjustment * usageAdjustment
  
  // Calculate statistical probability using normal distribution
  const statisticalProb = calculateOverProbability(adjustedAverage, stdDev, line, 1.0)
  
  // Get historical hit rate for this stat
  let historicalHitRate = 0.5  // Default to 50%
  const hitRateData = player.hitRates?.[statType as keyof typeof player.hitRates]
  if (hitRateData && hitRateData.totalGames >= 3) {
    // Adjust hit rate based on how the line compares to average
    // If line is below average, hit rate should be higher
    // If line is above average, hit rate should be lower
    const lineVsAvg = line / adjustedAverage
    
    if (lineVsAvg < 0.9) {
      // Line is significantly below average - higher chance of over
      historicalHitRate = Math.min(0.95, (hitRateData.hitRate / 100) * 1.2)
    } else if (lineVsAvg > 1.1) {
      // Line is significantly above average - lower chance of over
      historicalHitRate = Math.max(0.05, (hitRateData.hitRate / 100) * 0.8)
    } else {
      // Line is close to average - use historical hit rate
      historicalHitRate = hitRateData.hitRate / 100
    }
  }
  
  // Get reliability score
  const reliabilityScore = player.reliabilityScore ?? 50
  
  // Combine statistical and historical probabilities
  // Weight historical more heavily for reliable players with good sample size
  const gamesPlayed = player.gamesPlayed
  let historicalWeight = 0.3  // Default: 30% historical, 70% statistical
  
  if (gamesPlayed >= 10 && reliabilityScore >= 60) {
    historicalWeight = 0.5  // 50/50 for reliable players with good sample
  } else if (gamesPlayed >= 20 && reliabilityScore >= 70) {
    historicalWeight = 0.6  // 60% historical for very reliable players
  }
  
  const combinedProbability = (statisticalProb * (1 - historicalWeight)) + (historicalHitRate * historicalWeight)
  
  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (gamesPlayed >= 15 && reliabilityScore >= 65) {
    confidence = 'high'
  } else if (gamesPlayed >= 8 && reliabilityScore >= 50) {
    confidence = 'medium'
  }
  
  return {
    probability: Math.max(0.05, Math.min(0.95, combinedProbability)),
    statisticalProb,
    historicalHitRate,
    average: avg,
    stdDev: stdDev || avg * 0.3,
    gamesPlayed,
    reliabilityScore,
    homeAwayAdjustment,
    opponentAdjustment,
    backToBackAdjustment: isBackToBack ? backToBackAdjustment : undefined,
    paceAdjustment: paceAdjustment !== 1.0 ? paceAdjustment : undefined,
    usageAdjustment: usageAdjustment !== 1.0 ? usageAdjustment : undefined,
    adjustedAverage,
    confidence,
    paceDescription,
    usageDescription
  }
}

/**
 * Legacy function for backwards compatibility
 * Returns simplified result matching old interface
 */
export async function getPlayerPropProbabilitySimple(
  playerName: string,
  sport: string,
  statType: string,
  line: number,
  opponentTeamId?: string
): Promise<{ probability: number; average: number; stdDev: number; gamesPlayed: number } | null> {
  const result = await getPlayerPropProbability(playerName, sport, statType, line, opponentTeamId)
  if (!result) return null
  
  return {
    probability: result.probability,
    average: result.average,
    stdDev: result.stdDev,
    gamesPlayed: result.gamesPlayed
  }
}

// ============================================
// UPDATE FUNCTIONS
// ============================================

/**
 * Process completed games and update player stats
 */
export async function updatePlayerStats(daysBack: number = 1): Promise<{
  gamesProcessed: number
  playersUpdated: number
  errors: string[]
}> {
  console.log(`[PlayerStats] Starting update for last ${daysBack} days...`)
  
  const errors: string[] = []
  let gamesProcessed = 0
  const playersUpdated = new Set<string>()
  
  // Get existing data
  let statsData = await getPlayerStatsData()
  if (!statsData) {
    statsData = {
      players: {},
      teamDefense: {},
      lastUpdated: new Date().toISOString(),
      gamesProcessed: 0
    }
  }
  
  const processedIds = await getProcessedPlayerGameIds()
  
  // Process each sport
  for (const { sport, league, name: sportName } of ESPN_PLAYER_SPORTS) {
    console.log(`[PlayerStats] Processing ${sportName}...`)
    
    // Get games for each day
    for (let d = 0; d < daysBack; d++) {
      const date = new Date()
      date.setDate(date.getDate() - d - 1)  // Yesterday and before
      
      const gameIds = await fetchCompletedGamesForDate(sport, league, sportName, date)
      
      for (const gameId of gameIds) {
        const processKey = `${sportName}_${gameId}`
        if (processedIds.has(processKey)) continue
        
        const boxScore = await fetchGameBoxScore(sport, league, gameId, sportName)
        if (!boxScore) continue
        
        // Process each player's stats
        for (const playerLog of boxScore.players) {
          const extendedLog = playerLog as PlayerGameLog & { playerId: string; playerName: string; position: string }
          const playerKey = `${sportName}_${extendedLog.playerId}`
          
          // Initialize player if not exists
          if (!statsData.players[playerKey]) {
            statsData.players[playerKey] = {
              playerId: extendedLog.playerId,
              playerName: extendedLog.playerName,
              teamId: playerLog.isHome ? boxScore.homeTeamId : boxScore.awayTeamId,
              teamName: '',  // Will be updated
              sport: sportName,
              position: extendedLog.position,
              gameLogs: [],
              averages: {},
              stdDevs: {},
              gamesPlayed: 0,
              lastUpdated: new Date().toISOString()
            }
          }
          
          const player = statsData.players[playerKey]
          
          // Add game log (most recent first)
          player.gameLogs.unshift(playerLog)
          
          // Keep only last 20 games to save space
          if (player.gameLogs.length > 20) {
            player.gameLogs = player.gameLogs.slice(0, 20)
          }
          
          player.gamesPlayed++
          player.lastUpdated = new Date().toISOString()
          
          // Update rolling averages
          updatePlayerAverages(player)
          
          playersUpdated.add(playerKey)
        }
        
        processedIds.add(processKey)
        gamesProcessed++
      }
    }
  }
  
  // Save updated data
  statsData.lastUpdated = new Date().toISOString()
  statsData.gamesProcessed += gamesProcessed
  
  await savePlayerStatsData(statsData)
  await saveProcessedPlayerGameIds(processedIds)
  
  console.log(`[PlayerStats] Update complete: ${gamesProcessed} games, ${playersUpdated.size} players`)
  
  return {
    gamesProcessed,
    playersUpdated: playersUpdated.size,
    errors
  }
}

/**
 * Get stats summary for debugging/display
 */
export async function getPlayerStatsInfo(): Promise<{
  totalPlayers: number
  totalGamesProcessed: number
  lastUpdated: string
  sportCounts: Record<string, number>
} | null> {
  const statsData = await getPlayerStatsData()
  if (!statsData) return null
  
  const sportCounts: Record<string, number> = {}
  for (const player of Object.values(statsData.players)) {
    sportCounts[player.sport] = (sportCounts[player.sport] || 0) + 1
  }
  
  return {
    totalPlayers: Object.keys(statsData.players).length,
    totalGamesProcessed: statsData.gamesProcessed,
    lastUpdated: statsData.lastUpdated,
    sportCounts
  }
}
