/**
 * Public API endpoint for live odds across sportsbooks
 * 
 * Returns current odds for all available games grouped by sport,
 * with best price highlighted for each bet type.
 */

import { NextResponse } from 'next/server'
import { getCurrentOdds, type Game } from '@/lib/odds'

export const dynamic = 'force-dynamic'

interface FormattedGame {
  id: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  markets: {
    moneyline: BookPrice[]
    spread: BookPrice[]
    total: BookPrice[]
  }
  bestMoneyline: { home: BookPrice | null; away: BookPrice | null }
  bestSpread: { home: BookPrice | null; away: BookPrice | null }
  bestTotal: { over: BookPrice | null; under: BookPrice | null }
}

interface BookPrice {
  book: string
  price: number
  point?: number
}

function findBestPrice(prices: BookPrice[], side: 'home' | 'away' | 'over' | 'under', outcomes: { book: string; outcomes: { name: string; price: number; point?: number }[] }[]): BookPrice | null {
  let best: BookPrice | null = null
  
  for (const bk of outcomes) {
    for (const o of bk.outcomes) {
      const isTarget = (side === 'home' && o.name !== 'Draw') || 
                       (side === 'away' && o.name !== 'Draw') ||
                       (side === 'over' && o.name === 'Over') ||
                       (side === 'under' && o.name === 'Under')
      if (!isTarget) continue
      
      if (!best || o.price > best.price) {
        best = { book: bk.book, price: o.price, point: o.point }
      }
    }
  }
  
  return best
}

function formatGame(game: Game): FormattedGame {
  const moneylinePrices: BookPrice[] = []
  const spreadPrices: BookPrice[] = []
  const totalPrices: BookPrice[] = []

  // Extract moneyline prices
  for (const bk of game.moneylines) {
    for (const o of bk.outcomes) {
      moneylinePrices.push({ book: bk.bookmaker, price: o.price })
    }
  }

  // Extract spread prices
  for (const bk of game.spreads) {
    for (const o of bk.outcomes) {
      spreadPrices.push({ book: bk.bookmaker, price: o.price, point: o.point })
    }
  }

  // Extract total prices
  for (const bk of game.totals) {
    for (const o of bk.outcomes) {
      totalPrices.push({ book: bk.bookmaker, price: o.price, point: o.point })
    }
  }

  // Find best prices for each side
  let bestMLHome: BookPrice | null = null
  let bestMLAway: BookPrice | null = null
  
  for (const bk of game.moneylines) {
    for (const o of bk.outcomes) {
      if (o.name === game.homeTeam || (!o.name.includes('Draw') && bk.outcomes.indexOf(o) === 0)) {
        if (!bestMLHome || o.price > bestMLHome.price) {
          bestMLHome = { book: bk.bookmaker, price: o.price }
        }
      } else if (o.name !== 'Draw') {
        if (!bestMLAway || o.price > bestMLAway.price) {
          bestMLAway = { book: bk.bookmaker, price: o.price }
        }
      }
    }
  }

  let bestSpreadHome: BookPrice | null = null
  let bestSpreadAway: BookPrice | null = null

  for (const bk of game.spreads) {
    for (const o of bk.outcomes) {
      if (o.name === game.homeTeam || bk.outcomes.indexOf(o) === 0) {
        if (!bestSpreadHome || o.price > bestSpreadHome.price) {
          bestSpreadHome = { book: bk.bookmaker, price: o.price, point: o.point }
        }
      } else {
        if (!bestSpreadAway || o.price > bestSpreadAway.price) {
          bestSpreadAway = { book: bk.bookmaker, price: o.price, point: o.point }
        }
      }
    }
  }

  let bestTotalOver: BookPrice | null = null
  let bestTotalUnder: BookPrice | null = null

  for (const bk of game.totals) {
    for (const o of bk.outcomes) {
      if (o.name === 'Over') {
        if (!bestTotalOver || o.price > bestTotalOver.price) {
          bestTotalOver = { book: bk.bookmaker, price: o.price, point: o.point }
        }
      } else if (o.name === 'Under') {
        if (!bestTotalUnder || o.price > bestTotalUnder.price) {
          bestTotalUnder = { book: bk.bookmaker, price: o.price, point: o.point }
        }
      }
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
      moneyline: moneylinePrices,
      spread: spreadPrices,
      total: totalPrices,
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
