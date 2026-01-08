/**
 * Debug Endpoint: Force Fetch Fresh Odds Data
 * 
 * This endpoint bypasses the cache and directly calls fetchAllOdds()
 * to diagnose why getCurrentOdds() might be returning empty data.
 */

import { NextResponse } from "next/server"
import { fetchAllOdds, getCurrentOdds } from "@/lib/odds"

export const dynamic = "force-dynamic"

export async function GET() {
  const startTime = Date.now()
  
  try {
    // First, check what getCurrentOdds returns (uses cache)
    const cachedResult = await getCurrentOdds()
    const cachedTime = Date.now() - startTime
    
    // Then, force fetch fresh data (bypasses cache)
    const freshStartTime = Date.now()
    const freshResult = await fetchAllOdds()
    const freshTime = Date.now() - freshStartTime
    
    // Check environment variables
    const envCheck = {
      hasOddsApiKey: !!process.env.ODDS_API_KEY,
      oddsApiKeyLength: process.env.ODDS_API_KEY?.length || 0,
      hasKvUrl: !!process.env.KV_REST_API_URL,
      hasKvToken: !!process.env.KV_REST_API_TOKEN,
    }
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      envCheck,
      
      cachedResult: {
        fetchTimeMs: cachedTime,
        gamesCount: cachedResult.games.length,
        lastUpdated: cachedResult.lastUpdated,
        isStale: cachedResult.isStale,
        gamesBySport: groupBySport(cachedResult.games),
      },
      
      freshResult: {
        fetchTimeMs: freshTime,
        gamesCount: freshResult.games.length,
        lastUpdated: freshResult.lastUpdated,
        isStale: freshResult.isStale,
        gamesBySport: groupBySport(freshResult.games),
        sampleGames: freshResult.games.slice(0, 3).map(g => ({
          id: g.id,
          sport: g.sportName,
          home: g.homeTeam,
          away: g.awayTeam,
          hasOdds: g.spreads.length > 0 || g.totals.length > 0 || g.moneylines.length > 0
        }))
      },
      
      diagnosis: {
        cacheWorking: cachedResult.games.length > 0,
        freshFetchWorking: freshResult.games.length > 0,
        issue: cachedResult.games.length === 0 && freshResult.games.length > 0 
          ? 'Cache is empty but fresh fetch works - cache may not be saving properly'
          : cachedResult.games.length === 0 && freshResult.games.length === 0
          ? 'Both cache and fresh fetch return 0 games - API key may be missing or invalid'
          : 'Both working correctly'
      }
    })
    
  } catch (error) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}

function groupBySport(games: Array<{ sportName: string }>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const game of games) {
    result[game.sportName] = (result[game.sportName] || 0) + 1
  }
  return result
}
