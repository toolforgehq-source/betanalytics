import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports'

// ALL sports to fetch - verified from The Odds API documentation
const ALL_SPORTS = [
  { key: 'basketball_nba', name: 'NBA' },
  { key: 'americanfootball_nfl', name: 'NFL' },
  { key: 'americanfootball_ncaaf', name: 'NCAAF' },
  { key: 'icehockey_nhl', name: 'NHL' },
  { key: 'basketball_ncaab', name: 'NCAAB' },
  { key: 'baseball_mlb', name: 'MLB' },
  { key: 'mma_mixed_martial_arts', name: 'MMA/UFC' },
  { key: 'soccer_usa_mls', name: 'MLS' },
  { key: 'soccer_epl', name: 'English Premier League' },
]

interface SportDebugInfo {
  sportKey: string
  sportName: string
  requestUrl: string
  httpStatus: number | null
  errorMessage: string | null
  gamesCount: number
  bookmakersSeen: string[]
  sampleGames: Array<{
    homeTeam: string
    awayTeam: string
    commenceTime: string
    hasMoneyline: boolean
    hasSpreads: boolean
    hasTotals: boolean
  }>
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const apiKey = process.env.ODDS_API_KEY
  
  if (!apiKey) {
    return NextResponse.json({
      error: 'ODDS_API_KEY not configured in environment variables',
      timestamp: new Date().toISOString(),
      hint: 'Add ODDS_API_KEY to Vercel Environment Variables and redeploy'
    }, { status: 500 })
  }
  
  const results: SportDebugInfo[] = []
  
  // Fetch each sport and collect debug info
  for (const sport of ALL_SPORTS) {
    const debugInfo: SportDebugInfo = {
      sportKey: sport.key,
      sportName: sport.name,
      requestUrl: `${ODDS_API_BASE}/${sport.key}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=american`,
      httpStatus: null,
      errorMessage: null,
      gamesCount: 0,
      bookmakersSeen: [],
      sampleGames: []
    }
    
    try {
      const url = `${ODDS_API_BASE}/${sport.key}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      })
      
      debugInfo.httpStatus = response.status
      
      if (!response.ok) {
        const errorText = await response.text()
        debugInfo.errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`
        results.push(debugInfo)
        continue
      }
      
      const games = await response.json()
      
      if (!Array.isArray(games)) {
        debugInfo.errorMessage = 'Response is not an array'
        results.push(debugInfo)
        continue
      }
      
      debugInfo.gamesCount = games.length
      
      // Collect unique bookmakers seen
      const bookmakers = new Set<string>()
      for (const game of games) {
        if (game.bookmakers) {
          for (const bm of game.bookmakers) {
            bookmakers.add(bm.key)
          }
        }
      }
      debugInfo.bookmakersSeen = Array.from(bookmakers)
      
      // Sample first 5 games with market info
      for (const game of games.slice(0, 5)) {
        const hasMoneyline = game.bookmakers?.some((bm: { markets?: Array<{ key: string }> }) => 
          bm.markets?.some((m: { key: string }) => m.key === 'h2h')
        ) || false
        const hasSpreads = game.bookmakers?.some((bm: { markets?: Array<{ key: string }> }) => 
          bm.markets?.some((m: { key: string }) => m.key === 'spreads')
        ) || false
        const hasTotals = game.bookmakers?.some((bm: { markets?: Array<{ key: string }> }) => 
          bm.markets?.some((m: { key: string }) => m.key === 'totals')
        ) || false
        
        debugInfo.sampleGames.push({
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          commenceTime: game.commence_time,
          hasMoneyline,
          hasSpreads,
          hasTotals
        })
      }
      
    } catch (error) {
      debugInfo.errorMessage = error instanceof Error ? error.message : 'Unknown error'
    }
    
    results.push(debugInfo)
  }
  
  // Summary
  const summary = {
    totalSports: results.length,
    sportsWithGames: results.filter(r => r.gamesCount > 0).length,
    sportsWithErrors: results.filter(r => r.errorMessage !== null).length,
    totalGames: results.reduce((sum, r) => sum + r.gamesCount, 0),
    sportBreakdown: results.map(r => ({
      sport: r.sportName,
      games: r.gamesCount,
      status: r.errorMessage ? 'error' : r.gamesCount > 0 ? 'active' : 'no_games'
    }))
  }
  
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    apiKeyConfigured: true,
    summary,
    details: results
  })
}
