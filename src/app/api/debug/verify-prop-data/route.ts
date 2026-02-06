import { NextResponse } from 'next/server'
import { getPlayerPropProbability, getPlayerStatsData, getPlayerStatsInfo } from '@/lib/player-stats'
import { getCachedPlayerProps } from '@/lib/odds'
import { getCachedBestProp } from '@/lib/bet-ranking'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const testPlayer = searchParams.get('player') || 'Luka Doncic'
  const testStat = searchParams.get('stat') || 'points'
  const testLine = parseFloat(searchParams.get('line') || '28.5')
  
  const results: Record<string, unknown> = {}
  
  // 1. Test getPlayerPropProbability for specific players
  const testCases = [
    { player: 'Luka Doncic', stat: 'points', line: 28.5 },
    { player: 'LeBron James', stat: 'points', line: 25.5 },
    { player: 'Stephen Curry', stat: 'threePointersMade', line: 5 },
    { player: 'Giannis Antetokounmpo', stat: 'rebounds', line: 11.5 },
    { player: 'Nikola Jokic', stat: 'assists', line: 8.5 },
    { player: 'Nickeil Alexander-Walker', stat: 'assists', line: 3.5 },
    { player: testPlayer, stat: testStat, line: testLine },
  ]
  
  const propTests: Record<string, unknown> = {}
  for (const test of testCases) {
    const key = `${test.player}_${test.stat}_${test.line}`
    try {
      const result = await getPlayerPropProbability(test.player, 'NBA', test.stat, test.line)
      propTests[key] = result ? {
        probability: result.probability,
        average: result.average,
        adjustedAverage: result.adjustedAverage,
        stdDev: result.stdDev,
        gamesPlayed: result.gamesPlayed,
        confidence: result.confidence,
        reliabilityScore: result.reliabilityScore
      } : null
    } catch (err) {
      propTests[key] = { error: String(err) }
    }
  }
  results.propProbabilityTests = propTests
  
  // 2. Get player stats info (total players tracked)
  try {
    results.playerStatsInfo = await getPlayerStatsInfo()
  } catch (err) {
    results.playerStatsInfo = { error: String(err) }
  }
  
  // 3. Get raw player stats data to see what's actually stored
  try {
    const statsData = await getPlayerStatsData()
    if (statsData) {
      const playerKeys = Object.keys(statsData.players)
      const nbaPlayers = playerKeys.filter(k => k.startsWith('NBA_'))
      
      // Get sample of NBA players with their stats
      const samplePlayers = nbaPlayers.slice(0, 20).map(key => {
        const p = statsData.players[key]
        return {
          name: p.playerName,
          gamesPlayed: p.gamesPlayed,
          averages: p.averages,
          position: p.position
        }
      })
      
      results.rawStatsData = {
        totalPlayers: playerKeys.length,
        nbaPlayers: nbaPlayers.length,
        lastUpdated: statsData.lastUpdated,
        gamesProcessed: statsData.gamesProcessed,
        samplePlayers
      }
    } else {
      results.rawStatsData = { error: 'No stats data found - cache may be empty' }
    }
  } catch (err) {
    results.rawStatsData = { error: String(err) }
  }
  
  // 4. Get cached player props from Odds API
  try {
    const cachedProps = await getCachedPlayerProps()
    if (cachedProps && cachedProps.length > 0) {
      const allProps = cachedProps.flatMap(g => g.props.map(p => ({
        player: p.playerName,
        market: p.market,
        line: p.line,
        game: `${g.awayTeam} @ ${g.homeTeam}`
      })))
      
      results.cachedOddsApiProps = {
        totalGames: cachedProps.length,
        totalProps: allProps.length,
        uniquePlayers: Array.from(new Set(allProps.map(p => p.player))).length,
        sampleProps: allProps.slice(0, 30)
      }
    } else {
      results.cachedOddsApiProps = { error: 'No cached props from Odds API' }
    }
  } catch (err) {
    results.cachedOddsApiProps = { error: String(err) }
  }
  
  // 5. Get cached best prop
  try {
    const bestProp = await getCachedBestProp()
    if (bestProp) {
      results.cachedBestProp = {
        bestProp: bestProp.bestProp ? {
          playerName: bestProp.bestProp.playerName,
          market: bestProp.bestProp.market,
          line: bestProp.bestProp.line,
          modelEdge: bestProp.bestProp.modelEdge,
          modelProbability: bestProp.bestProp.modelProbability
        } : null,
        totalRankedProps: bestProp.allRankedProps?.length || 0,
        topRankedProps: bestProp.allRankedProps?.slice(0, 10).map(p => ({
          playerName: p.playerName,
          market: p.market,
          line: p.line,
          modelEdge: p.modelEdge,
          modelProbability: p.modelProbability
        })) || []
      }
    } else {
      results.cachedBestProp = { error: 'No cached best prop' }
    }
  } catch (err) {
    results.cachedBestProp = { error: String(err) }
  }
  
  return NextResponse.json(results, { status: 200 })
}
