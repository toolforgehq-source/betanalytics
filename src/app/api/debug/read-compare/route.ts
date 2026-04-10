/**
 * Diagnostic: Compare kvGet reads vs raw SQL reads for the same key.
 * This isolates whether the read staleness is in kvGet, cachedRead, or the DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import { neon } from '@neondatabase/serverless'
import { kvGet } from '@/lib/pg-kv'
import { getAllPicks } from '@/lib/pick-tracking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authError = requireDebugAuth(req)
  if (authError) return authError

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 })
  }

  const results: Record<string, unknown> = {}

  // Layer 1: Raw SQL with fresh neon() — ground truth
  try {
    const freshSql = neon(dbUrl)
    const rows = await freshSql`
      SELECT value FROM kv_strings
      WHERE key = 'betanalytics:picks'
      AND (expires_at IS NULL OR expires_at > NOW())
    `
    if (rows[0]?.value) {
      const picks = JSON.parse(rows[0].value as string)
      const pushes = picks.filter((p: { status: string }) => p.status === 'push')
      results.rawSql = {
        total: picks.length,
        pushCount: pushes.length,
        pushIds: pushes.map((p: { id: string; team: string; line?: number }) => ({
          id: p.id, team: p.team, line: p.line
        })),
        firstPickStatus: picks[0]?.status,
        firstPickLine: picks[0]?.line,
      }
    } else {
      results.rawSql = 'No data found'
    }
  } catch (e) {
    results.rawSql = { error: String(e) }
  }

  // Layer 2: Raw SQL with parameterized query (like kvGet uses)
  try {
    const freshSql = neon(dbUrl)
    const key = 'betanalytics:picks'
    const rows = await freshSql`
      SELECT value FROM kv_strings
      WHERE key = ${key}
      AND (expires_at IS NULL OR expires_at > NOW())
    `
    if (rows[0]?.value) {
      const picks = JSON.parse(rows[0].value as string)
      const pushes = picks.filter((p: { status: string }) => p.status === 'push')
      results.rawSqlParameterized = {
        total: picks.length,
        pushCount: pushes.length,
        firstPickStatus: picks[0]?.status,
        firstPickLine: picks[0]?.line,
        note: 'Same query as kvGet but bypassing getSql()'
      }
    } else {
      results.rawSqlParameterized = 'No data found'
    }
  } catch (e) {
    results.rawSqlParameterized = { error: String(e) }
  }

  // Layer 3: kvGet directly (bypasses cachedRead but uses getSql)
  try {
    const value = await kvGet('betanalytics:picks')
    if (value) {
      const picks = JSON.parse(value)
      const pushes = picks.filter((p: { status: string }) => p.status === 'push')
      results.kvGet = {
        total: picks.length,
        pushCount: pushes.length,
        pushIds: pushes.map((p: { id: string; team: string; line?: number }) => ({
          id: p.id, team: p.team, line: p.line
        })),
        firstPickStatus: picks[0]?.status,
        firstPickLine: picks[0]?.line,
        note: 'Uses getSql() fresh neon() connection'
      }
    } else {
      results.kvGet = 'No data found'
    }
  } catch (e) {
    results.kvGet = { error: String(e) }
  }

  // Layer 4: getAllPicks (uses cachedRead + kvGet)
  try {
    const picks = await getAllPicks()
    const pushes = picks.filter(p => p.status === 'push')
    results.getAllPicks = {
      total: picks.length,
      pushCount: pushes.length,
      pushIds: pushes.map(p => ({
        id: p.id, team: p.team, line: p.line
      })),
      firstPickStatus: picks[0]?.status,
      firstPickLine: picks[0]?.line,
      note: 'Uses cachedRead + kvGet (full application path)'
    }
  } catch (e) {
    results.getAllPicks = { error: String(e) }
  }

  return NextResponse.json(results)
}
