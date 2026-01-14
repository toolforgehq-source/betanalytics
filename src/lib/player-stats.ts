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
 */

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
  { sport: 'football', league: 'nfl', name: 'NFL' },
  { sport: 'hockey', league: 'nhl', name: 'NHL' },
  { sport: 'baseball', league: 'mlb', name: 'MLB' },
]

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
      for (const statGroup of teamData.statistics || []) {
        const statNames = statGroup.names || []
        
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
            // Hockey: G, A, +/-, S, SM, PN, PIM, HT, TK, GV, SHF, TOI
            const gIndex = statNames.indexOf('G')
            const aIndex = statNames.indexOf('A')
            const sIndex = statNames.indexOf('S')
            const toiIndex = statNames.indexOf('TOI')
            const svIndex = statNames.indexOf('SV')  // For goalies
            
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
 * Update player's rolling averages and standard deviations
 */
function updatePlayerAverages(player: PlayerStats): void {
  const logs = player.gameLogs.slice(0, ROLLING_WINDOW)
  
  // Calculate averages for each stat type based on sport
  const statTypes = SPORT_STATS[player.sport] || []
  
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
    }
  }
  
  // Also calculate minutes average
  const minuteValues = logs.map(log => log.minutes).filter(m => m > 0)
  if (minuteValues.length > 0) {
    player.averages.minutes = calculateWeightedAverage(minuteValues)
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
 * Get probability for a specific player prop
 */
export async function getPlayerPropProbability(
  playerName: string,
  sport: string,
  statType: string,
  line: number,
  opponentTeamId?: string
): Promise<{ probability: number; average: number; stdDev: number; gamesPlayed: number } | null> {
  const statsData = await getPlayerStatsData()
  if (!statsData) return null
  
  // Find player by name (case-insensitive search)
  const playerKey = Object.keys(statsData.players).find(key => {
    const player = statsData.players[key]
    return player.sport === sport && 
           player.playerName.toLowerCase().includes(playerName.toLowerCase())
  })
  
  if (!playerKey) return null
  
  const player = statsData.players[playerKey]
  const avg = (player.averages as Record<string, number>)[statType]
  const stdDev = (player.stdDevs as Record<string, number>)[statType]
  
  if (avg === undefined) return null
  
  // Get opponent defensive factor if available
  let opponentFactor = 1.0
  if (opponentTeamId) {
    const defenseKey = `${sport}_${opponentTeamId}`
    const defense = statsData.teamDefense[defenseKey]
    if (defense) {
      const factorKey = `${statType}AllowedFactor` as keyof TeamDefenseRating
      opponentFactor = (defense[factorKey] as number) || 1.0
    }
  }
  
  const probability = calculateOverProbability(avg, stdDev, line, opponentFactor)
  
  return {
    probability,
    average: avg,
    stdDev: stdDev || avg * 0.3,
    gamesPlayed: player.gamesPlayed
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
