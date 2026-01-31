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
  getEloStats,
  saveEloRatings,
  getEloRatings,
  getLeagueRatings,
  getEloWinProbabilityByName,
  SUPPORTED_LEAGUES
} from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 300 // 5 minutes for backfill

export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    
    // Action: Get ratings for a league
    if (action === 'ratings') {
      const league = url.searchParams.get('league') || 'NBA'
      const ratings = await getLeagueRatings(league)
      return NextResponse.json({
        success: true,
        league,
        teamCount: ratings.length,
        ratings: ratings.map(r => ({
          team: r.teamName,
          rating: r.rating,
          gamesPlayed: r.gamesPlayed,
          lastUpdated: r.lastUpdated
        }))
      })
    }
    
    // Action: Get win probability for a matchup
    if (action === 'matchup') {
      const league = url.searchParams.get('league') || 'NBA'
      const home = url.searchParams.get('home') || ''
      const away = url.searchParams.get('away') || ''
      
      if (!home || !away) {
        return NextResponse.json({ error: 'Missing home or away team' }, { status: 400 })
      }
      
      const result = await getEloWinProbabilityByName(league, home, away)
      return NextResponse.json({
        success: true,
        league,
        homeTeam: home,
        awayTeam: away,
        eloResult: result
      })
    }
    
    // Action: List supported leagues
    if (action === 'leagues') {
      return NextResponse.json({
        success: true,
        leagues: SUPPORTED_LEAGUES,
        message: 'Use ?league=NBA (or other) to backfill a specific league'
      })
    }
    
    const fullBackfill = url.searchParams.get('full') === 'true'
    const daysParam = url.searchParams.get('days')
    const leagueParam = url.searchParams.get('league') // Single league filter
    
    let startDate: Date
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 1) // Yesterday
    
    if (fullBackfill) {
      // Full backfill from season start
      // Soccer seasons start in August, other sports in October
      const isSoccerLeague = leagueParam && leagueParam.startsWith('soccer_')
      startDate = isSoccerLeague ? new Date('2025-08-01') : new Date('2025-10-01')
      console.log(`[Elo Debug] Running full backfill from ${isSoccerLeague ? 'August' : 'October'} 2025${leagueParam ? ` for ${leagueParam}` : ''}...`)
    } else {
      // Backfill last N days (default 7)
      const days = parseInt(daysParam || '7', 10)
      startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      console.log(`[Elo Debug] Backfilling last ${days} days${leagueParam ? ` for ${leagueParam}` : ''}...`)
    }
    
    // Pass league filter if specified
    const games = await backfillHistoricalGames(startDate, endDate, leagueParam || undefined)
    
    // Update ratings (this also saves to Redis)
    const eloData = await updateEloRatings(games)
    
    // Explicitly save again and check result
    const saveResult = await saveEloRatings(eloData)
    
    // Read back immediately to verify
    const readBack = await getEloRatings()
    
    // Get stats for response (re-read from Redis to verify save worked)
    const stats = await getEloStats()
    
    // Check if Redis env vars are configured
    const hasRedisConfig = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    
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
      redisStats: stats,
      hasRedisConfig,
      saveResult,
      readBackTeams: readBack ? Object.keys(readBack.ratings || {}).length : 0
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
