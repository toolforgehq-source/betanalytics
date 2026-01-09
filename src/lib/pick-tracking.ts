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
    
    return JSON.parse(data.result) as StoredPick[]
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
    
    return JSON.parse(data.result)
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
