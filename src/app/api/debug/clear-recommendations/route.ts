import { NextResponse } from "next/server"
import { requireDebugAuth } from "@/lib/debug-auth"
import { clearAllRecommendations } from "@/lib/recommendation-tracking"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    const result = await clearAllRecommendations()
    
    return NextResponse.json({
      success: true,
      message: `Cleared ${result.deleted} recommendations. Performance tracking starts fresh.`,
      deleted: result.deleted,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
