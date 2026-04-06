/**
 * Line Movement Tracking Module
 * 
 * Tracks odds changes over time by storing snapshots in Redis/KV.
 * This allows us to show:
 * - Opening lines vs current lines
 * - Line movement direction and magnitude
 * - Sharp money indicators (reverse line movement)
 * 
 * Snapshots are taken 6x daily via cron job (Vercel Pro required)
 */

import type { Game } from './odds'
import { kvGet, kvSet, isDbConfigured } from '@/lib/pg-kv'

// Redis cache keys for line movement
const SNAPSHOTS_KEY = 'betanalytics:line_movement:snapshots'
const OPENING_LINES_KEY = 'betanalytics:line_movement:opening'

// Types for line movement tracking
export interface OddsSnapshot {
  gameId: string
  sport: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  timestamp: string
  spreads: {
    bookmaker: string
    homeSpread: number
    homePrice: number
    awaySpread: number
    awayPrice: number
  }[]
  totals: {
    bookmaker: string
    total: number
    overPrice: number
    underPrice: number
  }[]
  moneylines: {
    bookmaker: string
    homePrice: number
    awayPrice: number
  }[]
}

export interface LineMovement {
  gameId: string
  sport: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  opening: {
    spread?: { line: number; price: number }
    total?: { line: number; overPrice: number; underPrice: number }
    homeML?: number
    awayML?: number
    timestamp: string
  }
  current: {
    spread?: { line: number; price: number }
    total?: { line: number; overPrice: number; underPrice: number }
    homeML?: number
    awayML?: number
    timestamp: string
  }
  movement: {
    spreadChange?: number
    totalChange?: number
    homeMLChange?: number
    awayMLChange?: number
    direction: 'home' | 'away' | 'over' | 'under' | 'neutral'
    magnitude: 'small' | 'medium' | 'large'
    sharpIndicator: boolean // True if line moved opposite to public betting
  }
}

/**
 * Store a snapshot of current odds
 * Called by cron job 6x daily
 */
export async function storeOddsSnapshot(games: Game[]): Promise<void> {
  if (!isDbConfigured()) return
  
  const timestamp = new Date().toISOString()
  const snapshots: OddsSnapshot[] = []
  
  for (const game of games) {
    const snapshot: OddsSnapshot = {
      gameId: game.id,
      sport: game.sport,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      timestamp,
      spreads: game.spreads.map(s => {
        const homeOutcome = s.outcomes.find(o => o.name === game.homeTeam)
        const awayOutcome = s.outcomes.find(o => o.name === game.awayTeam)
        return {
          bookmaker: s.bookmaker,
          homeSpread: homeOutcome?.point || 0,
          homePrice: homeOutcome?.price || 0,
          awaySpread: awayOutcome?.point || 0,
          awayPrice: awayOutcome?.price || 0,
        }
      }),
      totals: game.totals.map(t => {
        const over = t.outcomes.find(o => o.name === 'Over')
        const under = t.outcomes.find(o => o.name === 'Under')
        return {
          bookmaker: t.bookmaker,
          total: over?.point || 0,
          overPrice: over?.price || 0,
          underPrice: under?.price || 0,
        }
      }),
      moneylines: game.moneylines.map(m => {
        const home = m.outcomes.find(o => o.name === game.homeTeam)
        const away = m.outcomes.find(o => o.name === game.awayTeam)
        return {
          bookmaker: m.bookmaker,
          homePrice: home?.price || 0,
          awayPrice: away?.price || 0,
        }
      }),
    }
    snapshots.push(snapshot)
  }
  
  try {
    // Get existing snapshots
    let allSnapshots: OddsSnapshot[] = []
    const existing = await kvGet(SNAPSHOTS_KEY)
    if (existing) {
      allSnapshots = JSON.parse(existing)
    }
    
    // Add new snapshots
    allSnapshots.push(...snapshots)
    
    // Keep only last 48 hours of snapshots (to manage storage)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    allSnapshots = allSnapshots.filter(s => s.timestamp > cutoff)
    
    // Save back to Postgres
    await kvSet(SNAPSHOTS_KEY, JSON.stringify(allSnapshots), 72 * 60 * 60)
    
    // Also store opening lines (first snapshot we see for each game)
    await storeOpeningLines(snapshots)
    
    console.log(`[LineMovement] Stored ${snapshots.length} snapshots`)
  } catch (error) {
    console.error('[LineMovement] Error storing snapshots:', error)
  }
}

/**
 * Store opening lines for games we haven't seen before
 */
async function storeOpeningLines(snapshots: OddsSnapshot[]): Promise<void> {
  try {
    // Get existing opening lines
    let openingLines: Record<string, OddsSnapshot> = {}
    const existing = await kvGet(OPENING_LINES_KEY)
    if (existing) {
      openingLines = JSON.parse(existing)
    }
    
    // Add opening lines for new games
    for (const snapshot of snapshots) {
      if (!openingLines[snapshot.gameId]) {
        openingLines[snapshot.gameId] = snapshot
      }
    }
    
    // Clean up old games (games that have already started)
    const now = new Date().toISOString()
    for (const gameId of Object.keys(openingLines)) {
      if (openingLines[gameId].commenceTime < now) {
        delete openingLines[gameId]
      }
    }
    
    // Save back to Postgres
    await kvSet(OPENING_LINES_KEY, JSON.stringify(openingLines), 7 * 24 * 60 * 60)
  } catch (error) {
    console.error('[LineMovement] Error storing opening lines:', error)
  }
}

/**
 * Get line movement data for current games
 */
export async function getLineMovement(currentGames: Game[]): Promise<LineMovement[]> {
  if (!isDbConfigured()) return []
  
  try {
    // Get opening lines
    let openingLines: Record<string, OddsSnapshot> = {}
    const openingData = await kvGet(OPENING_LINES_KEY)
    if (openingData) {
      openingLines = JSON.parse(openingData)
    }
    
    const movements: LineMovement[] = []
    
    for (const game of currentGames) {
      const opening = openingLines[game.id]
      if (!opening) continue // No opening line recorded
      
      // Get consensus spread (DraftKings or first available)
      const currentSpread = game.spreads.find(s => s.bookmaker === 'DraftKings') || game.spreads[0]
      const openingSpread = opening.spreads.find(s => s.bookmaker === 'DraftKings') || opening.spreads[0]
      
      const currentTotal = game.totals.find(t => t.bookmaker === 'DraftKings') || game.totals[0]
      const openingTotal = opening.totals.find(t => t.bookmaker === 'DraftKings') || opening.totals[0]
      
      const currentML = game.moneylines.find(m => m.bookmaker === 'DraftKings') || game.moneylines[0]
      const openingML = opening.moneylines.find(m => m.bookmaker === 'DraftKings') || opening.moneylines[0]
      
      // Calculate movement
      const homeSpreadCurrent = currentSpread?.outcomes.find(o => o.name === game.homeTeam)?.point || 0
      const homeSpreadOpening = openingSpread?.homeSpread || 0
      const spreadChange = homeSpreadCurrent - homeSpreadOpening
      
      const totalCurrent = currentTotal?.outcomes.find(o => o.name === 'Over')?.point || 0
      const totalOpening = openingTotal?.total || 0
      const totalChange = totalCurrent - totalOpening
      
      const homeMLCurrent = currentML?.outcomes.find(o => o.name === game.homeTeam)?.price || 0
      const homeMLOpening = openingML?.homePrice || 0
      const homeMLChange = homeMLCurrent - homeMLOpening
      
      const awayMLCurrent = currentML?.outcomes.find(o => o.name === game.awayTeam)?.price || 0
      const awayMLOpening = openingML?.awayPrice || 0
      const awayMLChange = awayMLCurrent - awayMLOpening
      
      // Determine direction and magnitude
      let direction: 'home' | 'away' | 'over' | 'under' | 'neutral' = 'neutral'
      let magnitude: 'small' | 'medium' | 'large' = 'small'
      
      if (Math.abs(spreadChange) >= 0.5) {
        direction = spreadChange < 0 ? 'home' : 'away' // Negative spread change = line moved toward home
        magnitude = Math.abs(spreadChange) >= 2 ? 'large' : Math.abs(spreadChange) >= 1 ? 'medium' : 'small'
      } else if (Math.abs(totalChange) >= 0.5) {
        direction = totalChange > 0 ? 'over' : 'under'
        magnitude = Math.abs(totalChange) >= 3 ? 'large' : Math.abs(totalChange) >= 1.5 ? 'medium' : 'small'
      }
      
      // Sharp indicator: line moved but in unexpected direction
      // (This is simplified - real sharp detection would need betting percentages)
      const sharpIndicator = magnitude !== 'small' && (
        (direction === 'home' && homeMLCurrent > homeMLOpening) || // Line moved to home but home ML got worse
        (direction === 'away' && awayMLCurrent > awayMLOpening)
      )
      
      movements.push({
        gameId: game.id,
        sport: game.sport,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        commenceTime: game.commenceTime,
        opening: {
          spread: openingSpread ? { line: openingSpread.homeSpread, price: openingSpread.homePrice } : undefined,
          total: openingTotal ? { line: openingTotal.total, overPrice: openingTotal.overPrice, underPrice: openingTotal.underPrice } : undefined,
          homeML: openingML?.homePrice,
          awayML: openingML?.awayPrice,
          timestamp: opening.timestamp,
        },
        current: {
          spread: currentSpread ? { 
            line: homeSpreadCurrent, 
            price: currentSpread.outcomes.find(o => o.name === game.homeTeam)?.price || 0 
          } : undefined,
          total: currentTotal ? { 
            line: totalCurrent, 
            overPrice: currentTotal.outcomes.find(o => o.name === 'Over')?.price || 0,
            underPrice: currentTotal.outcomes.find(o => o.name === 'Under')?.price || 0
          } : undefined,
          homeML: homeMLCurrent,
          awayML: awayMLCurrent,
          timestamp: new Date().toISOString(),
        },
        movement: {
          spreadChange,
          totalChange,
          homeMLChange,
          awayMLChange,
          direction,
          magnitude,
          sharpIndicator,
        },
      })
    }
    
    return movements
  } catch (error) {
    console.error('[LineMovement] Error getting line movement:', error)
    return []
  }
}

/**
 * Format line movement data for Claude's context
 */
export function formatLineMovementForContext(movements: LineMovement[]): string {
  if (!movements || movements.length === 0) {
    return '\n=== LINE MOVEMENT ===\nNo line movement data available yet. Snapshots are taken 6x daily.\n'
  }
  
  const lines: string[] = []
  lines.push('\n=== LINE MOVEMENT (Opening vs Current) ===')
  lines.push('Sharp money indicators: Lines that moved opposite to public betting')
  lines.push('')
  
  // Group by sport
  const bySport = movements.reduce((acc, m) => {
    if (!acc[m.sport]) acc[m.sport] = []
    acc[m.sport].push(m)
    return acc
  }, {} as Record<string, LineMovement[]>)
  
  for (const [sport, sportMovements] of Object.entries(bySport)) {
    // Only show games with significant movement
    const significantMovements = sportMovements.filter(m => 
      m.movement.magnitude !== 'small' || m.movement.sharpIndicator
    )
    
    if (significantMovements.length === 0) continue
    
    lines.push(`--- ${sport.toUpperCase()} ---`)
    
    for (const m of significantMovements) {
      const sharpTag = m.movement.sharpIndicator ? ' [SHARP MONEY]' : ''
      const magnitudeTag = m.movement.magnitude === 'large' ? ' [BIG MOVE]' : ''
      
      lines.push(`${m.awayTeam} @ ${m.homeTeam}${sharpTag}${magnitudeTag}`)
      
      if (m.opening.spread && m.current.spread) {
        const spreadDir = m.movement.spreadChange && m.movement.spreadChange < 0 ? 'toward home' : 'toward away'
        lines.push(`  Spread: ${formatSpread(m.opening.spread.line)} -> ${formatSpread(m.current.spread.line)} (${spreadDir})`)
      }
      
      if (m.opening.total && m.current.total && m.movement.totalChange) {
        const totalDir = m.movement.totalChange > 0 ? 'UP' : 'DOWN'
        lines.push(`  Total: ${m.opening.total.line} -> ${m.current.total.line} (${totalDir} ${Math.abs(m.movement.totalChange).toFixed(1)})`)
      }
      
      if (m.opening.homeML && m.current.homeML && m.movement.homeMLChange) {
        lines.push(`  ML: ${formatOdds(m.opening.homeML)} -> ${formatOdds(m.current.homeML)} (${m.homeTeam})`)
      }
      
      lines.push('')
    }
  }
  
  // Summary
  const sharpGames = movements.filter(m => m.movement.sharpIndicator)
  const bigMoves = movements.filter(m => m.movement.magnitude === 'large')
  
  lines.push('LINE MOVEMENT SUMMARY:')
  lines.push(`- ${movements.length} games tracked`)
  lines.push(`- ${sharpGames.length} games with sharp money indicators`)
  lines.push(`- ${bigMoves.length} games with large line movement`)
  lines.push('')
  
  return lines.join('\n')
}

function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`
  return spread.toString()
}

function formatOdds(odds: number): string {
  if (odds > 0) return `+${odds}`
  return odds.toString()
}
