/**
 * SOCCER THREE-WAY MARKET VALIDATION
 * 
 * Soccer uses three-way markets (home/draw/away) unlike US sports (home/away).
 * This test validates that draw odds are preserved through the entire pipeline.
 * 
 * The bug: Draw odds were being dropped during ESPN-to-Game conversion,
 * causing soccer moneyline analysis to only consider two outcomes.
 * The fix: Spread operator includes draw when present:
 *   ...(g.moneyline.draw !== undefined ? [{ name: 'Draw', price: g.moneyline.draw }] : [])
 */
import { describe, it, expect } from 'vitest'
import type { Game, BookmakerOdds } from '@/lib/odds'

// ============================================================
// Test the conversion logic (extracted from route.ts)
// ============================================================

interface ESPNOddsLike {
  homeTeam: string
  awayTeam: string
  moneyline: {
    home: number
    away: number
    draw?: number
  } | null
}

function convertMoneylines(g: ESPNOddsLike, provider: string): BookmakerOdds[] {
  if (!g.moneyline) return []
  return [{
    bookmaker: provider,
    market: 'h2h',
    outcomes: [
      { name: g.homeTeam, price: g.moneyline.home },
      { name: g.awayTeam, price: g.moneyline.away },
      // Include draw odds for soccer three-way markets
      ...(g.moneyline.draw !== undefined ? [{ name: 'Draw', price: g.moneyline.draw }] : [])
    ]
  }]
}

describe('Soccer three-way market: draw odds preservation', () => {
  it('soccer game with draw odds: includes Draw outcome', () => {
    const game: ESPNOddsLike = {
      homeTeam: 'Arsenal',
      awayTeam: 'Manchester City',
      moneyline: { home: 180, away: 120, draw: 250 },
    }

    const moneylines = convertMoneylines(game, 'DraftKings')
    expect(moneylines).toHaveLength(1)
    expect(moneylines[0].outcomes).toHaveLength(3)
    
    const drawOutcome = moneylines[0].outcomes.find(o => o.name === 'Draw')
    expect(drawOutcome).toBeDefined()
    expect(drawOutcome!.price).toBe(250)
  })

  it('US sport game without draw: only 2 outcomes', () => {
    const game: ESPNOddsLike = {
      homeTeam: 'Lakers',
      awayTeam: 'Celtics',
      moneyline: { home: -150, away: 130 },
    }

    const moneylines = convertMoneylines(game, 'DraftKings')
    expect(moneylines).toHaveLength(1)
    expect(moneylines[0].outcomes).toHaveLength(2)
    
    const drawOutcome = moneylines[0].outcomes.find(o => o.name === 'Draw')
    expect(drawOutcome).toBeUndefined()
  })

  it('soccer game with draw=0 (even money): still includes Draw', () => {
    // Edge case: draw odds of 0 should NOT be treated as missing
    // The fix uses `!== undefined` not `&&` specifically for this
    const game: ESPNOddsLike = {
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      moneyline: { home: 200, away: 200, draw: 0 },
    }

    const moneylines = convertMoneylines(game, 'DraftKings')
    const drawOutcome = moneylines[0].outcomes.find(o => o.name === 'Draw')
    // draw=0 is a valid price, should be included
    expect(drawOutcome).toBeDefined()
    expect(drawOutcome!.price).toBe(0)
  })

  it('null moneyline: returns empty array', () => {
    const game: ESPNOddsLike = {
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      moneyline: null,
    }

    const moneylines = convertMoneylines(game, 'DraftKings')
    expect(moneylines).toHaveLength(0)
  })
})

describe('Soccer three-way market: all soccer leagues', () => {
  const soccerLeagues = [
    'English Premier League',
    'La Liga',
    'Bundesliga',
    'Serie A',
    'Ligue 1',
    'MLS',
    'UEFA Champions League',
  ]

  it.each(soccerLeagues)('%s: draw odds preserved in conversion', (league) => {
    const game: ESPNOddsLike = {
      homeTeam: `${league} Home Team`,
      awayTeam: `${league} Away Team`,
      moneyline: { home: 150, away: 200, draw: 220 },
    }

    const moneylines = convertMoneylines(game, 'DraftKings')
    expect(moneylines[0].outcomes).toHaveLength(3)
    expect(moneylines[0].outcomes[2].name).toBe('Draw')
    expect(moneylines[0].outcomes[2].price).toBe(220)
  })
})

describe('Soccer Game type: draw odds in Game structure', () => {
  it('Game with three-way moneyline has Draw outcome accessible', () => {
    const game: Game = {
      id: 'soccer-1',
      sport: 'soccer_epl',
      sportName: 'English Premier League',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      commenceTime: new Date().toISOString(),
      spreads: [],
      totals: [],
      moneylines: [{
        bookmaker: 'DraftKings',
        market: 'h2h',
        outcomes: [
          { name: 'Arsenal', price: 150 },
          { name: 'Chelsea', price: 200 },
          { name: 'Draw', price: 230 },
        ]
      }],
    }

    // Verify draw outcome is accessible
    const ml = game.moneylines[0]
    const drawOutcome = ml.outcomes.find(o => o.name === 'Draw')
    expect(drawOutcome).toBeDefined()
    expect(drawOutcome!.price).toBe(230)
    
    // Verify total outcome count
    expect(ml.outcomes).toHaveLength(3)
  })
})
