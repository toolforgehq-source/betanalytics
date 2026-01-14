/**
 * Cron job to update player stats daily
 * Runs at 11 AM UTC (6 AM ET) - same time as Elo updates
 * 
 * This fetches completed games from yesterday and updates player statistics.
 */

import { NextResponse } from 'next/server'
import { updatePlayerStats, getPlayerStatsInfo } from '@/lib/player-stats'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    // Verify cron secret for production
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[PlayerStats Cron] Unauthorized request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('[PlayerStats Cron] Starting daily update...')
    
    // Update stats from yesterday's games (1 day back)
    const result = await updatePlayerStats(1)
    
    // Get current stats info
    const info = await getPlayerStatsInfo()
    
    console.log(`[PlayerStats Cron] Complete: ${result.gamesProcessed} games, ${result.playersUpdated} players`)
    
    return NextResponse.json({
      success: true,
      message: 'Player stats updated successfully',
      gamesProcessed: result.gamesProcessed,
      playersUpdated: result.playersUpdated,
      errors: result.errors,
      stats: info,
      durationMs: Date.now() - startTime
    })
    
  } catch (error) {
    console.error('[PlayerStats Cron] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update player stats',
      details: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
