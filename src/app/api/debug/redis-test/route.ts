/**
 * Debug endpoint to test database write/read roundtrip
 * Tests whether updates actually persist to Neon Postgres (via pg-kv)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import { getRecommendation, updateRecommendation, getRecentRecommendations } from '@/lib/recommendation-tracking'
import { kvGet, kvSet, kvDel, isDbConfigured } from '@/lib/pg-kv'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authError = requireDebugAuth(req)
  if (authError) return authError

  if (!isDbConfigured()) {
    return NextResponse.json({ error: 'Database not configured (DATABASE_URL missing)' }, { status: 500 })
  }

  const results: Record<string, unknown> = {}

  // Test 1: Basic write/read roundtrip
  try {
    const testKey = 'debug:write-test'
    const testValue = JSON.stringify({ test: true, timestamp: new Date().toISOString() })

    await kvSet(testKey, testValue)
    const readResult = await kvGet(testKey)

    results.basicWriteTest = {
      written: testValue,
      readBack: readResult,
      match: readResult === testValue
    }

    // Clean up
    await kvDel(testKey)
  } catch (error) {
    results.basicWriteTest = { error: String(error) }
  }

  // Test 2: Try to read a specific recommendation and show its current status
  try {
    const recentRecos = await getRecentRecommendations(5)
    results.sampleRecommendations = recentRecos.map(r => ({
      id: r.id,
      status: r.status,
      selection: r.selection,
      settledAt: r.settledAt || null,
      actualResult: r.actualResult || null
    }))
  } catch (error) {
    results.sampleRecommendations = { error: String(error) }
  }

  // Test 3: Try to update first pending recommendation with a test field and read back
  try {
    const recentRecos = await getRecentRecommendations(20)
    const firstPending = recentRecos.find(r => r.status === 'pending')
    
    if (firstPending) {
      // Read the raw data first
      const rawBefore = await kvGet(`reco:v1:${firstPending.id}`)

      // Try to update it
      const updateSuccess = await updateRecommendation(firstPending.id, {
        status: 'won',
        settledAt: new Date().toISOString(),
        actualResult: 'Debug test settlement',
        profit: 1.0
      })

      // Read back the raw data
      const rawAfter = await kvGet(`reco:v1:${firstPending.id}`)

      // Also read via getRecommendation
      const readBack = await getRecommendation(firstPending.id)

      // Revert the test update back to pending
      await updateRecommendation(firstPending.id, {
        status: 'pending',
        settledAt: undefined,
        actualResult: undefined,
        profit: undefined
      })

      results.updateTest = {
        recoId: firstPending.id,
        updateSuccess,
        rawDataBefore: typeof rawBefore === 'string' ? rawBefore.substring(0, 200) : rawBefore,
        rawDataAfter: typeof rawAfter === 'string' ? rawAfter.substring(0, 200) : rawAfter,
        readBackStatus: readBack?.status,
        readBackSettledAt: readBack?.settledAt,
        dataChanged: rawBefore !== rawAfter
      }
    } else {
      results.updateTest = { message: 'No pending recommendations found' }
    }
  } catch (error) {
    results.updateTest = { error: String(error) }
  }

  // Test 4: Check the database config
  results.dbConfig = {
    hasDbUrl: !!process.env.DATABASE_URL,
    configured: isDbConfigured()
  }

  // Test 6: Large value write/read roundtrip (simulates picks blob)
  try {
    const testKey = 'debug:large-write-test'
    // Create a 50KB test value (similar to picks blob size)
    const largeData = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
      id: `test_${i}`,
      team: `Team ${i}`,
      status: 'pending',
      line: 1.5,
      betType: 'spread',
      padding: 'x'.repeat(300)
    })))

    const writeStart = Date.now()
    await kvSet(testKey, largeData)
    const writeMs = Date.now() - writeStart

    const readStart = Date.now()
    const readResult = await kvGet(testKey)
    const readMs = Date.now() - readStart

    results.largeWriteTest = {
      writtenBytes: largeData.length,
      writtenKB: Math.round(largeData.length / 1024),
      readBackBytes: readResult?.length ?? 0,
      match: readResult === largeData,
      writeMs,
      readMs
    }

    await kvDel(testKey)
  } catch (error) {
    results.largeWriteTest = { error: String(error) }
  }

  // Test 7: Check picks blob status
  try {
    const picksRaw = await kvGet('betanalytics:picks')
    const trackRecordRaw = await kvGet('betanalytics:track-record')
    const bestBetRaw = await kvGet('betanalytics:best-bet')

    const picks = picksRaw ? JSON.parse(picksRaw) : []
    results.picksStatus = {
      picksCount: Array.isArray(picks) ? picks.length : 'not-array',
      picksBlobBytes: picksRaw?.length ?? 0,
      picksBlobKB: Math.round((picksRaw?.length ?? 0) / 1024),
      trackRecordBytes: trackRecordRaw?.length ?? 0,
      bestBetBytes: bestBetRaw?.length ?? 0,
      bestBetKB: Math.round((bestBetRaw?.length ?? 0) / 1024),
      samplePick: Array.isArray(picks) && picks.length > 0 ? {
        id: picks[0].id,
        team: picks[0].team,
        status: picks[0].status,
        line: picks[0].line,
        betType: picks[0].betType
      } : null,
      pushCount: Array.isArray(picks) ? picks.filter((p: { status: string }) => p.status === 'push').length : 0
    }
  } catch (error) {
    results.picksStatus = { error: String(error) }
  }

  // Test 8: Picks blob write/read test (write SAME data back and verify)
  try {
    const picksRaw = await kvGet('betanalytics:picks')
    if (picksRaw) {
      const testKey = 'debug:picks-mirror-test'
      await kvSet(testKey, picksRaw)
      const readBack = await kvGet(testKey)
      results.picksMirrorTest = {
        originalBytes: picksRaw.length,
        readBackBytes: readBack?.length ?? 0,
        match: readBack === picksRaw,
        sizeDiff: (readBack?.length ?? 0) - picksRaw.length
      }
      await kvDel(testKey)
    } else {
      results.picksMirrorTest = { message: 'No picks data to test' }
    }
  } catch (error) {
    results.picksMirrorTest = { error: String(error) }
  }

  // Test 5: Diagnostic — test getRecentRecommendations with various limits
  // to find the threshold where kvMget starts failing
  try {
    const limits = [5, 50, 100, 0] // 0 = fetch ALL
    const diagResults: Record<string, number> = {}
    for (const limit of limits) {
      const start = Date.now()
      const recos = await getRecentRecommendations(limit)
      diagResults[`limit_${limit}`] = recos.length
      diagResults[`limit_${limit}_ms`] = Date.now() - start
    }
    results.recoLimitDiag = diagResults
  } catch (error) {
    results.recoLimitDiag = { error: String(error) }
  }

  return NextResponse.json(results)
}
