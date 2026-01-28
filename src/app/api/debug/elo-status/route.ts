/**
 * Debug Endpoint: Elo Update Status
 * 
 * Verifies that the Elo system is updating daily and learning from game results.
 * Shows:
 * - Last update timestamp
 * - Total games processed
 * - Sample team ratings with their last update dates
 * - Confidence levels explanation
 */

import { NextResponse } from 'next/server'
import { getEloRatings, getEloStats, getProcessedGameIds } from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 60

interface TeamWithHistory {
  teamName: string
  league: string
  rating: number
  gamesPlayed: number
  lastUpdated: string
  confidence: string
}

function getConfidenceLevel(gamesPlayed: number): string {
  if (gamesPlayed >= 50) return 'HIGH (50+ games)'
  if (gamesPlayed >= 20) return 'MEDIUM (20-49 games)'
  if (gamesPlayed >= 10) return 'LOW (10-19 games)'
  if (gamesPlayed >= 5) return 'VERY_LOW (5-9 games)'
  return 'MINIMAL (<5 games)'
}

export async function GET() {
  try {
    const [eloData, stats, processedIds] = await Promise.all([
      getEloRatings(),
      getEloStats(),
      getProcessedGameIds()
    ])
    
    if (!eloData || !eloData.ratings) {
      return NextResponse.json({
        error: 'Elo cache is empty',
        status: 'NOT_INITIALIZED',
        recommendation: 'Run /api/cron/update-elo?backfill=true to initialize'
      })
    }
    
    // Get all teams grouped by league
    const teamsByLeague: Record<string, TeamWithHistory[]> = {}
    
    for (const [, team] of Object.entries(eloData.ratings)) {
      const league = team.league
      if (!teamsByLeague[league]) {
        teamsByLeague[league] = []
      }
      teamsByLeague[league].push({
        teamName: team.teamName,
        league: team.league,
        rating: team.rating,
        gamesPlayed: team.gamesPlayed,
        lastUpdated: team.lastUpdated,
        confidence: getConfidenceLevel(team.gamesPlayed)
      })
    }
    
    // Sort teams by rating within each league
    for (const league of Object.keys(teamsByLeague)) {
      teamsByLeague[league].sort((a, b) => b.rating - a.rating)
    }
    
    // Get sample teams for verification (top and bottom rated from each major league)
    const sampleTeams: Record<string, { top: TeamWithHistory[], bottom: TeamWithHistory[] }> = {}
    const majorLeagues = ['NBA', 'NFL', 'NHL', 'NCAAB', 'NCAAF']
    
    for (const league of majorLeagues) {
      const teams = teamsByLeague[league] || []
      if (teams.length > 0) {
        sampleTeams[league] = {
          top: teams.slice(0, 5),
          bottom: teams.slice(-5).reverse()
        }
      }
    }
    
    // Find specific teams for verification
    const verificationTeams: Record<string, TeamWithHistory | null> = {}
    const teamsToFind = ['Los Angeles Lakers', 'Milwaukee Bucks', 'Boston Celtics', 'New York Rangers', 'Kansas City Chiefs']
    
    for (const teamName of teamsToFind) {
      for (const teams of Object.values(teamsByLeague)) {
        const found = teams.find(t => t.teamName === teamName)
        if (found) {
          verificationTeams[teamName] = found
          break
        }
      }
      if (!verificationTeams[teamName]) {
        verificationTeams[teamName] = null
      }
    }
    
    // Calculate time since last update
    const lastUpdated = new Date(eloData.lastUpdated)
    const now = new Date()
    const hoursSinceUpdate = Math.round((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60))
    
    // Determine health status
    let healthStatus = 'HEALTHY'
    let healthMessage = 'Elo system is updating normally'
    
    if (hoursSinceUpdate > 48) {
      healthStatus = 'CRITICAL'
      healthMessage = `Last update was ${hoursSinceUpdate} hours ago - cron may not be running`
    } else if (hoursSinceUpdate > 24) {
      healthStatus = 'WARNING'
      healthMessage = `Last update was ${hoursSinceUpdate} hours ago - check cron logs`
    }
    
    // Get league-specific last update times
    const leagueLastUpdates: Record<string, string> = {}
    for (const [league, teams] of Object.entries(teamsByLeague)) {
      const mostRecent = teams.reduce((latest, team) => {
        const teamDate = new Date(team.lastUpdated)
        return teamDate > latest ? teamDate : latest
      }, new Date(0))
      leagueLastUpdates[league] = mostRecent.toISOString()
    }
    
    return NextResponse.json({
      status: healthStatus,
      message: healthMessage,
      
      // Core metrics
      lastUpdated: eloData.lastUpdated,
      lastUpdatedET: lastUpdated.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      hoursSinceUpdate,
      totalGamesProcessed: eloData.gamesProcessed || processedIds.size,
      totalTeamsTracked: Object.keys(eloData.ratings).length,
      
      // League breakdown
      leagueCounts: stats?.leagueCounts || {},
      leagueLastUpdates,
      
      // Cron configuration
      cronConfig: {
        schedule: '0 11 * * * (Daily at 11:00 AM UTC / 6:00 AM ET)',
        endpoint: '/api/cron/update-elo',
        process: [
          '1. Fetch yesterday\'s completed games from ESPN',
          '2. For each game, update Elo ratings (winner gains, loser loses)',
          '3. Store updated ratings in Redis cache',
          '4. Ratings are now current for today\'s predictions'
        ]
      },
      
      // Confidence levels explanation
      confidenceLevels: {
        HIGH: '50+ games - Very reliable predictions',
        MEDIUM: '20-49 games - Good predictions',
        LOW: '10-19 games - Moderate confidence',
        VERY_LOW: '5-9 games - Limited data',
        MINIMAL: '<5 games - Insufficient data'
      },
      
      // Sample teams for verification
      verificationTeams,
      
      // Top/bottom teams by league
      sampleTeams,
      
      // What to check if updates aren't happening
      troubleshooting: {
        ifNotUpdating: [
          '1. Check Vercel cron logs for /api/cron/update-elo',
          '2. Verify CRON_SECRET env var is set correctly',
          '3. Check if ESPN API is returning games',
          '4. Manually trigger: /api/cron/update-elo?days=7'
        ]
      }
    })
    
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to get Elo status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
