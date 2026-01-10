/**
 * Cron Job: Snapshot Odds for Line Movement Tracking
 * 
 * COST OPTIMIZATION:
 * - Uses ESPN odds (FREE) instead of The Odds API
 * - No API costs for line movement tracking
 * 
 * This endpoint is called 6x daily by Vercel Cron to:
 * 1. Fetch fresh odds from ESPN (FREE)
 * 2. Store snapshots for line movement tracking
 * 
 * Schedule: Every 4 hours
 * Times: 12am, 4am, 8am, 12pm, 4pm, 8pm ET
 */

import { NextResponse } from 'next/server'
import { fetchAllESPNOdds, type ESPNOdds } from '@/lib/espn'
import { storeOddsSnapshot } from '@/lib/line-movement'
import { type Game } from '@/lib/odds'

export const runtime = 'nodejs'
export const maxDuration = 60 // Allow up to 60 seconds for this job

/**
 * Convert ESPN odds to Game format for snapshot storage
 */
function convertESPNOddsToGame(espnOdds: ESPNOdds): Game {
  const sportKeyMap: Record<string, string> = {
    'NBA': 'basketball_nba',
    'NFL': 'americanfootball_nfl',
    'NHL': 'icehockey_nhl',
    'NCAAB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'MLB': 'baseball_mlb',
    'English Premier League': 'soccer_epl',
    'La Liga': 'soccer_spain_la_liga',
    'Bundesliga': 'soccer_germany_bundesliga',
    'Serie A': 'soccer_italy_serie_a',
    'Ligue 1': 'soccer_france_ligue_one',
    'MLS': 'soccer_usa_mls',
    'UEFA Champions League': 'soccer_uefa_champs_league',
    'UFC': 'mma_mixed_martial_arts',
    'PGA Tour': 'golf_pga',
    'ATP Tennis': 'tennis_atp',
  }
  
  const sportKey = sportKeyMap[espnOdds.league] || espnOdds.sport
  const provider = espnOdds.provider || 'DraftKings'
  
  // Build spreads array
  const spreads = espnOdds.spread !== null ? [{
    bookmaker: provider,
    market: 'spreads',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.spreadOdds?.home || -110, point: espnOdds.homeFavorite ? espnOdds.spread : -espnOdds.spread },
      { name: espnOdds.awayTeam, price: espnOdds.spreadOdds?.away || -110, point: espnOdds.homeFavorite ? -espnOdds.spread : espnOdds.spread }
    ]
  }] : []
  
  // Build totals array
  const totals = espnOdds.overUnder !== null ? [{
    bookmaker: provider,
    market: 'totals',
    outcomes: [
      { name: 'Over', price: espnOdds.overUnderOdds?.over || -110, point: espnOdds.overUnder },
      { name: 'Under', price: espnOdds.overUnderOdds?.under || -110, point: espnOdds.overUnder }
    ]
  }] : []
  
  // Build moneylines array
  const moneylines = espnOdds.moneyline ? [{
    bookmaker: provider,
    market: 'h2h',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.moneyline.home },
      { name: espnOdds.awayTeam, price: espnOdds.moneyline.away }
    ]
  }] : []
  
  return {
    id: espnOdds.gameId,
    sport: sportKey,
    sportName: espnOdds.league,
    homeTeam: espnOdds.homeTeam,
    awayTeam: espnOdds.awayTeam,
    commenceTime: espnOdds.commenceTime,
    spreads,
    totals,
    moneylines
  }
}

export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // If CRON_SECRET is set, verify it
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Cron] Unauthorized access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('[Cron] Starting odds snapshot job (ESPN FREE)...')
    const startTime = Date.now()
    
    // Fetch fresh odds from ESPN (FREE - no API costs!)
    const espnOddsData = await fetchAllESPNOdds()
    
    if (!espnOddsData.games || espnOddsData.games.length === 0) {
      console.error('[Cron] No games returned from ESPN')
      return NextResponse.json({ 
        success: false, 
        error: 'No games available from ESPN',
        timestamp: new Date().toISOString()
      }, { status: 500 })
    }
    
    // Convert ESPN odds to Game format for snapshot storage
    const gamesForSnapshot = espnOddsData.games.map(convertESPNOddsToGame)
    
    // Store snapshot for line movement tracking
    await storeOddsSnapshot(gamesForSnapshot)
    
    const duration = Date.now() - startTime
    
    console.log(`[Cron] Snapshot complete: ${gamesForSnapshot.length} games in ${duration}ms (ESPN FREE)`)
    
    return NextResponse.json({
      success: true,
      source: 'ESPN (FREE)',
      gamesSnapshotted: gamesForSnapshot.length,
      sportsActive: new Set(espnOddsData.games.map(g => g.league)).size,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      nextRun: getNextRunTime(),
    })
  } catch (error) {
    console.error('[Cron] Error in snapshot job:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

function getNextRunTime(): string {
  const now = new Date()
  const currentHour = now.getUTCHours()
  
  // Find next 4-hour interval
  const nextHour = Math.ceil((currentHour + 1) / 4) * 4
  const nextRun = new Date(now)
  
  if (nextHour >= 24) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1)
    nextRun.setUTCHours(0, 0, 0, 0)
  } else {
    nextRun.setUTCHours(nextHour, 0, 0, 0)
  }
  
  return nextRun.toISOString()
}
