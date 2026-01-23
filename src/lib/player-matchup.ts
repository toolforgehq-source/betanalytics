/**
 * Player Props Matchup Data Module
 * 
 * This module tracks how players perform against specific teams/defenses
 * to improve player prop predictions. Key insights:
 * 
 * 1. Some players consistently over/underperform vs certain teams
 * 2. Defensive matchups significantly impact player stats
 * 3. Historical matchup data can provide edge over market
 * 
 * Example: A guard facing a top perimeter defense should have lower
 * point projections than their season average suggests.
 */

// Redis client (using REST API like other modules)
interface RedisClient {
  url: string
  token: string
}

function getRedisClient(): RedisClient | null {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) return null
  return { url, token }
}

// Helper functions for Redis operations
async function redisHSet(redis: RedisClient, key: string, field: string, value: string): Promise<boolean> {
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['HSET', key, field, value])
    })
    return response.ok
  } catch {
    return false
  }
}

async function redisHGet(redis: RedisClient, key: string, field: string): Promise<string | null> {
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['HGET', key, field])
    })
    if (!response.ok) return null
    const data = await response.json()
    return data.result || null
  } catch {
    return null
  }
}

async function redisHGetAll(redis: RedisClient, key: string): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['HGETALL', key])
    })
    if (!response.ok) return null
    const data = await response.json()
    // HGETALL returns array like [field1, value1, field2, value2, ...]
    if (!data.result || !Array.isArray(data.result)) return null
    const result: Record<string, string> = {}
    for (let i = 0; i < data.result.length; i += 2) {
      result[data.result[i]] = data.result[i + 1]
    }
    return result
  } catch {
    return null
  }
}

// ============================================
// TYPES
// ============================================

export interface PlayerMatchupGame {
  playerId: string
  playerName: string
  team: string
  opponent: string
  league: string
  date: string
  
  // Stats
  points: number
  rebounds: number
  assists: number
  threes: number
  steals: number
  blocks: number
  turnovers: number
  minutes: number
  
  // Context
  isHome: boolean
  won: boolean
}

export interface PlayerVsTeamStats {
  playerId: string
  playerName: string
  team: string
  opponent: string
  league: string
  
  // Sample
  gamesPlayed: number
  
  // Averages vs this opponent
  avgPoints: number
  avgRebounds: number
  avgAssists: number
  avgThrees: number
  avgMinutes: number
  
  // Season averages (for comparison)
  seasonAvgPoints: number
  seasonAvgRebounds: number
  seasonAvgAssists: number
  seasonAvgThrees: number
  seasonAvgMinutes: number
  
  // Differential (matchup avg - season avg)
  pointsDiff: number
  reboundsDiff: number
  assistsDiff: number
  threesDiff: number
  
  // Hit rates vs this opponent (for props)
  hitRates: {
    points: Record<string, number>    // e.g., "20.5": 0.75 (hit over 20.5 75% of time)
    rebounds: Record<string, number>
    assists: Record<string, number>
    threes: Record<string, number>
  }
  
  lastUpdated: string
}

export interface TeamDefensiveRating {
  teamName: string
  league: string
  season: string
  
  // Points allowed
  pointsAllowedPerGame: number
  pointsAllowedRank: number          // 1 = best defense
  
  // Position-specific (NBA/NCAAB)
  pointsAllowedToPG: number
  pointsAllowedToSG: number
  pointsAllowedToSF: number
  pointsAllowedToPF: number
  pointsAllowedToC: number
  
  // Category-specific
  reboundsAllowedPerGame: number
  assistsAllowedPerGame: number
  threesAllowedPerGame: number
  
  // Pace
  pace: number                        // Possessions per game
  paceRank: number
  
  lastUpdated: string
}

export interface MatchupAdjustment {
  playerName: string
  opponent: string
  stat: 'points' | 'rebounds' | 'assists' | 'threes'
  
  // Projection
  baseProjection: number              // Season average
  matchupProjection: number           // Adjusted for matchup
  adjustment: number                  // Difference
  adjustmentPct: number               // Percentage change
  
  // Confidence
  confidence: 'high' | 'medium' | 'low'
  sampleSize: number
  
  // Context
  notes: string[]
}

// Redis keys
const PLAYER_MATCHUP_GAMES_KEY = 'player_matchup:games'
const PLAYER_VS_TEAM_STATS_KEY = 'player_matchup:vs_team'
const TEAM_DEFENSIVE_RATINGS_KEY = 'player_matchup:team_defense'

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Normalize names for matching
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').replace(/^the\s+/, '').trim()
}

// Reserved for future use when we need to match player names across different data sources
// function normalizePlayerName(name: string): string {
//   return name.toLowerCase().replace(/\s+/g, ' ').replace(/[.']/g, '').trim()
// }

/**
 * Store a player's game performance
 */
export async function storePlayerMatchupGame(game: PlayerMatchupGame): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  
  try {
    const key = `${game.playerId}_${game.opponent}_${game.date}`
    await redisHSet(redis, PLAYER_MATCHUP_GAMES_KEY, key, JSON.stringify(game))
  } catch (error) {
    console.error('[PlayerMatchup] Error storing game:', error)
  }
}

/**
 * Get all games for a player vs a specific opponent
 */
export async function getPlayerGamesVsOpponent(
  playerId: string,
  opponent: string
): Promise<PlayerMatchupGame[]> {
  const redis = getRedisClient()
  if (!redis) return []
  
  try {
    const allGames = await redisHGetAll(redis, PLAYER_MATCHUP_GAMES_KEY)
    if (!allGames) return []
    
    const normOpp = normalizeTeamName(opponent)
    
    return Object.values(allGames)
      .map(g => JSON.parse(g) as PlayerMatchupGame)
      .filter(g => {
        const gameOpp = normalizeTeamName(g.opponent)
        return g.playerId === playerId && 
          (gameOpp.includes(normOpp) || normOpp.includes(gameOpp))
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  } catch (error) {
    console.error('[PlayerMatchup] Error getting games:', error)
    return []
  }
}

/**
 * Calculate player vs team stats
 */
export async function calculatePlayerVsTeamStats(
  playerId: string,
  playerName: string,
  team: string,
  opponent: string,
  league: string,
  seasonStats: {
    avgPoints: number
    avgRebounds: number
    avgAssists: number
    avgThrees: number
    avgMinutes: number
  }
): Promise<PlayerVsTeamStats | null> {
  const games = await getPlayerGamesVsOpponent(playerId, opponent)
  
  if (games.length === 0) return null
  
  // Calculate averages
  const avgPoints = games.reduce((sum, g) => sum + g.points, 0) / games.length
  const avgRebounds = games.reduce((sum, g) => sum + g.rebounds, 0) / games.length
  const avgAssists = games.reduce((sum, g) => sum + g.assists, 0) / games.length
  const avgThrees = games.reduce((sum, g) => sum + g.threes, 0) / games.length
  const avgMinutes = games.reduce((sum, g) => sum + g.minutes, 0) / games.length
  
  // Calculate hit rates for common lines
  const pointLines = [15.5, 17.5, 19.5, 20.5, 22.5, 24.5, 25.5, 27.5, 29.5]
  const reboundLines = [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]
  const assistLines = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5]
  const threeLines = [1.5, 2.5, 3.5, 4.5]
  
  const hitRates: PlayerVsTeamStats['hitRates'] = {
    points: {},
    rebounds: {},
    assists: {},
    threes: {},
  }
  
  for (const line of pointLines) {
    const hits = games.filter(g => g.points > line).length
    hitRates.points[line.toString()] = hits / games.length
  }
  
  for (const line of reboundLines) {
    const hits = games.filter(g => g.rebounds > line).length
    hitRates.rebounds[line.toString()] = hits / games.length
  }
  
  for (const line of assistLines) {
    const hits = games.filter(g => g.assists > line).length
    hitRates.assists[line.toString()] = hits / games.length
  }
  
  for (const line of threeLines) {
    const hits = games.filter(g => g.threes > line).length
    hitRates.threes[line.toString()] = hits / games.length
  }
  
  return {
    playerId,
    playerName,
    team,
    opponent,
    league,
    gamesPlayed: games.length,
    avgPoints,
    avgRebounds,
    avgAssists,
    avgThrees,
    avgMinutes,
    seasonAvgPoints: seasonStats.avgPoints,
    seasonAvgRebounds: seasonStats.avgRebounds,
    seasonAvgAssists: seasonStats.avgAssists,
    seasonAvgThrees: seasonStats.avgThrees,
    seasonAvgMinutes: seasonStats.avgMinutes,
    pointsDiff: avgPoints - seasonStats.avgPoints,
    reboundsDiff: avgRebounds - seasonStats.avgRebounds,
    assistsDiff: avgAssists - seasonStats.avgAssists,
    threesDiff: avgThrees - seasonStats.avgThrees,
    hitRates,
    lastUpdated: new Date().toISOString(),
  }
}

/**
 * Store player vs team stats
 */
export async function storePlayerVsTeamStats(stats: PlayerVsTeamStats): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  
  try {
    const key = `${stats.playerId}_${normalizeTeamName(stats.opponent)}`
    await redisHSet(redis, PLAYER_VS_TEAM_STATS_KEY, key, JSON.stringify(stats))
    console.log(`[PlayerMatchup] Stored ${stats.playerName} vs ${stats.opponent} stats`)
  } catch (error) {
    console.error('[PlayerMatchup] Error storing stats:', error)
  }
}

/**
 * Get player vs team stats
 */
export async function getPlayerVsTeamStats(
  playerId: string,
  opponent: string
): Promise<PlayerVsTeamStats | null> {
  const redis = getRedisClient()
  if (!redis) return null
  
  try {
    const key = `${playerId}_${normalizeTeamName(opponent)}`
    const data = await redisHGet(redis, PLAYER_VS_TEAM_STATS_KEY, key)
    if (!data) return null
    return JSON.parse(data) as PlayerVsTeamStats
  } catch (error) {
    console.error('[PlayerMatchup] Error getting stats:', error)
    return null
  }
}

/**
 * Store team defensive rating
 */
export async function storeTeamDefensiveRating(rating: TeamDefensiveRating): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  
  try {
    const key = `${rating.league}_${normalizeTeamName(rating.teamName)}_${rating.season}`
    await redisHSet(redis, TEAM_DEFENSIVE_RATINGS_KEY, key, JSON.stringify(rating))
  } catch (error) {
    console.error('[PlayerMatchup] Error storing defensive rating:', error)
  }
}

/**
 * Get team defensive rating
 */
export async function getTeamDefensiveRating(
  teamName: string,
  league: string,
  season?: string
): Promise<TeamDefensiveRating | null> {
  const redis = getRedisClient()
  if (!redis) return null
  
  const currentSeason = season || getCurrentSeason(league)
  
  try {
    const key = `${league}_${normalizeTeamName(teamName)}_${currentSeason}`
    const data = await redisHGet(redis, TEAM_DEFENSIVE_RATINGS_KEY, key)
    if (!data) return null
    return JSON.parse(data) as TeamDefensiveRating
  } catch (error) {
    console.error('[PlayerMatchup] Error getting defensive rating:', error)
    return null
  }
}

/**
 * Get current season string
 */
function getCurrentSeason(league: string): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  
  if (league === 'NFL' || league === 'NCAAF') {
    return month >= 8 ? `${year}` : `${year - 1}`
  } else if (league === 'NBA' || league === 'NHL' || league === 'NCAAB') {
    return month >= 10 ? `${year}-${year + 1}` : `${year - 1}-${year}`
  } else if (league === 'MLB') {
    return `${year}`
  } else {
    return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`
  }
}

/**
 * Calculate matchup adjustment for a player prop
 */
export async function calculateMatchupAdjustment(
  playerId: string,
  playerName: string,
  opponent: string,
  league: string,
  stat: 'points' | 'rebounds' | 'assists' | 'threes',
  baseProjection: number
): Promise<MatchupAdjustment> {
  const notes: string[] = []
  
  // Get player vs team stats
  const vsTeamStats = await getPlayerVsTeamStats(playerId, opponent)
  
  // Get team defensive rating
  const defRating = await getTeamDefensiveRating(opponent, league)
  
  let matchupProjection = baseProjection
  let confidence: 'high' | 'medium' | 'low' = 'low'
  let sampleSize = 0
  
  // Apply player vs team historical adjustment
  if (vsTeamStats && vsTeamStats.gamesPlayed >= 3) {
    sampleSize = vsTeamStats.gamesPlayed
    
    let diff: number
    let avg: number
    
    switch (stat) {
      case 'points':
        diff = vsTeamStats.pointsDiff
        avg = vsTeamStats.avgPoints
        break
      case 'rebounds':
        diff = vsTeamStats.reboundsDiff
        avg = vsTeamStats.avgRebounds
        break
      case 'assists':
        diff = vsTeamStats.assistsDiff
        avg = vsTeamStats.avgAssists
        break
      case 'threes':
        diff = vsTeamStats.threesDiff
        avg = vsTeamStats.avgThrees
        break
    }
    
    // Weight the adjustment based on sample size
    const weight = Math.min(sampleSize / 10, 1) // Full weight at 10+ games
    const adjustedDiff = diff * weight
    
    matchupProjection = baseProjection + adjustedDiff
    
    if (Math.abs(diff) > 2) {
      const direction = diff > 0 ? 'over' : 'under'
      notes.push(`${playerName} averages ${avg.toFixed(1)} ${stat} vs ${opponent} (${direction}performs by ${Math.abs(diff).toFixed(1)})`)
    }
    
    confidence = sampleSize >= 8 ? 'high' : sampleSize >= 5 ? 'medium' : 'low'
  }
  
  // Apply defensive rating adjustment if no direct matchup data
  if (defRating && (!vsTeamStats || vsTeamStats.gamesPlayed < 3)) {
    // Adjust based on defensive ranking
    // Top 5 defense: reduce projection
    // Bottom 5 defense: increase projection
    const leagueTeams = league === 'NBA' ? 30 : league === 'NFL' ? 32 : 30
    const midRank = leagueTeams / 2
    
    if (stat === 'points' && defRating.pointsAllowedRank) {
      const rankDiff = defRating.pointsAllowedRank - midRank
      // Each rank away from middle = ~0.3% adjustment
      const defAdjustment = (rankDiff / midRank) * 0.1 * baseProjection
      matchupProjection += defAdjustment
      
      if (defRating.pointsAllowedRank <= 5) {
        notes.push(`${opponent} has top 5 defense (rank #${defRating.pointsAllowedRank})`)
      } else if (defRating.pointsAllowedRank >= leagueTeams - 5) {
        notes.push(`${opponent} has bottom 5 defense (rank #${defRating.pointsAllowedRank})`)
      }
    }
    
    confidence = 'low'
  }
  
  const adjustment = matchupProjection - baseProjection
  const adjustmentPct = baseProjection > 0 ? (adjustment / baseProjection) * 100 : 0
  
  return {
    playerName,
    opponent,
    stat,
    baseProjection,
    matchupProjection,
    adjustment,
    adjustmentPct,
    confidence,
    sampleSize,
    notes,
  }
}

/**
 * Get hit rate for a specific line from matchup data
 */
export async function getMatchupHitRate(
  playerId: string,
  opponent: string,
  stat: 'points' | 'rebounds' | 'assists' | 'threes',
  line: number
): Promise<{ hitRate: number | null; sampleSize: number; notes: string[] }> {
  const vsTeamStats = await getPlayerVsTeamStats(playerId, opponent)
  
  if (!vsTeamStats || vsTeamStats.gamesPlayed < 3) {
    return { hitRate: null, sampleSize: 0, notes: ['Insufficient matchup data'] }
  }
  
  const hitRates = vsTeamStats.hitRates[stat]
  const lineKey = line.toString()
  
  // Find closest line if exact match not found
  let hitRate: number | null = null
  if (hitRates[lineKey] !== undefined) {
    hitRate = hitRates[lineKey]
  } else {
    // Find closest line
    const lines = Object.keys(hitRates).map(Number).sort((a, b) => a - b)
    const closest = lines.reduce((prev, curr) => 
      Math.abs(curr - line) < Math.abs(prev - line) ? curr : prev
    )
    if (Math.abs(closest - line) <= 1) {
      hitRate = hitRates[closest.toString()]
    }
  }
  
  const notes: string[] = []
  if (hitRate !== null) {
    const pct = (hitRate * 100).toFixed(0)
    notes.push(`${vsTeamStats.playerName} has hit over ${line} ${stat} in ${pct}% of games vs ${opponent} (${vsTeamStats.gamesPlayed} games)`)
  }
  
  return {
    hitRate,
    sampleSize: vsTeamStats.gamesPlayed,
    notes,
  }
}

/**
 * Format matchup adjustment for display
 */
export function formatMatchupAdjustmentForDisplay(adjustment: MatchupAdjustment): string {
  const lines: string[] = [
    `MATCHUP ANALYSIS: ${adjustment.playerName} vs ${adjustment.opponent}`,
    `Stat: ${adjustment.stat.toUpperCase()}`,
    `Base Projection: ${adjustment.baseProjection.toFixed(1)}`,
    `Matchup Projection: ${adjustment.matchupProjection.toFixed(1)}`,
  ]
  
  if (Math.abs(adjustment.adjustment) > 0.5) {
    const sign = adjustment.adjustment > 0 ? '+' : ''
    lines.push(`Adjustment: ${sign}${adjustment.adjustment.toFixed(1)} (${sign}${adjustment.adjustmentPct.toFixed(1)}%)`)
  }
  
  lines.push(`Confidence: ${adjustment.confidence} (${adjustment.sampleSize} games)`)
  
  if (adjustment.notes.length > 0) {
    lines.push('')
    for (const note of adjustment.notes) {
      lines.push(`- ${note}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * Batch update player matchup stats from game results
 * This should be called by a cron job after games complete
 */
export async function updatePlayerMatchupStats(
  games: PlayerMatchupGame[],
  playerSeasonStats: Map<string, {
    avgPoints: number
    avgRebounds: number
    avgAssists: number
    avgThrees: number
    avgMinutes: number
  }>
): Promise<void> {
  // Group games by player-opponent pair
  const playerOpponentGames = new Map<string, PlayerMatchupGame[]>()
  
  for (const game of games) {
    const key = `${game.playerId}_${normalizeTeamName(game.opponent)}`
    const existing = playerOpponentGames.get(key) || []
    existing.push(game)
    playerOpponentGames.set(key, existing)
  }
  
  // Calculate and store stats for each pair
  for (const [, pairGames] of Array.from(playerOpponentGames.entries())) {
    const firstGame = pairGames[0]
    const seasonStats = playerSeasonStats.get(firstGame.playerId)
    
    if (!seasonStats) continue
    
    const stats = await calculatePlayerVsTeamStats(
      firstGame.playerId,
      firstGame.playerName,
      firstGame.team,
      firstGame.opponent,
      firstGame.league,
      seasonStats
    )
    
    if (stats) {
      await storePlayerVsTeamStats(stats)
    }
  }
  
  console.log(`[PlayerMatchup] Updated stats for ${playerOpponentGames.size} player-opponent pairs`)
}
