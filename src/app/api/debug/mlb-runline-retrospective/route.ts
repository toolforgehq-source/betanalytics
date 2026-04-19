/**
 * MLB Runline Retrospective
 *
 * Re-prices every settled MLB spread pick in our history using the real
 * runline juice ESPN's core odds endpoint reports for that game, and
 * recomputes what the actual unit P/L would have been if the odds stored
 * at pick time had been correct instead of the silent -110/-110 fallback.
 *
 * This does NOT re-rank picks or change what was historically surfaced —
 * it only restates ROI under correct juice. That's deliberately scoped:
 * we don't have snapshots of the full candidate pool per day, so a true
 * counter-factual rerun isn't possible. What we CAN honestly answer is
 * "given the exact picks we shipped, what was the real-money result?"
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

function calculateUnitsWon(odds: number, units: number, result: 'won' | 'lost' | 'push'): number {
  if (result === 'push') return 0
  if (result === 'lost') return -units
  return odds > 0 ? units * (odds / 100) : units * (100 / Math.abs(odds))
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
  storedUnitsWon: number
  realUnitsWon: number
  unitsDelta: number
  oddsSource: 'current' | 'open' | 'close'
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
  // Push outcomes don't move units but we report them for completeness.
  const mlbSpreads = all.filter(
    (r) =>
      r.sport === 'baseball_mlb' &&
      r.betType === 'spread' &&
      (r.status === 'won' || r.status === 'lost' || r.status === 'push') &&
      new Date(r.createdAt).getTime() >= cutoffMs
  )

  const rows: RetrospectivePickRow[] = []
  const skipped: Array<{ id: string; reason: string; gameName: string }> = []

  // Fetch ESPN juice sequentially to stay polite (one request per unique game).
  // Cache by gameId so duplicate picks on the same game don't double-request.
  const juiceCache = new Map<string, { home: number; away: number; source: 'current' | 'open' | 'close' } | null>()
  for (const reco of mlbSpreads) {
    if (typeof reco.line !== 'number') {
      skipped.push({ id: reco.id, reason: 'missing line', gameName: reco.gameName })
      continue
    }

    let odds = juiceCache.get(reco.gameId)
    if (odds === undefined) {
      // Retrospective: prefer close price (most representative of what was
      // actually bookable at game start) with current/open as fallbacks.
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
      storedUnitsWon,
      realUnitsWon,
      unitsDelta: realUnitsWon - storedUnitsWon,
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

  // Break out by which side of the runline was picked — that's where the bias
  // actually lives. +1.5 dog covers were the most overstated; -1.5 favorite
  // covers were the most understated.
  const splitBySide = (filter: (r: RetrospectivePickRow) => boolean) => {
    const subset = rows.filter(filter)
    const subDecided = subset.filter((r) => r.status !== 'push')
    const subWins = subset.filter((r) => r.status === 'won').length
    const subLosses = subset.filter((r) => r.status === 'lost').length
    const subStored = subset.reduce((s, r) => s + r.storedUnitsWon, 0)
    const subReal = subset.reduce((s, r) => s + r.realUnitsWon, 0)
    return {
      picks: subset.length,
      wins: subWins,
      losses: subLosses,
      winRate: subDecided.length > 0 ? (subWins / subDecided.length) * 100 : 0,
      storedUnits: subStored,
      realUnits: subReal,
      storedROI: subDecided.length > 0 ? (subStored / subDecided.length) * 100 : 0,
      realROI: subDecided.length > 0 ? (subReal / subDecided.length) * 100 : 0,
      deltaUnits: subReal - subStored,
    }
  }

  return NextResponse.json({
    success: true,
    windowDays: days,
    summary: {
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
    bySide: {
      favoriteRunline: splitBySide((r) => (r.line ?? 0) < 0),
      underdogRunline: splitBySide((r) => (r.line ?? 0) > 0),
    },
    skipped,
    picks: rows,
  })
}
