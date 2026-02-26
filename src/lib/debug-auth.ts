/**
 * Debug endpoint authentication guard.
 * All debug endpoints must call this before executing.
 * Requires either CRON_SECRET header or valid admin session.
 */

import { NextResponse } from 'next/server'

export function requireDebugAuth(request: Request): NextResponse | null {
  // In production, require CRON_SECRET
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      return NextResponse.json(
        { error: 'Debug endpoints are not configured in this environment' },
        { status: 503 }
      )
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized — debug endpoints require authentication' },
        { status: 401 }
      )
    }
  }

  // Auth passed (or not in production)
  return null
}
