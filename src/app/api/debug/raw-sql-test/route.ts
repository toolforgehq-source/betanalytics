/**
 * Raw SQL diagnostic — bypasses kvSet/kvGet/cachedRead entirely.
 * Uses neon() directly to isolate whether the issue is in our code or the database.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import { neon } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authError = requireDebugAuth(req)
  if (authError) return authError

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 })
  }

  const results: Record<string, unknown> = {}
  const sql = neon(dbUrl)

  // Test 1: Read current picks key directly with raw SQL
  try {
    const rows = await sql`
      SELECT key, LENGTH(value) as value_len, expires_at,
             LEFT(value, 200) as value_preview
      FROM kv_strings
      WHERE key = 'betanalytics:picks'
    `
    results.currentPicksRow = rows[0] ? {
      key: rows[0].key,
      valueLen: rows[0].value_len,
      expiresAt: rows[0].expires_at,
      preview: rows[0].value_preview
    } : 'NOT FOUND'
  } catch (e) {
    results.currentPicksRow = { error: String(e) }
  }

  // Test 2: Count push picks in the actual stored blob
  try {
    const rows = await sql`
      SELECT value FROM kv_strings
      WHERE key = 'betanalytics:picks'
      AND (expires_at IS NULL OR expires_at > NOW())
    `
    if (rows[0]?.value) {
      const picks = JSON.parse(rows[0].value as string)
      const pushCount = picks.filter((p: { status: string }) => p.status === 'push').length
      const wonCount = picks.filter((p: { status: string }) => p.status === 'won').length
      const lostCount = picks.filter((p: { status: string }) => p.status === 'lost').length
      const pendingCount = picks.filter((p: { status: string }) => p.status === 'pending').length
      const withLine = picks.filter((p: { line?: number }) => p.line !== undefined && p.line !== null).length
      results.picksAnalysis = {
        total: picks.length,
        push: pushCount,
        won: wonCount,
        lost: lostCount,
        pending: pendingCount,
        withLine: withLine,
        withoutLine: picks.length - withLine,
        sample: picks.slice(0, 3).map((p: { id: string; team: string; status: string; line?: number; betType: string }) => ({
          id: p.id, team: p.team, status: p.status, line: p.line, betType: p.betType
        }))
      }
    } else {
      results.picksAnalysis = 'No picks data found'
    }
  } catch (e) {
    results.picksAnalysis = { error: String(e) }
  }

  // Test 3: RAW WRITE TEST — write a marker to a test key, read it back with a FRESH connection
  try {
    const testKey = 'debug:raw-sql-test-' + Date.now()
    const testValue = JSON.stringify({ marker: 'RAW_SQL_TEST', ts: Date.now() })

    // Write with connection 1
    await sql`
      INSERT INTO kv_strings (key, value, expires_at)
      VALUES (${testKey}, ${testValue}, NULL)
    `

    // Read back with a COMPLETELY FRESH connection
    const sql2 = neon(dbUrl)
    const readRows = await sql2`
      SELECT value FROM kv_strings WHERE key = ${testKey}
    `

    results.rawWriteNewKey = {
      written: testValue,
      readBack: readRows[0]?.value,
      match: readRows[0]?.value === testValue,
      note: 'New key INSERT, read with fresh connection'
    }

    // Cleanup
    await sql`DELETE FROM kv_strings WHERE key = ${testKey}`
  } catch (e) {
    results.rawWriteNewKey = { error: String(e) }
  }

  // Test 4: RAW OVERWRITE TEST — write to existing key using ON CONFLICT, read with fresh connection
  try {
    const testKey = 'debug:raw-overwrite-test'

    // First, ensure the key exists
    await sql`
      INSERT INTO kv_strings (key, value, expires_at)
      VALUES (${testKey}, 'original_value', NULL)
      ON CONFLICT (key) DO UPDATE SET value = 'original_value'
    `

    // Verify original value
    const sql2 = neon(dbUrl)
    const beforeRows = await sql2`
      SELECT value FROM kv_strings WHERE key = ${testKey}
    `

    // Now OVERWRITE with ON CONFLICT DO UPDATE
    await sql`
      INSERT INTO kv_strings (key, value, expires_at)
      VALUES (${testKey}, 'updated_value_v2', NULL)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
    `

    // Read back with FRESH connection
    const sql3 = neon(dbUrl)
    const afterRows = await sql3`
      SELECT value FROM kv_strings WHERE key = ${testKey}
    `

    results.rawOverwriteUpsert = {
      before: beforeRows[0]?.value,
      after: afterRows[0]?.value,
      updatePersisted: afterRows[0]?.value === 'updated_value_v2',
      note: 'Existing key ON CONFLICT DO UPDATE, read with fresh connection'
    }

    // Cleanup
    await sql`DELETE FROM kv_strings WHERE key = ${testKey}`
  } catch (e) {
    results.rawOverwriteUpsert = { error: String(e) }
  }

  // Test 5: RAW DELETE+INSERT TEST — same as transaction approach but raw SQL
  try {
    const testKey = 'debug:raw-delete-insert-test'

    // Ensure key exists first
    await sql`
      INSERT INTO kv_strings (key, value, expires_at)
      VALUES (${testKey}, 'original_value', NULL)
      ON CONFLICT (key) DO UPDATE SET value = 'original_value'
    `

    // DELETE then INSERT (simulating our transaction approach)
    await sql`DELETE FROM kv_strings WHERE key = ${testKey}`
    await sql`
      INSERT INTO kv_strings (key, value, expires_at)
      VALUES (${testKey}, 'replaced_value_v3', NULL)
    `

    // Read back with fresh connection
    const sql4 = neon(dbUrl)
    const rows = await sql4`
      SELECT value FROM kv_strings WHERE key = ${testKey}
    `

    results.rawDeleteInsert = {
      readBack: rows[0]?.value,
      persisted: rows[0]?.value === 'replaced_value_v3',
      note: 'DELETE + INSERT (non-transactional), read with fresh connection'
    }

    // Cleanup
    await sql`DELETE FROM kv_strings WHERE key = ${testKey}`
  } catch (e) {
    results.rawDeleteInsert = { error: String(e) }
  }

  // Test 6: TRANSACTION TEST — use sql.transaction() to do DELETE+INSERT
  try {
    const testKey = 'debug:raw-transaction-test'

    // Ensure key exists first
    await sql`
      INSERT INTO kv_strings (key, value, expires_at)
      VALUES (${testKey}, 'original_value', NULL)
      ON CONFLICT (key) DO UPDATE SET value = 'original_value'
    `

    // Transaction DELETE+INSERT
    try {
      await sql.transaction([
        sql`DELETE FROM kv_strings WHERE key = ${testKey}`,
        sql`INSERT INTO kv_strings (key, value, expires_at)
            VALUES (${testKey}, 'transaction_value_v4', NULL)`
      ])
      results.rawTransaction = { transactionThrew: false }
    } catch (txErr) {
      results.rawTransaction = { transactionThrew: true, error: String(txErr) }
    }

    // Read back with fresh connection
    const sql5 = neon(dbUrl)
    const rows = await sql5`
      SELECT value FROM kv_strings WHERE key = ${testKey}
    `

    results.rawTransaction = {
      ...results.rawTransaction as Record<string, unknown>,
      readBack: rows[0]?.value,
      persisted: rows[0]?.value === 'transaction_value_v4',
      note: 'sql.transaction([DELETE, INSERT]), read with fresh connection'
    }

    // Cleanup
    await sql`DELETE FROM kv_strings WHERE key = ${testKey}`
  } catch (e) {
    results.rawTransaction = { error: String(e) }
  }

  // Test 7: THE REAL TEST — try to modify the ACTUAL picks blob
  try {
    // Read picks with fresh connection
    const sqlA = neon(dbUrl)
    const beforeRows = await sqlA`
      SELECT value FROM kv_strings
      WHERE key = 'betanalytics:picks'
      AND (expires_at IS NULL OR expires_at > NOW())
    `

    if (beforeRows[0]?.value) {
      const picks = JSON.parse(beforeRows[0].value as string)
      const pushesBefore = picks.filter((p: { status: string }) => p.status === 'push').length

      // Add a diagnostic marker to the first pick
      const originalFirstPickStatus = picks[0]?.status
      const marker = `diag_${Date.now()}`
      if (picks[0]) {
        picks[0].diagMarker = marker
      }
      const newValue = JSON.stringify(picks)

      // Write the modified blob using DELETE+INSERT (no transaction wrapper)
      const sqlB = neon(dbUrl)
      await sqlB`DELETE FROM kv_strings WHERE key = 'betanalytics:picks'`
      await sqlB`
        INSERT INTO kv_strings (key, value, expires_at)
        VALUES ('betanalytics:picks', ${newValue}, NULL)
      `

      // Read back with yet another fresh connection
      const sqlC = neon(dbUrl)
      const afterRows = await sqlC`
        SELECT value FROM kv_strings
        WHERE key = 'betanalytics:picks'
        AND (expires_at IS NULL OR expires_at > NOW())
      `

      if (afterRows[0]?.value) {
        const afterPicks = JSON.parse(afterRows[0].value as string)
        const markerFound = afterPicks[0]?.diagMarker === marker
        const pushesAfter = afterPicks.filter((p: { status: string }) => p.status === 'push').length

        results.realPicksWriteTest = {
          pushesBefore,
          pushesAfter,
          markerWritten: marker,
          markerFound,
          valueLenBefore: (beforeRows[0].value as string).length,
          valueLenAfter: (afterRows[0].value as string).length,
          firstPickStatus: originalFirstPickStatus,
          persisted: markerFound,
          note: 'Modified actual picks blob with raw DELETE+INSERT, read with fresh connection'
        }

        // IMPORTANT: Remove the diagnostic marker to not corrupt data
        if (markerFound && afterPicks[0]) {
          delete afterPicks[0].diagMarker
          const cleanValue = JSON.stringify(afterPicks)
          const sqlD = neon(dbUrl)
          await sqlD`DELETE FROM kv_strings WHERE key = 'betanalytics:picks'`
          await sqlD`
            INSERT INTO kv_strings (key, value, expires_at)
            VALUES ('betanalytics:picks', ${cleanValue}, NULL)
          `
        }
      } else {
        results.realPicksWriteTest = { error: 'Picks row disappeared after write!' }
      }
    } else {
      results.realPicksWriteTest = { error: 'No picks data to test' }
    }
  } catch (e) {
    results.realPicksWriteTest = { error: String(e) }
  }

  return NextResponse.json(results)
}
