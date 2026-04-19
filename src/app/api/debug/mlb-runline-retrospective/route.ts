/**
 * MLB Runline Retrospective
 *
 * Re-prices every settled MLB spread pick in our history using the real
 * runline juice ESPN's core odds endpoint reports for that game and reports
 * three things:
 *
 *  1. Flat-1u restatement — what the actual unit P/L would have been if the
 *     stored odds had been correct instead of the silent -110/-110 fallback.
 *  2. Post-fix filter — the subset of picks the updated ranker would still
 *     surface (positive Kelly at real juice, juice tighter than -250).
 *  3. Bankroll simulation — $100 start, half-Kelly sizing compounded
 *     chronologically through the whole history. Both "all shipped picks"
 *     and "post-fix filter only" tracks are reported side-by-side.
 *
 * This does NOT re-rank the daily candidate pool (we don't snapshot the full
 * pool), mutate stored picks, or re-grade outcomes. It only restates what
 * those same picks would have returned under the corrected pricing regime.
 *
 * Auth: requires CRON_SECRET in production. See lib/debug-auth.ts.
 *
 * GET /api/debug/mlb-runline-retrospective?days=60
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import { getRecentRecommendations, type TrackedRecommendation } from '@/lib/recommendation-tracking'
import { fetchESPNCoreSpreadOdds } from '@/lib/espn'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Minimum juice the live ranker accepts. Anything tighter than -250 is
// filtered out regardless of model probability; mirror that here so the
// post-fix simulation faithfully represents what the system would actually
// surface today.
const MAX_JUICE_MAGNITUDE = 250

function calculateUnitsWon(odds: number, units: number, result: 'won' | 'lost' | 'push'): number {
  if (result === 'push') return 0
  if (result === 'lost') return -units
  return odds > 0 ? units * (odds / 100) : units * (100 / Math.abs(odds))
}

function payoutRatio(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds)
}

/**
 * Kelly fraction from american odds and true probability [0, 1].
 * Returns 0 when the bet is -EV so callers don't accidentally size into it.
 */
function kellyFraction(odds: number, probability: number): number {
  const b = payoutRatio(odds)
  const p = probability
  const q = 1 - p
  const f = (b * p - q) / b
  return f > 0 ? f : 0
}

/**
 * For MLB runlines, the favorite always sits at -1.5 and the underdog at +1.5.
 * The favorite's juice is the more-positive (plus-money) side and the
 * underdog's juice is the more-negative (minus-money) side. That invariant
 * lets us identify the picked side's juice from (homeJuice, awayJuice, line)
 * without needing to know which team was home vs away.
 */
function pickedSideJuice(line: number, homeJuice: number, awayJuice: number): number {
  const favoriteJuice = homeJuice > awayJuice ? homeJuice : awayJuice
  const underdogJuice = homeJuice > awayJuice ? awayJuice : homeJuice
  return line < 0 ? favoriteJuice : underdogJuice
}

interface RetrospectivePickRow {
  id: string
  createdAt: string
  gameId: string
  gameName: string
  selection: string
  line: number | undefined
  status: TrackedRecommendation['status']
  storedOdds: number
  realJuice: number
  probability: number // Model probability at pick time, 0-100
  storedUnitsWon: number
  realUnitsWon: number
  unitsDelta: number
  kellyFracReal: number // 0..1; 0 means post-fix system would skip
  halfKellyFracReal: number
  wouldSurfacePostFix: boolean // true if new ranker would still take this pick
  oddsSource: 'current' | 'open' | 'close'
}

interface BankrollSim {
  startingBankroll: number
  finalBankroll: number
  peakBankroll: number
  troughBankroll: number
  maxDrawdownPct: number // relative to running peak, 0..1
  totalReturnPct: number // (final / start) - 1
  picksPlaced: number
  picksSkippedZeroKelly: number
  wins: number
  losses: number
  pushes: number
  endingBankrollAfterEachPick: number[] // so we can chart it if we want later
}

/**
 * Simulate $100 → half-Kelly compounding across a chronologically-sorted
 * list of picks. `kellyFrac` is the FULL kelly per pick; we halve it here
 * and cap the stake at `maxFraction` of the current bankroll to protect
 * against pathological sizing calls.
 */
function simulateBankroll(
  rows: RetrospectivePickRow[],
  opts: { starting: number; fractionOfKelly: number; maxFraction: number }
): BankrollSim {
  const { starting, fractionOfKelly, maxFraction } = opts
  const sorted = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  let bankroll = starting
  let peak = starting
  let trough = starting
  let peakRunning = starting
  let maxDD = 0
  let picksPlaced = 0
  let skipped = 0
  let wins = 0
  let losses = 0
  let pushes = 0
  const trajectory: number[] = []

  for (const r of sorted) {
    const kf = r.kellyFracReal * fractionOfKelly
    if (kf <= 0 || !r.wouldSurfacePostFix) {
      skipped++
      trajectory.push(bankroll)
      continue
    }
    const stakeFrac = Math.min(kf, maxFraction)
    const stake = bankroll * stakeFrac
    const b = payoutRatio(r.realJuice)

    if (r.status === 'won') {
      bankroll += stake * b
      wins++
    } else if (r.status === 'lost') {
      bankroll -= stake
      losses++
    } else if (r.status === 'push') {
      pushes++
    }
    picksPlaced++

    if (bankroll > peak) peak = bankroll
    if (bankroll < trough) trough = bankroll
    if (bankroll > peakRunning) peakRunning = bankroll
    const ddHere = peakRunning > 0 ? 1 - bankroll / peakRunning : 0
    if (ddHere > maxDD) maxDD = ddHere
    trajectory.push(bankroll)
  }

  return {
    startingBankroll: starting,
    finalBankroll: Number(bankroll.toFixed(2)),
    peakBankroll: Number(peak.toFixed(2)),
    troughBankroll: Number(trough.toFixed(2)),
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
    totalReturnPct: Number(((bankroll / starting - 1) * 100).toFixed(2)),
    picksPlaced,
    picksSkippedZeroKelly: skipped,
    wins,
    losses,
    pushes,
    endingBankrollAfterEachPick: trajectory.map((v) => Number(v.toFixed(2))),
  }
}

export async function GET(request: NextRequest) {
  const authFail = requireDebugAuth(request)
  if (authFail) return authFail

  const daysParam = request.nextUrl.searchParams.get('days')
  const days = Math.max(1, Math.min(180, Number(daysParam) || 60))
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000

  // Pull every recommendation we've logged (0 = no limit).
  const all = await getRecentRecommendations(0)

  // Scope: MLB spreads, settled (won/lost/push), within the lookback window.
  const mlbSpreads = all.filter(
    (r) =>
      r.sport === 'baseball_mlb' &&
      r.betType === 'spread' &&
      (r.status === 'won' || r.status === 'lost' || r.status === 'push') &&
      new Date(r.createdAt).getTime() >= cutoffMs
  )

  const rows: RetrospectivePickRow[] = []
  const skipped: Array<{ id: string; reason: string; gameName: string }> = []

  // Cache by gameId so duplicate picks on the same game don't double-request.
  const juiceCache = new Map<
    string,
    { home: number; away: number; source: 'current' | 'open' | 'close' } | null
  >()
  for (const reco of mlbSpreads) {
    if (typeof reco.line !== 'number') {
      skipped.push({ id: reco.id, reason: 'missing line', gameName: reco.gameName })
      continue
    }

    let odds = juiceCache.get(reco.gameId)
    if (odds === undefined) {
      odds = await fetchESPNCoreSpreadOdds('baseball', 'mlb', reco.gameId, { preferClose: true })
      juiceCache.set(reco.gameId, odds)
    }
    if (!odds) {
      skipped.push({ id: reco.id, reason: 'ESPN core odds unavailable', gameName: reco.gameName })
      continue
    }

    const realJuice = pickedSideJuice(reco.line, odds.home, odds.away)
    const status = reco.status as 'won' | 'lost' | 'push'
    const storedUnitsWon = calculateUnitsWon(reco.odds, 1, status)
    const realUnitsWon = calculateUnitsWon(realJuice, 1, status)

    // Model probability is stored as 0-100 on TrackedRecommendation.
    const p = Math.max(0, Math.min(1, reco.probability / 100))
    const kf = kellyFraction(realJuice, p)
    const juiceOK = Math.abs(realJuice) <= MAX_JUICE_MAGNITUDE
    const wouldSurface = kf > 0 && juiceOK

    rows.push({
      id: reco.id,
      createdAt: reco.createdAt,
      gameId: reco.gameId,
      gameName: reco.gameName,
      selection: reco.selection,
      line: reco.line,
      status: reco.status,
      storedOdds: reco.odds,
      realJuice,
      probability: reco.probability,
      storedUnitsWon,
      realUnitsWon,
      unitsDelta: realUnitsWon - storedUnitsWon,
      kellyFracReal: Number(kf.toFixed(4)),
      halfKellyFracReal: Number((kf / 2).toFixed(4)),
      wouldSurfacePostFix: wouldSurface,
      oddsSource: odds.source,
    })
  }

  const decided = rows.filter((r) => r.status === 'won' || r.status === 'lost')
  const wins = rows.filter((r) => r.status === 'won').length
  const losses = rows.filter((r) => r.status === 'lost').length
  const pushes = rows.filter((r) => r.status === 'push').length

  const storedUnits = rows.reduce((s, r) => s + r.storedUnitsWon, 0)
  const realUnits = rows.reduce((s, r) => s + r.realUnitsWon, 0)
  const storedROI = decided.length > 0 ? (storedUnits / decided.length) * 100 : 0
  const realROI = decided.length > 0 ? (realUnits / decided.length) * 100 : 0

  // Post-fix subset: picks the updated ranker would actually surface.
  const postFix = rows.filter((r) => r.wouldSurfacePostFix)
  const postFixDecided = postFix.filter((r) => r.status !== 'push')
  const postFixWins = postFix.filter((r) => r.status === 'won').length
  const postFixLosses = postFix.filter((r) => r.status === 'lost').length
  const postFixUnits = postFix.reduce((s, r) => s + r.realUnitsWon, 0)
  const postFixROI = postFixDecided.length > 0 ? (postFixUnits / postFixDecided.length) * 100 : 0

  // Bankroll simulations. We run three tracks for clarity:
  //   (a) "all shipped" half-Kelly — what you'd have made half-Kelling
  //       every pick the old system shipped, priced at real juice.
  //       This is the pessimistic case (includes picks the new filter
  //       would reject as -EV at real juice, which will drag bankroll).
  //   (b) "post-fix" half-Kelly — restricted to picks the new system
  //       would still surface. This is the realistic forward-looking case.
  //   (c) "post-fix" quarter-Kelly — same subset, more conservative
  //       sizing. Included so the reader can see how much variance
  //       drops when you halve the fraction.
  const simShippedHalf = simulateBankroll(
    rows.map((r) => ({ ...r, wouldSurfacePostFix: r.kellyFracReal > 0 })),
    { starting: 100, fractionOfKelly: 0.5, maxFraction: 0.25 }
  )
  const simPostFixHalf = simulateBankroll(rows, {
    starting: 100,
    fractionOfKelly: 0.5,
    maxFraction: 0.25,
  })
  const simPostFixQuarter = simulateBankroll(rows, {
    starting: 100,
    fractionOfKelly: 0.25,
    maxFraction: 0.25,
  })

  return NextResponse.json({
    success: true,
    windowDays: days,
    flatOneUnit: {
      totalPicksInWindow: mlbSpreads.length,
      priced: rows.length,
      skipped: skipped.length,
      wins,
      losses,
      pushes,
      winRate: decided.length > 0 ? (wins / decided.length) * 100 : 0,
      storedUnits: Number(storedUnits.toFixed(3)),
      realUnits: Number(realUnits.toFixed(3)),
      storedROI: Number(storedROI.toFixed(2)),
      realROI: Number(realROI.toFixed(2)),
      deltaUnits: Number((realUnits - storedUnits).toFixed(3)),
    },
    postFixSubset: {
      criteria: `kelly > 0 at real juice AND |juice| <= ${MAX_JUICE_MAGNITUDE}`,
      picks: postFix.length,
      skippedByFilter: rows.length - postFix.length,
      wins: postFixWins,
      losses: postFixLosses,
      winRate: postFixDecided.length > 0 ? (postFixWins / postFixDecided.length) * 100 : 0,
      realUnits: Number(postFixUnits.toFixed(3)),
      realROI: Number(postFixROI.toFixed(2)),
    },
    bankrollSim: {
      allShipped_halfKelly: simShippedHalf,
      postFix_halfKelly: simPostFixHalf,
      postFix_quarterKelly: simPostFixQuarter,
    },
    picks: rows,
    skipped,
  })
}
