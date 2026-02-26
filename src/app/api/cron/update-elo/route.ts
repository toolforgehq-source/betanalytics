/**
 * Cron Job: Update Elo Ratings
 * 
 * This job runs daily to:
 * 1. Fetch yesterday's completed games from ESPN
 * 2. Update team Elo ratings based on results
 * 3. Store updated ratings in Redis
 * 
 * The system learns over time - the longer it runs, the more accurate predictions become.
 * 
 * Schedule: Daily at 6 AM ET (after most games complete)
 */

import { NextResponse } from 'next/server'
import { 
  fetchYesterdaysGames, 
  updateEloRatings, 
  backfillHistoricalGames,
  getEloStats,
  clearEloData
} from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 300 // 5 minutes for backfill

/**
 * GET /api/cron/update-elo
 * 
 * Query params:
 * - backfill=true: Run initial backfill from season start
 * - reset=true: Clear all existing data before backfilling (use with backfill=true)
 * - days=N: Backfill last N days (default: yesterday only)
 */
export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    // Verify cron secret (Vercel cron jobs send this header)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // Allow access if no secret configured (dev) or if secret matches
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const url = new URL(request.url)
    const shouldBackfill = url.searchParams.get('backfill') === 'true'
    const shouldReset = url.searchParams.get('reset') === 'true'
    const daysParam = url.searchParams.get('days')
    
    let games
    
    // If reset requested, clear all existing data first
    if (shouldReset) {
      console.log('[Elo Cron] Resetting all Elo data...')
      const cleared = await clearEloData()
      if (!cleared) {
        return NextResponse.json({ error: 'Failed to clear Elo data' }, { status: 500 })
      }
      console.log('[Elo Cron] Elo data cleared successfully')
    }
    
    if (shouldBackfill) {
      // Backfill from season start (October 2025 for most sports)
      const seasonStart = new Date('2025-10-01')
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      
      console.log('[Elo Cron] Running full backfill from season start...')
      games = await backfillHistoricalGames(seasonStart, yesterday)
    } else if (daysParam) {
      // Backfill last N days
      const days = parseInt(daysParam, 10) || 7
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      
      console.log(`[Elo Cron] Backfilling last ${days} days...`)
      games = await backfillHistoricalGames(startDate, yesterday)
    } else {
      // Normal daily update - just yesterday's games
      console.log('[Elo Cron] Fetching yesterday\'s games...')
      games = await fetchYesterdaysGames()
    }
    
    // Update ratings
    const eloData = await updateEloRatings(games)
    
    // Get stats for response
    const stats = await getEloStats()
    
    const duration = Date.now() - startTime
    
    return NextResponse.json({
      success: true,
      message: shouldReset ? 'Reset + backfill complete' : shouldBackfill ? 'Backfill complete' : 'Daily update complete',
      wasReset: shouldReset,
      gamesProcessed: games.length,
      totalTeams: stats?.totalTeams || 0,
      totalGamesProcessed: stats?.totalGamesProcessed || 0,
      leagueCounts: stats?.leagueCounts || {},
      lastUpdated: eloData.lastUpdated,
      durationMs: duration
    })
    
  } catch (error) {
    console.error('[Elo Cron] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update Elo ratings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
