import { NextResponse } from "next/server"
import { getCurrentOdds } from "@/lib/odds"
import { getAnalytics, formatTimeSinceUpdate } from "@/lib/analytics"

/**
 * GET /api/analytics
 * 
 * Returns real-time analytics data calculated from current odds:
 * - High confidence picks count
 * - Sharp money signals count
 * - Model consensus rating
 * - Data freshness indicators
 */
export async function GET() {
  try {
    // Get current odds data (from cache or fresh fetch)
    const oddsData = await getCurrentOdds()
    
    // Calculate analytics from odds data
    const analytics = getAnalytics(oddsData)
    
    // Format the time since update for display
    const timeSinceUpdate = formatTimeSinceUpdate(analytics.minutesSinceUpdate)
    
    return NextResponse.json({
      success: true,
      data: {
        highConfidencePicks: analytics.highConfidencePicks,
        sharpMoneySignals: analytics.sharpMoneySignals,
        modelConsensus: analytics.modelConsensus,
        modelConsensusRatio: analytics.modelConsensusRatio,
        freshnessStatus: analytics.freshnessStatus,
        timeSinceUpdate,
        lastUpdated: analytics.lastUpdated,
        gamesAnalyzed: oddsData.games.length,
        isStale: oddsData.isStale,
      }
    })
  } catch (error) {
    console.error("Analytics API error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    
    // Return fallback data on error
    return NextResponse.json({
      success: false,
      error: errorMessage,
      data: {
        highConfidencePicks: 0,
        sharpMoneySignals: 0,
        modelConsensus: "Limited",
        modelConsensusRatio: "0/4",
        freshnessStatus: "stale",
        timeSinceUpdate: "Unknown",
        lastUpdated: null,
        gamesAnalyzed: 0,
        isStale: true,
      }
    })
  }
}
