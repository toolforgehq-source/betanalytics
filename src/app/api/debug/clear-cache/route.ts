import { NextResponse } from "next/server"
import { requireDebugAuth } from "@/lib/debug-auth"
import { kvDel, isDbConfigured } from '@/lib/pg-kv'

export const dynamic = "force-dynamic"

const ODDS_CACHE_KEY = 'betanalytics:odds:data'
const BEST_BET_CACHE_KEY = 'betanalytics:best-bet'

export async function POST(request: Request) {
  const authError = requireDebugAuth(request)
  if (authError) return authError

  if (!isDbConfigured()) {
    return NextResponse.json({
      error: 'Database not configured (DATABASE_URL missing)',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
  
  try {
    // Delete both cache keys: odds data AND best bet recommendation
    const keysToDelete = [ODDS_CACHE_KEY, BEST_BET_CACHE_KEY]
    const results: Record<string, string> = {}
    
    for (const key of keysToDelete) {
      try {
        await kvDel(key)
        results[key] = 'deleted'
      } catch {
        results[key] = 'failed'
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
