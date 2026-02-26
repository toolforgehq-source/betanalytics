/**
 * Debug Endpoint: Comprehensive Sports Test
 * 
 * Tests Elo data flow for ALL sports to verify the system works universally.
 * Returns a detailed report showing which sports work and which have issues.
 */

import { NextResponse } from 'next/server'
import { getCachedESPNOdds, type ESPNOdds } from '@/lib/espn'
import { getEloWinProbabilityByName, getEloRatings } from '@/lib/elo'
import { computeBestBets, getCachedSportBets } from '@/lib/bet-ranking'
import type { Game } from '@/lib/odds'
import { requireDebugAuth } from "@/lib/debug-auth"

export const runtime = 'edge'
export const maxDuration = 60

// All sports we support
const SPORTS_CONFIG = [
  { league: 'NBA', eloLeague: 'NBA', sportKey: 'basketball_nba', espnSport: 'basketball' },
  { league: 'NFL', eloLeague: 'NFL', sportKey: 'americanfootball_nfl', espnSport: 'football' },
  { league: 'NHL', eloLeague: 'NHL', sportKey: 'icehockey_nhl', espnSport: 'hockey' },
  { league: 'MLB', eloLeague: 'MLB', sportKey: 'baseball_mlb', espnSport: 'baseball' },
  { league: 'NCAAB', eloLeague: 'NCAAB', sportKey: 'basketball_ncaab', espnSport: 'mens-college-basketball' },
  { league: 'NCAAF', eloLeague: 'NCAAF', sportKey: 'americanfootball_ncaaf', espnSport: 'college-football' },
  { league: 'English Premier League', eloLeague: 'soccer_epl', sportKey: 'soccer_epl', espnSport: 'soccer' },
  { league: 'La Liga', eloLeague: 'soccer_spain_la_liga', sportKey: 'soccer_spain_la_liga', espnSport: 'soccer' },
  { league: 'Bundesliga', eloLeague: 'soccer_germany_bundesliga', sportKey: 'soccer_germany_bundesliga', espnSport: 'soccer' },
  { league: 'Serie A', eloLeague: 'soccer_italy_serie_a', sportKey: 'soccer_italy_serie_a', espnSport: 'soccer' },
  { league: 'Ligue 1', eloLeague: 'soccer_france_ligue_one', sportKey: 'soccer_france_ligue_one', espnSport: 'soccer' },
  { league: 'MLS', eloLeague: 'soccer_usa_mls', sportKey: 'soccer_usa_mls', espnSport: 'soccer' },
  { league: 'UEFA Champions League', eloLeague: 'soccer_uefa_champs_league', sportKey: 'soccer_uefa_champs_league', espnSport: 'soccer' },
]

interface SportTestResult {
  league: string
  eloLeague: string
  eloTeamsCount: number
  eloSampleTeams: { name: string; rating: number; games: number }[]
  oddsGamesCount: number
  oddsGamesToday: number
  oddsSampleGames: { home: string; away: string; hasMoneyline: boolean }[]
  eloLookupResults: { game: string; eloFound: boolean; confidence?: string }[]
  computedBets: number
  computedBetsSample: { team: string; score: number; eloProbability: number; edge: number }[]
  cachedBet: { team: string; score: number; eloProbability: number } | null
  status: 'SUCCESS' | 'PARTIAL' | 'NO_GAMES' | 'NO_ELO' | 'FAILED'
  issues: string[]
}

function convertESPNToGame(g: ESPNOdds, sportKey: string): Game {
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
}

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  const results: Record<string, SportTestResult> = {}
  const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  
  try {
    // Get all data upfront
    const [eloData, espnOdds, cachedSportBets] = await Promise.all([
      getEloRatings(),
      getCachedESPNOdds(),
      getCachedSportBets()
    ])
    
    // Test each sport
    for (const sport of SPORTS_CONFIG) {
      const result: SportTestResult = {
        league: sport.league,
        eloLeague: sport.eloLeague,
        eloTeamsCount: 0,
        eloSampleTeams: [],
        oddsGamesCount: 0,
        oddsGamesToday: 0,
        oddsSampleGames: [],
        eloLookupResults: [],
        computedBets: 0,
        computedBetsSample: [],
        cachedBet: null,
        status: 'FAILED',
        issues: []
      }
      
      // Check Elo data for this sport
      if (eloData?.ratings) {
        const sportTeams = Object.values(eloData.ratings).filter(r => r.league === sport.eloLeague)
        result.eloTeamsCount = sportTeams.length
        result.eloSampleTeams = sportTeams.slice(0, 3).map(t => ({
          name: t.teamName,
          rating: t.rating,
          games: t.gamesPlayed
        }))
        
        if (sportTeams.length === 0) {
          result.issues.push(`No Elo teams found for league '${sport.eloLeague}'`)
        }
      } else {
        result.issues.push('Elo cache is empty')
      }
      
      // Check odds data for this sport
      const sportGames = espnOdds.games.filter(g => g.league === sport.league)
      result.oddsGamesCount = sportGames.length
      
      const sportGamesToday = sportGames.filter(g => {
        const gameDate = new Date(g.commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        return gameDate === todayET
      })
      result.oddsGamesToday = sportGamesToday.length
      
      result.oddsSampleGames = sportGamesToday.slice(0, 3).map(g => ({
        home: g.homeTeam,
        away: g.awayTeam,
        hasMoneyline: !!g.moneyline
      }))
      
      if (sportGames.length === 0) {
        result.issues.push(`No games in odds cache for league '${sport.league}'`)
      }
      
      // Test Elo lookup for each game today
      for (const game of sportGamesToday.slice(0, 5)) {
        try {
          const eloResult = await getEloWinProbabilityByName(sport.eloLeague, game.homeTeam, game.awayTeam)
          result.eloLookupResults.push({
            game: `${game.awayTeam} @ ${game.homeTeam}`,
            eloFound: !!eloResult,
            confidence: eloResult?.confidence
          })
        } catch {
          result.eloLookupResults.push({
            game: `${game.awayTeam} @ ${game.homeTeam}`,
            eloFound: false
          })
        }
      }
      
      const eloLookupSuccessRate = result.eloLookupResults.length > 0
        ? result.eloLookupResults.filter(r => r.eloFound).length / result.eloLookupResults.length
        : 0
      
      if (result.eloLookupResults.length > 0 && eloLookupSuccessRate < 1) {
        const failedGames = result.eloLookupResults.filter(r => !r.eloFound).map(r => r.game)
        result.issues.push(`Elo lookup failed for ${failedGames.length} games: ${failedGames.join(', ')}`)
      }
      
      // Compute bets for this sport's games today
      if (sportGamesToday.length > 0) {
        const gamesToAnalyze: Game[] = sportGamesToday
          .filter(g => g.moneyline) // Only games with moneylines
          .map(g => convertESPNToGame(g, sport.sportKey))
        
        if (gamesToAnalyze.length > 0) {
          try {
            const bestBetResult = await computeBestBets(gamesToAnalyze)
            const sportBets = bestBetResult.allEloBets?.filter(b => b.sportName === sport.league) || []
            
            result.computedBets = sportBets.length
            result.computedBetsSample = sportBets.slice(0, 3).map(b => ({
              team: b.team,
              score: b.score,
              eloProbability: b.eloProbability ?? 0,
              edge: b.edge
            }))
            
            if (sportBets.length === 0 && gamesToAnalyze.length > 0) {
              result.issues.push('computeBestBets returned 0 bets despite having games with moneylines')
            }
          } catch (error) {
            result.issues.push(`computeBestBets error: ${error instanceof Error ? error.message : 'Unknown'}`)
          }
        } else {
          result.issues.push('No games with moneylines to analyze')
        }
      }
      
      // Check cached sport bets
      if (cachedSportBets) {
        const cachedBet = cachedSportBets[sport.league]
        if (cachedBet) {
          result.cachedBet = {
            team: cachedBet.team,
            score: cachedBet.score,
            eloProbability: cachedBet.eloProbability ?? 0
          }
        }
      }
      
      // Determine status
      if (result.oddsGamesToday === 0) {
        result.status = 'NO_GAMES'
      } else if (result.eloTeamsCount === 0) {
        result.status = 'NO_ELO'
      } else if (result.computedBets > 0) {
        result.status = 'SUCCESS'
      } else if (result.eloLookupResults.some(r => r.eloFound)) {
        result.status = 'PARTIAL'
      } else {
        result.status = 'FAILED'
      }
      
      results[sport.league] = result
    }
    
    // Generate summary report
    const summary = {
      timestamp: new Date().toISOString(),
      todayET,
      totalSports: SPORTS_CONFIG.length,
      sportsWithGamesToday: Object.values(results).filter(r => r.oddsGamesToday > 0).length,
      sportsWorking: Object.values(results).filter(r => r.status === 'SUCCESS').length,
      sportsPartial: Object.values(results).filter(r => r.status === 'PARTIAL').length,
      sportsFailed: Object.values(results).filter(r => r.status === 'FAILED').length,
      sportsNoGames: Object.values(results).filter(r => r.status === 'NO_GAMES').length,
      sportsNoElo: Object.values(results).filter(r => r.status === 'NO_ELO').length,
      report: Object.entries(results).map(([league, r]) => ({
        sport: league,
        status: r.status,
        eloTeams: r.eloTeamsCount,
        gamesToday: r.oddsGamesToday,
        betsComputed: r.computedBets,
        cachedBet: r.cachedBet ? `${r.cachedBet.team} (${r.cachedBet.eloProbability}%)` : 'None',
        issues: r.issues.length > 0 ? r.issues : ['None']
      }))
    }
    
    return NextResponse.json({
      summary,
      details: results
    })
    
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to run comprehensive sports test',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
