/**
 * Recommendation Tracking System
 * 
 * Logs every recommendation made by the system and tracks actual outcomes
 * to measure performance over time.
 * 
 * Features:
 * - Logs recommendations when cached (best bet, parlay, props, sport bets)
 * - Tracks actual outcomes after games complete
 * - Calculates W-L record, ROI, and calibration
 */

// ============================================
// TYPES
// ============================================

export interface TrackedRecommendation {
  id: string                    // Unique ID (hash of key fields)
  createdAt: string             // When recommendation was made
  
  // Bet details
  sport: string                 // e.g., 'basketball_nba'
  sportName: string             // e.g., 'NBA'
  gameId: string                // ESPN/Odds API game ID
  gameName: string              // e.g., 'Lakers @ Celtics'
  commenceTime: string          // Game start time
  
  betType: 'moneyline' | 'spread' | 'total' | 'prop'
  selection: string             // e.g., 'Lakers ML', 'Over 220.5', 'LeBron Over 25.5 Points'
  line?: number                 // For spreads/totals/props
  
  // Odds and probability
  odds: number                  // American odds (e.g., -150, +120)
  probability: number           // Our stated probability (0-100)
  score: number                 // Our confidence score
  
  // Source of recommendation
  source: 'best_bet' | 'parlay' | 'sport_bet' | 'best_prop'
  
  // Confidence tier from tiered system
  confidenceTier?: 'lock' | 'strong' | 'value'
  
  // Lock-in tracking
  lockedIn?: boolean            // True once game starts and pick was still active
  supersededAt?: string         // When this pick was superseded by a newer version
  
  // Outcome tracking
  status: 'pending' | 'won' | 'lost' | 'push' | 'void'
  settledAt?: string            // When outcome was determined
  actualResult?: string         // e.g., 'Lakers won 112-108'
  profit?: number               // Profit/loss in units (1 unit = $100)
  
  // For props - additional tracking
  playerName?: string
  market?: string               // e.g., 'player_points'
  actualStat?: number           // What the player actually got
}

export interface TrackingStats {
  totalBets: number
  settledBets: number
  pendingBets: number
  
  wins: number
  losses: number
  pushes: number
  
  winRate: number               // wins / (wins + losses)
  roi: number                   // total profit / total units wagered
  totalProfit: number           // In units
  
  // By confidence level (score buckets)
  byConfidence: {
    level: string               // e.g., 'High (80+)', 'Medium (60-80)', 'Low (<60)'
    count: number
    wins: number
    losses: number
    winRate: number
    roi: number
  }[]
  
  // Calibration (by probability bucket)
  calibration: {
    bucket: string              // e.g., '55-60%'
    count: number
    expectedWinRate: number     // Average stated probability
    actualWinRate: number       // Actual win rate
    difference: number          // actual - expected
  }[]
  
  // By bet type
  byBetType: {
    type: string
    count: number
    wins: number
    losses: number
    winRate: number
    roi: number
  }[]
  
  // By sport
  bySport: {
    sport: string
    count: number
    wins: number
    losses: number
    winRate: number
    roi: number
  }[]
  
  lastUpdated: string
}

// ============================================
// CONSTANTS
// ============================================

const TRACKING_KEY_PREFIX = 'reco:v1:'
const TRACKING_INDEX_KEY = 'reco:v1:index:createdAt'
const TRACKING_PENDING_KEY = 'reco:v1:index:pending'

// ============================================
// REDIS HELPERS
// ============================================

async function getRedisClient() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.warn('[Tracking] Redis not configured')
    return null
  }
  
  return { url, token }
}

// ============================================
// RECOMMENDATION ID GENERATION
// ============================================

/**
 * Generate a unique, deterministic ID for a recommendation
 * This prevents duplicate logging if cron runs multiple times
 */
function generateRecommendationId(
  betType: string,
  sport: string,
  gameId: string,
  _selection: string,
  date: string
): string {
  // NOTE: selection is intentionally EXCLUDED from the key.
  // Previously, including selection meant line moves (e.g., +3.5 → +4.5) created
  // duplicate entries for the same game. Now one game + betType + day = one record.
  // The selection is still stored on the record and updated via upsert when odds change.
  const key = `${betType}|${sport}|${gameId}|${date.slice(0, 10)}`
  // Simple hash function
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `reco_${Math.abs(hash).toString(36)}`
}

// ============================================
// TRACKING FUNCTIONS
// ============================================

/**
 * Log a recommendation to the tracking system
 */
export async function trackRecommendation(reco: Omit<TrackedRecommendation, 'id' | 'createdAt' | 'status'>): Promise<string | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  const now = new Date()
  const id = generateRecommendationId(
    reco.betType,
    reco.sport,
    reco.gameId,
    reco.selection,
    now.toISOString()
  )
  
  // Check if already exists — if so, UPSERT (update odds/line) unless locked in
  try {
    const existsResponse = await fetch(`${redis.url}/exists/${TRACKING_KEY_PREFIX}${id}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
      cache: 'no-store'
    })
    const existsData = await existsResponse.json()
    if (existsData.result === 1) {
      // Recommendation exists — check if we should update or skip
      const existing = await getRecommendation(id)
      if (existing) {
        const gameStarted = existing.commenceTime && new Date(existing.commenceTime).getTime() <= now.getTime()
        if (existing.lockedIn || gameStarted) {
          // Game started or locked in — don't overwrite, this is the final record
          console.log(`[Tracking] Recommendation ${id} is locked in (game started), preserving`)
          return id
        }
        // Game hasn't started — update with latest odds/line/selection (upsert)
        await updateRecommendation(id, {
          selection: reco.selection,
          line: reco.line,
          odds: reco.odds,
          probability: reco.probability,
          score: reco.score,
          confidenceTier: reco.confidenceTier
        })
        console.log(`[Tracking] Updated recommendation ${id} with latest odds: ${reco.selection}`)
        return id
      }
      console.log(`[Tracking] Recommendation ${id} exists but unreadable, skipping`)
      return id
    }
  } catch (error) {
    console.error('[Tracking] Error checking existence:', error)
  }
  
  const fullReco: TrackedRecommendation = {
    ...reco,
    id,
    createdAt: now.toISOString(),
    status: 'pending'
  }
  
  try {
    // Store the recommendation
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', `${TRACKING_KEY_PREFIX}${id}`, JSON.stringify(fullReco)]),
      cache: 'no-store'
    })
    
    // Add to time index (sorted set with timestamp as score)
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['ZADD', TRACKING_INDEX_KEY, now.getTime(), id]),
      cache: 'no-store'
    })
    
    // Add to pending set
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SADD', TRACKING_PENDING_KEY, id]),
      cache: 'no-store'
    })
    
    console.log(`[Tracking] Logged recommendation: ${id} - ${reco.selection}`)
    return id
  } catch (error) {
    console.error('[Tracking] Error logging recommendation:', error)
    return null
  }
}

/**
 * Get a recommendation by ID
 */
export async function getRecommendation(id: string): Promise<TrackedRecommendation | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', `${TRACKING_KEY_PREFIX}${id}`]),
      cache: 'no-store'
    })
    
    const data = await response.json()
    if (!data.result) return null
    
    // Handle potentially double-encoded JSON from Redis
    let parsed = data.result
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        console.error('[Tracking] Failed to parse recommendation data')
        return null
      }
    }
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        console.error('[Tracking] Failed to parse double-encoded recommendation data')
        return null
      }
    }
    return parsed && typeof parsed === 'object' ? (parsed as TrackedRecommendation) : null
  } catch (error) {
    console.error('[Tracking] Error getting recommendation:', error)
    return null
  }
}

/**
 * Update a recommendation (e.g., when settling)
 */
export async function updateRecommendation(id: string, updates: Partial<TrackedRecommendation>): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) {
    console.error('[Tracking] updateRecommendation: Redis not configured')
    return false
  }
  
  const existing = await getRecommendation(id)
  if (!existing) {
    console.error(`[Tracking] updateRecommendation: Could not find existing recommendation ${id}`)
    return false
  }
  
  const updated = { ...existing, ...updates }
  const serialized = JSON.stringify(updated)
  
  try {
    // Write updated recommendation to Redis
    const setResponse = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', `${TRACKING_KEY_PREFIX}${id}`, serialized]),
      cache: 'no-store'
    })
    
    if (!setResponse.ok) {
      const errorText = await setResponse.text()
      console.error(`[Tracking] Redis SET failed for ${id}: HTTP ${setResponse.status} - ${errorText}`)
      return false
    }
    
    const setResult = await setResponse.json()
    if (setResult.error) {
      console.error(`[Tracking] Redis SET error for ${id}:`, setResult.error)
      return false
    }
    
    // If settled, remove from pending set
    if (updates.status && updates.status !== 'pending') {
      const sremResponse = await fetch(redis.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SREM', TRACKING_PENDING_KEY, id]),
        cache: 'no-store'
      })
      
      if (!sremResponse.ok) {
        const errorText = await sremResponse.text()
        console.error(`[Tracking] Redis SREM failed for ${id}: HTTP ${sremResponse.status} - ${errorText}`)
      }
    }
    
    return true
  } catch (error) {
    console.error(`[Tracking] Error updating recommendation ${id}:`, error)
    return false
  }
}

/**
 * Get all pending recommendations
 */
export async function getPendingRecommendations(): Promise<TrackedRecommendation[]> {
  const redis = await getRedisClient()
  if (!redis) return []
  
  try {
    // Get all pending IDs
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SMEMBERS', TRACKING_PENDING_KEY]),
      cache: 'no-store'
    })
    
    const data = await response.json()
    if (!data.result || !Array.isArray(data.result)) return []
    
    // Fetch each recommendation
    const recommendations: TrackedRecommendation[] = []
    for (const id of data.result) {
      const reco = await getRecommendation(id)
      if (reco) recommendations.push(reco)
    }
    
    return recommendations
  } catch (error) {
    console.error('[Tracking] Error getting pending recommendations:', error)
    return []
  }
}

/**
 * Get recent recommendations (for dashboard)
 */
export async function getRecentRecommendations(limit: number = 100): Promise<TrackedRecommendation[]> {
  const redis = await getRedisClient()
  if (!redis) return []
  
  try {
    // Get recent IDs from sorted set (newest first)
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['ZREVRANGE', TRACKING_INDEX_KEY, 0, limit - 1]),
      cache: 'no-store'
    })
    
    const data = await response.json()
    if (!data.result || !Array.isArray(data.result)) return []
    
    // Fetch each recommendation
    const recommendations: TrackedRecommendation[] = []
    for (const id of data.result) {
      const reco = await getRecommendation(id)
      if (reco) recommendations.push(reco)
    }
    
    return recommendations
  } catch (error) {
    console.error('[Tracking] Error getting recent recommendations:', error)
    return []
  }
}

/**
 * Clear all recommendation tracking data (fresh start)
 */
export async function clearAllRecommendations(): Promise<{ deleted: number }> {
  const redis = await getRedisClient()
  if (!redis) return { deleted: 0 }
  
  try {
    // Get all IDs from the index
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['ZRANGE', TRACKING_INDEX_KEY, 0, -1]),
      cache: 'no-store'
    })
    
    const data = await response.json()
    const ids: string[] = Array.isArray(data.result) ? data.result : []
    
    let deleted = 0
    
    // Delete each recommendation key
    for (const id of ids) {
      await fetch(redis.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['DEL', `${TRACKING_KEY_PREFIX}${id}`]),
        cache: 'no-store'
      })
      deleted++
    }
    
    // Clear the index
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['DEL', TRACKING_INDEX_KEY]),
      cache: 'no-store'
    })
    
    // Clear the pending set
    await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['DEL', TRACKING_PENDING_KEY]),
      cache: 'no-store'
    })
    
    console.log(`[Tracking] Cleared ${deleted} recommendations`)
    return { deleted }
  } catch (error) {
    console.error('[Tracking] Error clearing recommendations:', error)
    return { deleted: 0 }
  }
}

// ============================================
// LOCK-IN & CLEANUP
// ============================================

/**
 * Lock in started games and void superseded picks.
 * 
 * This is the core of the pick integrity system:
 * 1. If a game has started and the pick is still in the active Lock/Strong list → lock it in
 * 2. If a game has started and the pick was DROPPED from the list before tip-off → void it
 * 3. If a game hasn't started and the pick is no longer active → void it (superseded)
 * 4. Dedup: if multiple pending recommendations exist for the same gameId+betType, keep newest, void rest
 * 
 * @param activeGameKeys Set of "gameId:betType" strings currently in the Lock/Strong list
 * @returns Summary of actions taken
 */
export async function lockInAndCleanupRecommendations(
  activeGameKeys: Set<string>
): Promise<{ lockedIn: number; voided: number; deduped: number }> {
  const result = { lockedIn: 0, voided: 0, deduped: 0 }
  
  const pendingRecos = await getPendingRecommendations()
  if (pendingRecos.length === 0) return result
  
  const now = Date.now()
  
  // Group pending recommendations by gameId:betType to find duplicates
  const groups = new Map<string, TrackedRecommendation[]>()
  for (const reco of pendingRecos) {
    const key = `${reco.gameId}:${reco.betType}`
    const group = groups.get(key) || []
    group.push(reco)
    groups.set(key, group)
  }
  
  // Track recommendations that want to be locked in — we'll enforce caps after the loop
  const pendingLockIns: TrackedRecommendation[] = []
  
  for (const [groupKey, recos] of Array.from(groups.entries())) {
    // Sort by createdAt descending — newest first
    recos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    
    // Dedup: if multiple recommendations exist for the same game+betType, keep newest
    if (recos.length > 1) {
      for (let i = 1; i < recos.length; i++) {
        await updateRecommendation(recos[i].id, {
          status: 'void',
          settledAt: new Date().toISOString(),
          actualResult: 'Duplicate entry — superseded by newer recommendation',
          supersededAt: recos[0].createdAt
        })
        result.deduped++
        console.log(`[Tracking] Deduped old recommendation ${recos[i].id} for ${groupKey}`)
      }
    }
    
    // Process the primary (newest) recommendation
    const primary = recos[0]
    if (primary.lockedIn) continue // Already locked in from a previous run
    
    const gameStarted = primary.commenceTime && new Date(primary.commenceTime).getTime() <= now
    const isActive = activeGameKeys.has(groupKey)
    
    if (gameStarted) {
      // Game has started and pick is still pending → candidate for lock-in.
      // We collect these and enforce the 1 Lock + 3 Strong cap below.
      pendingLockIns.push(primary)
    } else if (!isActive) {
      // Game hasn't started and pick is no longer in active list → void it
      await updateRecommendation(primary.id, {
        status: 'void',
        settledAt: new Date().toISOString(),
        actualResult: 'Superseded by higher-ranked pick before game start',
        supersededAt: new Date().toISOString()
      })
      result.voided++
      console.log(`[Tracking] Voided recommendation ${primary.id} — superseded before game start`)
    }
    // If game hasn't started and pick IS active → do nothing, it's still live
  }
  
  // ============================================
  // DAILY TIER CAP ENFORCEMENT ON LOCK-IN
  // Only lock in max 1 Lock + 3 Strong = 4 best_bet recommendations per day.
  // Count already-locked recommendations, then fill remaining slots
  // with the highest-scored pending lock-in candidates.
  // ============================================
  const MAX_DAILY_LOCKS = 1
  const MAX_DAILY_STRONG = 3
  const MAX_DAILY_TOTAL = MAX_DAILY_LOCKS + MAX_DAILY_STRONG
  
  // Count recommendations already locked in from previous cron runs
  const allRecos = await getRecentRecommendations(500)
  const alreadyLockedBestBets = allRecos.filter(r =>
    r.lockedIn && r.source === 'best_bet' &&
    (r.status === 'pending' || r.status === 'won' || r.status === 'lost' || r.status === 'push')
  )
  const totalSlotsUsed = alreadyLockedBestBets.length
  const totalSlotsAvailable = MAX_DAILY_TOTAL - totalSlotsUsed
  
  if (pendingLockIns.length > 0) {
    // Only apply cap to best_bet recommendations (not parlays, props, etc.)
    const bestBetLockIns = pendingLockIns.filter(r => r.source === 'best_bet')
    const otherLockIns = pendingLockIns.filter(r => r.source !== 'best_bet')
    
    // Sort best_bet candidates by score descending (highest priority first)
    bestBetLockIns.sort((a, b) => (b.score || 0) - (a.score || 0))
    
    const slotsToFill = Math.max(0, totalSlotsAvailable)
    
    for (let i = 0; i < bestBetLockIns.length; i++) {
      const reco = bestBetLockIns[i]
      if (i < slotsToFill) {
        // Lock in — within daily cap
        await updateRecommendation(reco.id, { lockedIn: true })
        result.lockedIn++
        console.log(`[Tracking] Locked in recommendation ${reco.id} (slot ${totalSlotsUsed + i + 1}/${MAX_DAILY_TOTAL}) — game started, within daily cap`)
      } else {
        // Exceeds daily cap — void
        await updateRecommendation(reco.id, {
          status: 'void',
          settledAt: new Date().toISOString(),
          actualResult: 'Exceeded daily tier cap (max 1 Lock + 3 Strong = 4 picks/day)'
        })
        result.voided++
        console.log(`[Tracking] Voided recommendation ${reco.id} — exceeded daily tier cap (${totalSlotsUsed + i + 1} > ${MAX_DAILY_TOTAL})`)
      }
    }
    
    // Lock in non-best_bet recommendations (props, parlays) without cap
    for (const reco of otherLockIns) {
      await updateRecommendation(reco.id, { lockedIn: true })
      result.lockedIn++
      console.log(`[Tracking] Locked in ${reco.source} recommendation ${reco.id} — game started`)
    }
  }
  
  console.log(`[Tracking] Cleanup complete: ${result.lockedIn} locked in, ${result.voided} voided, ${result.deduped} deduped (${totalSlotsUsed} already locked, ${totalSlotsAvailable} slots available)`)
  return result
}

// ============================================
// PROFIT CALCULATION
// ============================================

/**
 * Calculate profit from American odds
 * Assumes 1 unit ($100) bet
 */
export function calculateProfit(odds: number, won: boolean): number {
  if (!won) return -1 // Lost 1 unit
  
  if (odds > 0) {
    // Underdog: +150 means win $150 on $100 bet
    return odds / 100
  } else {
    // Favorite: -150 means win $66.67 on $100 bet
    return 100 / Math.abs(odds)
  }
}

// ============================================
// STATISTICS CALCULATION
// ============================================

/**
 * Calculate tracking statistics from all recommendations
 */
export async function calculateTrackingStats(): Promise<TrackingStats> {
  const allRecommendations = await getRecentRecommendations(1000)
  
  // IMPORTANT: Only count best_bet picks with lock/strong tier in the official record.
  // Props, parlays, sport_bets, and value-tier picks should NOT inflate the public record.
  // The record should reflect exactly the 1 Lock + 3 Strong picks that were locked in.
  const recommendations = allRecommendations.filter(r =>
    r.source === 'best_bet' &&
    (r.confidenceTier === 'lock' || r.confidenceTier === 'strong')
  )
  
  const stats: TrackingStats = {
    totalBets: recommendations.length,
    settledBets: 0,
    pendingBets: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winRate: 0,
    roi: 0,
    totalProfit: 0,
    byConfidence: [],
    calibration: [],
    byBetType: [],
    bySport: [],
    lastUpdated: new Date().toISOString()
  }
  
  // Group data for aggregations
  const confidenceBuckets: Record<string, { wins: number; losses: number; profit: number }> = {
    'High (80+)': { wins: 0, losses: 0, profit: 0 },
    'Medium (60-80)': { wins: 0, losses: 0, profit: 0 },
    'Low (<60)': { wins: 0, losses: 0, profit: 0 }
  }
  
  const calibrationBuckets: Record<string, { count: number; totalProb: number; wins: number }> = {}
  const betTypeBuckets: Record<string, { wins: number; losses: number; profit: number }> = {}
  const sportBuckets: Record<string, { wins: number; losses: number; profit: number }> = {}
  
  for (const reco of recommendations) {
    if (reco.status === 'pending') {
      stats.pendingBets++
      continue
    }
    
    if (reco.status === 'void') {
      // Voided picks (superseded before game start) don't count at all
      continue
    }
    
    if (reco.status === 'push') {
      stats.pushes++
      continue
    }
    
    stats.settledBets++
    const won = reco.status === 'won'
    const profit = reco.profit ?? calculateProfit(reco.odds, won)
    
    if (won) {
      stats.wins++
    } else {
      stats.losses++
    }
    stats.totalProfit += profit
    
    // Confidence buckets
    const confLevel = reco.score >= 80 ? 'High (80+)' : reco.score >= 60 ? 'Medium (60-80)' : 'Low (<60)'
    if (!confidenceBuckets[confLevel]) {
      confidenceBuckets[confLevel] = { wins: 0, losses: 0, profit: 0 }
    }
    if (won) confidenceBuckets[confLevel].wins++
    else confidenceBuckets[confLevel].losses++
    confidenceBuckets[confLevel].profit += profit
    
    // Calibration buckets (5% increments)
    const probBucket = `${Math.floor(reco.probability / 5) * 5}-${Math.floor(reco.probability / 5) * 5 + 5}%`
    if (!calibrationBuckets[probBucket]) {
      calibrationBuckets[probBucket] = { count: 0, totalProb: 0, wins: 0 }
    }
    calibrationBuckets[probBucket].count++
    calibrationBuckets[probBucket].totalProb += reco.probability
    if (won) calibrationBuckets[probBucket].wins++
    
    // Bet type buckets
    if (!betTypeBuckets[reco.betType]) {
      betTypeBuckets[reco.betType] = { wins: 0, losses: 0, profit: 0 }
    }
    if (won) betTypeBuckets[reco.betType].wins++
    else betTypeBuckets[reco.betType].losses++
    betTypeBuckets[reco.betType].profit += profit
    
    // Sport buckets
    const sportKey = reco.sportName || reco.sport
    if (!sportBuckets[sportKey]) {
      sportBuckets[sportKey] = { wins: 0, losses: 0, profit: 0 }
    }
    if (won) sportBuckets[sportKey].wins++
    else sportBuckets[sportKey].losses++
    sportBuckets[sportKey].profit += profit
  }
  
  // Calculate overall stats
  const totalDecided = stats.wins + stats.losses
  stats.winRate = totalDecided > 0 ? (stats.wins / totalDecided) * 100 : 0
  stats.roi = stats.settledBets > 0 ? (stats.totalProfit / stats.settledBets) * 100 : 0
  
  // Format confidence stats
  stats.byConfidence = Object.entries(confidenceBuckets).map(([level, data]) => {
    const total = data.wins + data.losses
    return {
      level,
      count: total,
      wins: data.wins,
      losses: data.losses,
      winRate: total > 0 ? (data.wins / total) * 100 : 0,
      roi: total > 0 ? (data.profit / total) * 100 : 0
    }
  }).filter(b => b.count > 0)
  
  // Format calibration stats
  stats.calibration = Object.entries(calibrationBuckets).map(([bucket, data]) => {
    const actualWinRate = data.count > 0 ? (data.wins / data.count) * 100 : 0
    const expectedWinRate = data.count > 0 ? data.totalProb / data.count : 0
    return {
      bucket,
      count: data.count,
      expectedWinRate,
      actualWinRate,
      difference: actualWinRate - expectedWinRate
    }
  }).filter(b => b.count > 0).sort((a, b) => {
    const aNum = parseInt(a.bucket.split('-')[0])
    const bNum = parseInt(b.bucket.split('-')[0])
    return aNum - bNum
  })
  
  // Format bet type stats
  stats.byBetType = Object.entries(betTypeBuckets).map(([type, data]) => {
    const total = data.wins + data.losses
    return {
      type,
      count: total,
      wins: data.wins,
      losses: data.losses,
      winRate: total > 0 ? (data.wins / total) * 100 : 0,
      roi: total > 0 ? (data.profit / total) * 100 : 0
    }
  }).filter(b => b.count > 0)
  
  // Format sport stats
  stats.bySport = Object.entries(sportBuckets).map(([sport, data]) => {
    const total = data.wins + data.losses
    return {
      sport,
      count: total,
      wins: data.wins,
      losses: data.losses,
      winRate: total > 0 ? (data.wins / total) * 100 : 0,
      roi: total > 0 ? (data.profit / total) * 100 : 0
    }
  }).filter(b => b.count > 0)
  
  return stats
}

// ============================================
// HELPER FUNCTIONS FOR LOGGING FROM CACHE
// ============================================

import type { RankedBet, RankedProp } from './bet-ranking'

/**
 * Build selection string based on bet type
 */
function buildSelection(bet: RankedBet): string {
  if (bet.betType === 'spread' && bet.line !== undefined) {
    return `${bet.team} ${bet.line > 0 ? '+' : ''}${bet.line}`
  } else if (bet.betType === 'total' && bet.line !== undefined) {
    return `${bet.team} ${bet.line}`
  }
  return `${bet.team} ML`
}

/**
 * Track a best bet recommendation
 */
export async function trackBestBet(bet: RankedBet): Promise<string | null> {
  // Only track Lock and Strong Play picks publicly — value spots are excluded
  if (!bet.confidenceTier || bet.confidenceTier === 'value') {
    return null
  }
  return trackRecommendation({
    sport: bet.sport,
    sportName: bet.sportName,
    gameId: bet.gameId,
    gameName: `${bet.awayTeam} @ ${bet.homeTeam}`,
    commenceTime: bet.commenceTime,
    betType: bet.betType,
    selection: buildSelection(bet),
    line: bet.line,
    odds: bet.bestPrice,
    probability: bet.consensusProbability,
    score: bet.score,
    source: 'best_bet',
    confidenceTier: bet.confidenceTier
  })
}

/**
 * Track a parlay recommendation
 */
export async function trackParlay(parlay: RankedBet[], parlayType: 'safe' | 'aggressive'): Promise<string | null> {
  if (parlay.length === 0) return null
  
  const selection = parlay.map(b => `${b.team} ML`).join(' + ')
  const combinedProb = parlay.reduce((acc, b) => acc * (b.consensusProbability / 100), 1) * 100
  const combinedOdds = parlay.reduce((acc, b) => {
    // Convert to decimal, multiply, convert back to American
    const decimal = b.bestPrice > 0 ? (b.bestPrice / 100) + 1 : (100 / Math.abs(b.bestPrice)) + 1
    return acc * decimal
  }, 1)
  const americanOdds = combinedOdds >= 2 ? Math.round((combinedOdds - 1) * 100) : Math.round(-100 / (combinedOdds - 1))
  
  return trackRecommendation({
    sport: parlay[0].sport,
    sportName: 'Parlay',
    gameId: parlay.map(b => b.gameId).join('_'),
    gameName: `${parlay.length}-leg ${parlayType} parlay`,
    commenceTime: parlay[0].commenceTime,
    betType: 'moneyline',
    selection,
    odds: americanOdds,
    probability: combinedProb,
    score: parlay.reduce((acc, b) => acc + b.score, 0) / parlay.length,
    source: 'parlay'
  })
}

/**
 * Track a sport-specific best bet
 */
export async function trackSportBet(bet: RankedBet, sportName: string): Promise<string | null> {
  // Only track Lock and Strong Play picks publicly — value spots are excluded
  if (!bet.confidenceTier || bet.confidenceTier === 'value') {
    return null
  }
  return trackRecommendation({
    sport: bet.sport,
    sportName,
    gameId: bet.gameId,
    gameName: `${bet.awayTeam} @ ${bet.homeTeam}`,
    commenceTime: bet.commenceTime,
    betType: bet.betType,
    selection: buildSelection(bet),
    line: bet.line,
    odds: bet.bestPrice,
    probability: bet.consensusProbability,
    score: bet.score,
    source: 'sport_bet',
    confidenceTier: bet.confidenceTier
  })
}

/**
 * Track a prop bet recommendation
 */
export async function trackPropBet(prop: RankedProp): Promise<string | null> {
  return trackRecommendation({
    sport: prop.sport,
    sportName: prop.sport.includes('nba') ? 'NBA' : prop.sport.includes('nfl') ? 'NFL' : prop.sport.includes('nhl') ? 'NHL' : prop.sport,
    gameId: prop.gameId,
    gameName: `${prop.awayTeam} @ ${prop.homeTeam}`,
    commenceTime: prop.commenceTime,
    betType: 'prop',
    selection: `${prop.playerName} ${prop.pick} ${prop.line} ${prop.marketDisplay}`,
    line: prop.line,
    odds: prop.bestPrice,
    probability: prop.consensusProbability,
    score: prop.score,
    source: 'best_prop',
    playerName: prop.playerName,
    market: prop.market
  })
}
