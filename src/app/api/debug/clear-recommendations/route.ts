import { NextResponse } from "next/server"
import { requireDebugAuth } from "@/lib/debug-auth"
import { clearAllRecommendations } from "@/lib/recommendation-tracking"
import { clearAllPicks } from "@/lib/pick-tracking"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    // Clear both recommendation tracking AND pick tracking data
    // This performs a comprehensive reset of all records to zero
    const [recoResult, picksResult] = await Promise.all([
      clearAllRecommendations(),
      clearAllPicks()
    ])
    
    return NextResponse.json({
      success: true,
      message: `Reset complete. Cleared ${recoResult.deleted} recommendations and ${picksResult.deleted} picks. All records start fresh from zero.`,
      recommendationsDeleted: recoResult.deleted,
      picksDeleted: picksResult.deleted,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
