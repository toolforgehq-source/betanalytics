/**
 * Debug endpoint for player stats backfill
 * GET /api/debug/player-stats?days=3
 * 
 * This endpoint is for testing/debugging the player stats system.
 * It fetches completed games and updates player statistics.
 */

import { NextResponse } from 'next/server'
import { requireDebugAuth } from "@/lib/debug-auth"
import {
  updatePlayerStats, 
  getPlayerStatsInfo,
  getPlayerStatsData,
  getPlayerPropProbability,
  clearProcessedGames
} from '@/lib/player-stats'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  const startTime = Date.now()
  
  try {
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '1')
    const action = searchParams.get('action') || 'update'
    
    // Action: info - just get current stats info
    if (action === 'info') {
      const info = await getPlayerStatsInfo()
      return NextResponse.json({
        success: true,
        action: 'info',
        data: info,
        durationMs: Date.now() - startTime
      })
    }
    
    // Action: reset - clear processed games and re-process all sports
    if (action === 'reset') {
      console.log('[PlayerStats Debug] Clearing processed games list...')
      const cleared = await clearProcessedGames()
      
      if (!cleared) {
        return NextResponse.json({
          success: false,
          action: 'reset',
          error: 'Failed to clear processed games',
          durationMs: Date.now() - startTime
        }, { status: 500 })
      }
      
      // Now run update for specified days
      console.log(`[PlayerStats Debug] Re-processing games for ${days} days...`)
      const result = await updatePlayerStats(days)
      const info = await getPlayerStatsInfo()
      
      return NextResponse.json({
        success: true,
        action: 'reset',
        message: 'Cleared processed games and re-processed all sports',
        daysProcessed: days,
        gamesProcessed: result.gamesProcessed,
        playersUpdated: result.playersUpdated,
        errors: result.errors,
        stats: info,
        durationMs: Date.now() - startTime
      })
    }
    
    // Action: lookup - look up a specific player's prop probability
    if (action === 'lookup') {
      const player = searchParams.get('player')
      const sport = searchParams.get('sport') || 'NBA'
      const stat = searchParams.get('stat') || 'points'
      const line = parseFloat(searchParams.get('line') || '20')
      
      if (!player) {
        return NextResponse.json({
          success: false,
          error: 'Missing player parameter'
        }, { status: 400 })
      }
      
      const result = await getPlayerPropProbability(player, sport, stat, line)
      
      return NextResponse.json({
        success: true,
        action: 'lookup',
        query: { player, sport, stat, line },
        result,
        durationMs: Date.now() - startTime
      })
    }
    
    // Action: update - fetch and process games
    console.log(`[PlayerStats Debug] Starting update for ${days} days...`)
    
    const result = await updatePlayerStats(days)
    
    // Get updated stats info
    const info = await getPlayerStatsInfo()
    
    // Get sample of players for verification
    const statsData = await getPlayerStatsData()
    const samplePlayers = statsData ? 
      Object.values(statsData.players).slice(0, 5).map(p => ({
        name: p.playerName,
        sport: p.sport,
        gamesPlayed: p.gamesPlayed,
        averages: p.averages
      })) : []
    
    return NextResponse.json({
      success: true,
      action: 'update',
      daysProcessed: days,
      gamesProcessed: result.gamesProcessed,
      playersUpdated: result.playersUpdated,
      errors: result.errors,
      stats: info,
      samplePlayers,
      durationMs: Date.now() - startTime
    })
    
  } catch (error) {
    console.error('[PlayerStats Debug] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to run player stats update',
      details: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
