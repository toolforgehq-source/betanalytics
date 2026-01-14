/**
 * Debug Endpoint: Elo Backfill
 * 
 * This endpoint runs the Elo backfill without requiring CRON_SECRET.
 * Used for initial setup to populate ratings from season start.
 * 
 * Query params:
 * - days=N: Backfill last N days (default: 7)
 * - full=true: Full backfill from October 2025
 */

import { NextResponse } from 'next/server'
import { 
  backfillHistoricalGames,
  updateEloRatings, 
  getEloStats 
} from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 300 // 5 minutes for backfill

export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    const url = new URL(request.url)
    const fullBackfill = url.searchParams.get('full') === 'true'
    const daysParam = url.searchParams.get('days')
    
    let startDate: Date
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 1) // Yesterday
    
    if (fullBackfill) {
      // Full backfill from season start (October 2025)
      startDate = new Date('2025-10-01')
      console.log('[Elo Debug] Running full backfill from season start...')
    } else {
      // Backfill last N days (default 7)
      const days = parseInt(daysParam || '7', 10)
      startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      console.log(`[Elo Debug] Backfilling last ${days} days...`)
    }
    
    const games = await backfillHistoricalGames(startDate, endDate)
    
    // Update ratings
    const eloData = await updateEloRatings(games)
    
    // Get stats for response
    const stats = await getEloStats()
    
    const duration = Date.now() - startTime
    
    // Get team count directly from eloData (more reliable than re-reading from Redis)
    const teamCount = Object.keys(eloData.ratings || {}).length
    
    // Calculate league counts from eloData directly
    const leagueCounts: Record<string, number> = {}
    for (const rating of Object.values(eloData.ratings || {})) {
      leagueCounts[rating.league] = (leagueCounts[rating.league] || 0) + 1
    }
    
    return NextResponse.json({
      success: true,
      message: fullBackfill ? 'Full backfill complete' : `Backfill complete`,
      dateRange: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      },
      gamesProcessed: games.length,
      totalTeams: teamCount,
      totalGamesProcessed: eloData.gamesProcessed,
      leagueCounts: leagueCounts,
      lastUpdated: eloData.lastUpdated,
      durationMs: duration,
      // Debug: also include stats from Redis to compare
      redisStats: stats
    })
    
  } catch (error) {
    console.error('[Elo Debug] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to run Elo backfill',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
