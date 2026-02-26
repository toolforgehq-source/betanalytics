import { NextResponse } from "next/server"
import { requireDebugAuth } from "@/lib/debug-auth"

export const dynamic = "force-dynamic"

const ODDS_CACHE_KEY = 'betanalytics:odds:data'
const BEST_BET_CACHE_KEY = 'betanalytics:best-bet'

export async function POST(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    return NextResponse.json({
      error: 'Redis not configured',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
  
  try {
    // Delete both cache keys: odds data AND best bet recommendation
    const keysToDelete = [ODDS_CACHE_KEY, BEST_BET_CACHE_KEY]
    const results: Record<string, number> = {}
    
    for (const key of keysToDelete) {
      const response = await fetch(`${url}/del/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (response.ok) {
        const data = await response.json()
        results[key] = data.result
      } else {
        results[key] = -1 // failed
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'All caches cleared. Next chat request will fetch fresh odds and recompute best bets.',
      deletedKeys: results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
