import { NextResponse } from "next/server"
import { type Game } from "@/lib/odds"
import { fetchAllESPNOdds, cacheESPNOdds, fetchAllESPNData, type ESPNOdds, type ESPNInjury } from "@/lib/espn"
import { 
  computeBestBets, 
  cacheBestBet, 
  computeParlayOfTheDay, 
  cacheParlay,
  computeSportBestBets,
  cacheSportBets
} from "@/lib/bet-ranking"
import { storePick, getAllPicks, autoGradePicks } from "@/lib/pick-tracking"
import { trackBestBet } from "@/lib/recommendation-tracking"
import { getWeatherForGames } from "@/lib/weather"
import { getLineMovement } from "@/lib/line-movement"
import { getCachedTeamScheduleData } from "@/lib/team-schedule"
import { storeCLVPick } from "@/lib/clv-tracking"
import { storeCalibrationRecord } from "@/lib/calibration"
import { checkAndSendEdgeAlerts } from "@/lib/edge-alerts"

// Extended Game type with ESPN data for injury support
interface EnrichedGame extends Game {
  espnData?: {
    injuries: ESPNInjury[]
  }
}

/**
 * Get today's date string in ET timezone (America/New_York)
 */
function getTodayET(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
}

/**
 * Check if a game's commence time falls on today (ET timezone)
 */
function isGameToday(commenceTime: string): boolean {
  const todayET = getTodayET()
  const gameDate = new Date(commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  return gameDate === todayET
}

/**
 * Filter games to only include those happening today (ET timezone)
 */
function filterGamesToday<T extends { commenceTime: string }>(games: T[]): T[] {
  return games.filter(game => isGameToday(game.commenceTime))
}

/**
 * Normalize team name for matching between ESPN odds and ESPN data
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

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
  // SPREAD SIGN CONVENTION:
  // ESPN's pickcenter.spread is ALREADY SIGNED from the home team's perspective:
  // - Negative value (e.g., -6.5) means home team is favorite
  // - Positive value (e.g., +6.5) means home team is underdog
  // We use the spread value directly without re-signing based on homeFavorite.
  const homeSpread = espnOdds.spread ?? 0
  const spreads = espnOdds.spread !== null ? [{
    bookmaker: provider,
    market: 'spreads',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.spreadOdds?.home || -110, point: homeSpread },
      { name: espnOdds.awayTeam, price: espnOdds.spreadOdds?.away || -110, point: -homeSpread }
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
 * Cron endpoint to fetch ESPN odds (FREE) and compute best bets
 * 
 * This endpoint handles:
 * - Fetching game odds from ESPN (spreads, totals, moneylines) - FREE
 * - Computing best bet, parlay, and sport-specific bets
 * - Storing picks for track record
 * - Auto-grading completed picks
 * 
 * Player props are handled by a separate /api/cron/fetch-props endpoint
 * to allow different update frequencies (props are PAID via Odds API).
 * 
 * Schedule: Every hour (or 30 min during peak hours)
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
    
    console.log("[fetch-odds] Starting ESPN odds fetch (FREE)...")
    
    // Fetch both ESPN odds and ESPN data (with injuries) in parallel
    const [espnOddsData, espnData] = await Promise.all([
      fetchAllESPNOdds(),
      fetchAllESPNData()
    ])
    
    console.log(`Fetched ${espnOddsData.games.length} games with odds from ESPN at ${espnOddsData.lastUpdated}`)
    console.log(`Fetched ${espnData.games.length} games with injury data from ESPN`)
    
    // Cache ESPN odds to Redis for persistence across serverless invocations
    await cacheESPNOdds(espnOddsData)
    console.log(`[fetch-odds] Cached ESPN odds to Redis`)
    
    // Convert ESPN odds to Game format and enrich with injury data
    const allGames: EnrichedGame[] = espnOddsData.games.map(espnOdds => {
      const game = convertESPNOddsToGame(espnOdds)
      
      // Find matching ESPN game data (which has injuries)
      const matchingEspnGame = espnData.games.find(eg => {
        const oddsHome = normalizeTeamName(espnOdds.homeTeam)
        const oddsAway = normalizeTeamName(espnOdds.awayTeam)
        const espnHome = normalizeTeamName(eg.homeTeam.name)
        const espnAway = normalizeTeamName(eg.awayTeam.name)
        
        // Check for exact or partial matches
        const homeMatch = oddsHome === espnHome || 
          oddsHome.includes(espnHome) || espnHome.includes(oddsHome) ||
          oddsHome.split(' ').some(word => espnHome.includes(word) && word.length > 3)
        const awayMatch = oddsAway === espnAway || 
          oddsAway.includes(espnAway) || espnAway.includes(oddsAway) ||
          oddsAway.split(' ').some(word => espnAway.includes(word) && word.length > 3)
        
        return homeMatch && awayMatch
      })
      
      // Attach injury data if found
      if (matchingEspnGame && matchingEspnGame.injuries.length > 0) {
        console.log(`[fetch-odds] Found ${matchingEspnGame.injuries.length} injuries for ${espnOdds.homeTeam} vs ${espnOdds.awayTeam}`)
        return {
          ...game,
          espnData: {
            injuries: matchingEspnGame.injuries
          }
        }
      }
      
      return game
    })
    
    // Count games with injuries attached
    const gamesWithInjuries = allGames.filter(g => g.espnData?.injuries?.length).length
    console.log(`[fetch-odds] Attached injuries to ${gamesWithInjuries} games`)
    
    // Filter to TODAY's games only (ET timezone) for "best bet today"
    // This ensures when users ask "What's the best bet today?" they get a game happening TODAY
    const todaysGames = filterGamesToday(allGames)
    console.log(`[fetch-odds] Filtered to ${todaysGames.length} games today (ET) out of ${allGames.length} total`)
    
    // Fetch weather data for outdoor games (NFL, MLB, MLS)
    console.log("[fetch-odds] Fetching weather data for outdoor games...")
    const outdoorGames = todaysGames.filter(g => 
      g.sport.includes('football') || g.sport.includes('baseball') || g.sport.includes('soccer')
    ).map(g => ({ id: g.id, homeTeam: g.homeTeam, sport: g.sport }))
    const weatherMap = await getWeatherForGames(outdoorGames).catch(err => {
      console.error("[fetch-odds] Weather fetch failed:", err)
      return new Map()
    })
    console.log(`[fetch-odds] Weather data fetched for ${weatherMap.size} games`)
    
    // Fetch line movement data (compares current odds to opening lines)
    console.log("[fetch-odds] Fetching line movement data...")
    const lineMovements = await getLineMovement(todaysGames).catch(err => {
      console.error("[fetch-odds] Line movement fetch failed:", err)
      return []
    })
    const sharpGames = lineMovements.filter(lm => lm.movement.sharpIndicator).length
    console.log(`[fetch-odds] Line movement data fetched: ${lineMovements.length} games tracked, ${sharpGames} with sharp money indicators`)
    
    // Fetch team schedule data for rest day calculations
    console.log("[fetch-odds] Fetching team schedule data for rest days...")
    const teamScheduleData = await getCachedTeamScheduleData().catch(err => {
      console.error("[fetch-odds] Team schedule fetch failed:", err)
      return null
    })
    if (teamScheduleData) {
      console.log(`[fetch-odds] Team schedule data available: ${Object.keys(teamScheduleData.teams).length} teams tracked`)
    } else {
      console.log("[fetch-odds] No team schedule data available - rest day adjustments will use defaults")
    }
    
    // Compute and cache the best bet using only TODAY's games
    // Now passing weather, line movement, and team schedule data for situational adjustments
    console.log("Computing best bet from today's games...")
    const bestBetResult = await computeBestBets(todaysGames, weatherMap, lineMovements, teamScheduleData)
    await cacheBestBet(bestBetResult)
    
    console.log(`Best bet computed: ${bestBetResult.bestBet?.team || 'none'} (${bestBetResult.gamesQualified} qualified bets)`)
    
    // Compute and cache parlay of the day
    console.log("Computing parlay of the day...")
    const parlayResult = computeParlayOfTheDay(bestBetResult.allRankedBets)
    await cacheParlay(parlayResult)
    console.log(`Parlay computed: ${parlayResult.safeParlay ? '2-leg safe parlay ready' : 'no parlay available'}`)
    
    // Compute and cache sport-specific best bets
    // Use allEloBets (not allRankedBets) so sport-specific queries work even when
    // no bets pass strict filters. This ensures "best NHL bet" returns Elo-based
    // recommendations even if no NHL bets qualify for "best bet of the day"
    console.log("[fetch-odds] Computing sport-specific best bets...")
    const sportBets = computeSportBestBets(bestBetResult.allEloBets)
    await cacheSportBets(sportBets)
    console.log(`[fetch-odds] Sport bets computed: ${Object.keys(sportBets).length} sports (from ${bestBetResult.allEloBets.length} Elo bets)`)
    
    // Store ALL Lock + Strong tier picks for track record (not just the single best bet)
    // CRITICAL FIX: Check BOTH allRankedBets (strict analyzeGame filters) AND allEloBets
    // (relaxed analyzeGameForSportQuery filters). The strict path rejects many qualifying picks
    // (e.g., NCAAB conference strength filter, Elo confidence gate, multi-signal rejection)
    // that the relaxed path accepts. Without this, the model picks page can be empty even when
    // the chat shows high-scoring picks like Alabama A&M (88/100, 12.6% edge).
    let picksStored = 0
    const strictLockStrong = bestBetResult.allRankedBets.filter(
      b => b.confidenceTier === 'lock' || b.confidenceTier === 'strong'
    )
    const eloLockStrong = bestBetResult.allEloBets.filter(
      b => b.confidenceTier === 'lock' || b.confidenceTier === 'strong'
    )
    
    // Merge: start with strict picks, then add elo picks not already covered (by gameId + team)
    const seenKeys = new Set(strictLockStrong.map(b => `${b.gameId}:${b.team}`))
    const additionalEloPicks = eloLockStrong.filter(b => !seenKeys.has(`${b.gameId}:${b.team}`))
    const lockStrongBets = [...strictLockStrong, ...additionalEloPicks]
    
    console.log(`[fetch-odds] Found ${lockStrongBets.length} Lock/Strong picks (${strictLockStrong.length} from strict + ${additionalEloPicks.length} from relaxed elo) out of ${bestBetResult.allRankedBets.length} strict + ${bestBetResult.allEloBets.length} elo bets`)
    
    if (lockStrongBets.length > 0) {
      const existingPicks = await getAllPicks()
      
      for (const bet of lockStrongBets) {
        const alreadyHavePick = existingPicks.some(p => 
          p.gameId === bet.gameId && 
          p.pickType === 'best_bet' &&
          p.status === 'pending'
        )
        
        if (!alreadyHavePick) {
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
          picksStored++
          console.log(`Stored pick for track record: ${bet.team} (tier: ${bet.confidenceTier})`)
          
          // Also track in recommendation system (this is what the /picks page reads from)
          // storePick() writes to pick-tracking, but the picks page uses getRecentRecommendations()
          // which reads from the recommendation-tracking system — a separate Redis store.
          await trackBestBet(bet)
          console.log(`[Tracking] Tracked recommendation: ${bet.team} (tier: ${bet.confidenceTier})`)
        
          // Track CLV for this pick (stores the line at pick time)
          await storeCLVPick({
            gameId: bet.gameId,
            sport: bet.sport,
            betType: bet.betType as 'spread' | 'moneyline' | 'total' | 'prop',
            team: bet.team,
            pickLine: bet.line ?? 0,
            pickPrice: bet.bestPrice,
            pickProbability: bet.consensusProbability / 100,
            pickTimestamp: new Date().toISOString(),
            gameTimestamp: bet.commenceTime
          })
          console.log(`[CLV] Tracked pick: ${bet.team} ${bet.betType} at line ${bet.line ?? 'ML'}`)
          
          // Store calibration record (tracks predicted probability vs actual outcome)
          await storeCalibrationRecord({
            gameId: bet.gameId,
            sport: bet.sport,
            betType: bet.betType as 'spread' | 'moneyline' | 'total' | 'prop',
            team: bet.team,
            predictedProbability: bet.consensusProbability / 100
          })
          console.log(`[Calibration] Tracked prediction: ${bet.team} at ${bet.consensusProbability}%`)
        } else {
          console.log(`[fetch-odds] Pick already exists for ${bet.team} (${bet.gameId}) — skipping`)
        }
      }
    } else {
      console.log(`[fetch-odds] No Lock/Strong picks found today — best bet: ${bestBetResult.bestBet?.team || 'none'} (tier: ${bestBetResult.bestBet?.confidenceTier || 'none'})`)
    }
    
    // Check for big edge alerts (10%+ edge) and send to opted-in subscribers
    console.log("[fetch-odds] Checking for big edge alerts...")
    const alertResult = await checkAndSendEdgeAlerts(bestBetResult.allRankedBets).catch(err => {
      console.error("[fetch-odds] Edge alert check failed:", err)
      return { sent: 0, skipped: 'error' }
    })
    console.log(`[fetch-odds] Edge alerts: ${alertResult.sent} sent${alertResult.skipped ? ` (${alertResult.skipped})` : ''}`)

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
      picksStored,
      grading: {
        picksGraded: gradingResult.graded,
        errors: gradingResult.errors,
        pendingPicks: gradingResult.pending
      },
      edgeAlerts: {
        sent: alertResult.sent,
        skipped: alertResult.skipped
      },
      message: `ESPN odds: ${espnOddsData.games.length} games (FREE), Best bet: ${bestBetResult.bestBet?.team || 'none'}, Graded: ${gradingResult.graded} picks`
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
