import { NextResponse } from "next/server"
import { fetchAllOdds } from "@/lib/odds"
import { 
  computeBestBets, 
  cacheBestBet, 
  computeParlayOfTheDay, 
  cacheParlay,
  computeSportBestBets,
  cacheSportBets
} from "@/lib/bet-ranking"
import { storePick, getAllPicks } from "@/lib/pick-tracking"

/**
 * Cron endpoint to fetch fresh odds data and compute best bet
 * 
 * This endpoint is called by Vercel Cron Jobs at scheduled times:
 * - 8:00 AM ET (13:00 UTC)
 * - 2:00 PM ET (19:00 UTC)
 * - 8:00 PM ET (01:00 UTC next day)
 * 
 * This keeps the odds cache fresh while staying under the 500 requests/month limit.
 * Also computes and caches the deterministic "Best Bet of the Day".
 * Stores picks for track record tracking.
 */
export async function GET(request: Request) {
  try {
    // Verify the request is from Vercel Cron (optional security)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // If CRON_SECRET is set, verify it matches
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    
    // Check if ODDS_API_KEY is configured
    if (!process.env.ODDS_API_KEY) {
      console.error("ODDS_API_KEY is not configured")
      return NextResponse.json({ 
        error: "Odds API not configured",
        details: "ODDS_API_KEY environment variable is not set"
      }, { status: 500 })
    }
    
    console.log("Starting scheduled odds fetch...")
    
    // Fetch fresh odds for all sports
    const oddsData = await fetchAllOdds()
    
    console.log(`Fetched ${oddsData.games.length} games at ${oddsData.lastUpdated}`)
    
    // Compute and cache the best bet
    console.log("Computing best bet...")
    const bestBetResult = computeBestBets(oddsData.games)
    await cacheBestBet(bestBetResult)
    
    console.log(`Best bet computed: ${bestBetResult.bestBet?.team || 'none'} (${bestBetResult.gamesQualified} qualified bets)`)
    
    // Compute and cache parlay of the day
    console.log("Computing parlay of the day...")
    const parlayResult = computeParlayOfTheDay(bestBetResult.allRankedBets)
    await cacheParlay(parlayResult)
    console.log(`Parlay computed: ${parlayResult.safeParlay ? '2-leg safe parlay ready' : 'no parlay available'}`)
    
    // Compute and cache sport-specific best bets
    console.log("Computing sport-specific best bets...")
    const sportBets = computeSportBestBets(bestBetResult.allRankedBets)
    await cacheSportBets(sportBets)
    console.log(`Sport bets computed: ${Object.keys(sportBets).length} sports`)
    
    // Store the best bet pick for track record (if we have one and it's a new game)
    let pickStored = false
    if (bestBetResult.bestBet) {
      const existingPicks = await getAllPicks()
      const alreadyHavePick = existingPicks.some(p => 
        p.gameId === bestBetResult.bestBet!.gameId && 
        p.pickType === 'best_bet' &&
        p.status === 'pending'
      )
      
      if (!alreadyHavePick) {
        const bet = bestBetResult.bestBet
        await storePick({
          gameId: bet.gameId,
          sport: bet.sport,
          sportName: bet.sportName,
          homeTeam: bet.homeTeam,
          awayTeam: bet.awayTeam,
          gameTime: bet.commenceTime,
          pickType: 'best_bet',
          team: bet.team,
          betType: bet.betType,
          odds: bet.bestPrice,
          consensusProbability: bet.consensusProbability,
          impliedProbability: bet.impliedProbability,
          edge: bet.edge,
          bestBook: bet.bestBook
        })
        pickStored = true
        console.log(`Stored pick for track record: ${bet.team}`)
      }
    }
    
    return NextResponse.json({
      success: true,
      gamesCount: oddsData.games.length,
      lastUpdated: oddsData.lastUpdated,
      bestBet: bestBetResult.bestBet ? {
        team: bestBetResult.bestBet.team,
        game: `${bestBetResult.bestBet.awayTeam} @ ${bestBetResult.bestBet.homeTeam}`,
        probability: bestBetResult.bestBet.consensusProbability,
        edge: bestBetResult.bestBet.edge
      } : null,
      qualifiedBets: bestBetResult.gamesQualified,
      pickStored,
      message: `Successfully fetched odds for ${oddsData.games.length} games, best bet: ${bestBetResult.bestBet?.team || 'none'}`
    })
    
  } catch (error) {
    console.error("Cron fetch-odds error:", error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: "Failed to fetch odds", details: errorMessage },
      { status: 500 }
    )
  }
}
