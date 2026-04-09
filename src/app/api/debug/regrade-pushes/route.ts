/**
 * Debug endpoint to re-grade picks incorrectly marked as "push" due to missing line data.
 * 
 * GET /api/debug/regrade-pushes
 * 
 * This repairs picks where storePick() was called without the `line` field,
 * causing all spread/total picks to be graded as "push" with "line: undefined".
 * It recovers lines from the recommendation tracking system and re-grades using ESPN scores.
 */

import { NextResponse } from 'next/server'
import { regradeIncorrectPushes } from '@/lib/pick-tracking'
import { requireDebugAuth } from '@/lib/debug-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    console.log('[regrade-pushes] Starting repair of incorrectly pushed picks...')
    const result = await regradeIncorrectPushes()
    console.log(`[regrade-pushes] Complete: ${result.repaired} repaired, ${result.lineRecovered} lines recovered, ${result.errors} errors`)
    
    return NextResponse.json({
      success: true,
      ...result
    })
  } catch (error) {
    console.error('[regrade-pushes] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
