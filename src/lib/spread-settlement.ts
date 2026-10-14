/** Correct grade of integer lines in sports with integer score margins.
 *
 * A bet at -3 is NOT a binary event: exactly a 3-point win pushes.
 * For a half-point line (e.g. baseball +1.5), pushes are impossible.
 *
 * These are conditional probabilities under the existing Elo margin model,
 * NOT evidence that its league-specific sigma is calibrated. Historical
 * spread calibration must be evaluated out of sample before claiming edge.
 */
function gaussianCdf(value: number): number {
  // Abramowitz/Stegun erf approximation, maximum absolute error ~1.5e-7.
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value) / Math.SQRT2
  const t = 1 / (1 + 0.3275911*x)
  const erf = 1-(((((1.061405429*t - 1.453152027)*t) +
    1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x)
  return (1+sign*erf)/2
}

export function getSpreadSettlementProbabilities(
  expectedHomeMargin: number, sigma: number, homeSpread: number, forHome: boolean
): {win:number;push:number;lose:number} {
  if (![expectedHomeMargin,sigma,homeSpread].every(Number.isFinite) || sigma<=0)
    throw new Error('Invalid margin model inputs')
  const threshold=-homeSpread
  const integerLine=Math.abs(threshold-Math.round(threshold))<1e-9
  const normalized = (x:number)=>gaussianCdf((x-expectedHomeMargin)/sigma)
  let homeWin:number, homeLoss:number, push:number
  if (integerLine) {
    // Integer score margin equals exactly threshold -> refunded wager.
    homeWin=1-normalized(threshold+0.5)
    homeLoss=normalized(threshold-0.5)
    push=Math.max(0,1-homeWin-homeLoss)
  } else {
    // Every margin is integer. Winning home margin must exceed threshold.
    const boundary=Math.floor(threshold)+0.5
    homeWin=1-normalized(boundary)
    homeLoss=1-homeWin
    push=0
  }
  return forHome
    ? {win:homeWin,push,lose:homeLoss}
    : {win:homeLoss,push,lose:homeWin}
}
