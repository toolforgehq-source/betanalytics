import { NextResponse } from "next/server"
import { fetchSportPlayerProps, setCachedPlayerProps, type GamePlayerProps, type Game } from "@/lib/odds"
import { fetchAllESPNOdds, type ESPNOdds } from "@/lib/espn"
import { 
  computeBestBets, 
  cacheBestBet, 
  computeParlayOfTheDay, 
  cacheParlay,
  computeSportBestBets,
  cacheSportBets,
  computeBestProp,
  cacheBestProp
} from "@/lib/bet-ranking"
import { storePick, getAllPicks, autoGradePicks } from "@/lib/pick-tracking"

/**
 * Convert ESPN odds to Game format for best bet computation
 */
function convertESPNOddsToGame(espnOdds: ESPNOdds): Game {
  // Map ESPN league names to sport keys
  const sportKeyMap: Record<string, string> = {
    'NBA': 'basketball_nba',
    'NFL': 'americanfootball_nfl',
    'NHL': 'icehockey_nhl',
    'NCAAB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'MLB': 'baseball_mlb',
    'English Premier League': 'soccer_epl',
    'La Liga': 'soccer_spain_la_liga',
    'Bundesliga': 'soccer_germany_bundesliga',
    'Serie A': 'soccer_italy_serie_a',
    'Ligue 1': 'soccer_france_ligue_one',
    'MLS': 'soccer_usa_mls',
    'UEFA Champions League': 'soccer_uefa_champs_league',
    'UFC': 'mma_mixed_martial_arts',
    'PGA Tour': 'golf_pga',
    'ATP Tennis': 'tennis_atp',
  }
  
  const sportKey = sportKeyMap[espnOdds.league] || espnOdds.sport
  const provider = espnOdds.provider || 'DraftKings'
  
  // Build spreads array
  const spreads = espnOdds.spread !== null ? [{
    bookmaker: provider,
    market: 'spreads',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.spreadOdds?.home || -110, point: espnOdds.homeFavorite ? espnOdds.spread : -espnOdds.spread },
      { name: espnOdds.awayTeam, price: espnOdds.spreadOdds?.away || -110, point: espnOdds.homeFavorite ? -espnOdds.spread : espnOdds.spread }
    ]
  }] : []
  
  // Build totals array
  const totals = espnOdds.overUnder !== null ? [{
    bookmaker: provider,
    market: 'totals',
    outcomes: [
      { name: 'Over', price: espnOdds.overUnderOdds?.over || -110, point: espnOdds.overUnder },
      { name: 'Under', price: espnOdds.overUnderOdds?.under || -110, point: espnOdds.overUnder }
    ]
  }] : []
  
  // Build moneylines array
  const moneylines = espnOdds.moneyline ? [{
    bookmaker: provider,
    market: 'h2h',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.moneyline.home },
      { name: espnOdds.awayTeam, price: espnOdds.moneyline.away }
    ]
  }] : []
  
  return {
    id: espnOdds.gameId,
    sport: sportKey,
    sportName: espnOdds.league,
    homeTeam: espnOdds.homeTeam,
    awayTeam: espnOdds.awayTeam,
    commenceTime: espnOdds.commenceTime,
    spreads,
    totals,
    moneylines
  }
}

/**
 * Cron endpoint to fetch fresh odds data and compute best bet
 * 
 * COST OPTIMIZATION:
 * - ESPN odds are FREE - used for all game lines (spreads, totals, moneylines)
 * - Odds API is PAID - used ONLY for player props (~30 requests per cron run)
 * 
 * This endpoint is called by Vercel Cron Jobs every 4 hours.
 * 
 * Expected API usage: ~180 requests/month (down from ~18,000/month)
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
    
    // Note: ODDS_API_KEY is only needed for player props now
    // ESPN odds are FREE and don't require authentication
    
    console.log("Starting scheduled odds fetch (ESPN FREE + Odds API props only)...")
    
    // Fetch fresh odds from ESPN (FREE - no API key needed)
    console.log("Fetching ESPN odds (FREE)...")
    const espnOddsData = await fetchAllESPNOdds()
    
    console.log(`Fetched ${espnOddsData.games.length} games with odds from ESPN at ${espnOddsData.lastUpdated}`)
    
    // Convert ESPN odds to Game format for best bet computation
    const gamesForBestBet = espnOddsData.games.map(espnOdds => convertESPNOddsToGame(espnOdds))
    
    // Compute and cache the best bet using ESPN odds
    console.log("Computing best bet from ESPN odds...")
    const bestBetResult = computeBestBets(gamesForBestBet)
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
    
    // Fetch and cache player props for all major sports
    // This is now the ONLY place props are fetched (not per-chat request)
    console.log("Fetching and caching player props...")
    const [nbaProps, nflProps, nhlProps, ncaafProps, ncaabProps] = await Promise.all([
      fetchSportPlayerProps('basketball_nba').catch(() => [] as GamePlayerProps[]),
      fetchSportPlayerProps('americanfootball_nfl').catch(() => [] as GamePlayerProps[]),
      fetchSportPlayerProps('icehockey_nhl').catch(() => [] as GamePlayerProps[]),
      fetchSportPlayerProps('americanfootball_ncaaf').catch(() => [] as GamePlayerProps[]),
      fetchSportPlayerProps('basketball_ncaab').catch(() => [] as GamePlayerProps[])
    ])
    const allProps = [...nbaProps, ...nflProps, ...nhlProps, ...ncaafProps, ...ncaabProps]
    
    // Cache the props so chat requests don't need to fetch them
    await setCachedPlayerProps(allProps)
    console.log(`Cached ${allProps.length} games with player props`)
    
    // Compute and cache best prop of the day
    console.log("Computing best prop of the day...")
    const bestPropResult = computeBestProp(allProps)
    await cacheBestProp(bestPropResult)
    console.log(`Best prop computed: ${bestPropResult.bestProp ? `${bestPropResult.bestProp.playerName} ${bestPropResult.bestProp.pick} ${bestPropResult.bestProp.line}` : 'none'}`)
    
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
    
    // Auto-grade any pending picks that have completed
    console.log("Auto-grading pending picks...")
    const gradingResult = await autoGradePicks()
    console.log(`Auto-grading complete: ${gradingResult.graded} graded, ${gradingResult.errors} errors`)
    
    return NextResponse.json({
      success: true,
      source: 'ESPN (FREE)',
      gamesCount: espnOddsData.games.length,
      lastUpdated: espnOddsData.lastUpdated,
      bestBet: bestBetResult.bestBet ? {
        team: bestBetResult.bestBet.team,
        game: `${bestBetResult.bestBet.awayTeam} @ ${bestBetResult.bestBet.homeTeam}`,
        probability: bestBetResult.bestBet.consensusProbability,
        edge: bestBetResult.bestBet.edge
      } : null,
      qualifiedBets: bestBetResult.gamesQualified,
      propsCount: allProps.length,
      pickStored,
      grading: {
        picksGraded: gradingResult.graded,
        errors: gradingResult.errors,
        pendingPicks: gradingResult.pending
      },
      message: `ESPN odds: ${espnOddsData.games.length} games (FREE), Props: ${allProps.length} games (Odds API), Best bet: ${bestBetResult.bestBet?.team || 'none'}, Graded: ${gradingResult.graded} picks`
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
