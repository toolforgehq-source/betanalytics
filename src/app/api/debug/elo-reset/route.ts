/**
 * Debug Endpoint: Reset Elo Data for a League
 * 
 * This endpoint clears Elo ratings and processed game IDs for a specific league,
 * allowing a full recalculation from scratch with new parameters.
 * 
 * Query params:
 * - league: The league to reset (required)
 */

import { NextResponse } from 'next/server'
import { requireDebugAuth } from "@/lib/debug-auth"
import {
  getEloRatings,
  saveEloRatings,
  saveProcessedGameIds,
  getProcessedGameIds,
} from '@/lib/elo'

export const runtime = 'edge'
export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    const url = new URL(request.url)
    const league = url.searchParams.get('league')
    
    if (!league) {
      return NextResponse.json({ 
        error: 'Missing league parameter',
        usage: '?league=NBA (or NHL, NFL, NCAAB, etc.)'
      }, { status: 400 })
    }
    
    // Get current data
    const eloData = await getEloRatings()
    const processedIds = await getProcessedGameIds()
    
    if (!eloData) {
      return NextResponse.json({ error: 'No Elo data found' }, { status: 404 })
    }
    
    // Count teams to reset
    const teamsToReset = Object.keys(eloData.ratings).filter(key => 
      eloData.ratings[key].league === league
    )
    
    // Remove league teams from ratings
    for (const key of teamsToReset) {
      delete eloData.ratings[key]
    }
    
    // Clear ALL processed game IDs to force reprocessing
    // This is necessary because we can't easily identify which game IDs belong to which league
    const clearedCount = processedIds.size
    const newProcessedIds = new Set<string>()
    
    // Save cleared data
    await saveEloRatings(eloData)
    await saveProcessedGameIds(newProcessedIds)
    
    return NextResponse.json({
      success: true,
      message: `Reset complete for ${league}`,
      teamsRemoved: teamsToReset.length,
      processedIdsCleared: clearedCount,
      remainingTeams: Object.keys(eloData.ratings).length,
      nextStep: `Run full backfill: /api/debug/elo-backfill?full=true&league=${league}`
    })
    
  } catch (error) {
    console.error('[Elo Reset] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to reset Elo data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
