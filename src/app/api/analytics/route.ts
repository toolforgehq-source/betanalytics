import { NextResponse } from "next/server"
import { getCachedESPNOdds } from "@/lib/espn"

/**
 * GET /api/analytics
 * 
 * Returns system status data from ESPN odds:
 * - Games tracked today and tomorrow
 * - Sports coverage breakdown
 * - Data freshness indicators
 */
export async function GET() {
  try {
    // Get ESPN odds data (from cache or fresh fetch)
    const espnData = await getCachedESPNOdds()
    
    // Calculate time since last update
    const lastUpdated = new Date(espnData.lastUpdated)
    const now = new Date()
    const minutesSinceUpdate = Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60))
    
    // Determine freshness status
    let freshnessStatus: 'fresh' | 'aging' | 'stale'
    if (minutesSinceUpdate < 30) {
      freshnessStatus = 'fresh'
    } else if (minutesSinceUpdate < 120) {
      freshnessStatus = 'aging'
    } else {
      freshnessStatus = 'stale'
    }
    
    // Format time since update
    let timeSinceUpdate: string
    if (minutesSinceUpdate < 1) {
      timeSinceUpdate = 'Just now'
    } else if (minutesSinceUpdate === 1) {
      timeSinceUpdate = '1 min ago'
    } else if (minutesSinceUpdate < 60) {
      timeSinceUpdate = `${minutesSinceUpdate} min ago`
    } else {
      const hours = Math.floor(minutesSinceUpdate / 60)
      timeSinceUpdate = hours === 1 ? '1 hour ago' : `${hours} hours ago`
    }
    
    // Count games by sport/league
    const sportCounts: Record<string, number> = {}
    for (const game of espnData.games) {
      const league = game.league
      sportCounts[league] = (sportCounts[league] || 0) + 1
    }
    
    // Use scoreboard game counts (all games on ESPN, not just ones with odds)
    // Falls back to counting from odds data if scoreboard counts aren't available
    let gamesToday = espnData.scoreboardGamesToday ?? 0
    let gamesTomorrow = espnData.scoreboardGamesTomorrow ?? 0
    
    if (!espnData.scoreboardGamesToday && !espnData.scoreboardGamesTomorrow) {
      const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      const tomorrowDate = new Date()
      tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const tomorrowET = tomorrowDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      
      for (const game of espnData.games) {
        const gameDate = new Date(game.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        if (gameDate === todayET) {
          gamesToday++
        } else if (gameDate === tomorrowET) {
          gamesTomorrow++
        }
      }
    }
    
    // Count unique sports
    const uniqueSports = Object.keys(sportCounts).length
    
    return NextResponse.json({
      success: true,
      data: {
        totalGames: espnData.games.length,
        gamesToday,
        gamesTomorrow,
        uniqueSports,
        sportCounts,
        freshnessStatus,
        timeSinceUpdate,
        lastUpdated: espnData.lastUpdated,
        dataSource: 'ESPN',
        isHealthy: freshnessStatus !== 'stale' && espnData.games.length > 0,
      }
    })
  } catch (error) {
    console.error("Analytics API error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    
    // Return fallback data on error
    return NextResponse.json({
      success: false,
      error: errorMessage,
      data: {
        totalGames: 0,
        gamesToday: 0,
        gamesTomorrow: 0,
        uniqueSports: 0,
        sportCounts: {},
        freshnessStatus: 'stale',
        timeSinceUpdate: 'Unknown',
        lastUpdated: null,
        dataSource: 'ESPN',
        isHealthy: false,
      }
    })
  }
}
