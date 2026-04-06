/**
 * Player Prop Enhancements Module
 * 
 * Provides advanced adjustments for player prop predictions:
 * 1. Pace/Game Environment Adjustment - Uses game totals to adjust projections
 * 2. Prop Correlation Engine - Identifies correlated props for same-game parlays
 * 3. Minutes/Usage Projection - Adjusts for injuries affecting playing time
 * 4. Prop CLV Tracking - Tracks closing line value for prop bets
 */

import { getCachedESPNOdds, type ESPNOdds } from './espn'
import { getCachedESPNData, type ESPNInjury } from './espn'
import { kvGet, kvSet, kvHset, kvHget, kvHgetall, isDbConfigured } from '@/lib/pg-kv'

// ============================================
// TYPES
// ============================================

export interface PaceAdjustment {
  gameTotal: number           // The over/under for the game
  leagueAverage: number       // League average total
  paceMultiplier: number      // Multiplier to apply to projections (e.g., 1.05 = +5%)
  paceDescription: string     // Human-readable description
}

export interface PropCorrelation {
  prop1: { player: string; stat: string; direction: 'over' | 'under' }
  prop2: { player: string; stat: string; direction: 'over' | 'under' }
  correlationType: 'positive' | 'negative'
  strength: 'strong' | 'moderate' | 'weak'
  reason: string
}

export interface UsageAdjustment {
  usageMultiplier: number     // Multiplier for stats (more minutes = more stats)
  description: string         // Why the adjustment was made
  injuredTeammates: string[]  // List of injured players affecting this player
}

export interface PropCLVRecord {
  id: string
  playerName: string
  sport: string
  statType: string            // 'points', 'rebounds', etc.
  line: number                // The prop line (e.g., 24.5)
  direction: 'over' | 'under'
  
  // At pick time
  pickOdds: number            // Odds when picked (e.g., -110)
  pickProbability: number     // Our model's probability
  pickTimestamp: string
  
  // At closing
  closingLine: number | null
  closingOdds: number | null
  closingTimestamp: string | null
  
  // CLV calculation
  lineCLV: number | null      // Line movement (e.g., picked 24.5, closed 25.5 = +1.0 CLV)
  
  // Outcome
  actualResult: number | null
  outcome: 'hit' | 'miss' | 'push' | 'pending'
  gameTimestamp: string
}

export interface PropCLVStats {
  totalProps: number
  propsWithCLV: number
  averageLineCLV: number      // Average line movement in our favor
  positiveLineCLVRate: number // % of props where line moved in our favor
  hitRate: number             // Actual hit rate
  expectedHitRate: number     // Based on model probabilities
  byStat: Record<string, { props: number; avgCLV: number; hitRate: number }>
  bySport: Record<string, { props: number; avgCLV: number; hitRate: number }>
}

// ============================================
// CONSTANTS
// ============================================

// League average game totals (approximate)
const LEAGUE_AVERAGE_TOTALS: Record<string, number> = {
  'NBA': 225,
  'NCAAB': 145,
  'NFL': 45,
  'NCAAF': 52,
  'NHL': 6.0,
  'MLB': 8.5,
}

// How much pace affects player stats (per 10% change in game total)
// e.g., if game total is 10% above average, multiply player projection by this factor
const PACE_SENSITIVITY: Record<string, Record<string, number>> = {
  'NBA': {
    'points': 0.08,       // 8% more points per 10% pace increase
    'rebounds': 0.05,     // 5% more rebounds
    'assists': 0.07,      // 7% more assists
    'threePointersMade': 0.06,
  },
  'NCAAB': {
    'points': 0.08,
    'rebounds': 0.05,
    'assists': 0.07,
    'threePointersMade': 0.06,
  },
  'NFL': {
    'passingYards': 0.10,
    'rushingYards': 0.06,
    'receivingYards': 0.10,
    'passingTouchdowns': 0.08,
    'rushingTouchdowns': 0.05,
    'receivingTouchdowns': 0.08,
  },
  'NCAAF': {
    'passingYards': 0.10,
    'rushingYards': 0.06,
    'receivingYards': 0.10,
    'passingTouchdowns': 0.08,
    'rushingTouchdowns': 0.05,
    'receivingTouchdowns': 0.08,
  },
  'NHL': {
    'goals': 0.12,
    'hockeyAssists': 0.10,
    'shots': 0.08,
    'saves': 0.10,
  },
  'MLB': {
    'hits': 0.06,
    'homeRuns': 0.04,
    'rbis': 0.06,
    'totalBases': 0.06,
    'strikeouts': 0.05,
  },
}

// Position importance for usage calculations
// When a player at this position is out, how much does it affect teammates
const POSITION_USAGE_IMPACT: Record<string, Record<string, number>> = {
  'NBA': {
    'PG': 0.15,   // Point guard out = others handle ball more
    'SG': 0.10,
    'SF': 0.08,
    'PF': 0.08,
    'C': 0.10,
  },
  'NFL': {
    'QB': 0.0,    // QB out changes everything, handled separately
    'RB': 0.12,   // RB out = backup gets more carries
    'WR': 0.10,   // WR out = other WRs get more targets
    'TE': 0.06,
  },
}

// Redis key for prop CLV tracking
const PROP_CLV_KEY = 'prop_clv_records'


// ============================================
// 1. PACE/GAME ENVIRONMENT ADJUSTMENT
// ============================================

/**
 * Get pace adjustment for a specific game
 * Uses ESPN game totals (over/under) to determine expected pace
 */
export async function getPaceAdjustment(
  homeTeam: string,
  awayTeam: string,
  sport: string
): Promise<PaceAdjustment | null> {
  try {
    const espnOdds = await getCachedESPNOdds()
    if (!espnOdds || !espnOdds.games) return null
    
    // Normalize team names for matching
    const normalizeTeam = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const homeNorm = normalizeTeam(homeTeam)
    const awayNorm = normalizeTeam(awayTeam)
    
    // Find the game in ESPN odds
    const game = espnOdds.games.find((g: ESPNOdds) => {
      const gHomeNorm = normalizeTeam(g.homeTeam)
      const gAwayNorm = normalizeTeam(g.awayTeam)
      return (gHomeNorm.includes(homeNorm) || homeNorm.includes(gHomeNorm)) &&
             (gAwayNorm.includes(awayNorm) || awayNorm.includes(gAwayNorm))
    })
    
    if (!game || game.overUnder === null) {
      return null
    }
    
    const gameTotal = game.overUnder
    const leagueAverage = LEAGUE_AVERAGE_TOTALS[sport] || 0
    
    if (leagueAverage === 0) return null
    
    // Calculate pace deviation from league average
    const paceDeviation = (gameTotal - leagueAverage) / leagueAverage
    
    // Base multiplier: 1.0 + (deviation * sensitivity)
    // For a game with 10% higher total, multiplier might be 1.08 for points
    const paceMultiplier = 1.0 + paceDeviation
    
    let paceDescription: string
    if (paceDeviation > 0.05) {
      paceDescription = `High-scoring game expected (O/U ${gameTotal} vs avg ${leagueAverage})`
    } else if (paceDeviation < -0.05) {
      paceDescription = `Low-scoring game expected (O/U ${gameTotal} vs avg ${leagueAverage})`
    } else {
      paceDescription = `Average pace expected (O/U ${gameTotal})`
    }
    
    return {
      gameTotal,
      leagueAverage,
      paceMultiplier,
      paceDescription
    }
  } catch (error) {
    console.error('[getPaceAdjustment] Error:', error)
    return null
  }
}

/**
 * Calculate pace-adjusted projection for a specific stat
 */
export function calculatePaceAdjustedProjection(
  baseProjection: number,
  sport: string,
  statType: string,
  paceAdjustment: PaceAdjustment
): number {
  const sensitivity = PACE_SENSITIVITY[sport]?.[statType] || 0.05
  
  // Calculate the pace effect
  // If game total is 10% above average and sensitivity is 0.08,
  // the adjustment is 0.10 * 0.08 = 0.008 (0.8% increase)
  const paceDeviation = (paceAdjustment.gameTotal - paceAdjustment.leagueAverage) / paceAdjustment.leagueAverage
  const paceEffect = paceDeviation * sensitivity * 10 // Scale by 10 since sensitivity is per 10%
  
  const adjustedProjection = baseProjection * (1 + paceEffect)
  
  return adjustedProjection
}

// ============================================
// 2. PROP CORRELATION ENGINE
// ============================================

/**
 * Get correlated props for same-game parlay analysis
 * Identifies which props tend to hit together or against each other
 */
export function getCorrelatedProps(
  sport: string,
  player1: string,
  stat1: string,
  direction1: 'over' | 'under',
  player2: string,
  stat2: string,
  sameTeam: boolean
): PropCorrelation | null {
  // Same player correlations
  if (player1 === player2) {
    return getSamePlayerCorrelation(sport, stat1, direction1, stat2)
  }
  
  // Same team correlations
  if (sameTeam) {
    return getSameTeamCorrelation(sport, player1, stat1, direction1, player2, stat2)
  }
  
  // Opposing team correlations
  return getOpposingTeamCorrelation(sport, player1, stat1, direction1, player2, stat2)
}

/**
 * Same player prop correlations
 * e.g., Points Over + Assists Over for a star player
 */
function getSamePlayerCorrelation(
  sport: string,
  stat1: string,
  direction1: 'over' | 'under',
  stat2: string
): PropCorrelation | null {
  // Basketball: Points and assists are positively correlated for playmakers
  if (sport === 'NBA' || sport === 'NCAAB') {
    if ((stat1 === 'points' && stat2 === 'assists') || (stat1 === 'assists' && stat2 === 'points')) {
      return {
        prop1: { player: '', stat: stat1, direction: direction1 },
        prop2: { player: '', stat: stat2, direction: direction1 }, // Same direction
        correlationType: 'positive',
        strength: 'moderate',
        reason: 'Playmakers who score more often also create more assists'
      }
    }
    
    // Points and rebounds are weakly correlated
    if ((stat1 === 'points' && stat2 === 'rebounds') || (stat1 === 'rebounds' && stat2 === 'points')) {
      return {
        prop1: { player: '', stat: stat1, direction: direction1 },
        prop2: { player: '', stat: stat2, direction: direction1 },
        correlationType: 'positive',
        strength: 'weak',
        reason: 'More playing time leads to more of both stats'
      }
    }
  }
  
  // Football: Passing yards and TDs are correlated
  if (sport === 'NFL' || sport === 'NCAAF') {
    if ((stat1 === 'passingYards' && stat2 === 'passingTouchdowns') || 
        (stat1 === 'passingTouchdowns' && stat2 === 'passingYards')) {
      return {
        prop1: { player: '', stat: stat1, direction: direction1 },
        prop2: { player: '', stat: stat2, direction: direction1 },
        correlationType: 'positive',
        strength: 'strong',
        reason: 'More passing yards typically means more TD opportunities'
      }
    }
  }
  
  return null
}

/**
 * Same team prop correlations
 * e.g., QB passing yards and WR receiving yards
 */
function getSameTeamCorrelation(
  sport: string,
  player1: string,
  stat1: string,
  direction1: 'over' | 'under',
  player2: string,
  stat2: string
): PropCorrelation | null {
  // Football: QB passing and WR/TE receiving are strongly correlated
  if (sport === 'NFL' || sport === 'NCAAF') {
    if (stat1 === 'passingYards' && stat2 === 'receivingYards') {
      return {
        prop1: { player: player1, stat: stat1, direction: direction1 },
        prop2: { player: player2, stat: stat2, direction: direction1 },
        correlationType: 'positive',
        strength: 'strong',
        reason: 'QB passing yards directly feed into WR receiving yards'
      }
    }
    
    // Two WRs on same team: negative correlation (competing for targets)
    if (stat1 === 'receivingYards' && stat2 === 'receivingYards') {
      return {
        prop1: { player: player1, stat: stat1, direction: direction1 },
        prop2: { player: player2, stat: stat2, direction: direction1 === 'over' ? 'under' : 'over' },
        correlationType: 'negative',
        strength: 'moderate',
        reason: 'WRs on same team compete for targets'
      }
    }
  }
  
  // Basketball: Two scorers on same team have weak negative correlation
  if (sport === 'NBA' || sport === 'NCAAB') {
    if (stat1 === 'points' && stat2 === 'points') {
      return {
        prop1: { player: player1, stat: stat1, direction: direction1 },
        prop2: { player: player2, stat: stat2, direction: direction1 === 'over' ? 'under' : 'over' },
        correlationType: 'negative',
        strength: 'weak',
        reason: 'Scorers on same team share shot attempts'
      }
    }
  }
  
  return null
}

/**
 * Opposing team prop correlations
 * e.g., High-scoring game benefits both teams' players
 */
function getOpposingTeamCorrelation(
  sport: string,
  player1: string,
  stat1: string,
  direction1: 'over' | 'under',
  player2: string,
  stat2: string
): PropCorrelation | null {
  // High-scoring games benefit scorers on both teams
  if ((sport === 'NBA' || sport === 'NCAAB') && stat1 === 'points' && stat2 === 'points') {
    return {
      prop1: { player: player1, stat: stat1, direction: direction1 },
      prop2: { player: player2, stat: stat2, direction: direction1 },
      correlationType: 'positive',
      strength: 'moderate',
      reason: 'High-scoring games benefit scorers on both teams'
    }
  }
  
  // Goalie saves vs opposing shots
  if (sport === 'NHL') {
    if ((stat1 === 'saves' && stat2 === 'shots') || (stat1 === 'shots' && stat2 === 'saves')) {
      return {
        prop1: { player: player1, stat: stat1, direction: direction1 },
        prop2: { player: player2, stat: stat2, direction: direction1 },
        correlationType: 'positive',
        strength: 'strong',
        reason: 'More shots against means more save opportunities'
      }
    }
  }
  
  return null
}

/**
 * Analyze a same-game parlay for correlations
 * Returns warnings and recommendations
 */
export function analyzePropParlay(
  props: Array<{ player: string; stat: string; direction: 'over' | 'under'; team: string }>
): { correlations: PropCorrelation[]; warnings: string[]; recommendation: string } {
  const correlations: PropCorrelation[] = []
  const warnings: string[] = []
  
  // Check all pairs of props
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      const prop1 = props[i]
      const prop2 = props[j]
      const sameTeam = prop1.team === prop2.team
      
      // For now, assume NBA for correlation analysis
      const correlation = getCorrelatedProps(
        'NBA',
        prop1.player,
        prop1.stat,
        prop1.direction,
        prop2.player,
        prop2.stat,
        sameTeam
      )
      
      if (correlation) {
        correlations.push(correlation)
        
        // Check for conflicting directions
        if (correlation.correlationType === 'positive' && prop1.direction !== prop2.direction) {
          warnings.push(`${prop1.player} ${prop1.stat} ${prop1.direction} conflicts with ${prop2.player} ${prop2.stat} ${prop2.direction} - these are positively correlated`)
        }
        if (correlation.correlationType === 'negative' && prop1.direction === prop2.direction) {
          warnings.push(`${prop1.player} ${prop1.stat} and ${prop2.player} ${prop2.stat} are negatively correlated - consider opposite directions`)
        }
      }
    }
  }
  
  let recommendation: string
  if (warnings.length === 0) {
    recommendation = 'Parlay looks good - no conflicting correlations detected'
  } else if (warnings.length === 1) {
    recommendation = 'Minor correlation concern - consider adjusting one leg'
  } else {
    recommendation = 'Multiple correlation conflicts - this parlay has reduced probability'
  }
  
  return { correlations, warnings, recommendation }
}

// ============================================
// 3. MINUTES/USAGE PROJECTION
// ============================================

/**
 * Calculate usage adjustment based on teammate injuries
 * When a key player is out, others get more minutes/usage
 */
export async function getUsageAdjustment(
  sport: string,
  playerTeam: string,
  playerPosition?: string
): Promise<UsageAdjustment | null> {
  try {
    const espnData = await getCachedESPNData()
    if (!espnData || !espnData.games) return null
    
    // Find the game for this player's team
    const normalizeTeam = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const teamNorm = normalizeTeam(playerTeam)
    
    const game = espnData.games.find(g => {
      const homeNorm = normalizeTeam(g.homeTeam.name)
      const awayNorm = normalizeTeam(g.awayTeam.name)
      return homeNorm.includes(teamNorm) || teamNorm.includes(homeNorm) ||
             awayNorm.includes(teamNorm) || teamNorm.includes(awayNorm)
    })
    
    if (!game) return null
    
    // Get injuries for this team
    const teamInjuries = game.injuries.filter((inj: ESPNInjury) => {
      const injTeamNorm = normalizeTeam(inj.team)
      return injTeamNorm.includes(teamNorm) || teamNorm.includes(injTeamNorm)
    })
    
    // Filter to OUT players only
    const outPlayers = teamInjuries.filter((inj: ESPNInjury) => 
      inj.status.toLowerCase() === 'out' || 
      inj.status.toLowerCase().includes('out for')
    )
    
    if (outPlayers.length === 0) {
      return {
        usageMultiplier: 1.0,
        description: 'No significant injuries affecting usage',
        injuredTeammates: []
      }
    }
    
    // Calculate usage boost based on who's out
    let usageBoost = 0
    const injuredNames: string[] = []
    
    for (const injury of outPlayers) {
      injuredNames.push(injury.player)
      
      // Estimate position impact based on injured player's position
      const positionImpact = POSITION_USAGE_IMPACT[sport] || {}
      
      // If we know the player's position, use position-specific impact
      // Otherwise use average impact across all positions
      let impact = 0.08 // Default
      if (playerPosition && positionImpact[playerPosition]) {
        impact = positionImpact[playerPosition]
      } else {
        const impacts = Object.values(positionImpact)
        impact = impacts.length > 0 ? impacts.reduce((a, b) => a + b, 0) / impacts.length : 0.08
      }
      
      usageBoost += impact
    }
    
    // Cap usage boost at 25%
    usageBoost = Math.min(usageBoost, 0.25)
    
    const usageMultiplier = 1.0 + usageBoost
    
    return {
      usageMultiplier,
      description: `${outPlayers.length} teammate(s) OUT: ${injuredNames.join(', ')}`,
      injuredTeammates: injuredNames
    }
  } catch (error) {
    console.error('[getUsageAdjustment] Error:', error)
    return null
  }
}

// ============================================
// 4. PROP CLV TRACKING
// ============================================

/**
 * Store a prop pick for CLV tracking
 */
export async function storePropCLVRecord(
  record: Omit<PropCLVRecord, 'id' | 'closingLine' | 'closingOdds' | 'closingTimestamp' | 'lineCLV' | 'actualResult' | 'outcome'>
): Promise<PropCLVRecord | null> {
  if (!isDbConfigured()) return null
  
  const id = `${record.playerName}_${record.statType}_${record.line}_${Date.now()}`
  
  const fullRecord: PropCLVRecord = {
    ...record,
    id,
    closingLine: null,
    closingOdds: null,
    closingTimestamp: null,
    lineCLV: null,
    actualResult: null,
    outcome: 'pending'
  }
  
  try {
    await kvHset(PROP_CLV_KEY, id, JSON.stringify(fullRecord))
    console.log(`[PropCLV] Stored: ${record.playerName} ${record.statType} ${record.direction} ${record.line}`)
    return fullRecord
  } catch (error) {
    console.error('[PropCLV] Error storing record:', error)
    return null
  }
}

/**
 * Update a prop record with closing line
 */
export async function updatePropClosingLine(
  recordId: string,
  closingLine: number,
  closingOdds: number
): Promise<PropCLVRecord | null> {
  if (!isDbConfigured()) return null
  
  try {
    const recordData = await kvHget(PROP_CLV_KEY, recordId)
    if (!recordData) return null
    
    const record: PropCLVRecord = JSON.parse(recordData)
    
    // Calculate line CLV
    // If we picked Over 24.5 and it closed at 25.5, we have +1.0 CLV (line moved in our favor)
    // If we picked Under 24.5 and it closed at 23.5, we have +1.0 CLV
    let lineCLV: number
    if (record.direction === 'over') {
      lineCLV = closingLine - record.line // Higher closing = better for over
    } else {
      lineCLV = record.line - closingLine // Lower closing = better for under
    }
    
    const updatedRecord: PropCLVRecord = {
      ...record,
      closingLine,
      closingOdds,
      closingTimestamp: new Date().toISOString(),
      lineCLV
    }
    
    await kvHset(PROP_CLV_KEY, recordId, JSON.stringify(updatedRecord))
    console.log(`[PropCLV] Updated closing: ${record.playerName} ${record.line} → ${closingLine} (CLV: ${lineCLV > 0 ? '+' : ''}${lineCLV})`)
    
    return updatedRecord
  } catch (error) {
    console.error('[PropCLV] Error updating closing line:', error)
    return null
  }
}

/**
 * Update a prop record with outcome
 */
export async function updatePropOutcome(
  recordId: string,
  actualResult: number
): Promise<PropCLVRecord | null> {
  if (!isDbConfigured()) return null
  
  try {
    const recordData = await kvHget(PROP_CLV_KEY, recordId)
    if (!recordData) return null
    
    const record: PropCLVRecord = JSON.parse(recordData)
    
    // Determine outcome
    let outcome: 'hit' | 'miss' | 'push'
    if (actualResult === record.line) {
      outcome = 'push'
    } else if (record.direction === 'over') {
      outcome = actualResult > record.line ? 'hit' : 'miss'
    } else {
      outcome = actualResult < record.line ? 'hit' : 'miss'
    }
    
    const updatedRecord: PropCLVRecord = {
      ...record,
      actualResult,
      outcome
    }
    
    await kvHset(PROP_CLV_KEY, recordId, JSON.stringify(updatedRecord))
    return updatedRecord
  } catch (error) {
    console.error('[PropCLV] Error updating outcome:', error)
    return null
  }
}

/**
 * Get all prop CLV records
 */
export async function getAllPropCLVRecords(): Promise<PropCLVRecord[]> {
  if (!isDbConfigured()) return []
  
  try {
    const allRecords = await kvHgetall(PROP_CLV_KEY)
    if (!allRecords) return []
    
    return Object.values(allRecords).map(r => JSON.parse(r) as PropCLVRecord)
  } catch (error) {
    console.error('[PropCLV] Error getting records:', error)
    return []
  }
}

/**
 * Calculate prop CLV statistics
 */
export async function calculatePropCLVStats(): Promise<PropCLVStats> {
  const records = await getAllPropCLVRecords()
  
  const stats: PropCLVStats = {
    totalProps: records.length,
    propsWithCLV: 0,
    averageLineCLV: 0,
    positiveLineCLVRate: 0,
    hitRate: 0,
    expectedHitRate: 0,
    byStat: {},
    bySport: {}
  }
  
  if (records.length === 0) return stats
  
  // Records with CLV data
  const recordsWithCLV = records.filter(r => r.lineCLV !== null)
  stats.propsWithCLV = recordsWithCLV.length
  
  if (recordsWithCLV.length > 0) {
    const totalCLV = recordsWithCLV.reduce((sum, r) => sum + (r.lineCLV || 0), 0)
    const positiveCLVCount = recordsWithCLV.filter(r => (r.lineCLV || 0) > 0).length
    
    stats.averageLineCLV = totalCLV / recordsWithCLV.length
    stats.positiveLineCLVRate = positiveCLVCount / recordsWithCLV.length
  }
  
  // Completed records
  const completedRecords = records.filter(r => r.outcome !== 'pending')
  if (completedRecords.length > 0) {
    const hits = completedRecords.filter(r => r.outcome === 'hit').length
    stats.hitRate = hits / completedRecords.length
    
    const expectedHits = completedRecords.reduce((sum, r) => sum + r.pickProbability, 0)
    stats.expectedHitRate = expectedHits / completedRecords.length
  }
  
  // By stat type
  const statGroups = new Map<string, PropCLVRecord[]>()
  for (const record of records) {
    const existing = statGroups.get(record.statType) || []
    existing.push(record)
    statGroups.set(record.statType, existing)
  }
  
  for (const [stat, statRecords] of Array.from(statGroups.entries())) {
    const withCLV = statRecords.filter(r => r.lineCLV !== null)
    const completed = statRecords.filter(r => r.outcome !== 'pending')
    const hits = completed.filter(r => r.outcome === 'hit').length
    
    stats.byStat[stat] = {
      props: statRecords.length,
      avgCLV: withCLV.length > 0 ? withCLV.reduce((sum, r) => sum + (r.lineCLV || 0), 0) / withCLV.length : 0,
      hitRate: completed.length > 0 ? hits / completed.length : 0
    }
  }
  
  // By sport
  const sportGroups = new Map<string, PropCLVRecord[]>()
  for (const record of records) {
    const existing = sportGroups.get(record.sport) || []
    existing.push(record)
    sportGroups.set(record.sport, existing)
  }
  
  for (const [sport, sportRecords] of Array.from(sportGroups.entries())) {
    const withCLV = sportRecords.filter(r => r.lineCLV !== null)
    const completed = sportRecords.filter(r => r.outcome !== 'pending')
    const hits = completed.filter(r => r.outcome === 'hit').length
    
    stats.bySport[sport] = {
      props: sportRecords.length,
      avgCLV: withCLV.length > 0 ? withCLV.reduce((sum, r) => sum + (r.lineCLV || 0), 0) / withCLV.length : 0,
      hitRate: completed.length > 0 ? hits / completed.length : 0
    }
  }
  
  return stats
}

/**
 * Format prop CLV stats for display
 */
export function formatPropCLVStats(stats: PropCLVStats): string {
  const lines: string[] = [
    'PLAYER PROP CLV REPORT',
    '======================',
    '',
    `Total Props Tracked: ${stats.totalProps}`,
    `Props with CLV Data: ${stats.propsWithCLV}`,
    ''
  ]
  
  if (stats.propsWithCLV > 0) {
    lines.push('CLV PERFORMANCE:')
    lines.push(`  Average Line CLV: ${stats.averageLineCLV > 0 ? '+' : ''}${stats.averageLineCLV.toFixed(2)} points`)
    lines.push(`  Positive CLV Rate: ${(stats.positiveLineCLVRate * 100).toFixed(1)}%`)
    lines.push('')
  }
  
  if (stats.hitRate > 0) {
    lines.push('HIT RATE:')
    lines.push(`  Actual: ${(stats.hitRate * 100).toFixed(1)}%`)
    lines.push(`  Expected: ${(stats.expectedHitRate * 100).toFixed(1)}%`)
    lines.push(`  Edge: ${((stats.hitRate - stats.expectedHitRate) * 100).toFixed(1)}%`)
    lines.push('')
  }
  
  if (Object.keys(stats.byStat).length > 0) {
    lines.push('BY STAT TYPE:')
    for (const [stat, data] of Object.entries(stats.byStat)) {
      lines.push(`  ${stat}: ${data.avgCLV > 0 ? '+' : ''}${data.avgCLV.toFixed(2)} CLV, ${(data.hitRate * 100).toFixed(0)}% hit rate (${data.props} props)`)
    }
    lines.push('')
  }
  
  if (Object.keys(stats.bySport).length > 0) {
    lines.push('BY SPORT:')
    for (const [sport, data] of Object.entries(stats.bySport)) {
      lines.push(`  ${sport}: ${data.avgCLV > 0 ? '+' : ''}${data.avgCLV.toFixed(2)} CLV, ${(data.hitRate * 100).toFixed(0)}% hit rate (${data.props} props)`)
    }
  }
  
  return lines.join('\n')
}

// ============================================
// 5. PROP LINE MOVEMENT TRACKING
// ============================================

const PROP_SNAPSHOTS_KEY = 'betanalytics:prop_line_snapshots'

export interface PropLineSnapshot {
  playerName: string
  market: string
  line: number
  overOdds: number
  underOdds: number
  bookmaker: string
  timestamp: string
}

export interface PropLineMovement {
  playerName: string
  market: string
  opening: { line: number; overOdds: number; underOdds: number; timestamp: string }
  current: { line: number; overOdds: number; underOdds: number; timestamp: string }
  lineChange: number
  overOddsChange: number
  underOddsChange: number
  direction: 'over' | 'under' | 'neutral'
  magnitude: 'steam' | 'significant' | 'minor' | 'none'
  sharpSignal: boolean
}

export async function storePropLineSnapshots(
  props: Array<{ playerName: string; market: string; line: number; overOdds: number; underOdds: number; bookmaker: string }>
): Promise<void> {
  if (!isDbConfigured()) return

  const timestamp = new Date().toISOString()
  const snapshots: PropLineSnapshot[] = props.map(p => ({
    ...p,
    timestamp,
  }))

  try {
    let allSnapshots: PropLineSnapshot[] = []
    const existing = await kvGet(PROP_SNAPSHOTS_KEY)
    if (existing) {
      try { allSnapshots = JSON.parse(existing) } catch { /* empty */ }
    }

    allSnapshots.push(...snapshots)

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    allSnapshots = allSnapshots.filter(s => s.timestamp > cutoff)

    await kvSet(PROP_SNAPSHOTS_KEY, JSON.stringify(allSnapshots), 172800)

    console.log(`[PropLineMovement] Stored ${snapshots.length} prop snapshots`)
  } catch (error) {
    console.error('[PropLineMovement] Error storing snapshots:', error)
  }
}

/**
 * Fetch all line movements in a single Redis call and return a Map keyed by "playerName_lower|market".
 * Use this in batch scoring loops to avoid N+1 Redis calls.
 */
export async function getAllLineMovements(): Promise<Map<string, PropLineMovement[]>> {
  const result = new Map<string, PropLineMovement[]>()
  if (!isDbConfigured()) return result

  try {
    const raw = await kvGet(PROP_SNAPSHOTS_KEY)
    if (!raw) return result

    let allSnapshots: PropLineSnapshot[]
    try { allSnapshots = JSON.parse(raw) } catch { return result }

    // Group snapshots by player+market
    const byPlayerMarket = new Map<string, PropLineSnapshot[]>()
    for (const snap of allSnapshots) {
      const key = `${snap.playerName}_${snap.market}`
      const existing = byPlayerMarket.get(key) || []
      existing.push(snap)
      byPlayerMarket.set(key, existing)
    }

    // Compute movements for each group
    for (const [, snaps] of Array.from(byPlayerMarket.entries())) {
      snaps.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      if (snaps.length < 2) continue

      const opening = snaps[0]
      const current = snaps[snaps.length - 1]

      const lineChange = current.line - opening.line
      const overOddsChange = current.overOdds - opening.overOdds
      const underOddsChange = current.underOdds - opening.underOdds

      let direction: PropLineMovement['direction'] = 'neutral'
      if (lineChange > 0 || (lineChange === 0 && overOddsChange < -10)) {
        direction = 'over'
      } else if (lineChange < 0 || (lineChange === 0 && underOddsChange < -10)) {
        direction = 'under'
      }

      let magnitude: PropLineMovement['magnitude'] = 'none'
      const absLineChange = Math.abs(lineChange)
      const absOddsChange = Math.max(Math.abs(overOddsChange), Math.abs(underOddsChange))
      if (absLineChange >= 1.5 || absOddsChange >= 30) {
        magnitude = 'steam'
      } else if (absLineChange >= 1.0 || absOddsChange >= 20) {
        magnitude = 'significant'
      } else if (absLineChange >= 0.5 || absOddsChange >= 10) {
        magnitude = 'minor'
      }

      const timeDiffMs = new Date(current.timestamp).getTime() - new Date(opening.timestamp).getTime()
      const timeDiffHrs = timeDiffMs / (1000 * 60 * 60)
      const sharpSignal = magnitude === 'steam' || (magnitude === 'significant' && timeDiffHrs < 4)

      const movement: PropLineMovement = {
        playerName: opening.playerName,
        market: opening.market,
        opening: { line: opening.line, overOdds: opening.overOdds, underOdds: opening.underOdds, timestamp: opening.timestamp },
        current: { line: current.line, overOdds: current.overOdds, underOdds: current.underOdds, timestamp: current.timestamp },
        lineChange,
        overOddsChange,
        underOddsChange,
        direction,
        magnitude,
        sharpSignal,
      }

      // Index by normalized player name + market for fast lookup
      const lookupKey = `${opening.playerName.toLowerCase()}|${opening.market}`
      const existing = result.get(lookupKey) || []
      existing.push(movement)
      result.set(lookupKey, existing)
    }

    console.log(`[PropLineMovement] Loaded ${result.size} player-market movement entries in single fetch`)
    return result
  } catch (error) {
    console.error('[PropLineMovement] Error loading all movements:', error)
    return result
  }
}

/**
 * Look up line movements for a specific player+market from a pre-fetched movements map.
 * Falls back to empty array if not found.
 */
export function lookupLineMovement(
  allMovements: Map<string, PropLineMovement[]>,
  playerName: string,
  market?: string
): PropLineMovement[] {
  if (allMovements.size === 0) return []
  
  const normalizedName = playerName.toLowerCase()
  
  // Direct lookup by player+market
  if (market) {
    const direct = allMovements.get(`${normalizedName}|${market}`)
    if (direct) return direct
  }
  
  // Fuzzy search across all entries for this player
  const results: PropLineMovement[] = []
  for (const [key, movements] of Array.from(allMovements.entries())) {
    const [keyName] = key.split('|')
    if (keyName.includes(normalizedName) || normalizedName.includes(keyName)) {
      if (!market || movements.some(m => m.market === market)) {
        results.push(...(market ? movements.filter(m => m.market === market) : movements))
      }
    }
  }
  return results
}

export async function getPropLineMovement(
  playerName: string,
  market?: string
): Promise<PropLineMovement[]> {
  if (!isDbConfigured()) return []

  try {
    const raw = await kvGet(PROP_SNAPSHOTS_KEY)
    if (!raw) return []

    let allSnapshots: PropLineSnapshot[]
    try { allSnapshots = JSON.parse(raw) } catch { return [] }

    const normalizedName = playerName.toLowerCase()
    const playerSnapshots = allSnapshots.filter(s =>
      s.playerName.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(s.playerName.toLowerCase())
    )

    if (playerSnapshots.length === 0) return []

    const byMarket = new Map<string, PropLineSnapshot[]>()
    for (const snap of playerSnapshots) {
      if (market && snap.market !== market) continue
      const key = `${snap.playerName}_${snap.market}`
      const existing = byMarket.get(key) || []
      existing.push(snap)
      byMarket.set(key, existing)
    }

    const movements: PropLineMovement[] = []

    for (const [, snaps] of Array.from(byMarket.entries())) {
      snaps.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      if (snaps.length < 2) continue

      const opening = snaps[0]
      const current = snaps[snaps.length - 1]

      const lineChange = current.line - opening.line
      const overOddsChange = current.overOdds - opening.overOdds
      const underOddsChange = current.underOdds - opening.underOdds

      let direction: PropLineMovement['direction'] = 'neutral'
      if (lineChange > 0 || (lineChange === 0 && overOddsChange < -10)) {
        direction = 'over'
      } else if (lineChange < 0 || (lineChange === 0 && underOddsChange < -10)) {
        direction = 'under'
      }

      let magnitude: PropLineMovement['magnitude'] = 'none'
      const absLineChange = Math.abs(lineChange)
      const absOddsChange = Math.max(Math.abs(overOddsChange), Math.abs(underOddsChange))
      if (absLineChange >= 1.5 || absOddsChange >= 30) {
        magnitude = 'steam'
      } else if (absLineChange >= 1.0 || absOddsChange >= 20) {
        magnitude = 'significant'
      } else if (absLineChange >= 0.5 || absOddsChange >= 10) {
        magnitude = 'minor'
      }

      const timeDiffMs = new Date(current.timestamp).getTime() - new Date(opening.timestamp).getTime()
      const timeDiffHrs = timeDiffMs / (1000 * 60 * 60)
      const sharpSignal = magnitude === 'steam' || (magnitude === 'significant' && timeDiffHrs < 4)

      movements.push({
        playerName: opening.playerName,
        market: opening.market,
        opening: { line: opening.line, overOdds: opening.overOdds, underOdds: opening.underOdds, timestamp: opening.timestamp },
        current: { line: current.line, overOdds: current.overOdds, underOdds: current.underOdds, timestamp: current.timestamp },
        lineChange,
        overOddsChange,
        underOddsChange,
        direction,
        magnitude,
        sharpSignal,
      })
    }

    return movements
  } catch (error) {
    console.error('[PropLineMovement] Error getting movements:', error)
    return []
  }
}

export function formatPropLineMovement(movements: PropLineMovement[]): string {
  if (movements.length === 0) return ''

  const lines: string[] = ['LINE MOVEMENT:']
  for (const m of movements) {
    if (m.magnitude === 'none') continue

    const lineStr = m.lineChange !== 0
      ? `Line: ${m.opening.line} → ${m.current.line} (${m.lineChange > 0 ? '+' : ''}${m.lineChange})`
      : `Line: ${m.current.line} (no change)`

    const oddsStr = `Over odds: ${m.opening.overOdds > 0 ? '+' : ''}${m.opening.overOdds} → ${m.current.overOdds > 0 ? '+' : ''}${m.current.overOdds}`

    let signal = ''
    if (m.sharpSignal) signal = ' [SHARP MONEY]'
    else if (m.magnitude === 'steam') signal = ' [STEAM MOVE]'
    else if (m.magnitude === 'significant') signal = ' [SIGNIFICANT]'

    lines.push(`  ${m.market}: ${lineStr} | ${oddsStr}${signal}`)

    if (m.sharpSignal) {
      lines.push(`    → Sharp action detected moving line ${m.direction === 'over' ? 'UP (favor over)' : m.direction === 'under' ? 'DOWN (favor under)' : 'sideways'}`)
    }
  }

  return lines.length > 1 ? lines.join('\n') : ''
}
