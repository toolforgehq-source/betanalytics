import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const ODDS_CACHE_KEY = 'betanalytics:odds:data'

export async function POST() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    return NextResponse.json({
      error: 'Redis not configured',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
  
  try {
    // Delete the cache key
    const response = await fetch(`${url}/del/${ODDS_CACHE_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
    
    if (!response.ok) {
      return NextResponse.json({
        error: 'Failed to clear cache',
        status: response.status,
        timestamp: new Date().toISOString(),
      }, { status: 500 })
    }
    
    const result = await response.json()
    
    return NextResponse.json({
      success: true,
      message: 'Cache cleared successfully. Next chat request will fetch fresh odds data.',
      deletedKeys: result.result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
