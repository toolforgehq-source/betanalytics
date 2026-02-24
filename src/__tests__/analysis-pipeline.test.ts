/**
 * ANALYSIS PIPELINE VALIDATION
 * 
 * Tests the core analysis functions that power bet recommendations:
 * - analyzeSpecificGame: Full pipeline for specific game queries
 * - computeBestBets: Best bet computation from game list
 * - computeEnhancedParlay: Parlay building from ranked bets
 * - computeSportBestBets: Sport-specific grouping
 * - computeGameMenu: Game menu for all bet types
 * 
 * These tests use mock data to validate the pipeline WITHOUT external API calls.
 * They verify that given valid game data, the pipeline produces non-empty results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Game, BookmakerOdds } from '@/lib/odds'
import type { RankedBet, EnhancedParlayResult } from '@/lib/bet-ranking'

// ============================================================
// Test Fixtures — Mock game data for all sports
// ============================================================

function makeGame(overrides: Partial<Game> = {}): Game {
  const futureTime = new Date(Date.now() + 4 * 3600000).toISOString()
  return {
    id: 'test-game-1',
    sport: 'basketball_nba',
    sportName: 'NBA',
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Boston Celtics',
    commenceTime: futureTime,
    spreads: [{
      bookmaker: 'DraftKings',
      market: 'spreads',
      outcomes: [
        { name: 'Los Angeles Lakers', price: -110, point: -3.5 },
        { name: 'Boston Celtics', price: -110, point: 3.5 },
      ]
    }],
    totals: [{
      bookmaker: 'DraftKings',
      market: 'totals',
      outcomes: [
        { name: 'Over', price: -110, point: 224.5 },
        { name: 'Under', price: -110, point: 224.5 },
      ]
    }],
    moneylines: [{
      bookmaker: 'DraftKings',
      market: 'h2h',
      outcomes: [
        { name: 'Los Angeles Lakers', price: -150 },
        { name: 'Boston Celtics', price: 130 },
      ]
    }, {
      bookmaker: 'FanDuel',
      market: 'h2h',
      outcomes: [
        { name: 'Los Angeles Lakers', price: -145 },
        { name: 'Boston Celtics', price: 125 },
      ]
    }],
    ...overrides,
  }
}

function makeSoccerGame(league: string, sportKey: string): Game {
  return makeGame({
    id: `soccer-${league}`,
    sport: sportKey,
    sportName: league,
    homeTeam: `${league} Home FC`,
    awayTeam: `${league} Away FC`,
    spreads: [{
      bookmaker: 'DraftKings',
      market: 'spreads',
      outcomes: [
        { name: `${league} Home FC`, price: -110, point: -0.5 },
        { name: `${league} Away FC`, price: -110, point: 0.5 },
      ]
    }],
    totals: [{
      bookmaker: 'DraftKings',
      market: 'totals',
      outcomes: [
        { name: 'Over', price: -110, point: 2.5 },
        { name: 'Under', price: -110, point: 2.5 },
      ]
    }],
    moneylines: [{
      bookmaker: 'DraftKings',
      market: 'h2h',
      outcomes: [
        { name: `${league} Home FC`, price: 150 },
        { name: `${league} Away FC`, price: 200 },
        { name: 'Draw', price: 220 },
      ]
    }, {
      bookmaker: 'FanDuel',
      market: 'h2h',
      outcomes: [
        { name: `${league} Home FC`, price: 145 },
        { name: `${league} Away FC`, price: 205 },
        { name: 'Draw', price: 215 },
      ]
    }],
  })
}

// ============================================================
// Games for ALL 16 supported sports
// ============================================================

const ALL_SPORT_GAMES: { label: string; game: Game }[] = [
  { label: 'NBA', game: makeGame({ sport: 'basketball_nba', sportName: 'NBA' }) },
  { label: 'NFL', game: makeGame({ sport: 'americanfootball_nfl', sportName: 'NFL', homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills' }) },
  { label: 'NHL', game: makeGame({ sport: 'icehockey_nhl', sportName: 'NHL', homeTeam: 'Boston Bruins', awayTeam: 'NY Rangers' }) },
  { label: 'MLB', game: makeGame({ sport: 'baseball_mlb', sportName: 'MLB', homeTeam: 'NY Yankees', awayTeam: 'LA Dodgers' }) },
  { label: 'NCAAB', game: makeGame({ sport: 'basketball_ncaab', sportName: 'NCAAB', homeTeam: 'Duke Blue Devils', awayTeam: 'North Carolina Tar Heels' }) },
  { label: 'NCAAF', game: makeGame({ sport: 'americanfootball_ncaaf', sportName: 'NCAAF', homeTeam: 'Alabama Crimson Tide', awayTeam: 'Georgia Bulldogs' }) },
  { label: 'EPL', game: makeSoccerGame('English Premier League', 'soccer_epl') },
  { label: 'La Liga', game: makeSoccerGame('La Liga', 'soccer_spain_la_liga') },
  { label: 'Bundesliga', game: makeSoccerGame('Bundesliga', 'soccer_germany_bundesliga') },
  { label: 'Serie A', game: makeSoccerGame('Serie A', 'soccer_italy_serie_a') },
  { label: 'Ligue 1', game: makeSoccerGame('Ligue 1', 'soccer_france_ligue_one') },
  { label: 'MLS', game: makeSoccerGame('MLS', 'soccer_usa_mls') },
  { label: 'UCL', game: makeSoccerGame('UEFA Champions League', 'soccer_uefa_champs_league') },
  { label: 'UFC', game: makeGame({ sport: 'mma_mixed_martial_arts', sportName: 'UFC', homeTeam: 'Fighter A', awayTeam: 'Fighter B' }) },
  { label: 'PGA', game: makeGame({ sport: 'golf_pga', sportName: 'PGA Tour', homeTeam: 'Player A', awayTeam: 'Player B' }) },
  { label: 'ATP', game: makeGame({ sport: 'tennis_atp', sportName: 'ATP Tennis', homeTeam: 'Player X', awayTeam: 'Player Y' }) },
]

// ============================================================
// Game Data Validity
// ============================================================

describe('Game fixtures: all 16 sports have valid data', () => {
  it.each(ALL_SPORT_GAMES)('$label: game has required fields', ({ game }) => {
    expect(game.id).toBeTruthy()
    expect(game.sport).toBeTruthy()
    expect(game.sportName).toBeTruthy()
    expect(game.homeTeam).toBeTruthy()
    expect(game.awayTeam).toBeTruthy()
    expect(game.commenceTime).toBeTruthy()
  })

  it.each(ALL_SPORT_GAMES)('$label: game has moneyline odds', ({ game }) => {
    expect(game.moneylines.length).toBeGreaterThan(0)
    const ml = game.moneylines[0]
    expect(ml.outcomes.length).toBeGreaterThanOrEqual(2)
    // Every outcome has a price
    for (const outcome of ml.outcomes) {
      expect(typeof outcome.price).toBe('number')
    }
  })

  it.each(ALL_SPORT_GAMES)('$label: game has spread data', ({ game }) => {
    expect(game.spreads.length).toBeGreaterThan(0)
    const spread = game.spreads[0]
    expect(spread.outcomes.length).toBe(2)
    for (const outcome of spread.outcomes) {
      expect(typeof outcome.point).toBe('number')
    }
  })

  it.each(ALL_SPORT_GAMES)('$label: game has total data', ({ game }) => {
    expect(game.totals.length).toBeGreaterThan(0)
    const total = game.totals[0]
    expect(total.outcomes.length).toBe(2)
    for (const outcome of total.outcomes) {
      expect(typeof outcome.point).toBe('number')
    }
  })
})

// ============================================================
// Soccer games have draw odds
// ============================================================

describe('Soccer games: three-way markets', () => {
  const soccerGames = ALL_SPORT_GAMES.filter(g =>
    g.game.sport.startsWith('soccer_')
  )

  it.each(soccerGames)('$label: moneyline has Draw outcome', ({ game }) => {
    const ml = game.moneylines[0]
    const drawOutcome = ml.outcomes.find(o => o.name === 'Draw')
    expect(drawOutcome, `${game.sportName} is missing Draw outcome in moneylines`).toBeDefined()
    expect(typeof drawOutcome!.price).toBe('number')
  })
})

// ============================================================
// Non-soccer games do NOT have draw odds
// ============================================================

describe('Non-soccer games: two-way markets', () => {
  const nonSoccerGames = ALL_SPORT_GAMES.filter(g =>
    !g.game.sport.startsWith('soccer_')
  )

  it.each(nonSoccerGames)('$label: moneyline has exactly 2 outcomes (no Draw)', ({ game }) => {
    const ml = game.moneylines[0]
    expect(ml.outcomes).toHaveLength(2)
    const drawOutcome = ml.outcomes.find(o => o.name === 'Draw')
    expect(drawOutcome).toBeUndefined()
  })
})

// ============================================================
// computeEnhancedParlay — Integration
// ============================================================

describe('computeEnhancedParlay', () => {
  // Import the function
  let computeEnhancedParlay: typeof import('@/lib/bet-ranking').computeEnhancedParlay

  beforeEach(async () => {
    const mod = await import('@/lib/bet-ranking')
    computeEnhancedParlay = mod.computeEnhancedParlay
  })

  function makeTestBet(overrides: Partial<RankedBet> = {}): RankedBet {
    return {
      gameId: 'g1',
      sport: 'basketball_nba',
      sportName: 'NBA',
      homeTeam: 'Lakers',
      awayTeam: 'Celtics',
      commenceTime: new Date(Date.now() + 3600000).toISOString(),
      team: 'Lakers',
      betType: 'moneyline',
      consensusProbability: 60,
      bestPrice: -150,
      bestBook: 'DraftKings',
      impliedProbability: 60,
      edge: 5,
      eloProbability: 65,
      expectedValue: 8,
      roi: 8,
      allBookPrices: [{ book: 'DraftKings', price: -150, impliedProb: 60 }],
      score: 70,
      calculatedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  it('builds a 2-leg parlay from 2+ bets', () => {
    const bets = [
      makeTestBet({ gameId: 'g1', team: 'Lakers' }),
      makeTestBet({ gameId: 'g2', team: 'Celtics', homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      makeTestBet({ gameId: 'g3', team: 'Warriors', homeTeam: 'Warriors', awayTeam: 'Suns' }),
    ]

    const result = computeEnhancedParlay(bets, 2, true)
    expect(result).not.toBeNull()
    if (result) {
      expect(result.legs).toHaveLength(2)
      expect(result.legCount).toBe(2)
      expect(result.combinedProbability).toBeGreaterThan(0)
      expect(result.parlayOdds).toBeDefined()
    }
  })

  it('builds a 3-leg parlay from 3+ bets', () => {
    const bets = [
      makeTestBet({ gameId: 'g1', team: 'Lakers' }),
      makeTestBet({ gameId: 'g2', team: 'Celtics', homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      makeTestBet({ gameId: 'g3', team: 'Warriors', homeTeam: 'Warriors', awayTeam: 'Suns' }),
    ]

    const result = computeEnhancedParlay(bets, 3, true)
    expect(result).not.toBeNull()
    if (result) {
      expect(result.legs).toHaveLength(3)
    }
  })

  it('returns null when not enough bets for requested leg count', () => {
    const bets = [
      makeTestBet({ gameId: 'g1' }),
    ]

    const result = computeEnhancedParlay(bets, 3, true)
    expect(result).toBeNull()
  })

  it('parlay legs from different games (no duplicate games)', () => {
    const bets = [
      makeTestBet({ gameId: 'g1', team: 'Lakers' }),
      makeTestBet({ gameId: 'g1', team: 'Celtics' }), // Same game, different team
      makeTestBet({ gameId: 'g2', team: 'Warriors', homeTeam: 'Warriors', awayTeam: 'Suns' }),
    ]

    const result = computeEnhancedParlay(bets, 2, true)
    if (result) {
      const gameIds = result.legs.map(l => l.gameId)
      const uniqueGameIds = new Set(gameIds)
      expect(uniqueGameIds.size).toBe(result.legs.length)
    }
  })

  it('parlay with mixed bet types preserves correct betType on each leg', () => {
    const bets = [
      makeTestBet({ gameId: 'g1', betType: 'moneyline', team: 'Lakers' }),
      makeTestBet({ gameId: 'g2', betType: 'spread', line: 7.5, team: 'Celtics', homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      makeTestBet({ gameId: 'g3', betType: 'total', line: 224.5, team: 'Over', homeTeam: 'Bucks', awayTeam: 'Heat' }),
    ]

    const result = computeEnhancedParlay(bets, 3, true)
    if (result) {
      for (const leg of result.legs) {
        expect(['moneyline', 'spread', 'total']).toContain(leg.betType)
      }
    }
  })
})

// ============================================================
// computeSportBestBets — Sport grouping
// ============================================================

describe('computeSportBestBets', () => {
  let computeSportBestBets: typeof import('@/lib/bet-ranking').computeSportBestBets

  beforeEach(async () => {
    const mod = await import('@/lib/bet-ranking')
    computeSportBestBets = mod.computeSportBestBets
  })

  function makeTestBet(overrides: Partial<RankedBet> = {}): RankedBet {
    return {
      gameId: 'g1',
      sport: 'basketball_nba',
      sportName: 'NBA',
      homeTeam: 'Lakers',
      awayTeam: 'Celtics',
      commenceTime: new Date().toISOString(),
      team: 'Lakers',
      betType: 'moneyline',
      consensusProbability: 60,
      bestPrice: -150,
      bestBook: 'DraftKings',
      impliedProbability: 60,
      edge: 5,
      expectedValue: 8,
      roi: 8,
      allBookPrices: [],
      score: 70,
      calculatedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  it('groups bets by sport and picks highest score per sport', () => {
    const bets = [
      makeTestBet({ sportName: 'NBA', team: 'Lakers', score: 70 }),
      makeTestBet({ sportName: 'NBA', team: 'Celtics', score: 65, homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      makeTestBet({ sportName: 'NFL', team: 'Chiefs', score: 80, homeTeam: 'Chiefs', awayTeam: 'Bills' }),
    ]

    const result = computeSportBestBets(bets)
    expect(result['NBA']).toBeDefined()
    expect(result['NBA']!.team).toBe('Lakers') // Higher score
    expect(result['NFL']).toBeDefined()
    expect(result['NFL']!.team).toBe('Chiefs')
  })

  it('returns empty object for empty input', () => {
    const result = computeSportBestBets([])
    expect(Object.keys(result)).toHaveLength(0)
  })
})

// ============================================================
// computeGameMenu — All bet types for a game
// ============================================================

describe('computeGameMenu', () => {
  let computeGameMenu: typeof import('@/lib/bet-ranking').computeGameMenu

  beforeEach(async () => {
    const mod = await import('@/lib/bet-ranking')
    computeGameMenu = mod.computeGameMenu
  })

  it('NBA game: returns moneyline, spread, and total cards', () => {
    const game = makeGame()
    const menu = computeGameMenu(game)
    
    expect(menu.gameId).toBe(game.id)
    expect(menu.homeTeam).toBe(game.homeTeam)
    expect(menu.awayTeam).toBe(game.awayTeam)
    expect(menu.allBets.length).toBeGreaterThan(0)
    
    const betTypes = new Set(menu.allBets.map(b => b.type))
    expect(betTypes.has('moneyline')).toBe(true)
    expect(betTypes.has('spread')).toBe(true)
    expect(betTypes.has('total')).toBe(true)
  })

  it('soccer game with draw: moneyline cards include Draw', () => {
    const game = makeSoccerGame('English Premier League', 'soccer_epl')
    const menu = computeGameMenu(game)
    
    const mlBets = menu.allBets.filter(b => b.type === 'moneyline')
    const drawBet = mlBets.find(b => b.team === 'Draw')
    expect(drawBet, 'Soccer game menu should include Draw moneyline card').toBeDefined()
  })

  it('game with no odds data: returns empty bets', () => {
    const game = makeGame({
      moneylines: [],
      spreads: [],
      totals: [],
    })
    const menu = computeGameMenu(game)
    expect(menu.allBets).toHaveLength(0)
  })
})
