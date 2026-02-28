import { NextResponse } from "next/server"
import { clearAllRecommendations } from "@/lib/recommendation-tracking"

export const dynamic = "force-dynamic"

export async function POST() {
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
    }, { status: 500 })
  }
}
