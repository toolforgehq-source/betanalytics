/**
 * Diagnostic endpoint to inspect tier assignment details from cached best bet result.
 * Shows why picks are or aren't qualifying as Lock/Strong.
 */
import { NextResponse } from 'next/server'
import { getCachedBestBet } from '@/lib/bet-ranking'

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
      lockFailReasons: getLockFailReasons(b),
      // Why it's not Strong
      strongFailReasons: getStrongFailReasons(b),
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
      lockFailReasons: getLockFailReasons(b),
      strongFailReasons: getStrongFailReasons(b),
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

function getLockFailReasons(b: { eloProbability?: number; edge: number; eloConfidence?: string; situationalBreakdown?: { sharpMoney?: { adjustment?: number } }; situationalAdjustment?: number; betType: string; line?: number; homeElo?: number; awayElo?: number }): string[] {
  const reasons: string[] = []
  const prob = b.eloProbability !== undefined ? b.eloProbability : 0
  if (prob < 62) reasons.push(`prob ${prob.toFixed(1)} < 62`)
  if (b.edge < 5) reasons.push(`edge ${b.edge.toFixed(1)} < 5`)
  const conf = b.eloConfidence || 'unknown'
  if (conf !== 'high' && conf !== 'very_high') reasons.push(`confidence ${conf} not high/very_high`)
  const sharpAdj = b.situationalBreakdown?.sharpMoney?.adjustment
  if (sharpAdj !== undefined && sharpAdj < -0.01) reasons.push(`sharp against (${sharpAdj.toFixed(2)})`)
  const sitAdj = b.situationalAdjustment || 0
  if (sitAdj < -0.01) reasons.push(`negative sit adj (${sitAdj.toFixed(2)})`)
  const spreadSize = b.betType === 'spread' && b.line !== undefined ? Math.abs(b.line) : 0
  if (spreadSize > 10) reasons.push(`spread ${spreadSize} > 10`)
  const eloGap = b.homeElo && b.awayElo ? Math.abs(b.homeElo - b.awayElo) : 0
  if (eloGap > 300) reasons.push(`elo gap ${eloGap} > 300`)
  return reasons
}

function getStrongFailReasons(b: { eloProbability?: number; edge: number; eloConfidence?: string; betType: string; line?: number; homeElo?: number; awayElo?: number }): string[] {
  const reasons: string[] = []
  const prob = b.eloProbability !== undefined ? b.eloProbability : 0
  if (prob < 57) reasons.push(`prob ${prob.toFixed(1)} < 57`)
  if (b.edge < 4) reasons.push(`edge ${b.edge.toFixed(1)} < 4`)
  const conf = b.eloConfidence || 'unknown'
  if (conf !== 'medium' && conf !== 'high' && conf !== 'very_high') reasons.push(`confidence ${conf}`)
  const spreadSize = b.betType === 'spread' && b.line !== undefined ? Math.abs(b.line) : 0
  if (spreadSize > 14) reasons.push(`spread ${spreadSize} > 14`)
  const eloGap = b.homeElo && b.awayElo ? Math.abs(b.homeElo - b.awayElo) : 0
  if (eloGap > 300) reasons.push(`elo gap ${eloGap} > 300`)
  return reasons
}
