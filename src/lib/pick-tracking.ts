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

import { kvGet, kvSet, kvDel, isDbConfigured } from '@/lib/pg-kv'

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
  
  // Lock-in tracking
  lockedIn?: boolean            // True once game starts and pick was still active
  supersededAt?: string         // When this pick was superseded by a newer version
  
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
 * Get today's "betting day" date string in ET timezone.
 * A betting day runs until 2 AM ET the next morning, so at 1 AM ET on March 4
 * we still return the March 3 date string. This keeps the daily cap aligned
 * with when picks are displayed on the Model Picks page.
 */
function getTodayET(): string {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etNow = new Date(etStr)
  // Before 2 AM ET = still the previous calendar day for betting purposes
  if (etNow.getHours() < 2) {
    etNow.setDate(etNow.getDate() - 1)
  }
  return etNow.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
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
  if (!isDbConfigured()) return null
  
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
    
    // Store back to Postgres
    await kvSet(PICKS_CACHE_KEY, JSON.stringify(existingPicks))
    
    console.log(`[storePick] Stored pick: ${newPick.id} - ${newPick.team}`)
    return newPick
  } catch (error) {
    console.error('[storePick] Error storing pick:', error)
    return null
  }
}

/**
 * Get all stored picks.
 * Always reads fresh from the database — no in-memory caching.
 * The previous cachedRead() layer caused stale reads across Vercel serverless
 * instances: writes persisted to Postgres but other instances served cached data
 * for up to 2 minutes, breaking grading, settlement, and the performance page.
 */
export async function getAllPicks(): Promise<StoredPick[]> {
  if (!isDbConfigured()) return []
  
  try {
    const result = await kvGet(PICKS_CACHE_KEY)
    if (!result) return []
    
    const parsed = JSON.parse(result)
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
  if (!isDbConfigured()) return false
  
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
    await kvSet(PICKS_CACHE_KEY, JSON.stringify(picks))
    
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
  if (!isDbConfigured()) return
  
  const trackRecord = {
    '7d': calculateTrackRecordForPeriod(picks, 7),
    '30d': calculateTrackRecordForPeriod(picks, 30),
    '90d': calculateTrackRecordForPeriod(picks, 90),
    'all': calculateTrackRecordForPeriod(picks, null)
  }
  
  try {
    await kvSet(TRACK_RECORD_KEY, JSON.stringify(trackRecord))
    console.log(`[calculateAndStoreTrackRecord] Updated track record: ${trackRecord['30d'].wins}-${trackRecord['30d'].losses}`)
  } catch (error) {
    console.error('[calculateAndStoreTrackRecord] Error storing track record:', error)
  }
}

/**
 * Get track record.
 * Always reads fresh from the database — no in-memory caching.
 * See getAllPicks() comment for why cachedRead was removed.
 */
export async function getTrackRecord(): Promise<PickTrackingData['trackRecord'] | null> {
  if (!isDbConfigured()) return null
  
  try {
    const result = await kvGet(TRACK_RECORD_KEY)
    if (!result) return null
    
    const parsed = JSON.parse(result)
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
 * Clear all picks and track record data (for resetting records to zero)
 */
export async function clearAllPicks(): Promise<{ deleted: number }> {
  if (!isDbConfigured()) return { deleted: 0 }
  
  try {
    const allPicks = await getAllPicks()
    const count = allPicks.length
    
    await kvDel(PICKS_CACHE_KEY)
    await kvDel(TRACK_RECORD_KEY)
    
    console.log(`[clearAllPicks] Cleared ${count} picks and track record`)
    return { deleted: count }
  } catch (error) {
    console.error('[clearAllPicks] Error:', error)
    return { deleted: 0 }
  }
}

/**
 * Get pending picks that need grading (games that have ended)
 */
export async function getPendingPicksToGrade(): Promise<StoredPick[]> {
  const picks = await getAllPicks()
  const now = new Date()
  
  // IMPORTANT: Only grade picks that were LOCKED IN at game start.
  // The lockInAndCleanupPicks() function runs BEFORE grading in the cron
  // and sets lockedIn=true on picks that were active at tip-off (max 4/day).
  // Non-locked pending picks should NOT be graded — they either:
  //   1. Haven't had their game start yet (wait for lock-in)
  //   2. Exceeded the daily tier cap and were cancelled
  //   3. Were superseded by higher-ranked picks and cancelled
  return picks.filter(p => {
    if (p.status !== 'pending') return false
    if (!p.lockedIn) return false // Only grade locked-in picks
    const gameEnd = new Date(new Date(p.gameTime).getTime() + 4 * 60 * 60 * 1000)
    return now > gameEnd
  })
}

/**
 * Lock in started games and cancel superseded picks.
 * 
 * This is the pick-tracking counterpart to lockInAndCleanupRecommendations.
 * It ensures the pick-tracking system (used for grading/record) stays clean:
 * 1. Games that started while pick was still active → lockedIn = true
 * 2. Games that started after pick was dropped → cancelled
 * 3. Games not started and pick no longer active → cancelled (superseded)
 * 4. Dedup: multiple pending picks for same game+team+betType → keep newest
 * 
 * @param activeGameKeys Set of "gameId:team:betType" strings currently in Lock/Strong list
 */
export async function lockInAndCleanupPicks(
  activeGameKeys: Set<string>
): Promise<{ lockedIn: number; cancelled: number; deduped: number }> {
  const result = { lockedIn: 0, cancelled: 0, deduped: 0 }
  
  if (!isDbConfigured()) return result
  
  const picks = await getAllPicks()
  if (picks.length === 0) return result
  
  const now = Date.now()
  let modified = false
  
  // Group pending best_bet picks by gameId:team:betType to find duplicates
  const groups = new Map<string, number[]>() // key → array of indices
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]
    if (p.status !== 'pending' || p.pickType !== 'best_bet') continue
    const key = `${p.gameId}:${p.team}:${p.betType}`
    const group = groups.get(key) || []
    group.push(i)
    groups.set(key, group)
  }
  
  // Track picks that want to be locked in — we'll enforce caps after the loop
  const pendingLockIns: number[] = [] // indices of primary picks that want to lock in
  
  for (const [groupKey, indices] of Array.from(groups.entries())) {
    // Sort by createdAt descending — newest first
    indices.sort((a, b) => new Date(picks[b].createdAt).getTime() - new Date(picks[a].createdAt).getTime())
    
    // Dedup: cancel older entries for the same game+team+betType
    if (indices.length > 1) {
      for (let i = 1; i < indices.length; i++) {
        picks[indices[i]].status = 'cancelled'
        picks[indices[i]].gradedAt = new Date().toISOString()
        picks[indices[i]].actualResult = 'Duplicate entry — superseded by newer pick'
        picks[indices[i]].supersededAt = picks[indices[0]].createdAt
        result.deduped++
        modified = true
      }
    }
    
    // Process the primary (newest) pick
    const primary = picks[indices[0]]
    if (primary.lockedIn) continue // Already locked in from a previous run
    
    const gameStarted = new Date(primary.gameTime).getTime() <= now
    const isActive = activeGameKeys.has(groupKey)
    
    if (gameStarted) {
      // Game has started and pick is still pending → candidate for lock-in.
      // We collect these and enforce the 1 Lock + 3 Strong cap below.
      pendingLockIns.push(indices[0])
    } else if (!isActive) {
      // Game hasn't started and pick is no longer active → cancel
      primary.status = 'cancelled'
      primary.gradedAt = new Date().toISOString()
      primary.actualResult = 'Superseded by higher-ranked pick before game start'
      primary.supersededAt = new Date().toISOString()
      result.cancelled++
      modified = true
      console.log(`[Picks] Cancelled pick ${primary.id} for ${groupKey} — superseded before game start`)
    }
  }
  
  // ============================================
  // DAILY TIER CAP ENFORCEMENT ON LOCK-IN
  // Only lock in max 1 Lock + 3 Strong = 4 picks per day.
  // Count already-locked picks from previous runs, then fill remaining slots
  // with the highest-scored pending lock-in candidates.
  // ============================================
  const MAX_DAILY_LOCKS = 1
  const MAX_DAILY_STRONG = 3
  
  // Count picks already locked in from previous cron runs TODAY.
  // CRITICAL: Must scope to today's betting day (ET timezone, resets at 2 AM).
  // Without date scoping, this would count ALL locked picks ever stored,
  // causing totalSlotsUsed to grow forever and block all future lock-ins.
  const todayET = getTodayET()
  const alreadyLockedPicks = picks.filter(p => {
    if (!p.lockedIn || p.pickType !== 'best_bet') return false
    if (p.status !== 'pending' && p.status !== 'won' && p.status !== 'lost' && p.status !== 'push') return false
    // Check if pick was created today (same betting day in ET)
    const pickDate = new Date(p.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    return pickDate === todayET
  })
  const totalSlotsUsed = alreadyLockedPicks.length
  const totalSlotsAvailable = (MAX_DAILY_LOCKS + MAX_DAILY_STRONG) - totalSlotsUsed
  
  if (pendingLockIns.length > 0) {
    // Sort candidates by consensusProbability (highest model confidence first)
    // This matches the scoring logic used in bet-ranking for tier assignment
    pendingLockIns.sort((a, b) => (picks[b].consensusProbability || 0) - (picks[a].consensusProbability || 0))
    
    const slotsToFill = Math.max(0, totalSlotsAvailable)
    
    for (let i = 0; i < pendingLockIns.length; i++) {
      const idx = pendingLockIns[i]
      if (i < slotsToFill) {
        // Lock in — within daily cap
        picks[idx].lockedIn = true
        result.lockedIn++
        modified = true
        console.log(`[Picks] Locked in pick ${picks[idx].id} (slot ${totalSlotsUsed + i + 1}/${MAX_DAILY_LOCKS + MAX_DAILY_STRONG}) — game started, within daily cap`)
      } else {
        // Exceeds daily cap — cancel
        picks[idx].status = 'cancelled'
        picks[idx].gradedAt = new Date().toISOString()
        picks[idx].actualResult = 'Exceeded daily tier cap (max 1 Lock + 3 Strong = 4 picks/day)'
        result.cancelled++
        modified = true
        console.log(`[Picks] Cancelled pick ${picks[idx].id} — exceeded daily tier cap (${totalSlotsUsed + i + 1} > ${MAX_DAILY_LOCKS + MAX_DAILY_STRONG})`)
      }
    }
  }
  
  // Write updated picks back to Postgres if anything changed
  if (modified) {
    try {
      await kvSet(PICKS_CACHE_KEY, JSON.stringify(picks))
      // Recalculate track record after cleanup
      await calculateAndStoreTrackRecord(picks)
    } catch (error) {
      console.error('[Picks] Error writing cleanup results:', error)
    }
  }
  
  console.log(`[Picks] Cleanup complete: ${result.lockedIn} locked in, ${result.cancelled} cancelled, ${result.deduped} deduped`)
  return result
}

// ============================================
// AUTO-GRADING SYSTEM (ESPN-based)
// ============================================

/**
 * ESPN game result from the event summary or scoreboard API
 */
interface ESPNGameResult {
  completed: boolean
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
}

/**
 * Map sport key to ESPN sport/league format for score lookups
 */
function getESPNSportLeagueForPicks(sport: string): { espnSport: string; espnLeague: string } {
  if (sport.includes('nfl') || (sport.includes('football') && !sport.includes('ncaa'))) {
    return { espnSport: 'football', espnLeague: 'nfl' }
  } else if (sport.includes('ncaaf') || (sport.includes('football') && sport.includes('ncaa'))) {
    return { espnSport: 'football', espnLeague: 'college-football' }
  } else if (sport.includes('nhl') || sport.includes('hockey')) {
    return { espnSport: 'hockey', espnLeague: 'nhl' }
  } else if (sport.includes('mlb') || sport.includes('baseball')) {
    return { espnSport: 'baseball', espnLeague: 'mlb' }
  } else if (sport.includes('ncaab') || (sport.includes('basketball') && sport.includes('ncaa'))) {
    return { espnSport: 'basketball', espnLeague: 'mens-college-basketball' }
  } else if (sport.includes('nba')) {
    return { espnSport: 'basketball', espnLeague: 'nba' }
  } else if (sport.includes('soccer') || sport.includes('epl')) {
    return { espnSport: 'soccer', espnLeague: 'eng.1' }
  }
  // Default to NBA
  return { espnSport: 'basketball', espnLeague: 'nba' }
}

/**
 * Fetch game result from ESPN using the event summary endpoint.
 * Picks store ESPN game IDs (e.g. 401856562), so we query ESPN directly.
 */
async function fetchESPNGameResult(sport: string, gameId: string): Promise<ESPNGameResult | null> {
  try {
    const { espnSport, espnLeague } = getESPNSportLeagueForPicks(sport)
    
    // Use the event summary endpoint — works for any game, past or present
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/summary?event=${gameId}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    })
    
    if (!response.ok) {
      console.error(`[autoGrade] ESPN API error for game ${gameId}: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return parseESPNResult(data)
  } catch (error) {
    console.error(`[autoGrade] Error fetching ESPN game ${gameId}:`, error)
    return null
  }
}

/**
 * Parse ESPN event summary response into a game result
 */
function parseESPNResult(data: Record<string, unknown>): ESPNGameResult | null {
  try {
    const header = data.header as Record<string, unknown> | undefined
    if (!header) return null
    
    const competitions = header.competitions as Record<string, unknown>[] | undefined
    const competition = competitions?.[0]
    if (!competition) return null
    
    const statusObj = competition.status as Record<string, unknown> | undefined
    const statusType = statusObj?.type as Record<string, unknown> | undefined
    const completed = statusType?.completed === true
    
    const competitors = competition.competitors as Record<string, unknown>[] | undefined
    if (!competitors || competitors.length < 2) return null
    
    const homeCompetitor = competitors.find((c) => c.homeAway === 'home')
    const awayCompetitor = competitors.find((c) => c.homeAway === 'away')
    
    if (!homeCompetitor || !awayCompetitor) return null
    
    const homeTeamObj = homeCompetitor.team as Record<string, unknown> | undefined
    const awayTeamObj = awayCompetitor.team as Record<string, unknown> | undefined
    
    return {
      completed,
      homeTeam: String(homeTeamObj?.displayName || homeTeamObj?.name || ''),
      awayTeam: String(awayTeamObj?.displayName || awayTeamObj?.name || ''),
      homeScore: parseInt(String(homeCompetitor.score)) || 0,
      awayScore: parseInt(String(awayCompetitor.score)) || 0,
    }
  } catch (error) {
    console.error('[autoGrade] Error parsing ESPN event data:', error)
    return null
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
 * Auto-grade all pending picks using ESPN scores.
 * Picks store ESPN game IDs (e.g. 401856562), so we fetch results
 * directly from ESPN's event summary API per game.
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
  
  // Deduplicate ESPN API calls — multiple picks can reference the same game
  const gameResultCache = new Map<string, ESPNGameResult | null>()
  
  for (const pick of pendingPicks) {
    // Fetch game result from ESPN (with caching to avoid duplicate API calls)
    let gameResult = gameResultCache.get(pick.gameId)
    if (gameResult === undefined) {
      gameResult = await fetchESPNGameResult(pick.sport, pick.gameId)
      gameResultCache.set(pick.gameId, gameResult)
    }
    
    if (!gameResult) {
      result.details.push(`No ESPN result for game ${pick.gameId} (${pick.awayTeam} @ ${pick.homeTeam})`)
      continue
    }
    
    if (!gameResult.completed) {
      result.details.push(`Game ${pick.gameId} not yet completed`)
      continue
    }
    
    // Grade based on bet type
    let gradeResult: 'won' | 'lost' | 'push'
    let actualResult: string
    const scoreDisplay = `${gameResult.awayTeam} ${gameResult.awayScore} - ${gameResult.homeTeam} ${gameResult.homeScore}`
    
    if (pick.betType === 'moneyline') {
      gradeResult = gradeMoneylinePick(pick, gameResult.homeScore, gameResult.awayScore)
      actualResult = scoreDisplay
    } else if (pick.betType === 'spread') {
      if (pick.line === undefined || pick.line === null) {
        // Spread pick missing line — cannot grade accurately, skip instead of defaulting to push
        result.details.push(`Skipping spread pick ${pick.id} for ${pick.team} — missing line`)
        continue
      }
      gradeResult = gradeSpreadPick(pick, gameResult.homeScore, gameResult.awayScore)
      const margin = gameResult.homeScore - gameResult.awayScore
      actualResult = `${scoreDisplay} (margin: ${margin > 0 ? '+' : ''}${margin}, line: ${pick.line})`
    } else if (pick.betType === 'total') {
      if (pick.line === undefined || pick.line === null) {
        result.details.push(`Skipping total pick ${pick.id} for ${pick.team} — missing line`)
        continue
      }
      gradeResult = gradeTotalPick(pick, gameResult.homeScore, gameResult.awayScore)
      const total = gameResult.homeScore + gameResult.awayScore
      actualResult = `${scoreDisplay} (total: ${total}, line: ${pick.line})`
    } else {
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
      result.details.push(`REDIS WRITE FAILED grading pick ${pick.id} — check Upstash request limits`)
    }
  }
  
  return result
}

/**
 * Re-grade picks that were incorrectly marked as "push" due to missing line data.
 * This is a repair function that:
 * 1. Finds all picks graded as "push" where the line was undefined
 * 2. Tries to recover the line from the corresponding recommendation record
 * 3. Re-grades them with the correct line using ESPN scores
 */
export async function regradeIncorrectPushes(): Promise<{
  repaired: number
  lineRecovered: number
  errors: number
  details: string[]
}> {
  const result = {
    repaired: 0,
    lineRecovered: 0,
    errors: 0,
    details: [] as string[]
  }

  if (!isDbConfigured()) return result

  const picks = await getAllPicks()
  const incorrectPushes = picks.filter(p =>
    p.status === 'push' &&
    (p.betType === 'spread' || p.betType === 'total') &&
    (p.line === undefined || p.line === null) &&
    p.actualResult?.includes('line: undefined')
  )

  if (incorrectPushes.length === 0) {
    result.details.push('No incorrectly pushed picks found')
    return result
  }

  result.details.push(`Found ${incorrectPushes.length} picks incorrectly graded as push due to missing line`)

  // Try to recover lines from recommendation tracking system
  const { getRecentRecommendations } = await import('@/lib/recommendation-tracking')
  const recos = await getRecentRecommendations(0)

  // Build a lookup map: gameId:team:betType → recommendation
  const recoMap = new Map<string, { line?: number }>()
  for (const r of recos) {
    if (r.line !== undefined && r.line !== null) {
      // Extract team name from selection (e.g., "Rangers +1.5" → "Rangers")
      const teamFromSelection = r.selection.replace(/\s*[+-]?\d+\.?\d*\s*$/, '').trim()
      recoMap.set(`${r.gameId}:${teamFromSelection}:${r.betType}`, { line: r.line })
      // Also store with full selection for broader matching
      recoMap.set(`${r.gameId}:${r.betType}`, { line: r.line })
    }
  }

  const gameResultCache = new Map<string, ESPNGameResult | null>()

  for (const pick of incorrectPushes) {
    // Try to recover line from recommendation
    const exactMatch = recoMap.get(`${pick.gameId}:${pick.team}:${pick.betType}`)
    const broadMatch = recoMap.get(`${pick.gameId}:${pick.betType}`)
    const recoveredLine = exactMatch?.line ?? broadMatch?.line

    if (recoveredLine === undefined || recoveredLine === null) {
      result.details.push(`Could not recover line for ${pick.team} (${pick.gameId}) — no matching recommendation`)
      continue
    }

    // Don't patch line onto pick yet — only do so after confirming ESPN result is available.
    // Otherwise, persisting the line without re-grading makes the pick unfindable on future runs.
    const pickIndex = picks.findIndex(p => p.id === pick.id)
    if (pickIndex === -1) continue

    // Re-fetch ESPN result BEFORE patching the line
    let gameResult = gameResultCache.get(pick.gameId)
    if (gameResult === undefined) {
      gameResult = await fetchESPNGameResult(pick.sport, pick.gameId)
      gameResultCache.set(pick.gameId, gameResult)
    }

    if (!gameResult || !gameResult.completed) {
      result.details.push(`No ESPN result for ${pick.team} (${pick.gameId}) — line recovered but cannot re-grade yet`)
      continue
    }

    // Now safe to patch the line — we know we can complete the re-grade
    picks[pickIndex].line = recoveredLine
    result.lineRecovered++

    // Re-grade with recovered line
    let gradeResult: 'won' | 'lost' | 'push'
    let actualResult: string
    const scoreDisplay = `${gameResult.awayTeam} ${gameResult.awayScore} - ${gameResult.homeTeam} ${gameResult.homeScore}`

    if (pick.betType === 'spread') {
      gradeResult = gradeSpreadPick(picks[pickIndex], gameResult.homeScore, gameResult.awayScore)
      const margin = gameResult.homeScore - gameResult.awayScore
      actualResult = `${scoreDisplay} (margin: ${margin > 0 ? '+' : ''}${margin}, line: ${recoveredLine})`
    } else {
      gradeResult = gradeTotalPick(picks[pickIndex], gameResult.homeScore, gameResult.awayScore)
      const total = gameResult.homeScore + gameResult.awayScore
      actualResult = `${scoreDisplay} (total: ${total}, line: ${recoveredLine})`
    }

    // Update the pick in the array
    picks[pickIndex].status = gradeResult
    picks[pickIndex].gradedAt = new Date().toISOString()
    picks[pickIndex].actualResult = actualResult
    picks[pickIndex].unitsWon = calculateUnitsWon(picks[pickIndex].odds, picks[pickIndex].units, gradeResult)

    result.repaired++
    result.details.push(`Re-graded ${pick.team}: push → ${gradeResult.toUpperCase()} (line: ${recoveredLine}, ${actualResult})`)
  }

  // Write all changes back at once (lineRecovered now only increments after ESPN confirms)
  if (result.repaired > 0) {
    try {
      await kvSet(PICKS_CACHE_KEY, JSON.stringify(picks))
      await calculateAndStoreTrackRecord(picks)
      result.details.push(`Saved ${result.repaired} re-graded picks and updated track record`)
    } catch (error) {
      console.error('[regradeIncorrectPushes] Error writing repairs:', error)
      result.errors++
      result.details.push('Failed to save re-graded picks to database')
    }
  }

  return result
}
