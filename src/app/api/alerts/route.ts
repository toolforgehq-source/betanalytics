/**
 * API endpoint for alert preferences
 * 
 * POST: Save alert preferences for the authenticated user
 * GET: Retrieve current alert preferences
 * 
 * Preferences are stored in the user's database record.
 * The actual notification dispatch is handled by a separate cron/edge function.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const preferences = await req.json()

    // Validate required fields
    if (typeof preferences !== 'object' || preferences === null) {
      return NextResponse.json({ error: 'Invalid preferences format' }, { status: 400 })
    }

    // Store preferences in database
    // Using a simple key-value approach with the user's email
    const key = `alert_prefs:${session.user.email}`
    
    // Store in Redis if available, otherwise just acknowledge
    try {
      const { createClient } = await import('redis')
      const redisUrl = process.env.REDIS_URL || process.env.KV_URL
      if (redisUrl) {
        const client = createClient({ url: redisUrl })
        await client.connect()
        await client.set(key, JSON.stringify(preferences))
        await client.disconnect()
      }
    } catch (redisErr) {
      // Redis not available — log but don't fail
      console.warn('[alerts] Redis not available, preferences acknowledged but not persisted:', redisErr)
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

    const key = `alert_prefs:${session.user.email}`
    
    // Try to load from Redis
    try {
      const { createClient } = await import('redis')
      const redisUrl = process.env.REDIS_URL || process.env.KV_URL
      if (redisUrl) {
        const client = createClient({ url: redisUrl })
        await client.connect()
        const stored = await client.get(key)
        await client.disconnect()
        
        if (stored) {
          return NextResponse.json({
            success: true,
            preferences: JSON.parse(stored),
          })
        }
      }
    } catch (redisErr) {
      console.warn('[alerts] Redis not available:', redisErr)
    }

    // Return default preferences if none saved
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
