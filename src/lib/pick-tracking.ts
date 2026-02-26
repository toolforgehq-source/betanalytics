/**
 * Pick Tracking & Grading System
 * 
 * Stores every pick made by the system and grades them after games complete.
 * This enables a public track record that builds trust and retains subscribers.
 * 
 * Features:
 * - Store picks with timestamp, odds, probability, edge
 * - Grade picks automatically after games complete
 * - Calculate rolling record (7/30/90 days)
 * - Track ROI and units won/lost
 */

export interface StoredPick {
  id: string                    // Unique pick ID
  createdAt: string             // When pick was made
  gameId: string                // Game ID from Odds API
  sport: string                 // Sport key
  sportName: string             // Sport display name
  
  // Game info
  homeTeam: string
  awayTeam: string
  gameTime: string              // When game starts
  
  // Pick details
  pickType: 'best_bet' | 'parlay_leg' | 'prop' | 'game_specific'
  team: string                  // Team picked
  betType: 'moneyline' | 'spread' | 'total' | 'prop'
  line?: number                 // Spread/total line if applicable
  
  // Odds and probability at time of pick
  odds: number                  // American odds
  consensusProbability: number  // Our calculated probability
  impliedProbability: number    // Implied from odds
  edge: number                  // Consensus - implied
  bestBook: string              // Which book had best price
  
  // Grading (filled in after game)
  status: 'pending' | 'won' | 'lost' | 'push' | 'cancelled'
  gradedAt?: string
  actualResult?: string         // Brief description of result
  
  // For ROI tracking
  units: number                 // Recommended bet size (default 1)
  unitsWon?: number             // Units won/lost after grading
}

export interface TrackRecord {
  period: '7d' | '30d' | '90d' | 'all'
  wins: number
  losses: number
  pushes: number
  total: number
  winRate: number               // Percentage
  units: number                 // Net units won/lost
  roi: number                   // Return on investment percentage
  lastUpdated: string
}

export interface PickTrackingData {
  picks: StoredPick[]
  trackRecord: {
    '7d': TrackRecord
    '30d': TrackRecord
    '90d': TrackRecord
    'all': TrackRecord
  }
  lastUpdated: string
}

// Redis cache keys
const PICKS_CACHE_KEY = 'betanalytics:picks'
const TRACK_RECORD_KEY = 'betanalytics:track-record'

/**
 * Get Redis client for caching
 */
async function getRedisClient() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.warn('Redis not configured for pick tracking')
    return null
  }
  
  return { url, token }
}

/**
 * Generate a unique pick ID
 */
function generatePickId(): string {
  return `pick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Calculate units won based on odds and result
 */
function calculateUnitsWon(odds: number, units: number, result: 'won' | 'lost' | 'push'): number {
  if (result === 'push') return 0
  if (result === 'lost') return -units
  
  // Won - calculate payout
  if (odds > 0) {
    return units * (odds / 100)
  } else {
    return units * (100 / Math.abs(odds))
  }
}

/**
 * Store a new pick
 */
export async function storePick(pick: Omit<StoredPick, 'id' | 'createdAt' | 'status' | 'units'>): Promise<StoredPick | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  const newPick: StoredPick = {
    ...pick,
    id: generatePickId(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    units: 1 // Default 1 unit bet
  }
  
  try {
    // Get existing picks
    const existingPicks = await getAllPicks()
    
    // Add new pick
    existingPicks.push(newPick)
    
    // Store back to Redis
    await fetch(`${redis.url}/set/${PICKS_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(existingPicks))
    })
    
    console.log(`[storePick] Stored pick: ${newPick.id} - ${newPick.team}`)
    return newPick
  } catch (error) {
    console.error('[storePick] Error storing pick:', error)
    return null
  }
}

/**
 * Get all stored picks
 */
export async function getAllPicks(): Promise<StoredPick[]> {
  const redis = await getRedisClient()
  if (!redis) return []
  
  try {
    const response = await fetch(`${redis.url}/get/${PICKS_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    if (!data.result) return []
    
    // Handle potentially double-encoded JSON from Redis
    let parsed = data.result
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        console.error('[getAllPicks] Failed to parse picks data')
        return []
      }
    }
    // If still a string after first parse, try once more (double-encoded)
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        console.error('[getAllPicks] Failed to parse double-encoded picks data')
        return []
      }
    }
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('[getAllPicks] Error getting picks:', error)
    return []
  }
}

/**
 * Grade a pick (mark as won/lost/push)
 */
export async function gradePick(
  pickId: string, 
  result: 'won' | 'lost' | 'push' | 'cancelled',
  actualResult?: string
): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) return false
  
  try {
    const picks = await getAllPicks()
    const pickIndex = picks.findIndex(p => p.id === pickId)
    
    if (pickIndex === -1) {
      console.error(`[gradePick] Pick not found: ${pickId}`)
      return false
    }
    
    const pick = picks[pickIndex]
    pick.status = result
    pick.gradedAt = new Date().toISOString()
    pick.actualResult = actualResult
    
    if (result === 'won' || result === 'lost' || result === 'push') {
      pick.unitsWon = calculateUnitsWon(pick.odds, pick.units, result)
    }
    
    // Store updated picks
    await fetch(`${redis.url}/set/${PICKS_CACHE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(picks))
    })
    
    // Recalculate track record
    await calculateAndStoreTrackRecord(picks)
    
    console.log(`[gradePick] Graded pick ${pickId}: ${result}`)
    return true
  } catch (error) {
    console.error('[gradePick] Error grading pick:', error)
    return false
  }
}

/**
 * Calculate track record for a specific period
 */
function calculateTrackRecordForPeriod(picks: StoredPick[], days: number | null): TrackRecord {
  const now = new Date()
  const cutoff = days ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null
  
  const relevantPicks = picks.filter(p => {
    if (p.status === 'pending' || p.status === 'cancelled') return false
    if (cutoff && new Date(p.gradedAt || p.createdAt) < cutoff) return false
    return true
  })
  
  const wins = relevantPicks.filter(p => p.status === 'won').length
  const losses = relevantPicks.filter(p => p.status === 'lost').length
  const pushes = relevantPicks.filter(p => p.status === 'push').length
  const total = wins + losses + pushes
  
  const units = relevantPicks.reduce((sum, p) => sum + (p.unitsWon || 0), 0)
  const totalUnitsRisked = relevantPicks.reduce((sum, p) => sum + p.units, 0)
  
  return {
    period: days === 7 ? '7d' : days === 30 ? '30d' : days === 90 ? '90d' : 'all',
    wins,
    losses,
    pushes,
    total,
    winRate: total > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
    units: Math.round(units * 100) / 100,
    roi: totalUnitsRisked > 0 ? Math.round((units / totalUnitsRisked) * 1000) / 10 : 0,
    lastUpdated: now.toISOString()
  }
}

/**
 * Calculate and store track record
 */
async function calculateAndStoreTrackRecord(picks: StoredPick[]): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  const trackRecord = {
    '7d': calculateTrackRecordForPeriod(picks, 7),
    '30d': calculateTrackRecordForPeriod(picks, 30),
    '90d': calculateTrackRecordForPeriod(picks, 90),
    'all': calculateTrackRecordForPeriod(picks, null)
  }
  
  try {
    await fetch(`${redis.url}/set/${TRACK_RECORD_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(trackRecord))
    })
    
    console.log(`[calculateAndStoreTrackRecord] Updated track record: ${trackRecord['30d'].wins}-${trackRecord['30d'].losses}`)
  } catch (error) {
    console.error('[calculateAndStoreTrackRecord] Error storing track record:', error)
  }
}

/**
 * Get cached track record
 */
export async function getTrackRecord(): Promise<PickTrackingData['trackRecord'] | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${TRACK_RECORD_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    // Handle potentially double-encoded JSON from Redis
    let parsed = data.result
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        console.error('[getTrackRecord] Failed to parse track record data')
        return null
      }
    }
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        console.error('[getTrackRecord] Failed to parse double-encoded track record data')
        return null
      }
    }
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    console.error('[getTrackRecord] Error getting track record:', error)
    return null
  }
}

/**
 * Format track record for display in Claude's context
 */
export function formatTrackRecordForContext(trackRecord: PickTrackingData['trackRecord'] | null): string {
  if (!trackRecord) {
    return `=== TRACK RECORD ===
No picks recorded yet. Track record will build as picks are made and graded.
`
  }
  
  const lines: string[] = []
  lines.push('=== TRACK RECORD ===')
  lines.push('')
  lines.push('Our verified pick history (graded after each game):')
  lines.push('')
  
  const r7 = trackRecord['7d']
  const r30 = trackRecord['30d']
  const r90 = trackRecord['90d']
  const rAll = trackRecord['all']
  
  if (r7.total > 0) {
    lines.push(`Last 7 Days: ${r7.wins}-${r7.losses}${r7.pushes > 0 ? `-${r7.pushes}` : ''} (${r7.winRate}%) | ${r7.units >= 0 ? '+' : ''}${r7.units} units | ROI: ${r7.roi}%`)
  }
  
  if (r30.total > 0) {
    lines.push(`Last 30 Days: ${r30.wins}-${r30.losses}${r30.pushes > 0 ? `-${r30.pushes}` : ''} (${r30.winRate}%) | ${r30.units >= 0 ? '+' : ''}${r30.units} units | ROI: ${r30.roi}%`)
  }
  
  if (r90.total > 0) {
    lines.push(`Last 90 Days: ${r90.wins}-${r90.losses}${r90.pushes > 0 ? `-${r90.pushes}` : ''} (${r90.winRate}%) | ${r90.units >= 0 ? '+' : ''}${r90.units} units | ROI: ${r90.roi}%`)
  }
  
  if (rAll.total > 0) {
    lines.push(`All Time: ${rAll.wins}-${rAll.losses}${rAll.pushes > 0 ? `-${rAll.pushes}` : ''} (${rAll.winRate}%) | ${rAll.units >= 0 ? '+' : ''}${rAll.units} units | ROI: ${rAll.roi}%`)
  }
  
  if (rAll.total === 0) {
    lines.push('No graded picks yet. Track record will build as games complete.')
  }
  
  lines.push('')
  lines.push('IMPORTANT: Always mention our track record when giving picks to build trust.')
  lines.push('Example: "Our picks are hitting at 58% over the last 30 days..."')
  lines.push('')
  
  return lines.join('\n')
}

/**
 * Get pending picks that need grading (games that have ended)
 */
export async function getPendingPicksToGrade(): Promise<StoredPick[]> {
  const picks = await getAllPicks()
  const now = new Date()
  
  // Return picks where game time + 4 hours has passed (game should be over)
  return picks.filter(p => {
    if (p.status !== 'pending') return false
    const gameEnd = new Date(new Date(p.gameTime).getTime() + 4 * 60 * 60 * 1000)
    return now > gameEnd
  })
}

// ============================================
// AUTO-GRADING SYSTEM
// ============================================

/**
 * Score data from The Odds API
 */
interface GameScore {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  completed: boolean
  home_team: string
  away_team: string
  scores: { name: string; score: string }[] | null
  last_update: string | null
}

/**
 * Fetch scores for a specific sport from The Odds API
 */
async function fetchSportScores(sportKey: string): Promise<GameScore[]> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    console.error('[fetchSportScores] ODDS_API_KEY not configured')
    return []
  }
  
  try {
    // Fetch scores from the last 3 days
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${apiKey}&daysFrom=3`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    })
    
    if (!response.ok) {
      console.error(`[fetchSportScores] API error for ${sportKey}: ${response.status}`)
      return []
    }
    
    return await response.json()
  } catch (error) {
    console.error(`[fetchSportScores] Error fetching ${sportKey} scores:`, error)
    return []
  }
}

/**
 * Determine if a moneyline pick won based on final scores
 */
function gradeMoneylinePick(
  pick: StoredPick,
  homeScore: number,
  awayScore: number
): 'won' | 'lost' | 'push' {
  const pickedTeam = pick.team
  const isHome = pickedTeam === pick.homeTeam
  
  if (homeScore === awayScore) {
    // Tie game (rare in most sports, but possible in soccer)
    return 'push'
  }
  
  const homeWon = homeScore > awayScore
  
  if (isHome) {
    return homeWon ? 'won' : 'lost'
  } else {
    return homeWon ? 'lost' : 'won'
  }
}

/**
 * Determine if a spread pick won based on final scores
 * Example: If we picked Lakers -3.5 and they won by 5, we won
 * Example: If we picked Lakers -3.5 and they won by 3, we lost
 */
function gradeSpreadPick(
  pick: StoredPick,
  homeScore: number,
  awayScore: number
): 'won' | 'lost' | 'push' {
  if (pick.line === undefined || pick.line === null) {
    // Can't grade without the spread line
    return 'push'
  }
  
  const pickedTeam = pick.team
  const isHome = pickedTeam === pick.homeTeam
  const spread = pick.line // Negative for favorites, positive for underdogs
  
  // Calculate the margin from the picked team's perspective
  // If we picked home team: margin = homeScore - awayScore
  // If we picked away team: margin = awayScore - homeScore
  const margin = isHome ? (homeScore - awayScore) : (awayScore - homeScore)
  
  // Add the spread to the margin
  // Example: Lakers -3.5 (spread = -3.5), won by 5 (margin = 5)
  // Adjusted margin = 5 + (-3.5) = 1.5 > 0, so we won
  const adjustedMargin = margin + spread
  
  if (adjustedMargin > 0) {
    return 'won'
  } else if (adjustedMargin < 0) {
    return 'lost'
  } else {
    return 'push'
  }
}

/**
 * Determine if a total (over/under) pick won based on final scores
 * Example: If we picked Over 220.5 and total was 225, we won
 * Example: If we picked Under 220.5 and total was 225, we lost
 */
function gradeTotalPick(
  pick: StoredPick,
  homeScore: number,
  awayScore: number
): 'won' | 'lost' | 'push' {
  if (pick.line === undefined || pick.line === null) {
    // Can't grade without the total line
    return 'push'
  }
  
  const totalLine = pick.line
  const actualTotal = homeScore + awayScore
  
  // Determine if this is an Over or Under pick
  // The team field for totals is typically "Over" or "Under"
  const isOver = pick.team.toLowerCase().includes('over')
  const isUnder = pick.team.toLowerCase().includes('under')
  
  if (!isOver && !isUnder) {
    // Can't determine if Over or Under
    return 'push'
  }
  
  if (actualTotal > totalLine) {
    return isOver ? 'won' : 'lost'
  } else if (actualTotal < totalLine) {
    return isUnder ? 'won' : 'lost'
  } else {
    return 'push'
  }
}

/**
 * Auto-grade all pending picks using scores from The Odds API
 * Returns the number of picks graded
 */
export async function autoGradePicks(): Promise<{
  graded: number
  errors: number
  pending: number
  details: string[]
}> {
  const result = {
    graded: 0,
    errors: 0,
    pending: 0,
    details: [] as string[]
  }
  
  // Get all pending picks that should be graded
  const pendingPicks = await getPendingPicksToGrade()
  
  if (pendingPicks.length === 0) {
    result.details.push('No pending picks to grade')
    return result
  }
  
  result.pending = pendingPicks.length
  result.details.push(`Found ${pendingPicks.length} pending picks to grade`)
  
  // Group picks by sport to minimize API calls
  const picksBySport = new Map<string, StoredPick[]>()
  for (const pick of pendingPicks) {
    const existing = picksBySport.get(pick.sport) || []
    existing.push(pick)
    picksBySport.set(pick.sport, existing)
  }
  
  // Fetch scores for each sport and grade picks
  const sportEntries = Array.from(picksBySport.entries())
  for (const [sport, picks] of sportEntries) {
    result.details.push(`Fetching scores for ${sport}...`)
    const scores = await fetchSportScores(sport)
    
    if (scores.length === 0) {
      result.details.push(`No scores available for ${sport}`)
      continue
    }
    
    // Create a map of game ID to score data
    const scoreMap = new Map<string, GameScore>()
    for (const score of scores) {
      scoreMap.set(score.id, score)
    }
    
    // Grade each pick
    for (const pick of picks) {
      const gameScore = scoreMap.get(pick.gameId)
      
      if (!gameScore) {
        result.details.push(`No score found for game ${pick.gameId} (${pick.awayTeam} @ ${pick.homeTeam})`)
        continue
      }
      
      if (!gameScore.completed) {
        result.details.push(`Game ${pick.gameId} not yet completed`)
        continue
      }
      
      if (!gameScore.scores || gameScore.scores.length < 2) {
        result.details.push(`Invalid scores for game ${pick.gameId}`)
        result.errors++
        continue
      }
      
      // Extract scores
      const homeScoreData = gameScore.scores.find(s => s.name === gameScore.home_team)
      const awayScoreData = gameScore.scores.find(s => s.name === gameScore.away_team)
      
      if (!homeScoreData || !awayScoreData) {
        result.details.push(`Could not match team names for game ${pick.gameId}`)
        result.errors++
        continue
      }
      
      const homeScore = parseInt(homeScoreData.score, 10)
      const awayScore = parseInt(awayScoreData.score, 10)
      
      if (isNaN(homeScore) || isNaN(awayScore)) {
        result.details.push(`Invalid score values for game ${pick.gameId}`)
        result.errors++
        continue
      }
      
      // Grade based on bet type
      let gradeResult: 'won' | 'lost' | 'push'
      let actualResult: string
      const scoreDisplay = `${gameScore.away_team} ${awayScore} - ${gameScore.home_team} ${homeScore}`
      
      if (pick.betType === 'moneyline') {
        gradeResult = gradeMoneylinePick(pick, homeScore, awayScore)
        actualResult = scoreDisplay
      } else if (pick.betType === 'spread') {
        gradeResult = gradeSpreadPick(pick, homeScore, awayScore)
        const margin = homeScore - awayScore
        actualResult = `${scoreDisplay} (margin: ${margin > 0 ? '+' : ''}${margin}, line: ${pick.line})`
      } else if (pick.betType === 'total') {
        gradeResult = gradeTotalPick(pick, homeScore, awayScore)
        const total = homeScore + awayScore
        actualResult = `${scoreDisplay} (total: ${total}, line: ${pick.line})`
      } else {
        // Unknown bet type (e.g., prop) - skip for now
        result.details.push(`Skipping ${pick.betType} bet for ${pick.gameId} (unsupported bet type)`)
        continue
      }
      
      // Update the pick
      const success = await gradePick(pick.id, gradeResult, actualResult)
      
      if (success) {
        result.graded++
        result.details.push(`Graded ${pick.team}: ${gradeResult.toUpperCase()} (${actualResult})`)
      } else {
        result.errors++
        result.details.push(`Failed to grade pick ${pick.id}`)
      }
    }
  }
  
  return result
}
