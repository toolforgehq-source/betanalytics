import { NextResponse } from "next/server"
import { type Game } from "@/lib/odds"
import { fetchAllESPNOdds, cacheESPNOdds, fetchAllESPNData, type ESPNOdds, type ESPNInjury } from "@/lib/espn"
import { 
  computeBestBets, 
  cacheBestBet, 
  getCachedBestBet,
  computeParlayOfTheDay, 
  cacheParlay,
  computeSportBestBets,
  cacheSportBets,
  type RankedBet
} from "@/lib/bet-ranking"
import { storePick, getAllPicks, autoGradePicks, lockInAndCleanupPicks } from "@/lib/pick-tracking"
import { trackBestBet, lockInAndCleanupRecommendations } from "@/lib/recommendation-tracking"
import { getWeatherForGames } from "@/lib/weather"
import { getLineMovement } from "@/lib/line-movement"
import { getCachedTeamScheduleData } from "@/lib/team-schedule"
import { storeCLVPick } from "@/lib/clv-tracking"
import { storeCalibrationRecord } from "@/lib/calibration"
import { checkAndSendEdgeAlerts } from "@/lib/edge-alerts"

// Allow up to 60 seconds for cron processing (analyzes 80+ games with Elo lookups)
export const maxDuration = 60

// Extended Game type with ESPN data for injury support
interface EnrichedGame extends Game {
  espnData?: {
    injuries: ESPNInjury[]
  }
}

/**
 * Get today's "betting day" date string in ET timezone.
 * A betting day runs until 2 AM ET the next morning, so at 1 AM ET on March 4
 * we still return the March 3 date string. This keeps picks visible until 2 AM.
 */
function getTodayET(): string {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etNow = new Date(etStr)
  // Before 2 AM ET = still the previous calendar day for betting purposes
  if (etNow.getHours() < 2) {
    etNow.setDate(etNow.getDate() - 1)
  }
  return etNow.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
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
  //
  // SPREAD JUICE: We require real spreadOdds before emitting a spread market.
  // Previously this defaulted to -110/-110 when ESPN didn't return juice
  // (primarily MLB runlines), which silently corrupted every downstream Kelly
  // and edge calculation. ESPN odds enrichment now pulls the real juice from
  // the core odds endpoint; if it's still unavailable, we skip the spread
  // market entirely rather than fabricate a line.
  const homeSpread = espnOdds.spread ?? 0
  const spreads = (espnOdds.spread !== null && espnOdds.spreadOdds) ? [{
    bookmaker: provider,
    market: 'spreads',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.spreadOdds.home, point: homeSpread },
      { name: espnOdds.awayTeam, price: espnOdds.spreadOdds.away, point: -homeSpread }
    ]
  }] : []

  // Build totals array (reject 0 or negative — a total line of 0 is invalid ESPN data).
  // Skip entirely when juice is unavailable, for the same reason as spreads.
  const totals = (espnOdds.overUnder !== null && espnOdds.overUnder > 0 && espnOdds.overUnderOdds) ? [{
    bookmaker: provider,
    market: 'totals',
    outcomes: [
      { name: 'Over', price: espnOdds.overUnderOdds.over, point: espnOdds.overUnder },
      { name: 'Under', price: espnOdds.overUnderOdds.under, point: espnOdds.overUnder }
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
    if (teamScheduleData && teamScheduleData.teams) {
      console.log(`[fetch-odds] Team schedule data available: ${Object.keys(teamScheduleData.teams).length} teams tracked`)
    } else {
      console.log("[fetch-odds] No team schedule data available - rest day adjustments will use defaults")
    }
    
    // Compute the best bet using only TODAY's games
    // Now passing weather, line movement, and team schedule data for situational adjustments
    console.log("Computing best bet from today's games...")
    const bestBetResult = await computeBestBets(todaysGames, weatherMap, lineMovements, teamScheduleData)
    
    // ============================================
    // MERGE with existing cached picks to preserve picks from games that already started.
    // ESPN drops games from its feed once they start or may include in-progress games
    // without odds data. Without merging, picks would disappear when games start.
    // Strategy: keep old picks unless a new pick exists for the same game+team+betType.
    // ============================================
    const existingCache = await getCachedBestBet()
    if (existingCache) {
      // Helper to merge a pick list: keep old picks unless a new pick replaces them.
      // Previously this checked newGameIds (games in ESPN feed), but ESPN can include
      // in-progress games without odds data. That caused old picks to be dropped even
      // though no new pick was produced, making picks disappear when games start.
      // Fix: Only drop old picks if a new pick exists for the exact same game+team+betType.
      const mergePicks = (newPicks: RankedBet[], oldPicks: RankedBet[]): RankedBet[] => {
        const newKeys = new Set(newPicks.map(p => `${p.gameId}:${p.team}:${p.betType}`))
        const uniqueOld = oldPicks.filter(p => !newKeys.has(`${p.gameId}:${p.team}:${p.betType}`))
        return [...newPicks, ...uniqueOld]
      }
      
      const mergedRanked = mergePicks(bestBetResult.allRankedBets, existingCache.allRankedBets || [])
      const mergedElo = mergePicks(bestBetResult.allEloBets, existingCache.allEloBets || [])
      
      const preservedRanked = mergedRanked.length - bestBetResult.allRankedBets.length
      const preservedElo = mergedElo.length - bestBetResult.allEloBets.length
      console.log(`[fetch-odds] Merged with existing cache: preserved ${preservedRanked} strict + ${preservedElo} elo picks from games no longer in ESPN feed`)
      
      bestBetResult.allRankedBets = mergedRanked
      bestBetResult.allEloBets = mergedElo
      
      // Update bestBet to be the highest-scored pick across all merged picks
      const allMerged = [...mergedRanked, ...mergedElo].sort((a, b) => b.score - a.score)
      if (allMerged.length > 0 && (!bestBetResult.bestBet || allMerged[0].score > bestBetResult.bestBet.score)) {
        bestBetResult.bestBet = allMerged[0]
      }
    }
    
    await cacheBestBet(bestBetResult)
    
    console.log(`Best bet computed: ${bestBetResult.bestBet?.team || 'none'} (${bestBetResult.gamesQualified} qualified bets)`)
    
    // ============================================
    // PRIORITY: Store Lock/Strong picks FIRST (before parlay, sport bets, edge alerts)
    // This runs immediately after computeBestBets to avoid timeout before picks are stored.
    // The cron processes 80+ games and can timeout on Vercel if pick storage runs too late.
    // ============================================
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
    const mergedLockStrong = [...strictLockStrong, ...additionalEloPicks]
    
    console.log(`[fetch-odds] Found ${mergedLockStrong.length} Lock/Strong picks (${strictLockStrong.length} from strict + ${additionalEloPicks.length} from relaxed elo) out of ${bestBetResult.allRankedBets.length} strict + ${bestBetResult.allEloBets.length} elo bets`)
    
    // ============================================
    // TIER CAP ENFORCEMENT: Only store max 1 Lock + 3 Strong = 4 picks per day.
    // The mergedLockStrong list can have 6-8+ picks because strict and elo pools
    // are independently tiered. Without this cap, excess picks get stored, locked
    // in when games start, graded, and inflate the public record.
    // ============================================
    const MAX_STORED_LOCKS = 1
    const MAX_STORED_STRONG = 2
    mergedLockStrong.sort((a, b) => b.score - a.score)
    let storedLockCount = 0
    let storedStrongCount = 0
    const lockStrongBets = mergedLockStrong.filter(bet => {
      if (bet.confidenceTier === 'lock' && storedLockCount < MAX_STORED_LOCKS) {
        storedLockCount++
        return true
      }
      if (bet.confidenceTier === 'strong' && storedStrongCount < MAX_STORED_STRONG) {
        storedStrongCount++
        return true
      }
      return false
    })
    console.log(`[fetch-odds] After tier cap: ${lockStrongBets.length} picks to store (${storedLockCount} lock + ${storedStrongCount} strong), dropped ${mergedLockStrong.length - lockStrongBets.length} excess`)
    
    // Log top 5 bets by score from each source for debugging tier assignment
    const topStrict = bestBetResult.allRankedBets.slice(0, 5)
    const topElo = bestBetResult.allEloBets.slice(0, 5)
    console.log(`[fetch-odds] Top strict bets: ${topStrict.map(b => `${b.team}(p=${b.eloProbability?.toFixed(1) ?? '?'},e=${b.edge.toFixed(1)},c=${b.eloConfidence},t=${b.confidenceTier})`).join(', ')}`)
    console.log(`[fetch-odds] Top elo bets: ${topElo.map(b => `${b.team}(p=${b.eloProbability?.toFixed(1) ?? '?'},e=${b.edge.toFixed(1)},c=${b.eloConfidence},t=${b.confidenceTier})`).join(', ')}`)
    
    // ============================================
    // LOCK-IN & CLEANUP: Before storing new picks, lock in started games
    // and void any picks that have been superseded.
    // This prevents duplicate counting and ensures the record only reflects
    // picks that were active when the game started.
    // ============================================
    // SAFETY GUARD: Only run cleanup if we actually have Lock/Strong picks.
    // If the cron produced 0 picks (ESPN data glitch, timeout, off-season),
    // an empty active set would incorrectly void ALL pending picks.
    if (lockStrongBets.length > 0) {
      // Build active game keys from current Lock/Strong computation
      // For pick-tracking: "gameId:team:betType" (matches storePick dedup key)
      // For recommendation-tracking: "gameId:betType" (matches recommendation grouping)
      const activePickKeys = new Set(lockStrongBets.map(b => `${b.gameId}:${b.team}:${b.betType}`))
      const activeRecoKeys = new Set(lockStrongBets.map(b => `${b.gameId}:${b.betType}`))
      
      // Run cleanup on both tracking systems
      const [pickCleanup, recoCleanup] = await Promise.all([
        lockInAndCleanupPicks(activePickKeys).catch(err => {
          console.error('[fetch-odds] Pick cleanup failed:', err)
          return { lockedIn: 0, cancelled: 0, deduped: 0 }
        }),
        lockInAndCleanupRecommendations(activeRecoKeys).catch(err => {
          console.error('[fetch-odds] Recommendation cleanup failed:', err)
          return { lockedIn: 0, voided: 0, deduped: 0 }
        })
      ])
      console.log(`[fetch-odds] Pick cleanup: ${pickCleanup.lockedIn} locked, ${pickCleanup.cancelled} cancelled, ${pickCleanup.deduped} deduped`)
      console.log(`[fetch-odds] Reco cleanup: ${recoCleanup.lockedIn} locked, ${recoCleanup.voided} voided, ${recoCleanup.deduped} deduped`)
    } else {
      console.log('[fetch-odds] No Lock/Strong picks found — skipping cleanup to avoid voiding all pending picks')
    }
    
    if (lockStrongBets.length > 0) {
      const existingPicks = await getAllPicks()
      
      for (const bet of lockStrongBets) {
        // Check if we already have this SPECIFIC pick (same game + team + bet type)
        // Also check for locked-in picks — never replace a locked pick
        const alreadyHavePick = existingPicks.some(p => 
          p.gameId === bet.gameId && 
          p.team === bet.team &&
          p.betType === bet.betType &&
          p.pickType === 'best_bet' &&
          (p.status === 'pending' || p.lockedIn)
        )
        
        // ALWAYS update recommendation-tracking (upserts tier/score/odds).
        // Previously this was gated by !alreadyHavePick, so once a pick existed
        // in pick-tracking, the recommendation record was never updated with
        // new tiers or scores. This caused the Performance page to show stale
        // data that didn't match the Model Picks page.
        await trackBestBet(bet)
        
        if (!alreadyHavePick) {
          // Store in pick-tracking system (for grading/track record)
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
            line: bet.line,
            odds: bet.bestPrice,
            consensusProbability: bet.consensusProbability,
            impliedProbability: bet.impliedProbability,
            edge: bet.edge,
            bestBook: bet.bestBook
          })
          picksStored++
          console.log(`[fetch-odds] Stored + tracked: ${bet.team} (tier: ${bet.confidenceTier})`)
        
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
          
          // Store calibration record (tracks predicted probability vs actual outcome)
          await storeCalibrationRecord({
            gameId: bet.gameId,
            sport: bet.sport,
            betType: bet.betType as 'spread' | 'moneyline' | 'total' | 'prop',
            team: bet.team,
            predictedProbability: bet.consensusProbability / 100
          })
        } else {
          console.log(`[fetch-odds] Pick exists in pick-tracking for ${bet.team} (${bet.gameId}) — updated recommendation only`)
        }
      }
    } else {
      console.log(`[fetch-odds] No Lock/Strong picks found today — best bet: ${bestBetResult.bestBet?.team || 'none'} (tier: ${bestBetResult.bestBet?.confidenceTier || 'none'})`)
    }
    console.log(`[fetch-odds] Pick storage complete: ${picksStored} new picks stored`)
    
    // Compute and cache parlay of the day
    console.log("Computing parlay of the day...")
    const parlayResult = computeParlayOfTheDay(bestBetResult.allRankedBets)
    await cacheParlay(parlayResult)
    console.log(`Parlay computed: ${parlayResult.safeParlay ? '2-leg safe parlay ready' : 'no parlay available'}`)
    
    // Compute and cache sport-specific best bets
    console.log("[fetch-odds] Computing sport-specific best bets...")
    const sportBets = computeSportBestBets(bestBetResult.allEloBets)
    await cacheSportBets(sportBets)
    console.log(`[fetch-odds] Sport bets computed: ${Object.keys(sportBets).length} sports (from ${bestBetResult.allEloBets.length} Elo bets)`)
    
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
    
    // Build tier diagnostic summary for response
    const tierSummary = {
      strict: {
        total: bestBetResult.allRankedBets.length,
        locks: bestBetResult.allRankedBets.filter(b => b.confidenceTier === 'lock').length,
        strong: bestBetResult.allRankedBets.filter(b => b.confidenceTier === 'strong').length,
        value: bestBetResult.allRankedBets.filter(b => b.confidenceTier === 'value').length,
      },
      elo: {
        total: bestBetResult.allEloBets.length,
        locks: bestBetResult.allEloBets.filter(b => b.confidenceTier === 'lock').length,
        strong: bestBetResult.allEloBets.filter(b => b.confidenceTier === 'strong').length,
        value: bestBetResult.allEloBets.filter(b => b.confidenceTier === 'value').length,
      },
      topBets: bestBetResult.allEloBets.slice(0, 5).map(b => ({
        team: b.team,
        sport: b.sport,
        prob: b.eloProbability?.toFixed(1),
        edge: b.edge.toFixed(1),
        confidence: b.eloConfidence,
        tier: b.confidenceTier,
        score: b.score,
      })),
    }
    
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
      tierSummary,
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
