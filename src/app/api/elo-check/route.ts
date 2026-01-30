/**
 * Public Elo Cache Check Endpoint
 * 
 * This endpoint checks the Elo cache state without requiring authentication.
 * Used for debugging Elo lookup issues.
 */

import { NextResponse } from 'next/server'
import { getEloRatings, getLeagueRatings } from '@/lib/elo'

export const runtime = 'edge'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const league = url.searchParams.get('league') || 'NBA'
    const team = url.searchParams.get('team')
    
    const eloData = await getEloRatings()
    
    if (!eloData || !eloData.ratings) {
      return NextResponse.json({
        status: 'CACHE_EMPTY',
        message: 'Elo cache is empty - needs backfill',
        totalTeams: 0,
        lastUpdated: null
      })
    }
    
    const ratings = eloData.ratings
    const totalTeams = Object.keys(ratings).length
    
    // Count teams by league
    const leagueCounts: Record<string, number> = {}
    for (const rating of Object.values(ratings)) {
      leagueCounts[rating.league] = (leagueCounts[rating.league] || 0) + 1
    }
    
    // Get teams for requested league
    const leagueTeams = await getLeagueRatings(league)
    
    // If team parameter provided, search for it
    let teamSearch = null
    if (team) {
      const normalizeTeamName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const searchNorm = normalizeTeamName(team)
      
      const matches = Object.values(ratings).filter(r => {
        const teamNorm = normalizeTeamName(r.teamName)
        return teamNorm.includes(searchNorm) || searchNorm.includes(teamNorm)
      })
      
      teamSearch = {
        query: team,
        normalized: searchNorm,
        matches: matches.map(m => ({
          teamName: m.teamName,
          league: m.league,
          rating: m.rating,
          gamesPlayed: m.gamesPlayed
        }))
      }
    }
    
    return NextResponse.json({
      status: 'CACHE_POPULATED',
      lastUpdated: eloData.lastUpdated,
      totalTeams,
      totalGamesProcessed: eloData.gamesProcessed,
      leagueCounts,
      requestedLeague: league,
      teamsInLeague: leagueTeams.length,
      leagueTeams: leagueTeams.slice(0, 10).map(t => ({
        teamName: t.teamName,
        rating: t.rating,
        gamesPlayed: t.gamesPlayed
      })),
      teamSearch
    })
    
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to check Elo cache',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
