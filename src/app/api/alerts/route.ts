/**
 * API endpoint for alert preferences
 * 
 * POST: Save alert preferences for the authenticated user
 * GET: Retrieve current alert preferences
 * 
 * Uses the same Upstash Redis REST API that the rest of the app uses.
 * Falls back to in-memory storage for local development.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { kvGet, kvSet, kvSadd, kvSrem } from '@/lib/pg-kv'


export const dynamic = 'force-dynamic'

// Upstash Redis REST API helper (same pattern as src/db/index.ts)


// In-memory fallback for local development
const memoryAlertPrefs: Map<string, string> = new Map()

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const preferences = await req.json()

    if (typeof preferences !== 'object' || preferences === null) {
      return NextResponse.json({ error: 'Invalid preferences format' }, { status: 400 })
    }

    const key = `alert_prefs:${session.user.email.toLowerCase()}`
    const value = JSON.stringify(preferences)

    // Try Upstash Redis, fall back to memory
    const redisResult = await kvSet(key, value)
    if (redisResult === null) {
      memoryAlertPrefs.set(key, value)
    } else {
      // Track this user in a set so the cron job can scan all subscribers
      if (preferences.emailEnabled) {
        await kvSadd('alert_subscribers', session.user.email.toLowerCase())
      } else {
        await kvSrem('alert_subscribers', session.user.email.toLowerCase())
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Alert preferences saved',
      preferences,
    })
  } catch (error) {
    console.error('[API /alerts POST] Error:', error)
    return NextResponse.json({
      error: 'Failed to save alert preferences',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const key = `alert_prefs:${session.user.email.toLowerCase()}`

    // Try Upstash Redis first
    const stored = await kvGet(key)
    if (stored) {
      return NextResponse.json({
        success: true,
        preferences: JSON.parse(stored),
      })
    }

    // Check memory fallback
    const memStored = memoryAlertPrefs.get(key)
    if (memStored) {
      return NextResponse.json({
        success: true,
        preferences: JSON.parse(memStored),
      })
    }

    // No saved preferences
    return NextResponse.json({
      success: true,
      preferences: null,
      message: 'No saved preferences — using defaults',
    })
  } catch (error) {
    console.error('[API /alerts GET] Error:', error)
    return NextResponse.json({
      error: 'Failed to load alert preferences',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
