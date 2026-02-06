import { NextResponse } from "next/server"
import { fetchSportPlayerProps, setCachedPlayerProps, type GamePlayerProps } from "@/lib/odds"
import { computeBestPropWithModel, cacheBestProp, computeBestPropModelFirst, cacheModelFirstProps } from "@/lib/bet-ranking"
import { storePropLineSnapshots } from "@/lib/prop-enhancements"

/**
 * Cron endpoint to fetch player props from Odds API (PAID)
 * 
 * This is separate from fetch-odds to allow different schedules:
 * - ESPN odds (FREE): Every hour (or 30 min during peak)
 * - Player props (PAID): Every 2 hours to conserve API quota
 * 
 * Expected API usage: ~60 requests/day = ~1,800/month
 * (5 sports x 1 request each x 12 times/day)
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    
    const apiKey = process.env.ODDS_API_KEY
    if (!apiKey) {
      console.log("[fetch-props] No ODDS_API_KEY configured, skipping props fetch")
      return NextResponse.json({ 
        success: true, 
        message: "Props fetch skipped - no API key configured",
        propsCount: 0
      })
    }
    
    console.log("[fetch-props] Starting player props fetch (Odds API - PAID)...")
    
    const [nbaProps, nflProps, nhlProps, ncaafProps, ncaabProps] = await Promise.all([
      fetchSportPlayerProps('basketball_nba').catch((e) => {
        console.error("[fetch-props] NBA props error:", e.message)
        return [] as GamePlayerProps[]
      }),
      fetchSportPlayerProps('americanfootball_nfl').catch((e) => {
        console.error("[fetch-props] NFL props error:", e.message)
        return [] as GamePlayerProps[]
      }),
      fetchSportPlayerProps('icehockey_nhl').catch((e) => {
        console.error("[fetch-props] NHL props error:", e.message)
        return [] as GamePlayerProps[]
      }),
      fetchSportPlayerProps('americanfootball_ncaaf').catch((e) => {
        console.error("[fetch-props] NCAAF props error:", e.message)
        return [] as GamePlayerProps[]
      }),
      fetchSportPlayerProps('basketball_ncaab').catch((e) => {
        console.error("[fetch-props] NCAAB props error:", e.message)
        return [] as GamePlayerProps[]
      })
    ])
    
    const allProps = [...nbaProps, ...nflProps, ...nhlProps, ...ncaafProps, ...ncaabProps]
    
    await setCachedPlayerProps(allProps)
    console.log(`[fetch-props] Cached ${allProps.length} games with player props`)

    const allPropLines = allProps.flatMap(game =>
      game.props.map(p => ({
        playerName: p.playerName,
        market: p.market,
        line: p.line,
        overOdds: p.overOdds,
        underOdds: p.underOdds,
        bookmaker: p.bookmaker,
      }))
    )
    storePropLineSnapshots(allPropLines).catch(err =>
      console.error('[fetch-props] Line snapshot store failed:', err)
    )
    
    console.log("[fetch-props] Computing best prop of the day (with model enhancement)...")
    const bestPropResult = await computeBestPropWithModel(allProps)
    await cacheBestProp(bestPropResult)
    
    const bestPropInfo = bestPropResult.bestProp 
      ? `${bestPropResult.bestProp.playerName} ${bestPropResult.bestProp.pick} ${bestPropResult.bestProp.line}`
      : 'none'
    console.log(`[fetch-props] Best prop: ${bestPropInfo}`)
    
    // Also compute and cache model-first props for parlays
    // This uses player stats as the PRIMARY ranking (like Elo for teams)
    console.log("[fetch-props] Computing model-first props for parlays...")
    const modelFirstResult = await computeBestPropModelFirst(allProps)
    await cacheModelFirstProps(modelFirstResult)
    console.log(`[fetch-props] Model-first props: ${modelFirstResult.allRankedProps.length} props ranked`)
    
    return NextResponse.json({
      success: true,
      source: 'Odds API (PAID)',
      propsCount: allProps.length,
      breakdown: {
        nba: nbaProps.length,
        nfl: nflProps.length,
        nhl: nhlProps.length,
        ncaaf: ncaafProps.length,
        ncaab: ncaabProps.length
      },
      bestProp: bestPropResult.bestProp ? {
        player: bestPropResult.bestProp.playerName,
        game: `${bestPropResult.bestProp.awayTeam} @ ${bestPropResult.bestProp.homeTeam}`,
        prop: `${bestPropResult.bestProp.pick} ${bestPropResult.bestProp.line}`,
        market: bestPropResult.bestProp.market
      } : null,
      message: `Fetched props for ${allProps.length} games, Best prop: ${bestPropInfo}`
    })
    
  } catch (error) {
    console.error("[fetch-props] Error:", error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: "Failed to fetch props", details: errorMessage },
      { status: 500 }
    )
  }
}
