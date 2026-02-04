/**
 * Debug Endpoint: Backtest Spread Predictions
 * 
 * This endpoint backtests our spread predictions against historical results.
 * It calculates what our model would have predicted for each game and compares
 * to actual results.
 * 
 * Query params:
 * - league: League to backtest (default: NBA)
 * - days: Number of days to backtest (default: 30)
 */

import { NextResponse } from 'next/server'
import { 
  getEloRatings
} from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 120

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

const LEAGUE_TO_ESPN: Record<string, { sport: string; league: string }> = {
  'NBA': { sport: 'basketball', league: 'nba' },
  'NFL': { sport: 'football', league: 'nfl' },
  'NHL': { sport: 'hockey', league: 'nhl' },
  'MLB': { sport: 'baseball', league: 'mlb' },
  'NCAAB': { sport: 'basketball', league: 'mens-college-basketball' },
  'NCAAF': { sport: 'football', league: 'college-football' },
}

// Margin beta for converting Elo to expected margin
const MARGIN_BETA: Record<string, number> = {
  'NBA': 0.036,
  'NFL': 0.04,
  'NHL': 0.01,
  'MLB': 0.015,
  'NCAAB': 0.036,
  'NCAAF': 0.04,
}

// Home advantage in Elo points
const HOME_ADVANTAGE: Record<string, number> = {
  'NBA': 100,
  'NFL': 48,
  'NHL': 30,
  'MLB': 40,
  'NCAAB': 100,
  'NCAAF': 80,
}

interface GameResult {
  gameId: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  actualMargin: number // positive = home won by X
  date: string
}

interface BacktestResult {
  game: GameResult
  homeElo: number
  awayElo: number
  expectedMargin: number // positive = home expected to win by X
  impliedSpread: number // what spread would be fair (negative = home favored)
  modelPick: 'home' | 'away' | 'skip'
  modelEdge: number // how much edge we thought we had
  actualWinner: 'home' | 'away'
  modelCorrect: boolean
  coveredSpread: boolean // did our pick cover a hypothetical -110 spread?
}

function formatDateForESPN(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

async function fetchCompletedGames(
  sport: string,
  league: string,
  date: string
): Promise<GameResult[]> {
  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard?dates=${date}`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    
    if (!data.events || !Array.isArray(data.events)) return []
    
    const completedGames: GameResult[] = []
    
    for (const event of data.events) {
      if (!event.status?.type?.completed) continue
      
      const competition = event.competitions?.[0]
      if (!competition) continue
      
      const homeTeam = competition.competitors?.find(
        (c: { homeAway: string }) => c.homeAway === 'home'
      )
      const awayTeam = competition.competitors?.find(
        (c: { homeAway: string }) => c.homeAway === 'away'
      )
      
      if (!homeTeam || !awayTeam) continue
      
      const homeScore = parseInt(homeTeam.score || '0', 10)
      const awayScore = parseInt(awayTeam.score || '0', 10)
      
      completedGames.push({
        gameId: event.id,
        homeTeam: homeTeam.team?.displayName || homeTeam.team?.name || 'Unknown',
        awayTeam: awayTeam.team?.displayName || awayTeam.team?.name || 'Unknown',
        homeScore,
        awayScore,
        actualMargin: homeScore - awayScore,
        date: event.date
      })
    }
    
    return completedGames
  } catch (error) {
    console.error(`[Backtest] Error fetching games:`, error)
    return []
  }
}

export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    const url = new URL(request.url)
    const league = url.searchParams.get('league') || 'NBA'
    const daysParam = url.searchParams.get('days') || '30'
    const days = parseInt(daysParam, 10)
    
    if (!LEAGUE_TO_ESPN[league]) {
      return NextResponse.json({
        error: `Unsupported league: ${league}`,
        supportedLeagues: Object.keys(LEAGUE_TO_ESPN)
      }, { status: 400 })
    }
    
    // Get current Elo ratings
    const eloData = await getEloRatings()
    if (!eloData) {
      return NextResponse.json({ error: 'No Elo data found' }, { status: 404 })
    }
    
    const espnInfo = LEAGUE_TO_ESPN[league]
    const marginBeta = MARGIN_BETA[league] || 0.036
    const homeAdvantage = HOME_ADVANTAGE[league] || 100
    
    // Fetch games for each day
    const allGames: GameResult[] = []
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 1) // Start from yesterday
    
    for (let i = 0; i < days; i++) {
      const date = new Date(endDate)
      date.setDate(date.getDate() - i)
      const dateStr = formatDateForESPN(date)
      
      const games = await fetchCompletedGames(espnInfo.sport, espnInfo.league, dateStr)
      allGames.push(...games)
    }
    
    // Analyze each game
    const results: BacktestResult[] = []
    let correctPicks = 0
    let totalPicks = 0
    let coveredSpreads = 0
    let skippedGames = 0
    
    for (const game of allGames) {
      // Find team Elo ratings
      const homeKey = Object.keys(eloData.ratings).find(k => 
        eloData.ratings[k].teamName.toLowerCase().includes(game.homeTeam.toLowerCase().split(' ').pop() || '') ||
        game.homeTeam.toLowerCase().includes(eloData.ratings[k].teamName.toLowerCase().split(' ').pop() || '')
      )
      const awayKey = Object.keys(eloData.ratings).find(k => 
        eloData.ratings[k].teamName.toLowerCase().includes(game.awayTeam.toLowerCase().split(' ').pop() || '') ||
        game.awayTeam.toLowerCase().includes(eloData.ratings[k].teamName.toLowerCase().split(' ').pop() || '')
      )
      
      if (!homeKey || !awayKey) {
        skippedGames++
        continue
      }
      
      const homeElo = eloData.ratings[homeKey].rating
      const awayElo = eloData.ratings[awayKey].rating
      
      // Calculate expected margin (positive = home favored)
      const eloDiff = homeElo + homeAdvantage - awayElo
      const expectedMargin = eloDiff * marginBeta
      
      // Determine model pick based on edge
      // We pick the side where our expected margin differs significantly from 0
      // For simplicity, we'll pick home if expectedMargin > 2, away if < -2, skip otherwise
      const edgeThreshold = 2 // points
      let modelPick: 'home' | 'away' | 'skip' = 'skip'
      let modelEdge = 0
      
      if (expectedMargin > edgeThreshold) {
        modelPick = 'home'
        modelEdge = expectedMargin - edgeThreshold
      } else if (expectedMargin < -edgeThreshold) {
        modelPick = 'away'
        modelEdge = Math.abs(expectedMargin) - edgeThreshold
      }
      
      const actualWinner: 'home' | 'away' = game.actualMargin > 0 ? 'home' : 'away'
      const modelCorrect = modelPick !== 'skip' && modelPick === actualWinner
      
      // Did our pick cover a hypothetical spread?
      // If we picked home, we need home to win by more than the implied spread
      // If we picked away, we need away to win or lose by less than the spread
      let coveredSpread = false
      if (modelPick === 'home') {
        // We're betting home -expectedMargin (e.g., home -5.5)
        coveredSpread = game.actualMargin > expectedMargin - 0.5
      } else if (modelPick === 'away') {
        // We're betting away +expectedMargin (e.g., away +5.5)
        coveredSpread = game.actualMargin < expectedMargin + 0.5
      }
      
      if (modelPick !== 'skip') {
        totalPicks++
        if (modelCorrect) correctPicks++
        if (coveredSpread) coveredSpreads++
      }
      
      results.push({
        game,
        homeElo,
        awayElo,
        expectedMargin: Math.round(expectedMargin * 10) / 10,
        impliedSpread: -Math.round(expectedMargin * 10) / 10,
        modelPick,
        modelEdge: Math.round(modelEdge * 10) / 10,
        actualWinner,
        modelCorrect,
        coveredSpread
      })
    }
    
    const duration = Date.now() - startTime
    
    // Calculate statistics
    const winRate = totalPicks > 0 ? (correctPicks / totalPicks * 100).toFixed(1) : '0'
    const coverRate = totalPicks > 0 ? (coveredSpreads / totalPicks * 100).toFixed(1) : '0'
    
    // Get top picks (highest edge)
    const topPicks = results
      .filter(r => r.modelPick !== 'skip')
      .sort((a, b) => b.modelEdge - a.modelEdge)
      .slice(0, 10)
    
    // Get worst picks (highest edge but wrong)
    const worstPicks = results
      .filter(r => r.modelPick !== 'skip' && !r.modelCorrect)
      .sort((a, b) => b.modelEdge - a.modelEdge)
      .slice(0, 5)
    
    return NextResponse.json({
      success: true,
      league,
      daysAnalyzed: days,
      summary: {
        totalGames: allGames.length,
        gamesWithPicks: totalPicks,
        skippedGames,
        correctPicks,
        winRate: `${winRate}%`,
        coveredSpreads,
        coverRate: `${coverRate}%`,
        breakEvenRate: '52.4%', // Need 52.4% to beat -110 juice
        profitable: parseFloat(coverRate) > 52.4
      },
      topPicks: topPicks.map(r => ({
        date: r.game.date.split('T')[0],
        matchup: `${r.game.awayTeam} @ ${r.game.homeTeam}`,
        pick: r.modelPick === 'home' ? r.game.homeTeam : r.game.awayTeam,
        edge: `${r.modelEdge} pts`,
        result: r.modelCorrect ? 'WIN' : 'LOSS',
        score: `${r.game.awayScore}-${r.game.homeScore}`
      })),
      worstPicks: worstPicks.map(r => ({
        date: r.game.date.split('T')[0],
        matchup: `${r.game.awayTeam} @ ${r.game.homeTeam}`,
        pick: r.modelPick === 'home' ? r.game.homeTeam : r.game.awayTeam,
        edge: `${r.modelEdge} pts`,
        expectedMargin: r.expectedMargin,
        actualMargin: r.game.actualMargin,
        score: `${r.game.awayScore}-${r.game.homeScore}`
      })),
      durationMs: duration
    })
    
  } catch (error) {
    console.error('[Backtest] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to run backtest',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
