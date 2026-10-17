/**
 * Diagnostic endpoint to inspect tier assignment details from cached best bet result.
 * Shows why picks are or aren't qualifying as Lock/Strong.
 */
import { NextResponse } from 'next/server'
import { getCachedBestBet } from '@/lib/bet-ranking'
import { getTopPickRejectionReasons } from '@/lib/enforce-picks'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cached = await getCachedBestBet()
    
    if (!cached) {
      return NextResponse.json({ error: 'No cached best bet result found' })
    }
    
    const allRanked = cached.allRankedBets || []
    const allElo = cached.allEloBets || []
    
    // Tier counts
    const strictTiers = {
      lock: allRanked.filter(b => b.confidenceTier === 'lock').length,
      strong: allRanked.filter(b => b.confidenceTier === 'strong').length,
      value: allRanked.filter(b => b.confidenceTier === 'value').length,
      total: allRanked.length,
    }
    
    const eloTiers = {
      lock: allElo.filter(b => b.confidenceTier === 'lock').length,
      strong: allElo.filter(b => b.confidenceTier === 'strong').length,
      value: allElo.filter(b => b.confidenceTier === 'value').length,
      total: allElo.length,
    }
    
    // Show top 10 bets from each source with their tier-relevant stats
    const topStrict = allRanked.slice(0, 10).map(b => ({
      team: b.team,
      sport: b.sportName,
      betType: b.betType,
      tier: b.confidenceTier,
      score: b.score,
      eloProbability: b.eloProbability,
      consensusProbability: b.consensusProbability,
      edge: b.edge,
      eloConfidence: b.eloConfidence,
      situationalAdj: b.situationalAdjustment,
      sharpAdj: b.situationalBreakdown?.sharpMoney?.adjustment,
      line: b.line,
      spreadSize: b.betType === 'spread' && b.line !== undefined ? Math.abs(b.line) : 0,
      eloGap: b.homeElo && b.awayElo ? Math.abs(b.homeElo - b.awayElo) : 0,
      // Why it's not Lock
      lockFailReasons: getTopPickRejectionReasons(b),
      // Why it's not Strong
      strongFailReasons: getTopPickRejectionReasons(b),
    }))
    
    const topElo = allElo.slice(0, 10).map(b => ({
      team: b.team,
      sport: b.sportName,
      betType: b.betType,
      tier: b.confidenceTier,
      score: b.score,
      eloProbability: b.eloProbability,
      consensusProbability: b.consensusProbability,
      edge: b.edge,
      eloConfidence: b.eloConfidence,
      situationalAdj: b.situationalAdjustment,
      sharpAdj: b.situationalBreakdown?.sharpMoney?.adjustment,
      line: b.line,
      spreadSize: b.betType === 'spread' && b.line !== undefined ? Math.abs(b.line) : 0,
      eloGap: b.homeElo && b.awayElo ? Math.abs(b.homeElo - b.awayElo) : 0,
      lockFailReasons: getTopPickRejectionReasons(b),
      strongFailReasons: getTopPickRejectionReasons(b),
    }))
    
    return NextResponse.json({
      cachedAt: cached.calculatedAt,
      gamesAnalyzed: cached.gamesAnalyzed,
      gamesQualified: cached.gamesQualified,
      bestBet: cached.bestBet ? {
        team: cached.bestBet.team,
        tier: cached.bestBet.confidenceTier,
        score: cached.bestBet.score,
        eloProbability: cached.bestBet.eloProbability,
        edge: cached.bestBet.edge,
      } : null,
      strictTiers,
      eloTiers,
      topStrictBets: topStrict,
      topEloBets: topElo,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

