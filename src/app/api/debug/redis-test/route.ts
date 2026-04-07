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
