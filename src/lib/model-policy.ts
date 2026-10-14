/**
 * Model integrity policy for all sports and markets.
 *
 * Do not translate an interesting narrative (revenge, rivalry, rest, travel,
 * line moves, "must win", recent form) into points of implied win probability
 * without OUT-OF-TIME evidence for that sport, market and factor.
 *
 * This module is deliberately independent of Redis, bettors, or UI formatting
 * so risk rules can be replayed on historical quotations.
 */

export const MODEL_VERSION = 'elo-evidence-v3'
export const OFFICIAL_MAX_QUOTE_AGE_MS = 75 * 60 * 1000

export type BetMarket = 'moneyline' | 'spread' | 'total'

/** No active research-only coefficients have passed prospective validation yet.
 * Enabling a factor must be a new, independently tested model version.
 */
export function validatedSituationalShift(
  _league: string,
  _market: BetMarket,
  _researchShift: number
): number {
  // Intentionally zero in v3: previous additive values were unvalidated and
  // could even imply BOTH teams gained win probability from the same rivalry.
  return 0
}

/** Conditional on settlement, no-vig probability is not the bookmaker payout.
 * Handle full wins, full losses and exact-line pushes consistently.
 */
export function modelSettlement(
  winProbability: number,
  pushProbability: number,
  americanOdds: number
): { win: number; push: number; lose: number; returnPerUnit: number; breakEvenWinProbability: number; edgePercentagePoints: number } {
  if (
    !Number.isFinite(winProbability) || !Number.isFinite(pushProbability) ||
    !Number.isFinite(americanOdds) || americanOdds === 0 ||
    winProbability < 0 || pushProbability < 0 ||
    winProbability + pushProbability > 1 + 1e-10
  ) throw new Error('Invalid settlement probabilities or bookmaker odds')
  const win = Math.min(1,winProbability)
  const push = Math.min(1, pushProbability)
  const lose = Math.max(0,1-win-push)
  const netPayout = americanOdds > 0 ? americanOdds/100 : 100/Math.abs(americanOdds)
  const breakEvenWinProbability = (1-push)/(netPayout+1)
  return {
    win,push,lose,
    returnPerUnit:win*netPayout-lose,
    breakEvenWinProbability,
    edgePercentagePoints:(win-breakEvenWinProbability)*100
  }
}

/** A quote may only qualify when its snapshot is fresh AND its game has not
 * started. Invalid or missing timestamps fail closed.
 */
export function isFreshPregameQuote(
  calculatedAt: string | undefined,
  commenceTime: string | undefined,
  atMs: number = Date.now(),
  maxAgeMs: number = OFFICIAL_MAX_QUOTE_AGE_MS,
): boolean {
  if (!calculatedAt || !commenceTime) return false
  const snapshot = Date.parse(calculatedAt)
  const start = Date.parse(commenceTime)
  return Number.isFinite(snapshot) && Number.isFinite(start) &&
    snapshot <= atMs + 60_000 && atMs-snapshot >= -60_000 &&
    atMs-snapshot <= maxAgeMs &&
    start > atMs && start > snapshot
}

/** Confidence cap expresses a risk policy, not a proven forecast advantage.
 * The input probability itself is not changed without evidence.
 */
export function isSaneTwoWayMarketPrice(americanOdds: number): boolean {
  return Number.isFinite(americanOdds) && Number.isInteger(americanOdds) &&
    americanOdds !== 0 && Math.abs(americanOdds) >= 100 &&
    americanOdds > -10_000 && americanOdds < 10_000
}
