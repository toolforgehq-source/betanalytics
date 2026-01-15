/**
 * Admin API endpoint for tracking results
 * 
 * Returns statistics and recent recommendations for the admin dashboard.
 */

import { NextResponse } from 'next/server'
import { 
  calculateTrackingStats, 
  getRecentRecommendations 
} from '@/lib/recommendation-tracking'

export const dynamic = 'force-dynamic'

// Simple admin secret check
function isAuthorized(request: Request): boolean {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  const adminSecret = process.env.ADMIN_SECRET
  
  // If no admin secret is configured, allow access (for development)
  if (!adminSecret) return true
  
  return secret === adminSecret
}

export async function GET(request: Request) {
  // Check authorization
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'stats'
    
    if (action === 'stats') {
      const stats = await calculateTrackingStats()
      return NextResponse.json({
        success: true,
        stats
      })
    }
    
    if (action === 'recent') {
      const limit = parseInt(searchParams.get('limit') || '50')
      const recommendations = await getRecentRecommendations(limit)
      return NextResponse.json({
        success: true,
        recommendations
      })
    }
    
    return NextResponse.json({
      success: false,
      error: 'Invalid action'
    }, { status: 400 })
    
  } catch (error) {
    console.error('[Admin Results] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch results',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
