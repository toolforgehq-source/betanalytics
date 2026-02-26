/**
 * Debug Endpoint: Trace NHL Query
 * 
 * This endpoint traces the exact data flow for "best NHL bet tonight" query
 * to identify where the disconnect between Elo and Odds data is happening.
 */

import { NextResponse } from 'next/server'
import { getCachedESPNOdds } from '@/lib/espn'
import { getEloWinProbabilityByName, getEloRatings } from '@/lib/elo'
import { computeBestBets, getCachedSportBets, getFilteredBestBetWithElo } from '@/lib/bet-ranking'
import type { Game } from '@/lib/odds'
import { requireDebugAuth } from "@/lib/debug-auth"

export const runtime = 'edge'
export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  const trace: Record<string, unknown> = {}
  
  try {
    // Step 1: Check Elo cache
    trace.step1_eloCache = {}
    const eloData = await getEloRatings()
    if (eloData) {
      const nhlTeams = Object.values(eloData.ratings || {}).filter(r => r.league === 'NHL')
      trace.step1_eloCache = {
        hasData: true,
        totalTeams: Object.keys(eloData.ratings || {}).length,
        nhlTeams: nhlTeams.length,
        nhlSample: nhlTeams.slice(0, 5).map(t => ({ name: t.teamName, rating: t.rating, games: t.gamesPlayed })),
        lastUpdated: eloData.lastUpdated
      }
    } else {
      trace.step1_eloCache = { hasData: false, error: 'Elo cache is empty' }
    }
    
    // Step 2: Check ESPN odds cache
    trace.step2_oddsCache = {}
    const espnOdds = await getCachedESPNOdds()
    const nhlGamesInOdds = espnOdds.games.filter(g => g.league === 'NHL')
    trace.step2_oddsCache = {
      totalGames: espnOdds.games.length,
      nhlGames: nhlGamesInOdds.length,
      nhlGamesList: nhlGamesInOdds.map(g => ({
        home: g.homeTeam,
        away: g.awayTeam,
        commenceTime: g.commenceTime,
        commenceTimeET: new Date(g.commenceTime).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        league: g.league,
        sport: g.sport,
        hasMoneyline: !!g.moneyline,
        hasSpread: g.spread !== null
      }))
    }
    
    // Step 3: Date filtering
    trace.step3_dateFilter = {}
    const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    const nhlGamesToday = nhlGamesInOdds.filter(g => {
      const gameDate = new Date(g.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return gameDate === todayET
    })
    trace.step3_dateFilter = {
      todayET,
      nhlGamesToday: nhlGamesToday.length,
      nhlGamesFiltered: nhlGamesInOdds.map(g => ({
        game: `${g.awayTeam} @ ${g.homeTeam}`,
        gameDate: new Date(g.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' }),
        isToday: new Date(g.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === todayET
      }))
    }
    
    // Step 4: Sport key mapping
    trace.step4_sportKeyMapping = {
      mapping: {
        'NBA': 'basketball_nba',
        'NHL': 'icehockey_nhl',
        'NFL': 'americanfootball_nfl'
      },
      nhlGamesWithKeys: nhlGamesToday.map(g => ({
        game: `${g.awayTeam} @ ${g.homeTeam}`,
        originalSport: g.sport,
        mappedSport: 'icehockey_nhl',
        sportName: g.league
      }))
    }
    
    // Step 5: Elo lookup for each NHL game
    trace.step5_eloLookup = {}
    const eloLookupResults = []
    for (const game of nhlGamesToday) {
      const eloResult = await getEloWinProbabilityByName('NHL', game.homeTeam, game.awayTeam)
      eloLookupResults.push({
        game: `${game.awayTeam} @ ${game.homeTeam}`,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        eloFound: !!eloResult,
        eloResult: eloResult ? {
          homeRating: eloResult.homeRating,
          awayRating: eloResult.awayRating,
          probability: eloResult.probability,
          confidence: eloResult.confidence
        } : null
      })
    }
    trace.step5_eloLookup = {
      gamesChecked: nhlGamesToday.length,
      gamesWithElo: eloLookupResults.filter(r => r.eloFound).length,
      results: eloLookupResults
    }
    
    // Step 6: Check cached sport bets
    trace.step6_cachedSportBets = {}
    const cachedSportBets = await getCachedSportBets()
    if (cachedSportBets) {
      const nhlBet = cachedSportBets['NHL']
      trace.step6_cachedSportBets = {
        hasCachedBets: true,
        sports: Object.keys(cachedSportBets),
        hasNHL: !!nhlBet,
        nhlBet: nhlBet ? {
          team: nhlBet.team,
          homeTeam: nhlBet.homeTeam,
          awayTeam: nhlBet.awayTeam,
          score: nhlBet.score,
          eloProbability: nhlBet.eloProbability
        } : null
      }
    } else {
      trace.step6_cachedSportBets = { hasCachedBets: false }
    }
    
    // Step 7: Compute best bets on-demand (if we have NHL games today)
    trace.step7_computeBestBets = {}
    if (nhlGamesToday.length > 0) {
      const sportKeyMap: Record<string, string> = {
        'NBA': 'basketball_nba',
        'NFL': 'americanfootball_nfl',
        'NHL': 'icehockey_nhl',
        'NCAAB': 'basketball_ncaab',
        'NCAAF': 'americanfootball_ncaaf',
        'MLB': 'baseball_mlb',
      }
      
      const todaysGames: Game[] = nhlGamesToday.map(g => {
        const sportKey = sportKeyMap[g.league] || g.sport
        const provider = g.provider || 'DraftKings'
        const homeSpread = g.spread ?? 0
        
        return {
          id: g.gameId,
          sport: sportKey,
          sportName: g.league,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          commenceTime: g.commenceTime,
          spreads: g.spread !== null ? [{
            bookmaker: provider,
            market: 'spreads',
            outcomes: [
              { name: g.homeTeam, price: g.spreadOdds?.home || -110, point: homeSpread },
              { name: g.awayTeam, price: g.spreadOdds?.away || -110, point: -homeSpread }
            ]
          }] : [],
          totals: g.overUnder !== null ? [{
            bookmaker: provider,
            market: 'totals',
            outcomes: [
              { name: 'Over', price: g.overUnderOdds?.over || -110, point: g.overUnder },
              { name: 'Under', price: g.overUnderOdds?.under || -110, point: g.overUnder }
            ]
          }] : [],
          moneylines: g.moneyline ? [{
            bookmaker: provider,
            market: 'h2h',
            outcomes: [
              { name: g.homeTeam, price: g.moneyline.home },
              { name: g.awayTeam, price: g.moneyline.away }
            ]
          }] : []
        }
      })
      
      const bestBetResult = await computeBestBets(todaysGames)
      
      const nhlBets = bestBetResult.allEloBets?.filter(b => b.sportName === 'NHL') || []
      
      trace.step7_computeBestBets = {
        gamesAnalyzed: bestBetResult.gamesAnalyzed,
        gamesQualified: bestBetResult.gamesQualified,
        totalEloBets: bestBetResult.allEloBets?.length || 0,
        nhlEloBets: nhlBets.length,
        nhlBetsSample: nhlBets.slice(0, 3).map(b => ({
          team: b.team,
          homeTeam: b.homeTeam,
          awayTeam: b.awayTeam,
          score: b.score,
          eloProbability: b.eloProbability,
          edge: b.edge
        })),
        reason: bestBetResult.reason
      }
    } else {
      trace.step7_computeBestBets = {
        skipped: true,
        reason: 'No NHL games today after date filter'
      }
    }
    
    // Step 8: Test getFilteredBestBetWithElo
    trace.step8_filteredBestBet = {}
    if (cachedSportBets) {
      const result = getFilteredBestBetWithElo(cachedSportBets, [], ['NHL'])
      trace.step8_filteredBestBet = {
        hasBet: !!result.bet,
        message: result.message,
        bet: result.bet ? {
          team: result.bet.team,
          sportName: result.bet.sportName,
          score: result.bet.score
        } : null
      }
    } else {
      trace.step8_filteredBestBet = { skipped: true, reason: 'No cached sport bets' }
    }
    
    // Summary - use local variables to avoid type issues
    const step1 = trace.step1_eloCache as { nhlTeams?: number }
    const step2 = trace.step2_oddsCache as { nhlGames?: number }
    const step3 = trace.step3_dateFilter as { nhlGamesToday?: number }
    const step5 = trace.step5_eloLookup as { gamesWithElo?: number }
    const step6 = trace.step6_cachedSportBets as { hasNHL?: boolean }
    const step7 = trace.step7_computeBestBets as { nhlEloBets?: number }
    
    const summary = {
      eloHasNHLData: (step1.nhlTeams || 0) > 0,
      oddsHasNHLGames: (step2.nhlGames || 0) > 0,
      nhlGamesPassDateFilter: (step3.nhlGamesToday || 0) > 0,
      eloLookupSuccessful: (step5.gamesWithElo || 0) > 0,
      cachedSportBetsHasNHL: step6.hasNHL || false,
      computedNHLBets: step7.nhlEloBets || 0,
      diagnosis: ''
    }
    
    // Diagnose the issue
    if (!summary.eloHasNHLData) {
      summary.diagnosis = 'ISSUE: Elo cache has no NHL data'
    } else if (!summary.oddsHasNHLGames) {
      summary.diagnosis = 'ISSUE: Odds cache has no NHL games'
    } else if (!summary.nhlGamesPassDateFilter) {
      summary.diagnosis = 'ISSUE: NHL games exist but are filtered out by date filter'
    } else if (!summary.eloLookupSuccessful) {
      summary.diagnosis = 'ISSUE: Elo lookup failed for NHL teams (name mismatch?)'
    } else if (!summary.cachedSportBetsHasNHL && summary.computedNHLBets === 0) {
      summary.diagnosis = 'ISSUE: computeBestBets returned no NHL bets despite having data'
    } else if (summary.computedNHLBets > 0) {
      summary.diagnosis = 'SUCCESS: NHL bets can be computed - check why chat route is not using them'
    } else {
      summary.diagnosis = 'UNKNOWN: Need more investigation'
    }
    
    trace.summary = summary
    
    return NextResponse.json(trace)
    
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to trace NHL query',
      details: error instanceof Error ? error.message : 'Unknown error',
      trace
    }, { status: 500 })
  }
}
