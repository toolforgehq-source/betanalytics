import { NextResponse } from 'next/server'
import { getEloRatings, getEloWinProbabilityByName } from '@/lib/elo'
import { fetchESPNOddsForAllLeagues } from '@/lib/espn'

// Debug endpoint to trace NBA Elo lookup issues
// This will show exactly what team names are being used and whether they match the cache

export async function GET() {
  const results: {
    cacheStatus: {
      totalTeams: number
      nbaTeams: number
      nbaTeamNames: string[]
      lastUpdated: string | null
    }
    todaysNBAGames: {
      homeTeam: string
      awayTeam: string
      sport: string
      sportName: string
      eloLookupResult: {
        success: boolean
        homeRating?: number
        awayRating?: number
        probability?: number
        confidence?: string
        error?: string
      }
    }[]
    diagnosis: string[]
  } = {
    cacheStatus: {
      totalTeams: 0,
      nbaTeams: 0,
      nbaTeamNames: [],
      lastUpdated: null
    },
    todaysNBAGames: [],
    diagnosis: []
  }

  try {
    // Step 1: Check the Elo cache
    const eloData = await getEloRatings()
    
    if (!eloData) {
      results.diagnosis.push('CRITICAL: Elo cache is empty or not accessible')
      return NextResponse.json(results)
    }

    const ratings = eloData.ratings || {}
    results.cacheStatus.totalTeams = Object.keys(ratings).length
    results.cacheStatus.lastUpdated = eloData.lastUpdated

    // Get NBA teams from cache
    const nbaTeams = Object.values(ratings).filter(r => r.league === 'NBA')
    results.cacheStatus.nbaTeams = nbaTeams.length
    results.cacheStatus.nbaTeamNames = nbaTeams.map(t => t.teamName).sort()

    if (nbaTeams.length === 0) {
      results.diagnosis.push('CRITICAL: No NBA teams in cache - check if league name is "NBA" or something else')
      
      // Check what leagues ARE in the cache
      const leagues = [...new Set(Object.values(ratings).map(r => r.league))]
      results.diagnosis.push(`Leagues in cache: ${leagues.join(', ')}`)
    } else {
      results.diagnosis.push(`Found ${nbaTeams.length} NBA teams in cache`)
    }

    // Step 2: Fetch today's NBA games from ESPN
    const espnGames = await fetchESPNOddsForAllLeagues()
    const nbaGames = espnGames.filter(g => g.league === 'NBA')

    if (nbaGames.length === 0) {
      results.diagnosis.push('No NBA games found from ESPN today')
      return NextResponse.json(results)
    }

    results.diagnosis.push(`Found ${nbaGames.length} NBA games from ESPN`)

    // Step 3: For each NBA game, trace the Elo lookup
    for (const game of nbaGames) {
      const gameResult: typeof results.todaysNBAGames[0] = {
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        sport: 'basketball_nba', // This is what would be used in the actual code
        sportName: game.league,
        eloLookupResult: {
          success: false
        }
      }

      try {
        // Try the Elo lookup with league name "NBA"
        const eloResult = await getEloWinProbabilityByName('NBA', game.homeTeam, game.awayTeam)
        
        if (eloResult) {
          gameResult.eloLookupResult = {
            success: true,
            homeRating: eloResult.homeRating,
            awayRating: eloResult.awayRating,
            probability: eloResult.probability,
            confidence: eloResult.confidence
          }
        } else {
          gameResult.eloLookupResult = {
            success: false,
            error: 'getEloWinProbabilityByName returned null'
          }

          // Diagnose why it failed
          const normalizeTeamName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
          const homeNorm = normalizeTeamName(game.homeTeam)
          const awayNorm = normalizeTeamName(game.awayTeam)

          // Check if home team is in cache
          const homeMatch = nbaTeams.find(t => {
            const teamNorm = normalizeTeamName(t.teamName)
            return teamNorm.includes(homeNorm) || homeNorm.includes(teamNorm)
          })

          // Check if away team is in cache
          const awayMatch = nbaTeams.find(t => {
            const teamNorm = normalizeTeamName(t.teamName)
            return teamNorm.includes(awayNorm) || awayNorm.includes(teamNorm)
          })

          if (!homeMatch) {
            results.diagnosis.push(`HOME TEAM NOT FOUND: "${game.homeTeam}" (normalized: "${homeNorm}")`)
          }
          if (!awayMatch) {
            results.diagnosis.push(`AWAY TEAM NOT FOUND: "${game.awayTeam}" (normalized: "${awayNorm}")`)
          }
        }
      } catch (error) {
        gameResult.eloLookupResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }

      results.todaysNBAGames.push(gameResult)
    }

    // Summary diagnosis
    const successCount = results.todaysNBAGames.filter(g => g.eloLookupResult.success).length
    const failCount = results.todaysNBAGames.length - successCount
    
    if (failCount > 0) {
      results.diagnosis.push(`SUMMARY: ${successCount}/${results.todaysNBAGames.length} games have Elo data`)
      if (failCount === results.todaysNBAGames.length) {
        results.diagnosis.push('ALL games failed Elo lookup - likely a systemic issue')
      }
    } else {
      results.diagnosis.push(`SUCCESS: All ${results.todaysNBAGames.length} games have Elo data`)
    }

  } catch (error) {
    results.diagnosis.push(`ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return NextResponse.json(results, { status: 200 })
}
