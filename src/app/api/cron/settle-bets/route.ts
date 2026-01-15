/**
 * Cron job to settle pending bet recommendations
 * 
 * Runs periodically to check game outcomes and update recommendation status.
 * Uses ESPN API to get final scores and determine winners.
 */

import { NextResponse } from 'next/server'
import { 
  getPendingRecommendations, 
  updateRecommendation, 
  calculateProfit,
  type TrackedRecommendation 
} from '@/lib/recommendation-tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Minimum hours after game start before attempting settlement
const SETTLEMENT_BUFFER_HOURS = 4

/**
 * Fetch game result from ESPN
 */
async function fetchGameResult(sport: string, gameId: string): Promise<{
  completed: boolean
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  winner: string | null
} | null> {
  try {
    // Map sport to ESPN format
    let espnSport = 'basketball'
    let espnLeague = 'nba'
    
    if (sport.includes('nfl') || sport.includes('football')) {
      espnSport = 'football'
      espnLeague = sport.includes('ncaa') ? 'college-football' : 'nfl'
    } else if (sport.includes('nhl') || sport.includes('hockey')) {
      espnSport = 'hockey'
      espnLeague = 'nhl'
    } else if (sport.includes('mlb') || sport.includes('baseball')) {
      espnSport = 'baseball'
      espnLeague = 'mlb'
    } else if (sport.includes('ncaab') || sport.includes('ncaa')) {
      espnSport = 'basketball'
      espnLeague = 'mens-college-basketball'
    } else if (sport.includes('soccer')) {
      // Soccer has many leagues, try to extract
      espnSport = 'soccer'
      espnLeague = 'eng.1' // Default to EPL
    }
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/scoreboard`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    
    // Find the game by ID
    const event = data.events?.find((e: { id: string }) => e.id === gameId)
    if (!event) return null
    
    const competition = event.competitions?.[0]
    if (!competition) return null
    
    const completed = competition.status?.type?.completed === true
    
    const homeCompetitor = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === 'home')
    const awayCompetitor = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === 'away')
    
    if (!homeCompetitor || !awayCompetitor) return null
    
    const homeScore = parseInt(homeCompetitor.score) || 0
    const awayScore = parseInt(awayCompetitor.score) || 0
    const homeTeam = homeCompetitor.team?.displayName || ''
    const awayTeam = awayCompetitor.team?.displayName || ''
    
    let winner: string | null = null
    if (completed) {
      if (homeScore > awayScore) {
        winner = homeTeam
      } else if (awayScore > homeScore) {
        winner = awayTeam
      }
      // If scores are equal, winner is null (draw)
    }
    
    return {
      completed,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      winner
    }
  } catch (error) {
    console.error(`[SettleBets] Error fetching game ${gameId}:`, error)
    return null
  }
}

/**
 * Settle a moneyline bet
 */
function settleMoneylineBet(reco: TrackedRecommendation, gameResult: {
  completed: boolean
  winner: string | null
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
}): { status: 'won' | 'lost' | 'push' | 'void'; actualResult: string; profit: number } | null {
  if (!gameResult.completed) return null
  
  // Extract team name from selection (e.g., "Lakers ML" -> "Lakers")
  const selectedTeam = reco.selection.replace(' ML', '').trim()
  
  // Check if selected team won
  const actualResult = `${gameResult.awayTeam} ${gameResult.awayScore} @ ${gameResult.homeTeam} ${gameResult.homeScore}`
  
  // Handle draw (no winner)
  if (!gameResult.winner) {
    return {
      status: 'push',
      actualResult,
      profit: 0
    }
  }
  
  // Check if selected team matches winner (partial match for team names)
  const selectedLower = selectedTeam.toLowerCase()
  const winnerLower = gameResult.winner.toLowerCase()
  
  const won = winnerLower.includes(selectedLower) || selectedLower.includes(winnerLower)
  
  return {
    status: won ? 'won' : 'lost',
    actualResult,
    profit: calculateProfit(reco.odds, won)
  }
}

/**
 * Settle a prop bet
 */
async function settlePropBet(reco: TrackedRecommendation): Promise<{ status: 'won' | 'lost' | 'push'; actualResult: string; profit: number; actualStat: number } | null> {
  // For props, we need to fetch the player's actual stat from the game
  // This is more complex and requires fetching box score data
  // For now, we'll skip prop settlement and mark as pending
  // TODO: Implement prop settlement using ESPN box score API
  
  console.log(`[SettleBets] Prop settlement not yet implemented for: ${reco.selection}`)
  return null
}

export async function GET(request: Request) {
  const startTime = Date.now()
  
  try {
    const { searchParams } = new URL(request.url)
    const force = searchParams.get('force') === 'true'
    
    console.log('[SettleBets] Starting settlement check...')
    
    const pending = await getPendingRecommendations()
    console.log(`[SettleBets] Found ${pending.length} pending recommendations`)
    
    const now = new Date()
    let settled = 0
    let skipped = 0
    let errors = 0
    const results: { id: string; status: string; selection: string }[] = []
    
    for (const reco of pending) {
      // Check if enough time has passed since game start
      const gameTime = new Date(reco.commenceTime)
      const hoursSinceStart = (now.getTime() - gameTime.getTime()) / (1000 * 60 * 60)
      
      if (!force && hoursSinceStart < SETTLEMENT_BUFFER_HOURS) {
        skipped++
        continue
      }
      
      try {
        if (reco.betType === 'prop') {
          // Prop settlement
          const result = await settlePropBet(reco)
          if (result) {
            await updateRecommendation(reco.id, {
              status: result.status,
              settledAt: now.toISOString(),
              actualResult: result.actualResult,
              profit: result.profit,
              actualStat: result.actualStat
            })
            settled++
            results.push({ id: reco.id, status: result.status, selection: reco.selection })
          } else {
            skipped++
          }
        } else {
          // Moneyline/team bet settlement
          const gameResult = await fetchGameResult(reco.sport, reco.gameId)
          
          if (!gameResult) {
            console.log(`[SettleBets] Could not fetch result for game ${reco.gameId}`)
            skipped++
            continue
          }
          
          if (!gameResult.completed) {
            skipped++
            continue
          }
          
          const result = settleMoneylineBet(reco, gameResult)
          if (result) {
            await updateRecommendation(reco.id, {
              status: result.status,
              settledAt: now.toISOString(),
              actualResult: result.actualResult,
              profit: result.profit
            })
            settled++
            results.push({ id: reco.id, status: result.status, selection: reco.selection })
          }
        }
      } catch (error) {
        console.error(`[SettleBets] Error settling ${reco.id}:`, error)
        errors++
      }
    }
    
    console.log(`[SettleBets] Complete: ${settled} settled, ${skipped} skipped, ${errors} errors`)
    
    return NextResponse.json({
      success: true,
      pending: pending.length,
      settled,
      skipped,
      errors,
      results,
      durationMs: Date.now() - startTime
    })
    
  } catch (error) {
    console.error('[SettleBets] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to settle bets',
      details: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
