/**
 * Public API endpoint for live odds across sportsbooks
 * 
 * Returns current odds for all available games grouped by sport,
 * with structured per-book rows for each market type and best prices highlighted.
 */

import { NextResponse } from 'next/server'
import { getCurrentOdds, type Game } from '@/lib/odds'

export const dynamic = 'force-dynamic'

// ============================================
// TYPES — shared contract with client components
// ============================================

interface MoneylineRow {
  book: string
  home: number
  away: number
  draw?: number
}

interface SpreadRow {
  book: string
  homeSpread: number
  homePrice: number
  awaySpread: number
  awayPrice: number
}

interface TotalRow {
  book: string
  line: number
  overPrice: number
  underPrice: number
}

interface BookPrice {
  book: string
  price: number
  point?: number
}

interface FormattedGame {
  id: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  markets: {
    moneyline: MoneylineRow[]
    spread: SpreadRow[]
    total: TotalRow[]
  }
  bestMoneyline: { home: BookPrice | null; away: BookPrice | null }
  bestSpread: { home: BookPrice | null; away: BookPrice | null }
  bestTotal: { over: BookPrice | null; under: BookPrice | null }
}

// ============================================
// FORMATTING
// ============================================

function formatGame(game: Game): FormattedGame {
  // Build structured per-book moneyline rows
  const moneylineRows: MoneylineRow[] = []
  for (const bk of game.moneylines) {
    let home = 0
    let away = 0
    let draw: number | undefined
    for (const o of bk.outcomes) {
      if (o.name === 'Draw') {
        draw = o.price
      } else if (o.name === game.homeTeam) {
        home = o.price
      } else {
        away = o.price
      }
    }
    // If we couldn't match by name (some APIs use generic names),
    // fall back to positional: first outcome = away, second = home
    // (The Odds API convention: first outcome is typically away team)
    if (home === 0 && away === 0 && bk.outcomes.length >= 2) {
      // Check if any outcome matches home or away team name loosely
      const homeIdx = bk.outcomes.findIndex(o => o.name !== 'Draw' && o.name === game.homeTeam)
      const awayIdx = bk.outcomes.findIndex(o => o.name !== 'Draw' && o.name === game.awayTeam)
      if (homeIdx >= 0) home = bk.outcomes[homeIdx].price
      if (awayIdx >= 0) away = bk.outcomes[awayIdx].price
      // If still no match, use positional
      if (home === 0 && away === 0) {
        home = bk.outcomes[0].price
        away = bk.outcomes[1].price
      }
      if (bk.outcomes.length > 2 && !draw) {
        draw = bk.outcomes[2].price
      }
    }
    if (home !== 0 || away !== 0) {
      const row: MoneylineRow = { book: bk.bookmaker, home, away }
      if (draw !== undefined) row.draw = draw
      moneylineRows.push(row)
    }
  }

  // Build structured per-book spread rows
  const spreadRows: SpreadRow[] = []
  for (const bk of game.spreads) {
    let homeSpread = 0, homePrice = 0, awaySpread = 0, awayPrice = 0
    for (const o of bk.outcomes) {
      if (o.name === game.homeTeam) {
        homeSpread = o.point ?? 0
        homePrice = o.price
      } else if (o.name !== 'Draw') {
        awaySpread = o.point ?? 0
        awayPrice = o.price
      }
    }
    // Positional fallback
    if (homePrice === 0 && awayPrice === 0 && bk.outcomes.length >= 2) {
      homeSpread = bk.outcomes[0].point ?? 0
      homePrice = bk.outcomes[0].price
      awaySpread = bk.outcomes[1].point ?? 0
      awayPrice = bk.outcomes[1].price
    }
    if (homePrice !== 0 || awayPrice !== 0) {
      spreadRows.push({ book: bk.bookmaker, homeSpread, homePrice, awaySpread, awayPrice })
    }
  }

  // Build structured per-book total rows
  const totalRows: TotalRow[] = []
  for (const bk of game.totals) {
    let line = 0, overPrice = 0, underPrice = 0
    for (const o of bk.outcomes) {
      if (o.name === 'Over') {
        overPrice = o.price
        line = o.point ?? 0
      } else if (o.name === 'Under') {
        underPrice = o.price
        if (line === 0) line = o.point ?? 0
      }
    }
    if (overPrice !== 0 || underPrice !== 0) {
      totalRows.push({ book: bk.bookmaker, line, overPrice, underPrice })
    }
  }

  // Find best prices from the structured rows
  let bestMLHome: BookPrice | null = null
  let bestMLAway: BookPrice | null = null
  for (const row of moneylineRows) {
    if (row.home !== 0 && (!bestMLHome || row.home > bestMLHome.price)) {
      bestMLHome = { book: row.book, price: row.home }
    }
    if (row.away !== 0 && (!bestMLAway || row.away > bestMLAway.price)) {
      bestMLAway = { book: row.book, price: row.away }
    }
  }

  let bestSpreadHome: BookPrice | null = null
  let bestSpreadAway: BookPrice | null = null
  for (const row of spreadRows) {
    if (row.homePrice !== 0 && (!bestSpreadHome || row.homePrice > bestSpreadHome.price)) {
      bestSpreadHome = { book: row.book, price: row.homePrice, point: row.homeSpread }
    }
    if (row.awayPrice !== 0 && (!bestSpreadAway || row.awayPrice > bestSpreadAway.price)) {
      bestSpreadAway = { book: row.book, price: row.awayPrice, point: row.awaySpread }
    }
  }

  let bestTotalOver: BookPrice | null = null
  let bestTotalUnder: BookPrice | null = null
  for (const row of totalRows) {
    if (row.overPrice !== 0 && (!bestTotalOver || row.overPrice > bestTotalOver.price)) {
      bestTotalOver = { book: row.book, price: row.overPrice, point: row.line }
    }
    if (row.underPrice !== 0 && (!bestTotalUnder || row.underPrice > bestTotalUnder.price)) {
      bestTotalUnder = { book: row.book, price: row.underPrice, point: row.line }
    }
  }

  return {
    id: game.id,
    sport: game.sport,
    sportName: game.sportName,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    markets: {
      moneyline: moneylineRows,
      spread: spreadRows,
      total: totalRows,
    },
    bestMoneyline: { home: bestMLHome, away: bestMLAway },
    bestSpread: { home: bestSpreadHome, away: bestSpreadAway },
    bestTotal: { over: bestTotalOver, under: bestTotalUnder },
  }
}

export async function GET() {
  try {
    const oddsData = await getCurrentOdds()
    
    // Group by sport and format
    const gamesBySport: Record<string, FormattedGame[]> = {}
    
    for (const game of oddsData.games) {
      const formatted = formatGame(game)
      const sport = game.sportName || game.sport
      if (!gamesBySport[sport]) {
        gamesBySport[sport] = []
      }
      gamesBySport[sport].push(formatted)
    }

    // Sort games within each sport by commence time
    for (const sport of Object.keys(gamesBySport)) {
      gamesBySport[sport].sort((a, b) => 
        new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
      )
    }

    return NextResponse.json({
      success: true,
      sports: gamesBySport,
      totalGames: oddsData.games.length,
      lastUpdated: oddsData.lastUpdated,
      isStale: oddsData.isStale,
    })
  } catch (error) {
    console.error('[API /odds] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch odds data',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
