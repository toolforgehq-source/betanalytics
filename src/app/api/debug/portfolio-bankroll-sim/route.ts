/**
 * Portfolio-Wide Bankroll Simulation
 *
 * Simulates what $100 compounded at half-Kelly (and quarter-Kelly) across the
 * ENTIRE daily top-3 board would have returned over the lookback window —
 * not just the MLB-spread sleeve.
 *
 * Scope mirrors what the live Model Picks / Performance pages actually show:
 *   source = best_bet  AND  confidenceTier in {lock, strong}
 *   capped at 1 Lock + 2 Strong per betting day (enforceDailyCaps)
 *
 * For each pick we need a "fair juice" price to feed Kelly. Three branches:
 *   - MLB spread  → fetch real DK close juice from ESPN core (-110 fallback
 *                    was wrong; see #227 / #228)
 *   - Everything else → use the stored `odds` field (was never affected)
 *
 * Picks where Kelly <= 0 at fair juice are skipped (the updated ranker
 * wouldn't surface them). All others size at half-Kelly * bankroll, capped
 * at 25% of bankroll per pick.
 *
 * Auth: requires CRON_SECRET in production.
 *
 * GET /api/debug/portfolio-bankroll-sim?days=60
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import {
  getRecentRecommendations,
  enforceDailyCaps,
  type TrackedRecommendation,
} from '@/lib/recommendation-tracking'
import { fetchESPNCoreSpreadOdds } from '@/lib/espn'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_JUICE_MAGNITUDE = 250
const MAX_STAKE_FRACTION = 0.25 // safety cap; pathological Kelly calls never exceed 25% of bankroll

function payoutRatio(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds)
}

function kellyFraction(odds: number, probability: number): number {
  const b = payoutRatio(odds)
  const p = probability
  const q = 1 - p
  const f = (b * p - q) / b
  return f > 0 ? f : 0
}

function pickedSideJuice(line: number, homeJuice: number, awayJuice: number): number {
  const favoriteJuice = homeJuice > awayJuice ? homeJuice : awayJuice
  const underdogJuice = homeJuice > awayJuice ? awayJuice : homeJuice
  return line < 0 ? favoriteJuice : underdogJuice
}

interface PricedPick {
  id: string
  createdAt: string
  sport: string
  sportName: string
  gameName: string
  selection: string
  confidenceTier: 'lock' | 'strong'
  betType: TrackedRecommendation['betType']
  line?: number
  status: 'won' | 'lost' | 'push'
  storedOdds: number
  fairJuice: number
  juiceCorrected: boolean
  probability: number // 0-100
  kellyFracFair: number // 0..1
  halfKellyFracFair: number
  wouldSurface: boolean
}

interface BankrollSim {
  label: string
  startingBankroll: number
  finalBankroll: number
  peakBankroll: number
  troughBankroll: number
  maxDrawdownPct: number
  totalReturnPct: number
  picksPlaced: number
  picksSkippedZeroKelly: number
  wins: number
  losses: number
  pushes: number
  trajectory: Array<{ date: string; bankroll: number }>
}

function simulateBankroll(
  picks: PricedPick[],
  opts: { label: string; starting: number; fractionOfKelly: number }
): BankrollSim {
  const sorted = [...picks].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  let bankroll = opts.starting
  let peak = opts.starting
  let trough = opts.starting
  let peakRunning = opts.starting
  let maxDD = 0
  let picksPlaced = 0
  let skipped = 0
  let wins = 0
  let losses = 0
  let pushes = 0
  const trajectory: Array<{ date: string; bankroll: number }> = []

  for (const r of sorted) {
    const kf = r.kellyFracFair * opts.fractionOfKelly
    if (kf <= 0 || !r.wouldSurface) {
      skipped++
      continue
    }
    const stakeFrac = Math.min(kf, MAX_STAKE_FRACTION)
    const stake = bankroll * stakeFrac
    const b = payoutRatio(r.fairJuice)

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
    trajectory.push({ date: r.createdAt.slice(0, 10), bankroll: Number(bankroll.toFixed(2)) })
  }

  return {
    label: opts.label,
    startingBankroll: opts.starting,
    finalBankroll: Number(bankroll.toFixed(2)),
    peakBankroll: Number(peak.toFixed(2)),
    troughBankroll: Number(trough.toFixed(2)),
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
    totalReturnPct: Number(((bankroll / opts.starting - 1) * 100).toFixed(2)),
    picksPlaced,
    picksSkippedZeroKelly: skipped,
    wins,
    losses,
    pushes,
    trajectory,
  }
}

export async function GET(request: NextRequest) {
  const authFail = requireDebugAuth(request)
  if (authFail) return authFail

  const daysParam = request.nextUrl.searchParams.get('days')
  const days = Math.max(1, Math.min(180, Number(daysParam) || 60))
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000

  // Match the live /performance page scope exactly: best_bet + lock/strong,
  // then enforce daily caps so each betting day has at most 1 Lock + 2 Strong.
  const all = await getRecentRecommendations(0)
  const filtered = all.filter(
    (r) =>
      r.source === 'best_bet' &&
      (r.confidenceTier === 'lock' || r.confidenceTier === 'strong') &&
      (r.status === 'won' || r.status === 'lost' || r.status === 'push') &&
      new Date(r.createdAt).getTime() >= cutoffMs
  )
  const capped = enforceDailyCaps(filtered)

  // Price each pick with fair juice.
  const priced: PricedPick[] = []
  const skipped: Array<{ id: string; reason: string; gameName: string }> = []
  const juiceCache = new Map<
    string,
    { home: number; away: number; source: 'current' | 'open' | 'close' } | null
  >()

  for (const reco of capped) {
    let fairJuice = reco.odds
    let corrected = false

    if (reco.sport === 'baseball_mlb' && reco.betType === 'spread' && typeof reco.line === 'number') {
      let odds = juiceCache.get(reco.gameId)
      if (odds === undefined) {
        odds = await fetchESPNCoreSpreadOdds('baseball', 'mlb', reco.gameId, { preferClose: true })
        juiceCache.set(reco.gameId, odds)
      }
      if (!odds) {
        // Conservative: if we can't fetch real juice, SKIP this pick from the
        // sim rather than use the stored -110 fallback (which we know is wrong).
        skipped.push({ id: reco.id, reason: 'MLB juice unavailable', gameName: reco.gameName })
        continue
      }
      fairJuice = pickedSideJuice(reco.line, odds.home, odds.away)
      corrected = true
    }

    const p = Math.max(0, Math.min(1, reco.probability / 100))
    const kf = kellyFraction(fairJuice, p)
    const juiceOK = Math.abs(fairJuice) <= MAX_JUICE_MAGNITUDE
    const wouldSurface = kf > 0 && juiceOK

    priced.push({
      id: reco.id,
      createdAt: reco.createdAt,
      sport: reco.sport,
      sportName: reco.sportName,
      gameName: reco.gameName,
      selection: reco.selection,
      confidenceTier: reco.confidenceTier as 'lock' | 'strong',
      betType: reco.betType,
      line: reco.line,
      status: reco.status as 'won' | 'lost' | 'push',
      storedOdds: reco.odds,
      fairJuice,
      juiceCorrected: corrected,
      probability: reco.probability,
      kellyFracFair: Number(kf.toFixed(4)),
      halfKellyFracFair: Number((kf / 2).toFixed(4)),
      wouldSurface,
    })
  }

  // Portfolio-level summary
  const decided = priced.filter((p) => p.status !== 'push')
  const wins = priced.filter((p) => p.status === 'won').length
  const losses = priced.filter((p) => p.status === 'lost').length
  const pushes = priced.filter((p) => p.status === 'push').length

  // Flat 1u across the whole board at fair juice
  const flatUnits = priced.reduce((s, r) => {
    if (r.status === 'won') return s + payoutRatio(r.fairJuice)
    if (r.status === 'lost') return s - 1
    return s
  }, 0)
  const flatROI = decided.length > 0 ? (flatUnits / decided.length) * 100 : 0

  // Bankroll sims
  const sims = [
    simulateBankroll(priced, { label: 'half-Kelly', starting: 100, fractionOfKelly: 0.5 }),
    simulateBankroll(priced, { label: 'quarter-Kelly', starting: 100, fractionOfKelly: 0.25 }),
    simulateBankroll(priced, { label: 'tenth-Kelly', starting: 100, fractionOfKelly: 0.1 }),
  ]

  // Break down by sport so the user can see where the action is
  const bySport: Record<string, { picks: number; wins: number; losses: number; pushes: number }> = {}
  for (const p of priced) {
    const key = p.sportName || p.sport
    if (!bySport[key]) bySport[key] = { picks: 0, wins: 0, losses: 0, pushes: 0 }
    bySport[key].picks++
    if (p.status === 'won') bySport[key].wins++
    else if (p.status === 'lost') bySport[key].losses++
    else if (p.status === 'push') bySport[key].pushes++
  }

  // Break down by bet type
  const byBetType: Record<string, { picks: number; wins: number; losses: number; pushes: number }> = {}
  for (const p of priced) {
    if (!byBetType[p.betType]) byBetType[p.betType] = { picks: 0, wins: 0, losses: 0, pushes: 0 }
    byBetType[p.betType].picks++
    if (p.status === 'won') byBetType[p.betType].wins++
    else if (p.status === 'lost') byBetType[p.betType].losses++
    else if (p.status === 'push') byBetType[p.betType].pushes++
  }

  // Days covered so we can compute picks-per-day for sanity
  const dayKeys = new Set(priced.map((p) => p.createdAt.slice(0, 10)))

  return NextResponse.json({
    success: true,
    windowDays: days,
    scope: 'best_bet + lock/strong, capped at 1L+2S per betting day (mirrors /performance)',
    summary: {
      rawRecosInWindow: filtered.length,
      afterDailyCaps: capped.length,
      pricedForSim: priced.length,
      skippedByPricing: skipped.length,
      daysCovered: dayKeys.size,
      picksPerDay: dayKeys.size > 0 ? Number((priced.length / dayKeys.size).toFixed(2)) : 0,
      wins,
      losses,
      pushes,
      winRate: decided.length > 0 ? Number(((wins / decided.length) * 100).toFixed(2)) : 0,
      flatUnits: Number(flatUnits.toFixed(3)),
      flatROI: Number(flatROI.toFixed(2)),
    },
    bySport,
    byBetType,
    bankrollSim: sims,
    skipped,
    // Per-pick detail is hefty; only include if explicitly requested.
    picks: request.nextUrl.searchParams.get('verbose') === '1' ? priced : undefined,
  })
}
