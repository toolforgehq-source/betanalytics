import { NextResponse } from 'next/server'
import { getCachedBestBet } from '@/lib/bet-ranking'
import { getRecentRecommendations } from '@/lib/recommendation-tracking'
import { dedupeAndSort, type PickLike } from '@/lib/enforce-picks'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Step 1: Get cached best bet (same as chat route)
    const bestBetResult = await getCachedBestBet()
    
    const strictPicks = bestBetResult?.allRankedBets || []
    const eloPicks = bestBetResult?.allEloBets || []
    
    // Step 2: Fetch stored recommendations (same as chat route)
    const rawRecentRecos = await getRecentRecommendations(200)
    const recentRecos = Array.isArray(rawRecentRecos) ? rawRecentRecos : []
    
    // Step 3: Filter to today (same betting-day logic)
    const now = new Date()
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    const etNow = new Date(etStr)
    const bettingDay = new Date(etNow)
    if (etNow.getHours() < 2) {
      bettingDay.setDate(bettingDay.getDate() - 1)
    }
    const todayStr = bettingDay.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    
    const todaysRecommendations = recentRecos.filter(r => {
      const recoDate = new Date(r.commenceTime || r.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
      return recoDate === todayStr
    })
    
    // Step 4: Merge all sources (same as chat route)
    const allRawPicks: PickLike[] = [...strictPicks, ...eloPicks, ...todaysRecommendations]
    const allBets = dedupeAndSort(allRawPicks)
    
    // Return diagnostic info
    return NextResponse.json({
      todayStr,
      counts: {
        strictPicks: strictPicks.length,
        eloPicks: eloPicks.length,
        totalRecentRecos: recentRecos.length,
        todaysRecommendations: todaysRecommendations.length,
        allRawPicks: allRawPicks.length,
        afterDedup: allBets.length,
      },
      topBet: allBets[0] ? {
        team: allBets[0].team,
        gameId: allBets[0].gameId,
        betType: allBets[0].betType,
        score: allBets[0].score,
        selection: allBets[0].selection,
        source: allBets[0].source,
      } : null,
      top5: allBets.slice(0, 5).map(b => ({
        team: b.team,
        gameId: b.gameId,
        betType: b.betType,
        score: b.score,
        selection: b.selection,
        source: b.source,
      })),
      // Show a few stored recos for debugging
      sampleStoredRecos: todaysRecommendations.slice(0, 3).map(r => ({
        gameId: r.gameId,
        selection: r.selection,
        betType: r.betType,
        score: r.score,
        source: r.source,
      })),
      // Show strict picks for comparison
      sampleStrictPicks: strictPicks.slice(0, 3).map((b: PickLike) => ({
        team: b.team,
        gameId: b.gameId,
        betType: b.betType,
        score: b.score,
      })),
    })
  } catch (error) {
    return NextResponse.json({
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 })
  }
}
