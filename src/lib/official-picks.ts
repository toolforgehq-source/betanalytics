import type { BestBetResult, RankedBet } from './bet-ranking'

/**
 * The persisted model-performance ledger must contain exactly the selections
 * published by the globally qualified engine, never a re-ranked candidate pool.
 * Safe fallback supports previously created fixtures, not a fresh independent
 * ranking; no more than 3 distinct, future games are allowed.
 */
export function selectOfficialPicksForTracking(
  result: BestBetResult,
  atMs = Date.now()
): RankedBet[] {
  const canonical = result.officialPicks ??
    [result.bestBet, result.runnerUp].filter((bet): bet is RankedBet => bet !== null)
  const seenGames = new Set<string>()
  const selected: RankedBet[] = []
  for (const bet of canonical) {
    if (selected.length >= 3) break
    if (bet.confidenceTier !== 'lock' && bet.confidenceTier !== 'strong') continue
    if (!bet.gameId || seenGames.has(bet.gameId)) continue
    const commence = Date.parse(bet.commenceTime)
    if (!Number.isFinite(commence) || commence <= atMs) continue
    seenGames.add(bet.gameId)
    selected.push(bet)
  }
  return selected
}
