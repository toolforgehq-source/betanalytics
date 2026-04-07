/**
 * Postgres-backed Key-Value Store
 *
 * Drop-in replacement for Upstash Redis REST API.
 * Uses Neon serverless Postgres (free tier) instead of per-command billing.
 *
 * Supports: GET/SET/DEL/EXISTS/EXPIRE (strings), SADD/SREM/SMEMBERS/SISMEMBER (sets),
 *           HSET/HGET/HGETALL (hashes), LPUSH/LRANGE (lists).
 *
 * Tables are auto-created on first use.
 * Requires DATABASE_URL environment variable pointing to a Neon Postgres database.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless'

let _sql: NeonQueryFunction<false, false> | null = null
let _initialized = false

function getSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (!_sql) {
    _sql = neon(url)
  }
  return _sql
}

/** Returns true if DATABASE_URL is configured */
export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL
}

async function ensureTables(): Promise<void> {
  if (_initialized) return
  const sql = getSql()
  if (!sql) return

  await sql`CREATE TABLE IF NOT EXISTS kv_strings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ
  )`

  await sql`CREATE TABLE IF NOT EXISTS kv_sets (
    key TEXT NOT NULL,
    member TEXT NOT NULL,
    PRIMARY KEY (key, member)
  )`

  await sql`CREATE TABLE IF NOT EXISTS kv_hashes (
    key TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (key, field)
  )`

  await sql`CREATE TABLE IF NOT EXISTS kv_lists (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL
  )`

  await sql`CREATE TABLE IF NOT EXISTS kv_sorted_sets (
    key TEXT NOT NULL,
    member TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (key, member)
  )`

  _initialized = true
}

// ============================================
// STRING OPERATIONS (GET/SET/DEL/EXISTS/EXPIRE)
// ============================================

export async function kvGet(key: string): Promise<string | null> {
  const sql = getSql()
  if (!sql) return null
  await ensureTables()

  const rows = await sql`
    SELECT value FROM kv_strings
    WHERE key = ${key}
    AND (expires_at IS NULL OR expires_at > NOW())
  `
  return (rows[0]?.value as string) ?? null
}

export async function kvSet(key: string, value: string, expiresInSeconds?: number): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  const expiresAt = expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : null

  await sql`
    INSERT INTO kv_strings (key, value, expires_at)
    VALUES (${key}, ${value}, ${expiresAt}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
  `
}

export async function kvDel(key: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`DELETE FROM kv_strings WHERE key = ${key}`
}

export async function kvExists(key: string): Promise<boolean> {
  const sql = getSql()
  if (!sql) return false
  await ensureTables()

  const rows = await sql`
    SELECT 1 FROM kv_strings
    WHERE key = ${key}
    AND (expires_at IS NULL OR expires_at > NOW())
  `
  return rows.length > 0
}

export async function kvExpire(key: string, seconds: number): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  const expiresAt = new Date(Date.now() + seconds * 1000).toISOString()
  await sql`UPDATE kv_strings SET expires_at = ${expiresAt}::timestamptz WHERE key = ${key}`
}

// ============================================
// SET OPERATIONS (SADD/SREM/SMEMBERS/SISMEMBER)
// ============================================

export async function kvSadd(key: string, ...members: string[]): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  for (const member of members) {
    await sql`
      INSERT INTO kv_sets (key, member) VALUES (${key}, ${member})
      ON CONFLICT (key, member) DO NOTHING
    `
  }
}

export async function kvSrem(key: string, ...members: string[]): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  for (const member of members) {
    await sql`DELETE FROM kv_sets WHERE key = ${key} AND member = ${member}`
  }
}

export async function kvSmembers(key: string): Promise<string[]> {
  const sql = getSql()
  if (!sql) return []
  await ensureTables()

  const rows = await sql`SELECT member FROM kv_sets WHERE key = ${key}`
  return rows.map(r => r.member as string)
}

export async function kvSismember(key: string, member: string): Promise<boolean> {
  const sql = getSql()
  if (!sql) return false
  await ensureTables()

  const rows = await sql`SELECT 1 FROM kv_sets WHERE key = ${key} AND member = ${member}`
  return rows.length > 0
}

export async function kvSdelAll(key: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`DELETE FROM kv_sets WHERE key = ${key}`
}

// ============================================
// HASH OPERATIONS (HSET/HGET/HGETALL)
// ============================================

export async function kvHset(key: string, field: string, value: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`
    INSERT INTO kv_hashes (key, field, value) VALUES (${key}, ${field}, ${value})
    ON CONFLICT (key, field) DO UPDATE SET value = EXCLUDED.value
  `
}

export async function kvHget(key: string, field: string): Promise<string | null> {
  const sql = getSql()
  if (!sql) return null
  await ensureTables()

  const rows = await sql`SELECT value FROM kv_hashes WHERE key = ${key} AND field = ${field}`
  return (rows[0]?.value as string) ?? null
}

export async function kvHgetall(key: string): Promise<Record<string, string> | null> {
  const sql = getSql()
  if (!sql) return null
  await ensureTables()

  const rows = await sql`SELECT field, value FROM kv_hashes WHERE key = ${key}`
  if (rows.length === 0) return null

  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.field as string] = row.value as string
  }
  return result
}

export async function kvHdelAll(key: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`DELETE FROM kv_hashes WHERE key = ${key}`
}

// ============================================
// LIST OPERATIONS (LPUSH/LRANGE)
// ============================================

export async function kvLpush(key: string, value: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`INSERT INTO kv_lists (key, value) VALUES (${key}, ${value})`
}

export async function kvLrange(key: string, start: number, stop: number): Promise<string[]> {
  const sql = getSql()
  if (!sql) return []
  await ensureTables()

  if (stop === -1) {
    const rows = await sql`
      SELECT value FROM kv_lists WHERE key = ${key}
      ORDER BY id DESC OFFSET ${start}
    `
    return rows.map(r => r.value as string)
  }

  const limit = stop - start + 1
  const rows = await sql`
    SELECT value FROM kv_lists WHERE key = ${key}
    ORDER BY id DESC OFFSET ${start} LIMIT ${limit}
  `
  return rows.map(r => r.value as string)
}

export async function kvLdelAll(key: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`DELETE FROM kv_lists WHERE key = ${key}`
}

// ============================================
// SORTED SET OPERATIONS (ZADD/ZRANGE/ZREVRANGE)
// ============================================

export async function kvZadd(key: string, score: number, member: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`
    INSERT INTO kv_sorted_sets (key, member, score) VALUES (${key}, ${member}, ${score})
    ON CONFLICT (key, member) DO UPDATE SET score = EXCLUDED.score
  `
}

export async function kvZrange(key: string, start: number, stop: number): Promise<string[]> {
  const sql = getSql()
  if (!sql) return []
  await ensureTables()

  if (stop === -1) {
    const rows = await sql`
      SELECT member FROM kv_sorted_sets WHERE key = ${key}
      ORDER BY score ASC OFFSET ${start}
    `
    return rows.map(r => r.member as string)
  }

  const limit = stop - start + 1
  const rows = await sql`
    SELECT member FROM kv_sorted_sets WHERE key = ${key}
    ORDER BY score ASC OFFSET ${start} LIMIT ${limit}
  `
  return rows.map(r => r.member as string)
}

export async function kvZrevrange(key: string, start: number, stop: number): Promise<string[]> {
  const sql = getSql()
  if (!sql) return []
  await ensureTables()

  if (stop === -1) {
    const rows = await sql`
      SELECT member FROM kv_sorted_sets WHERE key = ${key}
      ORDER BY score DESC OFFSET ${start}
    `
    return rows.map(r => r.member as string)
  }

  const limit = stop - start + 1
  const rows = await sql`
    SELECT member FROM kv_sorted_sets WHERE key = ${key}
    ORDER BY score DESC OFFSET ${start} LIMIT ${limit}
  `
  return rows.map(r => r.member as string)
}

export async function kvZdelAll(key: string): Promise<void> {
  const sql = getSql()
  if (!sql) return
  await ensureTables()

  await sql`DELETE FROM kv_sorted_sets WHERE key = ${key}`
}

// ============================================
// MULTI-KEY OPERATIONS (MGET)
// ============================================

export async function kvMget(...keys: string[]): Promise<(string | null)[]> {
  const sql = getSql()
  if (!sql) return keys.map(() => null)
  await ensureTables()

  const rows = await sql`
    SELECT key, value FROM kv_strings
    WHERE key = ANY(${keys})
    AND (expires_at IS NULL OR expires_at > NOW())
  `

  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(row.key as string, row.value as string)
  }
  return keys.map(k => map.get(k) ?? null)
}

// ============================================
// MULTI-KEY DELETE (for cleanup operations)
// ============================================

export async function kvDelPattern(pattern: string): Promise<number> {
  const sql = getSql()
  if (!sql) return 0
  await ensureTables()

  // Convert Redis glob pattern to SQL LIKE pattern
  const likePattern = pattern.replace(/\*/g, '%')

  const result = await sql`DELETE FROM kv_strings WHERE key LIKE ${likePattern}`
  return result.length
}
