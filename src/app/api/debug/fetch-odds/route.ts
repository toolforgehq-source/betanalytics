/**
 * Debug Endpoint: Force Fetch Fresh Odds Data
 * 
 * This endpoint bypasses the cache and directly calls fetchAllOdds()
 * to diagnose why getCurrentOdds() might be returning empty data.
 * 
 * Also includes direct API testing to see HTTP status codes.
 */

import { NextResponse } from "next/server"
import { fetchAllOdds, getCurrentOdds } from "@/lib/odds"

export const dynamic = "force-dynamic"

// Test sports to check
const TEST_SPORTS = [
  { key: 'basketball_nba', name: 'NBA' },
  { key: 'americanfootball_nfl', name: 'NFL' },
  { key: 'icehockey_nhl', name: 'NHL' },
  { key: 'americanfootball_ncaaf', name: 'NCAAF' },
]

export async function GET() {
  const startTime = Date.now()
  
  try {
    // Check environment variables
    const envCheck = {
      hasOddsApiKey: !!process.env.ODDS_API_KEY,
      oddsApiKeyLength: process.env.ODDS_API_KEY?.length || 0,
      oddsApiKeyFirst4: process.env.ODDS_API_KEY?.substring(0, 4) || 'N/A',
      oddsApiKeyLast4: process.env.ODDS_API_KEY?.substring(process.env.ODDS_API_KEY.length - 4) || 'N/A',
      hasKvUrl: !!process.env.KV_REST_API_URL,
      hasKvToken: !!process.env.KV_REST_API_TOKEN,
    }
    
    // Direct API test for each sport
    const apiKey = process.env.ODDS_API_KEY
    const directApiTests: Array<{
      sport: string;
      status: number;
      statusText: string;
      gamesCount: number;
      error: string | null;
      responsePreview: string;
      latencyMs: number;
    }> = []
    
    if (apiKey) {
      for (const sport of TEST_SPORTS) {
        const testStart = Date.now()
        try {
          const url = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
          
          const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store',
          })
          
          const responseText = await response.text()
          let gamesCount = 0
          let responsePreview = responseText.substring(0, 200)
          
          if (response.ok) {
            try {
              const data = JSON.parse(responseText)
              gamesCount = Array.isArray(data) ? data.length : 0
            } catch {
              responsePreview = `JSON parse error: ${responseText.substring(0, 100)}`
            }
          }
          
          directApiTests.push({
            sport: sport.key,
            status: response.status,
            statusText: response.statusText,
            gamesCount,
            error: response.ok ? null : responsePreview,
            responsePreview: response.ok ? `${gamesCount} games` : responsePreview,
            latencyMs: Date.now() - testStart,
          })
        } catch (error) {
          directApiTests.push({
            sport: sport.key,
            status: 0,
            statusText: 'Network Error',
            gamesCount: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
            responsePreview: 'N/A',
            latencyMs: Date.now() - testStart,
          })
        }
      }
    }
    
    // First, check what getCurrentOdds returns (uses cache)
    const cachedResult = await getCurrentOdds()
    const cachedTime = Date.now() - startTime
    
    // Then, force fetch fresh data (bypasses cache)
    const freshStartTime = Date.now()
    const freshResult = await fetchAllOdds()
    const freshTime = Date.now() - freshStartTime
    
    const cachedGames = cachedResult?.games || []
    const freshGames = freshResult?.games || []
    
    // Calculate total games from direct API tests
    const directApiTotalGames = directApiTests.reduce((sum, t) => sum + t.gamesCount, 0)
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      envCheck,
      
      // Direct API test results (most important for debugging)
      directApiTests: {
        totalGames: directApiTotalGames,
        sports: directApiTests,
      },
      
      cachedResult: {
        fetchTimeMs: cachedTime,
        gamesCount: cachedGames.length,
        lastUpdated: cachedResult?.lastUpdated || 'N/A',
        isStale: cachedResult?.isStale || false,
        gamesBySport: groupBySport(cachedGames),
      },
      
      freshResult: {
        fetchTimeMs: freshTime,
        gamesCount: freshGames.length,
        lastUpdated: freshResult?.lastUpdated || 'N/A',
        isStale: freshResult?.isStale || false,
        gamesBySport: groupBySport(freshGames),
        sampleGames: freshGames.slice(0, 3).map(g => ({
          id: g.id,
          sport: g.sportName,
          home: g.homeTeam,
          away: g.awayTeam,
          hasOdds: (g.spreads?.length || 0) > 0 || (g.totals?.length || 0) > 0 || (g.moneylines?.length || 0) > 0
        }))
      },
      
      diagnosis: {
        directApiWorking: directApiTotalGames > 0,
        cacheWorking: cachedGames.length > 0,
        freshFetchWorking: freshGames.length > 0,
        issue: directApiTotalGames === 0
          ? 'Direct API calls return 0 games - check API key validity or API status'
          : directApiTotalGames > 0 && freshGames.length === 0
          ? 'Direct API works but fetchAllOdds returns 0 - internal processing issue'
          : cachedGames.length === 0 && freshGames.length > 0 
          ? 'Cache is empty but fresh fetch works - cache may not be saving properly'
          : cachedGames.length === 0 && freshGames.length === 0
          ? 'Both cache and fresh fetch return 0 games - API key may be missing or invalid'
          : 'All systems working correctly'
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
