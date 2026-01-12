/**
 * Debug Endpoint: Check and Fetch Player Props
 * 
 * This endpoint checks the props cache status and can trigger a manual fetch.
 * No authorization required for debugging purposes.
 */

import { NextResponse } from "next/server"
import { getCachedPlayerProps, fetchSportPlayerProps, setCachedPlayerProps, type GamePlayerProps } from "@/lib/odds"

export const dynamic = "force-dynamic"

export async function GET() {
  const startTime = Date.now()
  
  try {
    // Check environment variables
    const envCheck = {
      hasOddsApiKey: !!process.env.ODDS_API_KEY,
      oddsApiKeyLength: process.env.ODDS_API_KEY?.length || 0,
      hasKvUrl: !!process.env.KV_REST_API_URL,
      hasKvToken: !!process.env.KV_REST_API_TOKEN,
    }
    
    // Check cached props
    const cachedProps = await getCachedPlayerProps()
    const cacheCheckTime = Date.now() - startTime
    
    // Try to fetch fresh props for NBA (as a test)
    const fetchStartTime = Date.now()
    let freshNbaProps: GamePlayerProps[] = []
    let fetchError: string | null = null
    
    try {
      freshNbaProps = await fetchSportPlayerProps('basketball_nba')
    } catch (error) {
      fetchError = error instanceof Error ? error.message : 'Unknown error'
    }
    const fetchTime = Date.now() - fetchStartTime
    
    // If we got fresh props and cache was empty, populate the cache with ALL sports
    let cacheUpdated = false
    let allProps: GamePlayerProps[] = []
    let sportBreakdown: Record<string, number> = {}
    
    if (freshNbaProps.length > 0 && (!cachedProps || cachedProps.length === 0)) {
      // Fetch all sports and cache
      const [nflProps, nhlProps, ncaabProps, ncaafProps] = await Promise.all([
        fetchSportPlayerProps('americanfootball_nfl').catch(() => [] as GamePlayerProps[]),
        fetchSportPlayerProps('icehockey_nhl').catch(() => [] as GamePlayerProps[]),
        fetchSportPlayerProps('basketball_ncaab').catch(() => [] as GamePlayerProps[]),
        fetchSportPlayerProps('americanfootball_ncaaf').catch(() => [] as GamePlayerProps[]),
      ])
      
      allProps = [...freshNbaProps, ...nflProps, ...nhlProps, ...ncaabProps, ...ncaafProps]
      sportBreakdown = {
        NBA: freshNbaProps.length,
        NFL: nflProps.length,
        NHL: nhlProps.length,
        NCAAB: ncaabProps.length,
        NCAAF: ncaafProps.length,
      }
      
      const cacheWriteSuccess = await setCachedPlayerProps(allProps)
      cacheUpdated = cacheWriteSuccess
    }
    
    // Re-check cache after update to verify it persisted
    const updatedCachedProps = cacheUpdated ? await getCachedPlayerProps() : cachedProps
    
    // Use updated cache if we just wrote to it
    const finalCachedProps = updatedCachedProps || cachedProps
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      envCheck,
      
      cachedProps: {
        checkTimeMs: cacheCheckTime,
        count: finalCachedProps?.length || 0,
        games: finalCachedProps?.map(p => ({
          game: `${p.awayTeam} @ ${p.homeTeam}`,
          sport: p.sport,
          playersCount: p.playersWithProps?.length || 0,
          propsCount: p.props?.length || 0,
        })) || [],
      },
      
      freshFetch: {
        fetchTimeMs: fetchTime,
        nbaGamesWithProps: freshNbaProps.length,
        error: fetchError,
        sample: freshNbaProps.slice(0, 2).map(p => ({
          game: `${p.awayTeam} @ ${p.homeTeam}`,
          playersWithProps: p.playersWithProps?.slice(0, 5) || [],
          propsCount: p.props?.length || 0,
        })),
      },
      
      cacheUpdated,
      sportBreakdown: cacheUpdated ? sportBreakdown : undefined,
      totalPropsCached: cacheUpdated ? allProps.length : undefined,
      
      diagnosis: {
        apiKeyConfigured: envCheck.hasOddsApiKey,
        kvConfigured: envCheck.hasKvUrl && envCheck.hasKvToken,
        cacheHasData: (finalCachedProps?.length || 0) > 0,
        freshFetchWorking: freshNbaProps.length > 0,
        issue: !envCheck.hasOddsApiKey
          ? 'ODDS_API_KEY not configured'
          : fetchError
          ? `API error: ${fetchError}`
          : freshNbaProps.length === 0
          ? 'No props returned from API - props may not be posted yet for today\'s games'
          : cacheUpdated
          ? `Cache updated with ${allProps.length} games across all sports`
          : 'Props system working correctly'
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
