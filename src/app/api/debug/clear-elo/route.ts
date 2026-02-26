/**
 * Debug Endpoint: Clear Elo Data for Full Recalculation
 * 
 * This endpoint clears all Elo ratings and processed game IDs,
 * allowing a full recalculation from scratch with new parameters.
 * 
 * Query params:
 * - league: Optional - only clear a specific league (if not provided, clears ALL)
 * - confirm: Must be "yes" to actually clear data
 */

import { NextResponse } from 'next/server'
import { requireDebugAuth } from "@/lib/debug-auth"
import {
  getEloRatings,
  saveEloRatings,
  saveProcessedGameIds,
  getProcessedGameIds,
  SUPPORTED_LEAGUES,
  type EloRatings
} from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    const url = new URL(request.url)
    const league = url.searchParams.get('league')
    const confirm = url.searchParams.get('confirm')
    
    // Safety check
    if (confirm !== 'yes') {
      return NextResponse.json({
        warning: 'This will clear Elo data. Add ?confirm=yes to proceed.',
        usage: league 
          ? `?league=${league}&confirm=yes` 
          : '?confirm=yes (clears ALL leagues)',
        supportedLeagues: SUPPORTED_LEAGUES
      })
    }
    
    // Get current data
    const eloData = await getEloRatings()
    const processedIds = await getProcessedGameIds()
    
    if (!eloData) {
      return NextResponse.json({ error: 'No Elo data found' }, { status: 404 })
    }
    
    const originalTeamCount = Object.keys(eloData.ratings).length
    const originalProcessedCount = processedIds.size
    
    if (league) {
      // Clear only specific league
      const teamsToReset = Object.keys(eloData.ratings).filter(key => 
        eloData.ratings[key].league === league
      )
      
      for (const key of teamsToReset) {
        delete eloData.ratings[key]
      }
      
      // Clear ALL processed IDs to force reprocessing
      const newProcessedIds = new Set<string>()
      
      await saveEloRatings(eloData)
      await saveProcessedGameIds(newProcessedIds)
      
      return NextResponse.json({
        success: true,
        action: 'reset_league',
        league,
        teamsRemoved: teamsToReset.length,
        processedIdsCleared: originalProcessedCount,
        remainingTeams: Object.keys(eloData.ratings).length,
        nextStep: `Run full backfill: /api/debug/elo-backfill?full=true&league=${league}`
      })
    } else {
      // Clear ALL data
      const clearedData: EloRatings = {
        ratings: {},
        lastUpdated: new Date().toISOString(),
        gamesProcessed: 0
      }
      
      await saveEloRatings(clearedData)
      await saveProcessedGameIds(new Set<string>())
      
      return NextResponse.json({
        success: true,
        action: 'reset_all',
        teamsRemoved: originalTeamCount,
        processedIdsCleared: originalProcessedCount,
        nextStep: 'Run full backfill: /api/debug/elo-backfill?full=true'
      })
    }
    
  } catch (error) {
    console.error('[Clear Elo] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to clear Elo data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
