/**
 * Cron Job: Snapshot Odds for Line Movement Tracking
 * 
 * This endpoint is called 6x daily by Vercel Cron to:
 * 1. Fetch fresh odds from The Odds API
 * 2. Store snapshots for line movement tracking
 * 3. Update the cache with fresh data
 * 
 * Schedule: Every 4 hours
 * Times: 12am, 4am, 8am, 12pm, 4pm, 8pm ET
 * 
 * Requires Vercel Pro for cron job support.
 */

import { NextResponse } from 'next/server'
import { fetchAllOdds } from '@/lib/odds'
import { storeOddsSnapshot } from '@/lib/line-movement'

export const runtime = 'nodejs'
export const maxDuration = 60 // Allow up to 60 seconds for this job

export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // If CRON_SECRET is set, verify it
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Cron] Unauthorized access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('[Cron] Starting odds snapshot job...')
    const startTime = Date.now()
    
    // Fetch fresh odds from all sports
    const oddsData = await fetchAllOdds()
    
    if (!oddsData.games || oddsData.games.length === 0) {
      console.error('[Cron] No games returned from fetchAllOdds')
      return NextResponse.json({ 
        success: false, 
        error: 'No games available',
        timestamp: new Date().toISOString()
      }, { status: 500 })
    }
    
    // Store snapshot for line movement tracking
    await storeOddsSnapshot(oddsData.games)
    
    const duration = Date.now() - startTime
    
    console.log(`[Cron] Snapshot complete: ${oddsData.games.length} games in ${duration}ms`)
    
    return NextResponse.json({
      success: true,
      gamesSnapshotted: oddsData.games.length,
      sportsActive: oddsData.coverage?.activeSports || 0,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      nextRun: getNextRunTime(),
    })
  } catch (error) {
    console.error('[Cron] Error in snapshot job:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

function getNextRunTime(): string {
  const now = new Date()
  const currentHour = now.getUTCHours()
  
  // Find next 4-hour interval
  const nextHour = Math.ceil((currentHour + 1) / 4) * 4
  const nextRun = new Date(now)
  
  if (nextHour >= 24) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1)
    nextRun.setUTCHours(0, 0, 0, 0)
  } else {
    nextRun.setUTCHours(nextHour, 0, 0, 0)
  }
  
  return nextRun.toISOString()
}
