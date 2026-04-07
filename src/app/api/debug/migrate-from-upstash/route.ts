/**
 * One-time migration endpoint: copies all data from Upstash Redis to Neon Postgres.
 *
 * Reads from Upstash using the legacy KV_REST_API_URL / KV_REST_API_TOKEN env vars
 * and writes into Postgres via the pg-kv module (DATABASE_URL).
 *
 * Safe to run multiple times — pg-kv uses INSERT ... ON CONFLICT DO UPDATE (upsert).
 *
 * DELETE THIS ENDPOINT after migration is confirmed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import {
  kvSet,
  kvSadd,
  kvZadd,
  isDbConfigured,
} from '@/lib/pg-kv'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // migration may take a while

// ---------------------------------------------------------------------------
// Upstash REST helpers (read-only)
// ---------------------------------------------------------------------------

function getUpstashCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  return { url, token }
}

async function upstashCommand(creds: { url: string; token: string }, args: unknown[]): Promise<unknown> {
  const res = await fetch(creds.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Upstash HTTP ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(`Upstash error: ${data.error}`)
  return data.result
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

/** Migrate a simple string key (GET → kvSet) */
async function migrateStringKey(
  creds: { url: string; token: string },
  key: string,
  log: string[],
): Promise<boolean> {
  const value = await upstashCommand(creds, ['GET', key])
  if (value === null || value === undefined) {
    log.push(`  SKIP ${key} (not found in Upstash)`)
    return false
  }
  const strValue = typeof value === 'string' ? value : JSON.stringify(value)
  await kvSet(key, strValue)
  log.push(`  OK   ${key} (${strValue.length} chars)`)
  return true
}

/** Migrate a sorted set (ZRANGE WITH SCORES → kvZadd) */
async function migrateSortedSet(
  creds: { url: string; token: string },
  key: string,
  log: string[],
): Promise<number> {
  // ZRANGE key 0 -1 WITHSCORES returns [member, score, member, score, ...]
  const raw = await upstashCommand(creds, ['ZRANGE', key, 0, -1, 'WITHSCORES'])
  if (!Array.isArray(raw) || raw.length === 0) {
    log.push(`  SKIP ${key} (empty or not found)`)
    return 0
  }
  let count = 0
  for (let i = 0; i < raw.length; i += 2) {
    const member = String(raw[i])
    const score = parseFloat(raw[i + 1])
    await kvZadd(key, score, member)
    count++
  }
  log.push(`  OK   ${key} (${count} members)`)
  return count
}

/** Migrate a set (SMEMBERS → kvSadd) */
async function migrateSet(
  creds: { url: string; token: string },
  key: string,
  log: string[],
): Promise<number> {
  const raw = await upstashCommand(creds, ['SMEMBERS', key])
  if (!Array.isArray(raw) || raw.length === 0) {
    log.push(`  SKIP ${key} (empty or not found)`)
    return 0
  }
  for (const member of raw) {
    await kvSadd(key, String(member))
  }
  log.push(`  OK   ${key} (${raw.length} members)`)
  return raw.length
}

/** Discover all reco:v1:* string keys by reading the sorted-set index */
async function migrateRecommendationRecords(
  creds: { url: string; token: string },
  log: string[],
): Promise<number> {
  // Get all IDs from the time index
  const ids = await upstashCommand(creds, ['ZRANGE', 'reco:v1:index:createdAt', 0, -1])
  if (!Array.isArray(ids) || ids.length === 0) {
    log.push('  SKIP reco:v1:* records (no IDs in index)')
    return 0
  }

  let migrated = 0
  // Batch fetch with MGET
  const keys = ids.map((id: string) => `reco:v1:${id}`)
  const batchSize = 50
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize)
    const values = await upstashCommand(creds, ['MGET', ...batch]) as (string | null)[]
    if (!Array.isArray(values)) continue

    for (let j = 0; j < batch.length; j++) {
      const val = values[j]
      if (val === null || val === undefined) continue
      const strVal = typeof val === 'string' ? val : JSON.stringify(val)
      await kvSet(batch[j], strVal)
      migrated++
    }
  }
  log.push(`  OK   reco:v1:* records (${migrated} of ${ids.length} IDs)`)
  return migrated
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const authError = requireDebugAuth(req)
  if (authError) return authError

  // Pre-flight checks
  const upstash = getUpstashCredentials()
  if (!upstash) {
    return NextResponse.json(
      { error: 'Upstash credentials missing (KV_REST_API_URL / KV_REST_API_TOKEN)' },
      { status: 500 },
    )
  }
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: 'Postgres not configured (DATABASE_URL missing)' },
      { status: 500 },
    )
  }

  const log: string[] = []
  const summary: Record<string, unknown> = {}
  let totalKeys = 0

  try {
    // ---- 1. String keys (caches, picks, track record, etc.) ----
    log.push('--- String keys ---')
    const stringKeys = [
      'betanalytics:picks',
      'betanalytics:track-record',
      'betanalytics:best-bet',
      'betanalytics:parlay',
      'betanalytics:sport-bets',
      'betanalytics:best-prop',
      'betanalytics:model-first-props',
      'betanalytics:odds:data',
      'betanalytics:props:data',
      'betanalytics:prop_line_snapshots',
      'betanalytics:line_movement:snapshots',
      'betanalytics:line_movement:opening',
      'betanalytics:cached_espn_odds',
    ]
    let stringCount = 0
    for (const key of stringKeys) {
      const ok = await migrateStringKey(upstash, key, log)
      if (ok) stringCount++
    }
    summary.stringKeys = { attempted: stringKeys.length, migrated: stringCount }
    totalKeys += stringCount

    // ---- 2. Recommendation tracking sorted set (time index) ----
    log.push('--- Sorted sets ---')
    const sortedSetCount = await migrateSortedSet(upstash, 'reco:v1:index:createdAt', log)
    summary.sortedSets = { 'reco:v1:index:createdAt': sortedSetCount }
    if (sortedSetCount > 0) totalKeys++

    // ---- 3. Recommendation tracking regular set (pending) ----
    log.push('--- Sets ---')
    const setCount = await migrateSet(upstash, 'reco:v1:index:pending', log)
    summary.sets = { 'reco:v1:index:pending': setCount }
    if (setCount > 0) totalKeys++

    // ---- 4. Individual recommendation records (reco:v1:<id>) ----
    log.push('--- Recommendation records ---')
    const recoCount = await migrateRecommendationRecords(upstash, log)
    summary.recommendationRecords = recoCount
    totalKeys += recoCount

    // ---- 5. Try to discover pinned-picks keys (today & recent days) ----
    log.push('--- Pinned picks (recent days) ---')
    let pinnedCount = 0
    const now = new Date()
    for (let d = 0; d < 7; d++) {
      const date = new Date(now)
      date.setDate(date.getDate() - d)
      const dateKey = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' }).replace(/\//g, '-')
      const pinnedKey = `betanalytics:pinned-picks-v2:${dateKey}`
      const ok = await migrateStringKey(upstash, pinnedKey, log)
      if (ok) pinnedCount++
    }
    summary.pinnedPicks = pinnedCount
    totalKeys += pinnedCount

    // ---- 6. Elo data (hash keys for each league) ----
    log.push('--- Elo hashes ---')
    const eloLeagues = ['NBA', 'NFL', 'NHL', 'MLB', 'NCAAB', 'NCAAF',
      'soccer_epl', 'soccer_spain_la_liga', 'soccer_germany_bundesliga',
      'soccer_italy_serie_a', 'soccer_france_ligue_one', 'soccer_usa_mls',
      'soccer_uefa_champs_league']
    let eloCount = 0
    for (const league of eloLeagues) {
      const key = `elo:ratings:${league}`
      // HGETALL returns {field: value, field: value, ...}
      const raw = await upstashCommand(upstash, ['HGETALL', key])
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        // Upstash REST may return flat array [field, value, field, value, ...]
        if (Array.isArray(raw) && raw.length > 0) {
          const { kvHset } = await import('@/lib/pg-kv')
          for (let i = 0; i < raw.length; i += 2) {
            await kvHset(key, String(raw[i]), String(raw[i + 1]))
          }
          const fields = raw.length / 2
          log.push(`  OK   ${key} (${fields} fields, flat array)`)
          eloCount++
        } else {
          log.push(`  SKIP ${key} (not found)`)
        }
        continue
      }
      // Object form
      const { kvHset } = await import('@/lib/pg-kv')
      const entries = Object.entries(raw as Record<string, string>)
      if (entries.length === 0) {
        log.push(`  SKIP ${key} (empty)`)
        continue
      }
      for (const [field, value] of entries) {
        await kvHset(key, field, String(value))
      }
      log.push(`  OK   ${key} (${entries.length} fields)`)
      eloCount++
    }
    summary.eloHashes = eloCount
    totalKeys += eloCount

    summary.totalKeysMigrated = totalKeys
    summary.status = 'success'
  } catch (error) {
    summary.status = 'error'
    summary.error = error instanceof Error ? error.message : String(error)
  }

  return NextResponse.json({ summary, log })
}
