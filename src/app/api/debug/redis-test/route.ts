/**
 * Debug endpoint to test Redis write/read roundtrip
 * Tests whether updates actually persist to Vercel KV
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAuth } from '@/lib/debug-auth'
import { getRecommendation, updateRecommendation, getRecentRecommendations } from '@/lib/recommendation-tracking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authError = requireDebugAuth(req)
  if (authError) return authError

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 500 })
  }

  const results: Record<string, unknown> = {}

  // Test 1: Basic Redis write/read roundtrip
  try {
    const testKey = 'debug:write-test'
    const testValue = JSON.stringify({ test: true, timestamp: new Date().toISOString() })

    const writeResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', testKey, testValue])
    })
    const writeResult = await writeResponse.json()

    const readResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', testKey])
    })
    const readResult = await readResponse.json()

    results.basicWriteTest = {
      writeStatus: writeResponse.status,
      writeResult,
      readStatus: readResponse.status,
      readResult,
      match: readResult.result === testValue
    }
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
      // Read the raw Redis data first
      const rawReadResponse = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['GET', `reco:v1:${firstPending.id}`])
      })
      const rawReadResult = await rawReadResponse.json()

      // Try to update it
      const updateSuccess = await updateRecommendation(firstPending.id, {
        status: 'won',
        settledAt: new Date().toISOString(),
        actualResult: 'Debug test settlement',
        profit: 1.0
      })

      // Read back the raw data
      const rawReadAfterResponse = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['GET', `reco:v1:${firstPending.id}`])
      })
      const rawReadAfterResult = await rawReadAfterResponse.json()

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
        rawDataBefore: typeof rawReadResult.result === 'string' ? rawReadResult.result.substring(0, 200) : rawReadResult.result,
        rawDataAfter: typeof rawReadAfterResult.result === 'string' ? rawReadAfterResult.result.substring(0, 200) : rawReadAfterResult.result,
        readBackStatus: readBack?.status,
        readBackSettledAt: readBack?.settledAt,
        dataChanged: rawReadResult.result !== rawReadAfterResult.result
      }
    } else {
      results.updateTest = { message: 'No pending recommendations found' }
    }
  } catch (error) {
    results.updateTest = { error: String(error) }
  }

  // Test 4: Check the Redis URL format
  results.redisConfig = {
    urlPrefix: url.substring(0, 30) + '...',
    hasToken: !!token,
    tokenLength: token.length
  }

  return NextResponse.json(results)
}
