import { NextResponse } from "next/server"
import { fetchAllOdds } from "@/lib/odds"

/**
 * Cron endpoint to fetch fresh odds data
 * 
 * This endpoint is called by Vercel Cron Jobs at scheduled times:
 * - 8:00 AM ET (13:00 UTC)
 * - 2:00 PM ET (19:00 UTC)
 * - 8:00 PM ET (01:00 UTC next day)
 * 
 * This keeps the odds cache fresh while staying under the 500 requests/month limit.
 * Math: 3 sports × 3 times/day = 9 requests/day = ~270 requests/month
 */
export async function GET(request: Request) {
  try {
    // Verify the request is from Vercel Cron (optional security)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // If CRON_SECRET is set, verify it matches
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    
    // Check if ODDS_API_KEY is configured
    if (!process.env.ODDS_API_KEY) {
      console.error("ODDS_API_KEY is not configured")
      return NextResponse.json({ 
        error: "Odds API not configured",
        details: "ODDS_API_KEY environment variable is not set"
      }, { status: 500 })
    }
    
    console.log("Starting scheduled odds fetch...")
    
    // Fetch fresh odds for all sports
    const oddsData = await fetchAllOdds()
    
    console.log(`Fetched ${oddsData.games.length} games at ${oddsData.lastUpdated}`)
    
    return NextResponse.json({
      success: true,
      gamesCount: oddsData.games.length,
      lastUpdated: oddsData.lastUpdated,
      message: `Successfully fetched odds for ${oddsData.games.length} games`
    })
    
  } catch (error) {
    console.error("Cron fetch-odds error:", error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: "Failed to fetch odds", details: errorMessage },
      { status: 500 }
    )
  }
}
