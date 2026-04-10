/**
 * Debug endpoint to re-grade picks incorrectly marked as "push" due to missing line data.
 * 
 * GET /api/debug/regrade-pushes
 * 
 * This version bypasses kvGet/kvSet entirely and uses neon() directly to read/write
 * the picks blob. This isolates whether the persistence issue is in the KV abstraction
 * layer or at the database level.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import { neon } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function gradeSpreadPick(pick: { team: string; homeTeam: string; line?: number }, homeScore: number, awayScore: number): 'won' | 'lost' | 'push' {
  if (pick.line === undefined || pick.line === null) return 'push'
  const isHome = pick.team === pick.homeTeam
  const margin = isHome ? homeScore - awayScore : awayScore - homeScore
  const adjusted = margin + pick.line
  if (adjusted > 0) return 'won'
  if (adjusted < 0) return 'lost'
  return 'push'
}

function gradeTotalPick(pick: { team: string; line?: number }, homeScore: number, awayScore: number): 'won' | 'lost' | 'push' {
  if (pick.line === undefined || pick.line === null) return 'push'
  const total = homeScore + awayScore
  const isOver = pick.team.toLowerCase().includes('over')
  if (isOver) {
    if (total > pick.line) return 'won'
    if (total < pick.line) return 'lost'
    return 'push'
  } else {
    if (total < pick.line) return 'won'
    if (total > pick.line) return 'lost'
    return 'push'
  }
}

function calculateUnitsWon(odds: number, units: number, result: 'won' | 'lost' | 'push'): number {
  if (result === 'push') return 0
  if (result === 'lost') return -units
  if (odds > 0) return units * (odds / 100)
  return units * (100 / Math.abs(odds))
}

interface ESPNGameResult {
  completed: boolean
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
}

function getESPNSportLeague(sport: string): { sport: string; league: string } | null {
  const map: Record<string, { sport: string; league: string }> = {
    'baseball_mlb': { sport: 'baseball', league: 'mlb' },
    'basketball_nba': { sport: 'basketball', league: 'nba' },
    'icehockey_nhl': { sport: 'hockey', league: 'nhl' },
    'americanfootball_nfl': { sport: 'football', league: 'nfl' },
    'americanfootball_ncaaf': { sport: 'football', league: 'college-football' },
    'basketball_ncaab': { sport: 'basketball', league: 'mens-college-basketball' },
  }
  return map[sport] || null
}

async function fetchESPNResult(sport: string, gameId: string): Promise<ESPNGameResult | null> {
  const mapping = getESPNSportLeague(sport)
  if (!mapping) return null
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.sport}/${mapping.league}/scoreboard/${gameId}`
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) return null
    const data = await resp.json()
    const comp = data?.competitions?.[0]
    if (!comp) return null
    const homeComp = comp.competitors?.find((c: { homeAway: string }) => c.homeAway === 'home')
    const awayComp = comp.competitors?.find((c: { homeAway: string }) => c.homeAway === 'away')
    if (!homeComp || !awayComp) return null
    const completed = comp.status?.type?.completed === true
    return {
      completed,
      homeTeam: homeComp.team?.displayName || homeComp.team?.name || '',
      awayTeam: awayComp.team?.displayName || awayComp.team?.name || '',
      homeScore: parseInt(homeComp.score || '0', 10),
      awayScore: parseInt(awayComp.score || '0', 10),
    }
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pick = any

export async function GET(request: NextRequest) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 })
  }

  const diagnostics: Record<string, unknown> = {}

  try {
    // STEP 1: Read picks directly with neon() — no kvGet, no getSql, no abstractions
    const readSql = neon(dbUrl)
    const readRows = await readSql`
      SELECT value FROM kv_strings
      WHERE key = 'betanalytics:picks'
      AND (expires_at IS NULL OR expires_at > NOW())
    `

    if (!readRows[0]?.value) {
      return NextResponse.json({ success: true, repaired: 0, details: ['No picks data found in database'] })
    }

    const picks: Pick[] = JSON.parse(readRows[0].value as string)
    diagnostics.totalPicks = picks.length
    diagnostics.pushCountBefore = picks.filter((p: Pick) => p.status === 'push').length

    // STEP 2: Find incorrect pushes
    const incorrectPushes = picks.filter((p: Pick) =>
      p.status === 'push' &&
      (p.betType === 'spread' || p.betType === 'total') &&
      (p.line === undefined || p.line === null) &&
      p.actualResult?.includes('line: undefined')
    )

    if (incorrectPushes.length === 0) {
      return NextResponse.json({
        success: true,
        repaired: 0,
        details: ['No incorrectly pushed picks found'],
        diagnostics
      })
    }

    diagnostics.incorrectPushesFound = incorrectPushes.length

    // STEP 3: Recover lines from recommendations
    const recoSql = neon(dbUrl)
    const recoRows = await recoSql`
      SELECT value FROM kv_strings
      WHERE key = 'betanalytics:recommendations'
      AND (expires_at IS NULL OR expires_at > NOW())
    `

    const recoMap = new Map<string, { line?: number }>()
    if (recoRows[0]?.value) {
      const recos = JSON.parse(recoRows[0].value as string)
      for (const r of recos) {
        if (r.line !== undefined && r.line !== null) {
          const teamFromSelection = r.selection.replace(/\s*[+-]?\d+\.?\d*\s*$/, '').trim()
          recoMap.set(`${r.gameId}:${teamFromSelection}:${r.betType}`, { line: r.line })
          recoMap.set(`${r.gameId}:${r.betType}`, { line: r.line })
        }
      }
    }

    // STEP 4: Re-grade each incorrect push
    const details: string[] = [`Found ${incorrectPushes.length} picks incorrectly graded as push due to missing line`]
    let repaired = 0
    let lineRecovered = 0
    let errors = 0
    const gameResultCache = new Map<string, ESPNGameResult | null>()

    for (const pick of incorrectPushes) {
      const exactMatch = recoMap.get(`${pick.gameId}:${pick.team}:${pick.betType}`)
      const broadMatch = recoMap.get(`${pick.gameId}:${pick.betType}`)
      const recoveredLine = exactMatch?.line ?? broadMatch?.line

      if (recoveredLine === undefined || recoveredLine === null) {
        details.push(`Could not recover line for ${pick.team} (${pick.gameId})`)
        continue
      }

      const pickIndex = picks.findIndex((p: Pick) => p.id === pick.id)
      if (pickIndex === -1) continue

      let gameResult = gameResultCache.get(pick.gameId)
      if (gameResult === undefined) {
        gameResult = await fetchESPNResult(pick.sport, pick.gameId)
        gameResultCache.set(pick.gameId, gameResult)
      }

      if (!gameResult || !gameResult.completed) {
        details.push(`No ESPN result for ${pick.team} (${pick.gameId})`)
        continue
      }

      picks[pickIndex].line = recoveredLine
      lineRecovered++

      let gradeResult: 'won' | 'lost' | 'push'
      let actualResult: string
      const scoreDisplay = `${gameResult.awayTeam} ${gameResult.awayScore} - ${gameResult.homeTeam} ${gameResult.homeScore}`

      if (pick.betType === 'spread') {
        gradeResult = gradeSpreadPick(picks[pickIndex], gameResult.homeScore, gameResult.awayScore)
        const margin = gameResult.homeScore - gameResult.awayScore
        actualResult = `${scoreDisplay} (margin: ${margin > 0 ? '+' : ''}${margin}, line: ${recoveredLine})`
      } else {
        gradeResult = gradeTotalPick(picks[pickIndex], gameResult.homeScore, gameResult.awayScore)
        const total = gameResult.homeScore + gameResult.awayScore
        actualResult = `${scoreDisplay} (total: ${total}, line: ${recoveredLine})`
      }

      picks[pickIndex].status = gradeResult
      picks[pickIndex].gradedAt = new Date().toISOString()
      picks[pickIndex].actualResult = actualResult
      picks[pickIndex].unitsWon = calculateUnitsWon(picks[pickIndex].odds, picks[pickIndex].units, gradeResult)

      repaired++
      details.push(`Re-graded ${pick.team}: push → ${gradeResult.toUpperCase()} (line: ${recoveredLine}, ${actualResult})`)
    }

    // STEP 5: Write the corrected picks back using neon() directly
    if (repaired > 0) {
      const newValue = JSON.stringify(picks)
      diagnostics.writeValueLength = newValue.length

      try {
        const writeSql = neon(dbUrl)
        await writeSql.transaction([
          writeSql`DELETE FROM kv_strings WHERE key = 'betanalytics:picks'`,
          writeSql`INSERT INTO kv_strings (key, value, expires_at)
                   VALUES ('betanalytics:picks', ${newValue}, NULL)`
        ])
        diagnostics.writeMethod = 'transaction'
        diagnostics.writeError = null
      } catch (txErr) {
        diagnostics.writeMethod = 'transaction_failed'
        diagnostics.writeError = String(txErr)
        
        // Fallback: try non-transactional delete+insert with separate connections
        try {
          const delSql = neon(dbUrl)
          await delSql`DELETE FROM kv_strings WHERE key = 'betanalytics:picks'`
          const insSql = neon(dbUrl)
          await insSql`INSERT INTO kv_strings (key, value, expires_at)
                       VALUES ('betanalytics:picks', ${newValue}, NULL)`
          diagnostics.fallbackWrite = 'success'
        } catch (fbErr) {
          diagnostics.fallbackWrite = String(fbErr)
          errors++
          details.push('Failed to save re-graded picks to database')
        }
      }

      // STEP 6: Verify the write by reading back with yet another fresh neon()
      try {
        const verifySql = neon(dbUrl)
        const verifyRows = await verifySql`
          SELECT value FROM kv_strings
          WHERE key = 'betanalytics:picks'
          AND (expires_at IS NULL OR expires_at > NOW())
        `
        if (verifyRows[0]?.value) {
          const verifyPicks = JSON.parse(verifyRows[0].value as string)
          const pushCountAfter = verifyPicks.filter((p: Pick) => p.status === 'push').length
          diagnostics.pushCountAfterWrite = pushCountAfter
          diagnostics.writeVerified = pushCountAfter < (diagnostics.pushCountBefore as number)
          diagnostics.verifyValueLength = (verifyRows[0].value as string).length
        } else {
          diagnostics.writeVerified = false
          diagnostics.verifyError = 'No data found after write'
        }
      } catch (vErr) {
        diagnostics.writeVerified = false
        diagnostics.verifyError = String(vErr)
      }

      // STEP 7: Also update track record directly
      try {
        const gradedPicks = picks.filter((p: Pick) => 
          p.status === 'won' || p.status === 'lost' || p.status === 'push'
        )
        const wins = gradedPicks.filter((p: Pick) => p.status === 'won').length
        const losses = gradedPicks.filter((p: Pick) => p.status === 'lost').length
        const pushes = gradedPicks.filter((p: Pick) => p.status === 'push').length
        const total = wins + losses + pushes
        const units = gradedPicks.reduce((sum: number, p: Pick) => sum + (p.unitsWon || 0), 0)
        const totalUnitsRisked = gradedPicks.reduce((sum: number, p: Pick) => sum + p.units, 0)
        
        const trackRecord = {
          '7d': { period: '7d', wins, losses, pushes, total, winRate: total > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0, units: Math.round(units * 100) / 100, roi: totalUnitsRisked > 0 ? Math.round((units / totalUnitsRisked) * 1000) / 10 : 0, lastUpdated: new Date().toISOString() },
          '30d': { period: '30d', wins, losses, pushes, total, winRate: total > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0, units: Math.round(units * 100) / 100, roi: totalUnitsRisked > 0 ? Math.round((units / totalUnitsRisked) * 1000) / 10 : 0, lastUpdated: new Date().toISOString() },
          '90d': { period: '90d', wins, losses, pushes, total, winRate: total > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0, units: Math.round(units * 100) / 100, roi: totalUnitsRisked > 0 ? Math.round((units / totalUnitsRisked) * 1000) / 10 : 0, lastUpdated: new Date().toISOString() },
          'all': { period: 'all', wins, losses, pushes, total, winRate: total > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0, units: Math.round(units * 100) / 100, roi: totalUnitsRisked > 0 ? Math.round((units / totalUnitsRisked) * 1000) / 10 : 0, lastUpdated: new Date().toISOString() },
        }
        
        const trValue = JSON.stringify(trackRecord)
        const trSql = neon(dbUrl)
        await trSql.transaction([
          trSql`DELETE FROM kv_strings WHERE key = 'betanalytics:track-record'`,
          trSql`INSERT INTO kv_strings (key, value, expires_at)
                VALUES ('betanalytics:track-record', ${trValue}, NULL)`
        ])
        details.push(`Saved ${repaired} re-graded picks and updated track record (${wins}W-${losses}L)`)
      } catch (trErr) {
        details.push(`Picks saved but track record update failed: ${trErr}`)
      }
    }

    return NextResponse.json({
      success: true,
      repaired,
      lineRecovered,
      errors,
      details,
      diagnostics
    })
  } catch (error) {
    console.error('[regrade-pushes] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics
    }, { status: 500 })
  }
}
