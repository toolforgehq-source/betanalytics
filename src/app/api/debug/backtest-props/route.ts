/**
 * Debug Endpoint: Backtest Player Prop Predictions
 * 
 * This endpoint backtests our player prop predictions against historical results.
 * It uses player game logs to simulate what our model would have predicted
 * and compares against actual outcomes.
 * 
 * Query params:
 * - sport: Sport to backtest (default: NBA)
 * - days: Number of days to backtest (default: 14)
 * - stat: Stat type to backtest (default: points)
 * - minGames: Minimum games for player to be included (default: 5)
 */

import { NextResponse } from 'next/server'
import { getPlayerStatsData, calculateOverProbability, type PlayerStats } from '@/lib/player-stats'
import { requireDebugAuth } from "@/lib/debug-auth"

export const runtime = 'edge'
export const maxDuration = 120

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

const SPORT_TO_ESPN: Record<string, { sport: string; league: string }> = {
  'NBA': { sport: 'basketball', league: 'nba' },
  'NFL': { sport: 'football', league: 'nfl' },
  'NHL': { sport: 'hockey', league: 'nhl' },
  'MLB': { sport: 'baseball', league: 'mlb' },
}

// Stat types by sport
const SPORT_STATS: Record<string, string[]> = {
  'NBA': ['points', 'rebounds', 'assists', 'threePointersMade'],
  'NFL': ['passingYards', 'rushingYards', 'receivingYards'],
  'NHL': ['goals', 'hockeyAssists', 'shots'],
  'MLB': ['hits', 'homeRuns', 'rbis', 'strikeouts'],
}

// Minimum edge threshold for making a recommendation
// Higher = more selective = potentially higher win rate
const MIN_EDGE_THRESHOLD = 0.08  // 8% edge required

// Minimum probability for over/under recommendation
const MIN_PROBABILITY = 0.55  // 55% minimum

// Maximum probability (avoid extreme predictions)
const MAX_PROBABILITY = 0.85  // 85% maximum

interface PropBacktestResult {
  playerName: string
  stat: string
  line: number
  direction: 'over' | 'under'
  predictedProb: number
  actualResult: number
  outcome: 'hit' | 'miss' | 'push'
  edge: number
  gameDate: string
}

interface BacktestSummary {
  totalPredictions: number
  hits: number
  misses: number
  pushes: number
  hitRate: number
  expectedHitRate: number
  roi: number
  profitable: boolean
  byStat: Record<string, { predictions: number; hitRate: number }>
  byEdgeBucket: Record<string, { predictions: number; hitRate: number }>
}

function formatDateForESPN(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

interface ESPNBoxscoreAthlete {
  athlete: {
    id: string
    displayName: string
  }
  stats: string[]
  didNotPlay?: boolean
}

interface ESPNBoxscoreTeam {
  team: {
    id: string
    displayName: string
  }
  statistics: Array<{
    names: string[]
    keys?: string[]
    athletes: ESPNBoxscoreAthlete[]
  }>
}

interface PlayerGameResult {
  playerId: string
  playerName: string
  teamName: string
  gameDate: string
  stats: Record<string, number>
}

async function fetchGameBoxScores(
  sport: string,
  league: string,
  date: string
): Promise<PlayerGameResult[]> {
  try {
    // First get the scoreboard to find completed games
    const scoreboardUrl = `${ESPN_API_BASE}/${sport}/${league}/scoreboard?dates=${date}`
    const scoreboardResponse = await fetch(scoreboardUrl, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!scoreboardResponse.ok) return []
    
    const scoreboardData = await scoreboardResponse.json()
    if (!scoreboardData.events) return []
    
    const results: PlayerGameResult[] = []
    
    // Process each completed game
    for (const event of scoreboardData.events) {
      if (!event.status?.type?.completed) continue
      
      const gameId = event.id
      const gameDate = event.date
      
      // Fetch box score for this game
      const boxscoreUrl = `https://site.web.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`
      
      try {
        const boxscoreResponse = await fetch(boxscoreUrl, {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store',
        })
        
        if (!boxscoreResponse.ok) continue
        
        const boxscoreData = await boxscoreResponse.json()
        const boxscore = boxscoreData.boxscore
        
        if (!boxscore?.players) continue
        
        // Process each team's players
        for (const teamData of boxscore.players as ESPNBoxscoreTeam[]) {
          const teamName = teamData.team?.displayName || 'Unknown'
          
          for (const statGroup of teamData.statistics || []) {
            const statNames = statGroup.names || statGroup.keys || []
            
            for (const athlete of statGroup.athletes || []) {
              if (athlete.didNotPlay) continue
              
              const stats = athlete.stats || []
              const playerStats: Record<string, number> = {}
              
              // Map stats based on sport
              if (sport === 'basketball') {
                const ptsIndex = statNames.indexOf('PTS')
                const rebIndex = statNames.indexOf('REB')
                const astIndex = statNames.indexOf('AST')
                const threePtIndex = statNames.indexOf('3PT')
                
                if (ptsIndex >= 0) playerStats.points = parseInt(stats[ptsIndex]) || 0
                if (rebIndex >= 0) playerStats.rebounds = parseInt(stats[rebIndex]) || 0
                if (astIndex >= 0) playerStats.assists = parseInt(stats[astIndex]) || 0
                if (threePtIndex >= 0) {
                  const threePt = stats[threePtIndex] || '0-0'
                  playerStats.threePointersMade = parseInt(threePt.split('-')[0]) || 0
                }
              } else if (sport === 'football') {
                const ydsIndex = statNames.indexOf('YDS')
                const recIndex = statNames.indexOf('REC')
                const carIndex = statNames.indexOf('CAR')
                
                if (ydsIndex >= 0) {
                  const yards = parseInt(stats[ydsIndex]) || 0
                  if (carIndex >= 0) {
                    playerStats.rushingYards = yards
                  } else if (recIndex >= 0) {
                    playerStats.receivingYards = yards
                  } else {
                    playerStats.passingYards = yards
                  }
                }
              } else if (sport === 'hockey') {
                const gIndex = statNames.indexOf('goals') >= 0 ? statNames.indexOf('goals') : statNames.indexOf('G')
                const aIndex = statNames.indexOf('assists') >= 0 ? statNames.indexOf('assists') : statNames.indexOf('A')
                const sIndex = statNames.indexOf('shotsTotal') >= 0 ? statNames.indexOf('shotsTotal') : statNames.indexOf('S')
                
                if (gIndex >= 0) playerStats.goals = parseInt(stats[gIndex]) || 0
                if (aIndex >= 0) playerStats.hockeyAssists = parseInt(stats[aIndex]) || 0
                if (sIndex >= 0) playerStats.shots = parseInt(stats[sIndex]) || 0
              } else if (sport === 'baseball') {
                const hIndex = statNames.indexOf('H')
                const hrIndex = statNames.indexOf('HR')
                const rbiIndex = statNames.indexOf('RBI')
                const kIndex = statNames.indexOf('K')
                
                if (hIndex >= 0) playerStats.hits = parseInt(stats[hIndex]) || 0
                if (hrIndex >= 0) playerStats.homeRuns = parseInt(stats[hrIndex]) || 0
                if (rbiIndex >= 0) playerStats.rbis = parseInt(stats[rbiIndex]) || 0
                if (kIndex >= 0) playerStats.strikeouts = parseInt(stats[kIndex]) || 0
              }
              
              if (Object.keys(playerStats).length > 0) {
                results.push({
                  playerId: athlete.athlete?.id || '',
                  playerName: athlete.athlete?.displayName || 'Unknown',
                  teamName,
                  gameDate,
                  stats: playerStats
                })
              }
            }
          }
        }
      } catch {
        // Skip games that fail to fetch
        continue
      }
    }
    
    return results
  } catch (error) {
    console.error(`[PropBacktest] Error fetching box scores:`, error)
    return []
  }
}

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  const startTime = Date.now()
  
  try {
    const url = new URL(request.url)
    const sport = url.searchParams.get('sport') || 'NBA'
    const daysParam = url.searchParams.get('days') || '14'
    const days = parseInt(daysParam, 10)
    const statFilter = url.searchParams.get('stat') || null
    const minGamesParam = url.searchParams.get('minGames') || '5'
    const minGames = parseInt(minGamesParam, 10)
    
    if (!SPORT_TO_ESPN[sport]) {
      return NextResponse.json({
        error: `Unsupported sport: ${sport}`,
        supportedSports: Object.keys(SPORT_TO_ESPN)
      }, { status: 400 })
    }
    
    // Get player stats data
    const statsData = await getPlayerStatsData()
    if (!statsData || Object.keys(statsData.players).length === 0) {
      return NextResponse.json({ 
        error: 'No player stats data found. Run /api/cron/fetch-player-stats first.',
        playersTracked: 0
      }, { status: 404 })
    }
    
    const espnInfo = SPORT_TO_ESPN[sport]
    const statsToTest = statFilter ? [statFilter] : (SPORT_STATS[sport] || ['points'])
    
    // Get players for this sport with enough games
    const sportPlayers = Object.values(statsData.players).filter(
      (p: PlayerStats) => p.sport === sport && p.gamesPlayed >= minGames
    )
    
    if (sportPlayers.length === 0) {
      return NextResponse.json({
        error: `No players found for ${sport} with ${minGames}+ games`,
        totalPlayers: Object.keys(statsData.players).length
      }, { status: 404 })
    }
    
    // Fetch game results for the backtest period
    const allGameResults: PlayerGameResult[] = []
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 1) // Start from yesterday
    
    for (let i = 0; i < days; i++) {
      const date = new Date(endDate)
      date.setDate(date.getDate() - i)
      const dateStr = formatDateForESPN(date)
      
      const gameResults = await fetchGameBoxScores(espnInfo.sport, espnInfo.league, dateStr)
      allGameResults.push(...gameResults)
    }
    
    if (allGameResults.length === 0) {
      return NextResponse.json({
        error: 'No game results found for backtest period',
        daysSearched: days
      }, { status: 404 })
    }
    
    // Run backtest
    const results: PropBacktestResult[] = []
    
    for (const gameResult of allGameResults) {
      // Find matching player in our stats
      const player = sportPlayers.find((p: PlayerStats) => 
        p.playerName.toLowerCase() === gameResult.playerName.toLowerCase() ||
        p.playerName.toLowerCase().includes(gameResult.playerName.toLowerCase().split(' ').pop() || '')
      )
      
      if (!player) continue
      
      // Test each stat type
      for (const stat of statsToTest) {
        const actualValue = gameResult.stats[stat]
        if (actualValue === undefined) continue
        
        const playerAvg = (player.averages as Record<string, number>)[stat]
        const playerStdDev = (player.stdDevs as Record<string, number>)[stat]
        
        if (playerAvg === undefined || playerStdDev === undefined) continue
        
        // Simulate a prop line at the player's average (typical sportsbook behavior)
        // We'll test lines at avg - 0.5, avg, and avg + 0.5
        const testLines = [
          Math.floor(playerAvg) - 0.5,
          Math.floor(playerAvg) + 0.5,
          Math.ceil(playerAvg) + 0.5
        ]
        
        for (const line of testLines) {
          if (line <= 0) continue
          
          // Calculate our predicted probability
          const overProb = calculateOverProbability(playerAvg, playerStdDev, line)
          const underProb = 1 - overProb
          
          // Determine if we would make a recommendation
          let direction: 'over' | 'under' | null = null
          let predictedProb = 0
          let edge = 0
          
          // Check if over meets our criteria
          if (overProb >= MIN_PROBABILITY && overProb <= MAX_PROBABILITY) {
            const impliedProb = 0.5 // Assume -110 odds (52.4% implied, but use 50% for simplicity)
            edge = overProb - impliedProb
            if (edge >= MIN_EDGE_THRESHOLD) {
              direction = 'over'
              predictedProb = overProb
            }
          }
          
          // Check if under meets our criteria (only if over didn't)
          if (!direction && underProb >= MIN_PROBABILITY && underProb <= MAX_PROBABILITY) {
            const impliedProb = 0.5
            edge = underProb - impliedProb
            if (edge >= MIN_EDGE_THRESHOLD) {
              direction = 'under'
              predictedProb = underProb
            }
          }
          
          // Skip if no recommendation
          if (!direction) continue
          
          // Determine outcome
          let outcome: 'hit' | 'miss' | 'push'
          if (actualValue === line) {
            outcome = 'push'
          } else if (direction === 'over') {
            outcome = actualValue > line ? 'hit' : 'miss'
          } else {
            outcome = actualValue < line ? 'hit' : 'miss'
          }
          
          results.push({
            playerName: player.playerName,
            stat,
            line,
            direction,
            predictedProb,
            actualResult: actualValue,
            outcome,
            edge,
            gameDate: gameResult.gameDate
          })
        }
      }
    }
    
    // Calculate summary statistics
    const hits = results.filter(r => r.outcome === 'hit').length
    const misses = results.filter(r => r.outcome === 'miss').length
    const pushes = results.filter(r => r.outcome === 'push').length
    const totalPredictions = hits + misses // Exclude pushes from win rate
    
    const hitRate = totalPredictions > 0 ? hits / totalPredictions : 0
    const expectedHitRate = totalPredictions > 0 
      ? results.filter(r => r.outcome !== 'push').reduce((sum, r) => sum + r.predictedProb, 0) / totalPredictions
      : 0
    
    // Calculate ROI assuming -110 odds
    // Win: +$90.91 per $100 bet, Loss: -$100 per $100 bet
    const winPayout = 90.91
    const totalWinnings = hits * winPayout
    const totalLosses = misses * 100
    const totalWagered = totalPredictions * 100
    const roi = totalWagered > 0 ? ((totalWinnings - totalLosses) / totalWagered) * 100 : 0
    
    // Break down by stat
    const byStat: Record<string, { predictions: number; hitRate: number }> = {}
    for (const stat of statsToTest) {
      const statResults = results.filter(r => r.stat === stat && r.outcome !== 'push')
      const statHits = statResults.filter(r => r.outcome === 'hit').length
      byStat[stat] = {
        predictions: statResults.length,
        hitRate: statResults.length > 0 ? statHits / statResults.length : 0
      }
    }
    
    // Break down by edge bucket
    const byEdgeBucket: Record<string, { predictions: number; hitRate: number }> = {}
    const edgeBuckets = ['8-10%', '10-15%', '15-20%', '20%+']
    for (const bucket of edgeBuckets) {
      let minEdge = 0, maxEdge = 1
      if (bucket === '8-10%') { minEdge = 0.08; maxEdge = 0.10 }
      else if (bucket === '10-15%') { minEdge = 0.10; maxEdge = 0.15 }
      else if (bucket === '15-20%') { minEdge = 0.15; maxEdge = 0.20 }
      else if (bucket === '20%+') { minEdge = 0.20; maxEdge = 1 }
      
      const bucketResults = results.filter(r => r.edge >= minEdge && r.edge < maxEdge && r.outcome !== 'push')
      const bucketHits = bucketResults.filter(r => r.outcome === 'hit').length
      byEdgeBucket[bucket] = {
        predictions: bucketResults.length,
        hitRate: bucketResults.length > 0 ? bucketHits / bucketResults.length : 0
      }
    }
    
    const summary: BacktestSummary = {
      totalPredictions,
      hits,
      misses,
      pushes,
      hitRate,
      expectedHitRate,
      roi,
      profitable: roi > 0,
      byStat,
      byEdgeBucket
    }
    
    // Get top performers and worst performers
    const topHits = results
      .filter(r => r.outcome === 'hit')
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 10)
    
    const worstMisses = results
      .filter(r => r.outcome === 'miss')
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 5)
    
    const duration = Date.now() - startTime
    
    return NextResponse.json({
      success: true,
      sport,
      daysAnalyzed: days,
      statsAnalyzed: statsToTest,
      playersTracked: sportPlayers.length,
      gameResultsFound: allGameResults.length,
      
      summary: {
        totalPredictions: summary.totalPredictions,
        hits: summary.hits,
        misses: summary.misses,
        pushes: summary.pushes,
        hitRate: `${(summary.hitRate * 100).toFixed(1)}%`,
        expectedHitRate: `${(summary.expectedHitRate * 100).toFixed(1)}%`,
        roi: `${summary.roi.toFixed(1)}%`,
        breakEvenRate: '52.4%',
        profitable: summary.profitable
      },
      
      byStat: Object.fromEntries(
        Object.entries(summary.byStat).map(([stat, data]) => [
          stat,
          {
            predictions: data.predictions,
            hitRate: `${(data.hitRate * 100).toFixed(1)}%`
          }
        ])
      ),
      
      byEdgeBucket: Object.fromEntries(
        Object.entries(summary.byEdgeBucket).map(([bucket, data]) => [
          bucket,
          {
            predictions: data.predictions,
            hitRate: `${(data.hitRate * 100).toFixed(1)}%`
          }
        ])
      ),
      
      topHits: topHits.map(r => ({
        player: r.playerName,
        stat: r.stat,
        line: r.line,
        direction: r.direction,
        predicted: `${(r.predictedProb * 100).toFixed(0)}%`,
        actual: r.actualResult,
        edge: `${(r.edge * 100).toFixed(1)}%`
      })),
      
      worstMisses: worstMisses.map(r => ({
        player: r.playerName,
        stat: r.stat,
        line: r.line,
        direction: r.direction,
        predicted: `${(r.predictedProb * 100).toFixed(0)}%`,
        actual: r.actualResult,
        edge: `${(r.edge * 100).toFixed(1)}%`
      })),
      
      durationMs: duration
    })
    
  } catch (error) {
    console.error('[PropBacktest] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to run prop backtest',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
