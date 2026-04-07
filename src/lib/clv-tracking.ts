/**
 * Closing Line Value (CLV) Tracking Module
 * 
 * CLV is the gold standard for measuring betting skill. It tracks:
 * 1. What line was recommended at the time of the pick
 * 2. What the line closed at (final line before game starts)
 * 3. The difference (CLV) - positive CLV means you beat the market
 * 
 * Professional bettors consistently beating CLV indicates real edge.
 * This module stores picks with their lines and calculates CLV metrics.
 */

import { kvHset, kvHget, kvHgetall, isDbConfigured } from '@/lib/pg-kv'

// ============================================
// TYPES
// ============================================

export interface CLVPick {
  id: string                    // Unique pick ID
  gameId: string                // Game identifier
  sport: string                 // Sport key
  betType: 'spread' | 'moneyline' | 'total' | 'prop'
  team: string                  // Team or player name
  
  // Line at time of pick
  pickLine: number              // The spread/total at pick time (e.g., -3.5)
  pickPrice: number             // The odds at pick time (e.g., -110)
  pickProbability: number       // Our model's probability at pick time
  
  // Closing line (filled in later)
  closingLine: number | null    // The spread/total at game start
  closingPrice: number | null   // The odds at game start
  
  // CLV calculation
  clvPoints: number | null      // Line movement in our favor (positive = good)
  clvPercentage: number | null  // CLV as percentage
  
  // Metadata
  pickTimestamp: string         // When the pick was made
  gameTimestamp: string         // When the game starts
  closingTimestamp: string | null // When closing line was recorded
  
  // Outcome (filled in after game)
  outcome: 'win' | 'loss' | 'push' | 'pending'
  actualResult: number | null   // Actual margin/total
}

export interface CLVStats {
  totalPicks: number
  picksWithCLV: number          // Picks where we have closing line data
  
  // CLV metrics
  averageCLV: number            // Average CLV in points
  positiveCLVRate: number       // % of picks that beat closing line
  totalCLVPoints: number        // Sum of all CLV
  
  // By bet type
  spreadCLV: { picks: number; avgCLV: number; positiveRate: number }
  moneylineCLV: { picks: number; avgCLV: number; positiveRate: number }
  totalCLV: { picks: number; avgCLV: number; positiveRate: number }
  
  // By sport
  bySport: Record<string, { picks: number; avgCLV: number; positiveRate: number }>
  
  // Win rate comparison
  actualWinRate: number         // Actual win rate
  expectedWinRate: number       // Expected based on closing line
  winRateEdge: number           // Difference (positive = outperforming)
}

// Redis keys
const CLV_PICKS_KEY = 'clv:picks'

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Store a new pick for CLV tracking
 */
export async function storeCLVPick(pick: Omit<CLVPick, 'id' | 'closingLine' | 'closingPrice' | 'clvPoints' | 'clvPercentage' | 'closingTimestamp' | 'outcome' | 'actualResult'>): Promise<CLVPick | null> {
  if (!isDbConfigured()) return null
  
  const id = `${pick.gameId}_${pick.team}_${pick.betType}_${Date.now()}`
  
  const fullPick: CLVPick = {
    ...pick,
    id,
    closingLine: null,
    closingPrice: null,
    clvPoints: null,
    clvPercentage: null,
    closingTimestamp: null,
    outcome: 'pending',
    actualResult: null
  }
  
  try {
    await kvHset(CLV_PICKS_KEY, id, JSON.stringify(fullPick))
    console.log(`[CLV] Stored pick: ${pick.team} ${pick.betType} at ${pick.pickLine}`)
    return fullPick
  } catch (error) {
    console.error('[CLV] Error storing pick:', error)
    return null
  }
}

/**
 * Update a pick with closing line data
 */
export async function updateClosingLine(
  pickId: string,
  closingLine: number,
  closingPrice: number
): Promise<CLVPick | null> {
  if (!isDbConfigured()) return null
  
  try {
    const pickData = await kvHget(CLV_PICKS_KEY, pickId)
    if (!pickData) {
      console.warn(`[CLV] Pick not found: ${pickId}`)
      return null
    }
    
    const pick: CLVPick = JSON.parse(pickData)
    
    // Calculate CLV
    // For spreads: if we got -3.5 and it closed at -5, we have +1.5 CLV
    // For totals: if we got Over 220 and it closed at 224, we have +4 CLV
    const clvPoints = pick.betType === 'moneyline' 
      ? 0 // Moneyline CLV is measured differently (by price movement)
      : closingLine - pick.pickLine
    
    // For spreads, positive CLV means line moved in our favor
    // If we took Team -3.5 and it closed at -5, the market agreed with us
    const clvPercentage = pick.pickLine !== 0 
      ? (clvPoints / Math.abs(pick.pickLine)) * 100
      : 0
    
    const updatedPick: CLVPick = {
      ...pick,
      closingLine,
      closingPrice,
      clvPoints,
      clvPercentage,
      closingTimestamp: new Date().toISOString()
    }
    
    await kvHset(CLV_PICKS_KEY, pickId, JSON.stringify(updatedPick))
    console.log(`[CLV] Updated closing line for ${pickId}: ${pick.pickLine} → ${closingLine} (CLV: ${clvPoints > 0 ? '+' : ''}${clvPoints})`)
    
    return updatedPick
  } catch (error) {
    console.error('[CLV] Error updating closing line:', error)
    return null
  }
}

/**
 * Update a pick with game outcome
 */
export async function updatePickOutcome(
  pickId: string,
  outcome: 'win' | 'loss' | 'push',
  actualResult: number
): Promise<CLVPick | null> {
  if (!isDbConfigured()) return null
  
  try {
    const pickData = await kvHget(CLV_PICKS_KEY, pickId)
    if (!pickData) return null
    
    const pick: CLVPick = JSON.parse(pickData)
    const updatedPick: CLVPick = {
      ...pick,
      outcome,
      actualResult
    }
    
    await kvHset(CLV_PICKS_KEY, pickId, JSON.stringify(updatedPick))
    return updatedPick
  } catch (error) {
    console.error('[CLV] Error updating outcome:', error)
    return null
  }
}

/**
 * Get all CLV picks
 */
export async function getAllCLVPicks(): Promise<CLVPick[]> {
  if (!isDbConfigured()) return []
  
  try {
    const allPicks = await kvHgetall(CLV_PICKS_KEY)
    if (!allPicks) return []
    
    return Object.values(allPicks).map(p => JSON.parse(p) as CLVPick)
  } catch (error) {
    console.error('[CLV] Error getting picks:', error)
    return []
  }
}

/**
 * Get CLV picks for a specific game
 */
export async function getCLVPicksForGame(gameId: string): Promise<CLVPick[]> {
  const allPicks = await getAllCLVPicks()
  return allPicks.filter(p => p.gameId === gameId)
}

/**
 * Calculate CLV statistics
 */
export async function calculateCLVStats(): Promise<CLVStats> {
  const picks = await getAllCLVPicks()
  
  const stats: CLVStats = {
    totalPicks: picks.length,
    picksWithCLV: 0,
    averageCLV: 0,
    positiveCLVRate: 0,
    totalCLVPoints: 0,
    spreadCLV: { picks: 0, avgCLV: 0, positiveRate: 0 },
    moneylineCLV: { picks: 0, avgCLV: 0, positiveRate: 0 },
    totalCLV: { picks: 0, avgCLV: 0, positiveRate: 0 },
    bySport: {},
    actualWinRate: 0,
    expectedWinRate: 0,
    winRateEdge: 0
  }
  
  if (picks.length === 0) return stats
  
  // Filter picks with CLV data
  const picksWithCLV = picks.filter(p => p.clvPoints !== null)
  stats.picksWithCLV = picksWithCLV.length
  
  if (picksWithCLV.length > 0) {
    // Calculate overall CLV
    const totalCLV = picksWithCLV.reduce((sum, p) => sum + (p.clvPoints || 0), 0)
    const positiveCLVCount = picksWithCLV.filter(p => (p.clvPoints || 0) > 0).length
    
    stats.totalCLVPoints = totalCLV
    stats.averageCLV = totalCLV / picksWithCLV.length
    stats.positiveCLVRate = positiveCLVCount / picksWithCLV.length
    
    // By bet type
    const spreadPicks = picksWithCLV.filter(p => p.betType === 'spread')
    const mlPicks = picksWithCLV.filter(p => p.betType === 'moneyline')
    const totalPicks = picksWithCLV.filter(p => p.betType === 'total')
    
    if (spreadPicks.length > 0) {
      const spreadTotal = spreadPicks.reduce((sum, p) => sum + (p.clvPoints || 0), 0)
      const spreadPositive = spreadPicks.filter(p => (p.clvPoints || 0) > 0).length
      stats.spreadCLV = {
        picks: spreadPicks.length,
        avgCLV: spreadTotal / spreadPicks.length,
        positiveRate: spreadPositive / spreadPicks.length
      }
    }
    
    if (mlPicks.length > 0) {
      stats.moneylineCLV = {
        picks: mlPicks.length,
        avgCLV: 0, // Moneyline CLV measured differently
        positiveRate: 0
      }
    }
    
    if (totalPicks.length > 0) {
      const totalsTotal = totalPicks.reduce((sum, p) => sum + (p.clvPoints || 0), 0)
      const totalsPositive = totalPicks.filter(p => (p.clvPoints || 0) > 0).length
      stats.totalCLV = {
        picks: totalPicks.length,
        avgCLV: totalsTotal / totalPicks.length,
        positiveRate: totalsPositive / totalPicks.length
      }
    }
    
    // By sport
    const sportGroups = new Map<string, CLVPick[]>()
    for (const pick of picksWithCLV) {
      const existing = sportGroups.get(pick.sport) || []
      existing.push(pick)
      sportGroups.set(pick.sport, existing)
    }
    
    for (const [sport, sportPicks] of Array.from(sportGroups.entries())) {
      const sportTotal = sportPicks.reduce((sum, p) => sum + (p.clvPoints || 0), 0)
      const sportPositive = sportPicks.filter(p => (p.clvPoints || 0) > 0).length
      stats.bySport[sport] = {
        picks: sportPicks.length,
        avgCLV: sportTotal / sportPicks.length,
        positiveRate: sportPositive / sportPicks.length
      }
    }
  }
  
  // Win rate analysis
  const completedPicks = picks.filter(p => p.outcome !== 'pending')
  if (completedPicks.length > 0) {
    const wins = completedPicks.filter(p => p.outcome === 'win').length
    stats.actualWinRate = wins / completedPicks.length
    
    // Expected win rate based on our model probabilities
    const expectedWins = completedPicks.reduce((sum, p) => sum + p.pickProbability, 0)
    stats.expectedWinRate = expectedWins / completedPicks.length
    
    stats.winRateEdge = stats.actualWinRate - stats.expectedWinRate
  }
  
  return stats
}

/**
 * Format CLV stats for display
 */
export function formatCLVStatsForDisplay(stats: CLVStats): string {
  const lines: string[] = [
    '📊 CLOSING LINE VALUE (CLV) REPORT',
    '═══════════════════════════════════',
    '',
    `Total Picks Tracked: ${stats.totalPicks}`,
    `Picks with CLV Data: ${stats.picksWithCLV}`,
    ''
  ]
  
  if (stats.picksWithCLV > 0) {
    lines.push('CLV PERFORMANCE:')
    lines.push(`  Average CLV: ${stats.averageCLV > 0 ? '+' : ''}${stats.averageCLV.toFixed(2)} points`)
    lines.push(`  Positive CLV Rate: ${(stats.positiveCLVRate * 100).toFixed(1)}%`)
    lines.push(`  Total CLV Points: ${stats.totalCLVPoints > 0 ? '+' : ''}${stats.totalCLVPoints.toFixed(1)}`)
    lines.push('')
    
    if (stats.spreadCLV.picks > 0) {
      lines.push(`  Spreads: ${stats.spreadCLV.avgCLV > 0 ? '+' : ''}${stats.spreadCLV.avgCLV.toFixed(2)} avg CLV (${stats.spreadCLV.picks} picks)`)
    }
    if (stats.totalCLV.picks > 0) {
      lines.push(`  Totals: ${stats.totalCLV.avgCLV > 0 ? '+' : ''}${stats.totalCLV.avgCLV.toFixed(2)} avg CLV (${stats.totalCLV.picks} picks)`)
    }
    lines.push('')
    
    lines.push('BY SPORT:')
    for (const [sport, sportStats] of Object.entries(stats.bySport)) {
      lines.push(`  ${sport}: ${sportStats.avgCLV > 0 ? '+' : ''}${sportStats.avgCLV.toFixed(2)} avg CLV, ${(sportStats.positiveRate * 100).toFixed(0)}% positive (${sportStats.picks} picks)`)
    }
    lines.push('')
  }
  
  if (stats.actualWinRate > 0) {
    lines.push('WIN RATE ANALYSIS:')
    lines.push(`  Actual Win Rate: ${(stats.actualWinRate * 100).toFixed(1)}%`)
    lines.push(`  Expected Win Rate: ${(stats.expectedWinRate * 100).toFixed(1)}%`)
    lines.push(`  Edge: ${stats.winRateEdge > 0 ? '+' : ''}${(stats.winRateEdge * 100).toFixed(1)}%`)
  }
  
  return lines.join('\n')
}

/**
 * Get CLV interpretation
 */
export function interpretCLV(avgCLV: number, positiveCLVRate: number): string {
  if (positiveCLVRate >= 0.55 && avgCLV > 0.5) {
    return 'EXCELLENT - You are consistently beating the closing line. This indicates real edge over the market.'
  } else if (positiveCLVRate >= 0.50 && avgCLV > 0) {
    return 'GOOD - You are beating the closing line more often than not. Continue tracking to confirm edge.'
  } else if (positiveCLVRate >= 0.45) {
    return 'NEUTRAL - Your CLV is close to break-even. The model may need calibration.'
  } else {
    return 'NEEDS IMPROVEMENT - You are not consistently beating the closing line. Consider adjusting the model.'
  }
}
