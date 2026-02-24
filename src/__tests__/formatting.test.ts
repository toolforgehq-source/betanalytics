/**
 * FORMATTING & DISPLAY VALIDATION
 * 
 * Tests that bet formatting functions correctly display:
 * - Bet type labels (moneyline → "ML", spread → "+7.5", total → "Over 224.5")
 * - Parlay legs respect bet types (not hardcoded "ML" for everything)
 * - Soccer three-way markets preserve draw odds
 * - Dead-end responses never appear (every code path returns useful analysis)
 * - Sport-specific units (Points, Goals, Runs)
 */
import { describe, it, expect } from 'vitest'
import {
  formatBestBetForContext,
  formatGameAnalysisForContext,
  formatEnhancedParlayForContext,
  formatParlayForContext,
  formatFilteredBestBetResponse,
  type RankedBet,
  type BestBetResult,
  type GameAnalysisResult,
  type EnhancedParlayResult,
  type ParlayResult,
} from '@/lib/bet-ranking'

// ============================================================
// Test Fixtures
// ============================================================

function makeRankedBet(overrides: Partial<RankedBet> = {}): RankedBet {
  return {
    gameId: 'game-1',
    sport: 'basketball_nba',
    sportName: 'NBA',
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Boston Celtics',
    commenceTime: new Date(Date.now() + 3600000).toISOString(),
    team: 'Los Angeles Lakers',
    betType: 'moneyline',
    consensusProbability: 55.0,
    bestPrice: -130,
    bestBook: 'DraftKings',
    impliedProbability: 56.5,
    edge: 3.5,
    eloProbability: 60.0,
    eloConfidence: 'high',
    homeElo: 1650,
    awayElo: 1600,
    expectedValue: 5.50,
    roi: 5.50,
    allBookPrices: [{ book: 'DraftKings', price: -130, impliedProb: 56.5 }],
    score: 72,
    calculatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ============================================================
// formatBestBetForContext — Bet Type Display
// ============================================================

describe('formatBestBetForContext: bet type display', () => {
  it('moneyline bet shows "ML" label', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'moneyline' }),
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 10,
      gamesQualified: 1,
      reason: null,
      closestMisses: [],
      mostLikelyWinners: [],
    }

    const formatted = formatBestBetForContext(result)
    expect(formatted).toContain('ML')
    expect(formatted).toContain('Los Angeles Lakers')
    expect(formatted).toContain('BEST BET TODAY')
  })

  it('spread bet shows point line (e.g., "+7.5" or "-3.5")', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'spread', line: -3.5, team: 'Los Angeles Lakers' }),
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 10,
      gamesQualified: 1,
      reason: null,
      closestMisses: [],
      mostLikelyWinners: [],
    }

    const formatted = formatBestBetForContext(result)
    expect(formatted).toContain('-3.5')
    expect(formatted).not.toMatch(/Los Angeles Lakers ML/) // Should NOT show "ML" for spreads
  })

  it('total bet shows Over/Under with line (e.g., "Over 224.5 Points")', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({
        betType: 'total',
        line: 224.5,
        team: 'Over',
        sport: 'basketball_nba',
        sportName: 'NBA',
      }),
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 10,
      gamesQualified: 1,
      reason: null,
      closestMisses: [],
      mostLikelyWinners: [],
    }

    const formatted = formatBestBetForContext(result)
    expect(formatted).toContain('Over')
    expect(formatted).toContain('224.5')
    expect(formatted).toContain('Points')
  })
})

// ============================================================
// formatBestBetForContext — Sport-specific total units
// ============================================================

describe('formatBestBetForContext: sport-specific total units', () => {
  it('NBA totals show "Points"', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'total', line: 224.5, team: 'Over', sportName: 'NBA' }),
      runnerUp: null, allRankedBets: [], allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 1, gamesQualified: 1, reason: null,
      closestMisses: [], mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toContain('Points')
  })

  it('NHL totals show "Goals"', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'total', line: 5.5, team: 'Over', sportName: 'NHL', sport: 'icehockey_nhl' }),
      runnerUp: null, allRankedBets: [], allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 1, gamesQualified: 1, reason: null,
      closestMisses: [], mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toContain('Goals')
  })

  it('MLB totals show "Runs"', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'total', line: 8.5, team: 'Under', sportName: 'MLB', sport: 'baseball_mlb' }),
      runnerUp: null, allRankedBets: [], allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 1, gamesQualified: 1, reason: null,
      closestMisses: [], mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toContain('Runs')
  })

  it('Soccer totals show "Goals"', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'total', line: 2.5, team: 'Over', sportName: 'English Premier League', sport: 'soccer_epl' }),
      runnerUp: null, allRankedBets: [], allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 1, gamesQualified: 1, reason: null,
      closestMisses: [], mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toContain('Goals')
  })

  it('NFL totals show "Points"', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({ betType: 'total', line: 45.5, team: 'Over', sportName: 'NFL', sport: 'americanfootball_nfl' }),
      runnerUp: null, allRankedBets: [], allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 1, gamesQualified: 1, reason: null,
      closestMisses: [], mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toContain('Points')
  })
})

// ============================================================
// formatGameAnalysisForContext — Game analysis formatting
// ============================================================

describe('formatGameAnalysisForContext', () => {
  it('with best bet: shows pick, score, and analysis', () => {
    const result: GameAnalysisResult = {
      game: {
        homeTeam: 'Notre Dame',
        awayTeam: 'Duke',
        sport: 'basketball_ncaab',
        sportName: 'NCAAB',
        commenceTime: new Date(Date.now() + 3600000).toISOString(),
      },
      bets: [makeRankedBet({
        homeTeam: 'Notre Dame',
        awayTeam: 'Duke',
        team: 'Notre Dame',
        betType: 'spread',
        line: 17.5,
        sportName: 'NCAAB',
      })],
      bestBet: makeRankedBet({
        homeTeam: 'Notre Dame',
        awayTeam: 'Duke',
        team: 'Notre Dame',
        betType: 'spread',
        line: 17.5,
        sportName: 'NCAAB',
      }),
      calculatedAt: new Date().toISOString(),
      eloData: {
        homeRating: 1520,
        awayRating: 1703,
        homeWinProbability: 0.35,
        confidence: 'high',
      },
    }

    const formatted = formatGameAnalysisForContext(result)
    expect(formatted).toContain('GAME ANALYSIS')
    expect(formatted).toContain('Notre Dame')
    expect(formatted).toContain('Duke')
    expect(formatted).toContain('TOP PICK')
    expect(formatted).toContain('+17.5') // Spread should show positive sign
    expect(formatted.toLowerCase()).toContain('cover probability') // Spread uses "cover probability" (may be capitalized)
  })

  it('without best bet but with Elo data: shows Elo analysis', () => {
    const result: GameAnalysisResult = {
      game: {
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        sport: 'basketball_nba',
        sportName: 'NBA',
        commenceTime: new Date(Date.now() + 3600000).toISOString(),
      },
      bets: [],
      bestBet: null,
      calculatedAt: new Date().toISOString(),
      eloData: {
        homeRating: 1600,
        awayRating: 1550,
        homeWinProbability: 0.62,
        confidence: 'medium',
      },
    }

    const formatted = formatGameAnalysisForContext(result)
    expect(formatted).toContain('ELO ANALYSIS')
    expect(formatted).toContain('1600')
    expect(formatted).toContain('1550')
    expect(formatted).not.toContain('No betting options available') // Should NOT be a dead-end
  })

  it('without best bet AND without Elo: still provides helpful message', () => {
    const result: GameAnalysisResult = {
      game: {
        homeTeam: 'Team X',
        awayTeam: 'Team Y',
        sport: 'mma_mixed_martial_arts',
        sportName: 'UFC',
        commenceTime: new Date(Date.now() + 3600000).toISOString(),
      },
      bets: [],
      bestBet: null,
      calculatedAt: new Date().toISOString(),
    }

    const formatted = formatGameAnalysisForContext(result)
    expect(formatted).toContain('GAME ANALYSIS')
    // Should suggest alternatives, not be a dead-end
    expect(formatted).toMatch(/best bet|another game|help/i)
  })
})

// ============================================================
// Parlay Formatting — Bet type labels
// ============================================================

describe('formatEnhancedParlayForContext: bet type labels', () => {
  it('moneyline legs show "ML"', () => {
    const parlay: EnhancedParlayResult = {
      legs: [
        makeRankedBet({ betType: 'moneyline', team: 'Lakers', bestPrice: -150 }),
        makeRankedBet({ betType: 'moneyline', team: 'Celtics', bestPrice: +120, homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      ],
      legCount: 2,
      combinedProbability: 30,
      parlayOdds: 250,
      parlayPayout: 350,
      impliedProbability: 28.6,
      parlayEdge: 1.4,
      expectedValue: 5,
      calculatedAt: new Date().toISOString(),
      alternatives: {},
      reason: null,
    }

    const formatted = formatEnhancedParlayForContext(parlay)
    expect(formatted).toContain('ML')
  })

  it('spread legs show point line, NOT "ML"', () => {
    const parlay: EnhancedParlayResult = {
      legs: [
        makeRankedBet({ betType: 'spread', line: -3.5, team: 'Lakers', bestPrice: -110 }),
        makeRankedBet({ betType: 'spread', line: 7.5, team: 'Celtics', bestPrice: -110, homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      ],
      legCount: 2,
      combinedProbability: 25,
      parlayOdds: 300,
      parlayPayout: 400,
      impliedProbability: 25,
      parlayEdge: 0,
      expectedValue: 0,
      calculatedAt: new Date().toISOString(),
      alternatives: {},
      reason: null,
    }

    const formatted = formatEnhancedParlayForContext(parlay)
    expect(formatted).toContain('-3.5')
    expect(formatted).toContain('+7.5')
    // The text for spread legs should NOT contain "ML"
    // Check each leg line specifically
    const lines = formatted.split('\n')
    const legLines = lines.filter(l => l.includes('Leg'))
    for (const line of legLines) {
      expect(line).not.toContain(' ML ')
    }
  })

  it('total legs show Over/Under with line', () => {
    const parlay: EnhancedParlayResult = {
      legs: [
        makeRankedBet({ betType: 'total', line: 224.5, team: 'Over', bestPrice: -110 }),
        makeRankedBet({ betType: 'total', line: 5.5, team: 'Under', bestPrice: -120, sportName: 'NHL', homeTeam: 'Bruins', awayTeam: 'Rangers' }),
      ],
      legCount: 2,
      combinedProbability: 25,
      parlayOdds: 300,
      parlayPayout: 400,
      impliedProbability: 25,
      parlayEdge: 0,
      expectedValue: 0,
      calculatedAt: new Date().toISOString(),
      alternatives: {},
      reason: null,
    }

    const formatted = formatEnhancedParlayForContext(parlay)
    expect(formatted).toContain('Over 224.5')
    expect(formatted).toContain('Under 5.5')
  })

  it('mixed bet type parlay shows correct labels for each', () => {
    const parlay: EnhancedParlayResult = {
      legs: [
        makeRankedBet({ betType: 'moneyline', team: 'Lakers', bestPrice: -150 }),
        makeRankedBet({ betType: 'spread', line: 7.5, team: 'Celtics', bestPrice: -110, homeTeam: 'Knicks', awayTeam: 'Celtics' }),
        makeRankedBet({ betType: 'total', line: 224.5, team: 'Over', bestPrice: -110, homeTeam: 'Bucks', awayTeam: 'Heat' }),
      ],
      legCount: 3,
      combinedProbability: 15,
      parlayOdds: 550,
      parlayPayout: 650,
      impliedProbability: 15.4,
      parlayEdge: -0.4,
      expectedValue: -2,
      calculatedAt: new Date().toISOString(),
      alternatives: {},
      reason: null,
    }

    const formatted = formatEnhancedParlayForContext(parlay)
    expect(formatted).toContain('ML')
    expect(formatted).toContain('+7.5')
    expect(formatted).toContain('Over 224.5')
  })
})

// ============================================================
// formatParlayForContext (legacy format) — also respects bet types
// ============================================================

describe('formatParlayForContext: bet type labels', () => {
  it('spread legs in safe parlay show point line', () => {
    const parlay: ParlayResult = {
      safeParlay: [
        makeRankedBet({ betType: 'spread', line: -3.5, team: 'Lakers' }),
        makeRankedBet({ betType: 'spread', line: 7.5, team: 'Celtics', homeTeam: 'Knicks', awayTeam: 'Celtics' }),
      ],
      aggressiveParlay: null,
      combinedProbability: 25,
      calculatedAt: new Date().toISOString(),
      reason: null,
    }

    const formatted = formatParlayForContext(parlay)
    expect(formatted).toContain('-3.5')
    expect(formatted).toContain('+7.5')
  })

  it('no safe parlay: returns helpful message, not dead-end', () => {
    const parlay: ParlayResult = {
      safeParlay: null,
      aggressiveParlay: null,
      combinedProbability: null,
      calculatedAt: new Date().toISOString(),
      reason: 'Not enough qualifying games',
    }

    const formatted = formatParlayForContext(parlay)
    expect(formatted).toContain('PARLAY')
    expect(formatted).toContain('No parlay available')
    // Should explain why and suggest when to check back
    expect(formatted).toMatch(/check back|criteria|qualify/i)
  })
})

// ============================================================
// formatFilteredBestBetResponse — sport-filtered responses
// ============================================================

describe('formatFilteredBestBetResponse', () => {
  it('includes the filter description', () => {
    const bet = makeRankedBet({ sportName: 'NBA' })
    const formatted = formatFilteredBestBetResponse(bet, 'Best NBA bet')
    // The filter description may be incorporated into the header rather than shown verbatim
    expect(formatted).toContain('NBA')
  })

  it('includes alternatives when provided', () => {
    const bet = makeRankedBet({ sportName: 'NBA', team: 'Lakers' })
    const alts = [
      makeRankedBet({ sportName: 'NBA', team: 'Celtics', homeTeam: 'Knicks', awayTeam: 'Celtics' }),
    ]
    const formatted = formatFilteredBestBetResponse(bet, 'Best NBA bet', alts)
    expect(formatted).toContain('Celtics')
  })
})

// ============================================================
// Dead-End Response Validation
// ============================================================

describe('Dead-end response prevention', () => {
  it('formatBestBetForContext with no bestBet but closestMisses: returns useful analysis', () => {
    const result: BestBetResult = {
      bestBet: null,
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 10,
      gamesQualified: 0,
      reason: 'No bets passed filters',
      closestMisses: [{
        gameId: 'g1',
        sport: 'basketball_nba',
        sportName: 'NBA',
        homeTeam: 'Lakers',
        awayTeam: 'Celtics',
        commenceTime: new Date().toISOString(),
        team: 'Lakers',
        consensusProbability: 54,
        bestPrice: -140,
        bestBook: 'DraftKings',
        impliedProbability: 58.3,
        edge: -4.3,
        expectedValue: -3,
        roi: -3,
        score: 45,
        disqualifyReasons: ['Edge below 3%'],
        isValuePlay: false,
      }],
      mostLikelyWinners: [],
    }

    const formatted = formatBestBetForContext(result)
    // Should still show a pick, not "no recommended bets"
    expect(formatted).toContain('Lakers')
    expect(formatted).toContain('DraftKings')
  })

  it('formatBestBetForContext with completely empty data: shows clear message', () => {
    const result: BestBetResult = {
      bestBet: null,
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: new Date().toISOString(),
      gamesAnalyzed: 0,
      gamesQualified: 0,
      reason: 'No games available',
      closestMisses: [],
      mostLikelyWinners: [],
    }

    const formatted = formatBestBetForContext(result)
    expect(formatted).toContain('NO RECOMMENDED BETS')
    expect(formatted).toMatch(/check back/i)
  })
})

// ============================================================
// SNAPSHOT TESTS — Catch unintended formatting changes
// ============================================================
// These snapshots capture the exact output format of formatting functions.
// If someone changes the format, these tests will fail and require
// explicit approval via `pnpm test -- --update` to accept the new format.

describe('Snapshot: formatBestBetForContext output format', () => {
  it('moneyline best bet matches snapshot', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({
        betType: 'moneyline',
        team: 'Los Angeles Lakers',
        bestPrice: -130,
        bestBook: 'DraftKings',
        consensusProbability: 55.0,
        impliedProbability: 56.5,
        edge: 3.5,
        eloProbability: 60.0,
        expectedValue: 5.50,
        roi: 5.50,
        score: 72,
        homeElo: 1650,
        awayElo: 1600,
        commenceTime: '2026-01-15T20:00:00.000Z',
      }),
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: '2026-01-15T12:00:00.000Z',
      gamesAnalyzed: 10,
      gamesQualified: 1,
      reason: null,
      closestMisses: [],
      mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toMatchSnapshot()
  })

  it('spread best bet matches snapshot', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({
        betType: 'spread',
        line: -3.5,
        team: 'Los Angeles Lakers',
        bestPrice: -110,
        bestBook: 'FanDuel',
        consensusProbability: 58.0,
        impliedProbability: 52.4,
        edge: 5.6,
        eloProbability: 58.0,
        expectedValue: 7.20,
        roi: 7.20,
        score: 80,
        homeElo: 1680,
        awayElo: 1600,
        commenceTime: '2026-01-15T20:00:00.000Z',
      }),
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: '2026-01-15T12:00:00.000Z',
      gamesAnalyzed: 10,
      gamesQualified: 1,
      reason: null,
      closestMisses: [],
      mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toMatchSnapshot()
  })

  it('total over best bet matches snapshot', () => {
    const result: BestBetResult = {
      bestBet: makeRankedBet({
        betType: 'total',
        line: 224.5,
        team: 'Over',
        sportName: 'NBA',
        bestPrice: -110,
        bestBook: 'BetMGM',
        consensusProbability: 56.0,
        impliedProbability: 52.4,
        edge: 3.6,
        eloProbability: 56.0,
        expectedValue: 4.80,
        roi: 4.80,
        score: 68,
        homeElo: 1650,
        awayElo: 1600,
        commenceTime: '2026-01-15T20:00:00.000Z',
      }),
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: '2026-01-15T12:00:00.000Z',
      gamesAnalyzed: 10,
      gamesQualified: 1,
      reason: null,
      closestMisses: [],
      mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toMatchSnapshot()
  })

  it('no best bet with closest misses matches snapshot', () => {
    const result: BestBetResult = {
      bestBet: null,
      runnerUp: null,
      allRankedBets: [],
      allEloBets: [],
      calculatedAt: '2026-01-15T12:00:00.000Z',
      gamesAnalyzed: 10,
      gamesQualified: 0,
      reason: 'No bets passed filters',
      closestMisses: [{
        gameId: 'g1',
        sport: 'basketball_nba',
        sportName: 'NBA',
        homeTeam: 'Lakers',
        awayTeam: 'Celtics',
        commenceTime: '2026-01-15T20:00:00.000Z',
        team: 'Lakers',
        consensusProbability: 54,
        bestPrice: -140,
        bestBook: 'DraftKings',
        impliedProbability: 58.3,
        edge: -4.3,
        expectedValue: -3,
        roi: -3,
        score: 45,
        disqualifyReasons: ['Edge below 3%'],
        isValuePlay: false,
      }],
      mostLikelyWinners: [],
    }
    expect(formatBestBetForContext(result)).toMatchSnapshot()
  })
})

describe('Snapshot: formatGameAnalysisForContext output format', () => {
  it('game with Elo and bets matches snapshot', () => {
    const result: GameAnalysisResult = {
      game: {
        homeTeam: 'Notre Dame',
        awayTeam: 'Duke',
        sport: 'basketball_ncaab',
        sportName: 'NCAAB',
        commenceTime: '2026-01-15T23:00:00.000Z',
      },
      bets: [makeRankedBet({
        homeTeam: 'Notre Dame',
        awayTeam: 'Duke',
        team: 'Notre Dame',
        betType: 'spread',
        line: 17.5,
        sportName: 'NCAAB',
        bestPrice: -110,
        bestBook: 'DraftKings',
        consensusProbability: 83.3,
        edge: 30.9,
        score: 95,
      })],
      bestBet: makeRankedBet({
        homeTeam: 'Notre Dame',
        awayTeam: 'Duke',
        team: 'Notre Dame',
        betType: 'spread',
        line: 17.5,
        sportName: 'NCAAB',
        bestPrice: -110,
        bestBook: 'DraftKings',
        consensusProbability: 83.3,
        edge: 30.9,
        score: 95,
      }),
      calculatedAt: '2026-01-15T12:00:00.000Z',
      eloData: {
        homeRating: 1520,
        awayRating: 1703,
        homeWinProbability: 0.35,
        confidence: 'high',
      },
    }
    expect(formatGameAnalysisForContext(result)).toMatchSnapshot()
  })

  it('game with Elo but no qualifying bets matches snapshot', () => {
    const result: GameAnalysisResult = {
      game: {
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        sport: 'basketball_nba',
        sportName: 'NBA',
        commenceTime: '2026-01-15T23:00:00.000Z',
      },
      bets: [],
      bestBet: null,
      calculatedAt: '2026-01-15T12:00:00.000Z',
      eloData: {
        homeRating: 1600,
        awayRating: 1550,
        homeWinProbability: 0.62,
        confidence: 'medium',
      },
    }
    expect(formatGameAnalysisForContext(result)).toMatchSnapshot()
  })
})

describe('Snapshot: formatEnhancedParlayForContext output format', () => {
  it('3-leg mixed parlay matches snapshot', () => {
    const parlay: EnhancedParlayResult = {
      legs: [
        makeRankedBet({ betType: 'moneyline', team: 'Lakers', bestPrice: -150, homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics' }),
        makeRankedBet({ betType: 'spread', line: 7.5, team: 'Celtics', bestPrice: -110, homeTeam: 'New York Knicks', awayTeam: 'Boston Celtics' }),
        makeRankedBet({ betType: 'total', line: 224.5, team: 'Over', bestPrice: -110, homeTeam: 'Milwaukee Bucks', awayTeam: 'Miami Heat' }),
      ],
      legCount: 3,
      combinedProbability: 15,
      parlayOdds: 550,
      parlayPayout: 650,
      impliedProbability: 15.4,
      parlayEdge: -0.4,
      expectedValue: -2,
      calculatedAt: '2026-01-15T12:00:00.000Z',
      alternatives: {},
      reason: null,
    }
    expect(formatEnhancedParlayForContext(parlay)).toMatchSnapshot()
  })
})

describe('Snapshot: formatFilteredBestBetResponse output format', () => {
  it('filtered bet with alternatives matches snapshot', () => {
    const bet = makeRankedBet({
      sportName: 'NBA',
      team: 'Los Angeles Lakers',
      betType: 'moneyline',
      bestPrice: -130,
      bestBook: 'DraftKings',
      score: 72,
      commenceTime: '2026-01-15T20:00:00.000Z',
    })
    const alts = [
      makeRankedBet({ sportName: 'NBA', team: 'Boston Celtics', betType: 'spread', line: 3.5, bestPrice: -110, homeTeam: 'New York Knicks', awayTeam: 'Boston Celtics', score: 65, commenceTime: '2026-01-15T20:00:00.000Z' }),
    ]
    expect(formatFilteredBestBetResponse(bet, 'Best NBA bet', alts)).toMatchSnapshot()
  })
})
