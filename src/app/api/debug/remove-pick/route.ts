import { NextResponse } from "next/server"
import { requireDebugAuth } from "@/lib/debug-auth"
import { getAllPicks } from "@/lib/pick-tracking"
import { getRecentRecommendations } from "@/lib/recommendation-tracking"

export const dynamic = "force-dynamic"

/**
 * Remove a specific pick from BOTH stored picks AND recommendations by team name substring.
 * Also recalculates the track record after removal.
 * 
 * POST /api/debug/remove-pick
 * Headers: Authorization: Bearer <CRON_SECRET>
 * Body: { "teamMatch": "Texas Tech" }
 */
export async function POST(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const teamMatch = body.teamMatch as string
    
    if (!teamMatch) {
      return NextResponse.json({ error: "teamMatch is required" }, { status: 400 })
    }

    const url = process.env.KV_REST_API_URL
    const token = process.env.KV_REST_API_TOKEN
    
    if (!url || !token) {
      return NextResponse.json({ error: "Redis not configured" }, { status: 500 })
    }

    const matchLower = teamMatch.toLowerCase()

    // ============================================
    // 1. Remove from betanalytics:picks
    // ============================================
    const allPicks = await getAllPicks()
    
    const picksRemoved = allPicks.filter(p => 
      (p.team || '').toLowerCase().includes(matchLower) ||
      (p.homeTeam || '').toLowerCase().includes(matchLower) ||
      (p.awayTeam || '').toLowerCase().includes(matchLower)
    )

    const picksRemaining = allPicks.filter(p => 
      !(p.team || '').toLowerCase().includes(matchLower) &&
      !(p.homeTeam || '').toLowerCase().includes(matchLower) &&
      !(p.awayTeam || '').toLowerCase().includes(matchLower)
    )

    if (picksRemoved.length > 0) {
      await fetch(`${url}/set/betanalytics:picks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(picksRemaining))
      })
    }

    // ============================================
    // 2. Remove from recommendations (reco:v1:*)
    // ============================================
    const allRecos = await getRecentRecommendations(500)
    
    const recosToRemove = allRecos.filter(r => {
      const selection = (r.selection || '').toLowerCase()
      const gameName = (r.gameName || '').toLowerCase()
      return selection.includes(matchLower) || gameName.includes(matchLower)
    })

    const recoDeleteResults: string[] = []
    for (const reco of recosToRemove) {
      // Remove the individual key
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['DEL', `reco:v1:${reco.id}`])
      })

      // Remove from the sorted set index
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['ZREM', 'reco:v1:index:createdAt', reco.id])
      })

      // Remove from pending set (if present)
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SREM', 'reco:v1:index:pending', reco.id])
      })

      recoDeleteResults.push(`${reco.id}: ${reco.selection} (${reco.status})`)
    }

    // ============================================
    // 3. Recalculate track record from remaining picks
    // ============================================
    const now = new Date()
    const periods = [
      { key: '7d', days: 7 },
      { key: '30d', days: 30 },
      { key: '90d', days: 90 },
      { key: 'all', days: null },
    ] as const

    const trackRecord: Record<string, unknown> = {}
    for (const period of periods) {
      const cutoff = period.days ? new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000) : null
      const relevant = picksRemaining.filter(p => {
        if (p.status === 'pending' || p.status === 'cancelled') return false
        if (cutoff && new Date(p.gradedAt || p.createdAt) < cutoff) return false
        return true
      })
      const wins = relevant.filter(p => p.status === 'won').length
      const losses = relevant.filter(p => p.status === 'lost').length
      const pushes = relevant.filter(p => p.status === 'push').length
      const total = wins + losses + pushes
      const units = relevant.reduce((sum, p) => sum + (p.unitsWon || 0), 0)
      const totalUnitsRisked = relevant.reduce((sum, p) => sum + p.units, 0)

      trackRecord[period.key] = {
        period: period.key,
        wins,
        losses,
        pushes,
        total,
        winRate: total > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
        units: Math.round(units * 100) / 100,
        roi: totalUnitsRisked > 0 ? Math.round((units / totalUnitsRisked) * 1000) / 10 : 0,
        lastUpdated: now.toISOString()
      }
    }

    await fetch(`${url}/set/betanalytics:track-record`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(trackRecord))
    })

    return NextResponse.json({
      success: true,
      message: `Removed ${picksRemoved.length} pick(s) and ${recosToRemove.length} recommendation(s) matching "${teamMatch}"`,
      picksRemoved: picksRemoved.map(p => ({ team: p.team, betType: p.betType, status: p.status })),
      recosRemoved: recoDeleteResults,
      picksRemainingCount: picksRemaining.length,
      updatedRecord: trackRecord,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
