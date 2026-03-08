import { NextResponse } from "next/server"
import { requireDebugAuth } from "@/lib/debug-auth"
import { getAllPicks } from "@/lib/pick-tracking"

export const dynamic = "force-dynamic"

/**
 * Remove a specific pick from the stored picks by team name substring.
 * Also recalculates the track record after removal.
 * 
 * POST /api/debug/remove-pick?secret=CRON_SECRET
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

    // Get all picks
    const allPicks = await getAllPicks()
    
    // Find picks matching the team
    const toRemove = allPicks.filter(p => 
      (p.team || '').toLowerCase().includes(teamMatch.toLowerCase()) ||
      (p.homeTeam || '').toLowerCase().includes(teamMatch.toLowerCase()) ||
      (p.awayTeam || '').toLowerCase().includes(teamMatch.toLowerCase())
    )
    
    if (toRemove.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: `No picks found matching "${teamMatch}"`,
        totalPicks: allPicks.length
      })
    }

    // Filter out the matching picks
    const remaining = allPicks.filter(p => 
      !(p.team || '').toLowerCase().includes(teamMatch.toLowerCase()) &&
      !(p.homeTeam || '').toLowerCase().includes(teamMatch.toLowerCase()) &&
      !(p.awayTeam || '').toLowerCase().includes(teamMatch.toLowerCase())
    )

    // Store remaining picks back to Redis
    const url = process.env.KV_REST_API_URL
    const token = process.env.KV_REST_API_TOKEN
    
    if (!url || !token) {
      return NextResponse.json({ error: "Redis not configured" }, { status: 500 })
    }

    await fetch(`${url}/set/betanalytics:picks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(remaining))
    })

    // Recalculate track record
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
      const relevant = remaining.filter(p => {
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
      message: `Removed ${toRemove.length} pick(s) matching "${teamMatch}"`,
      removed: toRemove.map(p => ({ team: p.team, betType: p.betType, line: p.line, status: p.status })),
      remainingCount: remaining.length,
      updatedRecord: trackRecord,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
