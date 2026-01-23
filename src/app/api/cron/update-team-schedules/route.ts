/**
 * Cron Job: Update Team Schedules
 * 
 * This job runs daily to:
 * 1. Fetch completed games from the last 7 days from ESPN
 * 2. Build a map of each team's most recent game date
 * 3. Cache the data in Redis for fast lookups
 * 
 * This data is used by the situational factors system to:
 * - Detect back-to-back games (team played yesterday)
 * - Calculate rest advantage between teams
 * - Apply appropriate probability adjustments
 * 
 * Schedule: Daily at 6 AM ET (runs alongside update-elo)
 */

import { NextResponse } from 'next/server'
import { updateTeamScheduleData } from '@/lib/team-schedule'

export const runtime = 'edge'
export const maxDuration = 120 // 2 minutes should be plenty

/**
 * GET /api/cron/update-team-schedules
 * 
 * Updates the team schedule cache with recent game data.
 * Called daily by Vercel cron.
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
    
    console.log('[TeamSchedule Cron] Starting team schedule update...')
    
    // Update team schedule data
    const scheduleData = await updateTeamScheduleData()
    
    const duration = Date.now() - startTime
    
    // Count teams by league
    const leagueCounts: Record<string, number> = {}
    for (const team of Object.values(scheduleData.teams)) {
      leagueCounts[team.league] = (leagueCounts[team.league] || 0) + 1
    }
    
    // Find teams on back-to-back (for logging)
    const now = new Date()
    const backToBackTeams: string[] = []
    for (const team of Object.values(scheduleData.teams)) {
      const lastGame = new Date(team.lastGameDate)
      const daysSince = Math.floor((now.getTime() - lastGame.getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince <= 1) {
        backToBackTeams.push(team.teamName)
      }
    }
    
    console.log(`[TeamSchedule Cron] Update complete in ${duration}ms`)
    console.log(`[TeamSchedule Cron] Teams on back-to-back: ${backToBackTeams.length}`)
    
    return NextResponse.json({
      success: true,
      message: 'Team schedule update complete',
      teamsTracked: Object.keys(scheduleData.teams).length,
      leagueCounts,
      backToBackTeams: backToBackTeams.slice(0, 10), // Show first 10
      backToBackCount: backToBackTeams.length,
      lastUpdated: scheduleData.lastUpdated,
      durationMs: duration
    })
    
  } catch (error) {
    console.error('[TeamSchedule Cron] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update team schedules',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
