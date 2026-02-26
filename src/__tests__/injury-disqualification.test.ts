/**
 * INJURY DISQUALIFICATION TESTS
 * 
 * Tests the injury disqualification system that prevents recommending
 * bets on teams with severely depleted rosters (3+ players OUT).
 * 
 * This covers:
 * 1. formatGameAnalysisForContext: strips disqualified bets from OTHER OPTIONS
 * 2. formatGameAnalysisForContext: shows "no strong value" advisory when best bet is negative EV
 * 3. formatGameAnalysisForContext: injury report displays correctly
 */
import { describe, it, expect } from 'vitest'
import {
  formatGameAnalysisForContext,
  type GameAnalysisResult,
  type RankedBet,
} from '@/lib/bet-ranking'
import type { InjuryInfo } from '@/lib/elo'

// ============================================================
// Helper: create a mock RankedBet
// ============================================================
function makeBet(overrides: Partial<RankedBet> = {}): RankedBet {
  return {
    gameId: 'test-game-1',
    sport: 'basketball_nba',
    sportName: 'NBA',
    homeTeam: 'Phoenix Suns',
    awayTeam: 'Los Angeles Lakers',
    commenceTime: new Date().toISOString(),
    team: 'Los Angeles Lakers',
    betType: 'moneyline',
    consensusProbability: 60,
    bestPrice: -200,
    bestBook: 'DraftKings',
    impliedProbability: 66.7,
    edge: 5.0,
    expectedValue: 10,
    roi: 10,
    allBookPrices: [{ book: 'DraftKings', price: -200, impliedProb: 66.7 }],
    score: 65,
    calculatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ============================================================
// Helper: create a mock GameAnalysisResult
// ============================================================
function makeResult(overrides: Partial<GameAnalysisResult> = {}): GameAnalysisResult {
  const bestBet = makeBet()
  return {
    game: {
      homeTeam: 'Phoenix Suns',
      awayTeam: 'Los Angeles Lakers',
      sport: 'basketball_nba',
      sportName: 'NBA',
      commenceTime: new Date().toISOString(),
    },
    bets: [bestBet],
    bestBet,
    calculatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ============================================================
// Helper: create injury data for Suns with N players OUT
// ============================================================
function makeSunsInjuries(count: number): InjuryInfo[] {
  const players = [
    'Devin Booker', 'Dillon Brooks', 'Cole Anthony', 
    'Jordan Goodwin', 'Haywood Highsmith', 'Kevin Durant'
  ]
  return players.slice(0, count).map(player => ({
    team: 'Phoenix Suns',
    player,
    status: 'Out',
    importance: 'starter' as const,
  }))
}

// ============================================================
// Fix 1: Disqualified bets stripped from OTHER OPTIONS
// ============================================================
describe('formatGameAnalysisForContext: disqualified bets stripped from OTHER OPTIONS', () => {
  it('does not show disqualified bets in OTHER OPTIONS section', () => {
    const lakersML = makeBet({ team: 'Los Angeles Lakers', betType: 'moneyline', score: 65 })
    const sunsML = makeBet({ team: 'Phoenix Suns', betType: 'moneyline', score: 10, injuryDisqualified: true })
    const sunsSpread = makeBet({ team: 'Phoenix Suns', betType: 'spread', line: 5.5, score: 5, injuryDisqualified: true })
    
    const result = makeResult({
      bets: [lakersML, sunsML, sunsSpread],
      bestBet: lakersML,
      injuries: makeSunsInjuries(5),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    // Should NOT contain Suns ML or Suns spread in the output as recommendable options
    expect(output).not.toContain('Phoenix Suns ML')
    expect(output).not.toContain('Phoenix Suns +5.5')
    // Should mention the alternatives are unavailable due to injuries
    expect(output).toContain('injury-depleted')
  })

  it('shows non-disqualified alternatives in OTHER OPTIONS', () => {
    const lakersML = makeBet({ team: 'Los Angeles Lakers', betType: 'moneyline', score: 65 })
    const lakersSpread = makeBet({ team: 'Los Angeles Lakers', betType: 'spread', line: -5.5, score: 50 })
    const sunsML = makeBet({ team: 'Phoenix Suns', betType: 'moneyline', score: 10, injuryDisqualified: true })
    
    const result = makeResult({
      bets: [lakersML, lakersSpread, sunsML],
      bestBet: lakersML,
      injuries: makeSunsInjuries(5),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    // Lakers spread should be visible as an alternative
    expect(output).toContain('Los Angeles Lakers')
    expect(output).toContain('-5.5')
    // Suns ML should NOT be visible
    expect(output).not.toContain('Phoenix Suns ML')
  })

  it('shows "None available" when all alternatives are disqualified', () => {
    const lakersML = makeBet({ team: 'Los Angeles Lakers', betType: 'moneyline', score: 65 })
    const sunsML = makeBet({ team: 'Phoenix Suns', betType: 'moneyline', score: 10, injuryDisqualified: true })
    const sunsSpread = makeBet({ team: 'Phoenix Suns', betType: 'spread', line: 5.5, score: 5, injuryDisqualified: true })
    const totalOver = makeBet({ team: 'Over', betType: 'total', line: 224.5, score: 3, injuryDisqualified: true })
    
    const result = makeResult({
      bets: [lakersML, sunsML, sunsSpread, totalOver],
      bestBet: lakersML,
      injuries: makeSunsInjuries(5),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).toContain('None available')
    expect(output).toContain('injury-depleted')
  })

  it('shows all bets normally when no injuries', () => {
    const lakersML = makeBet({ team: 'Los Angeles Lakers', betType: 'moneyline', score: 65 })
    const sunsML = makeBet({ team: 'Phoenix Suns', betType: 'moneyline', score: 55, bestPrice: 150 })
    const totalOver = makeBet({ team: 'Over', betType: 'total', line: 224.5, score: 45 })
    
    const result = makeResult({
      bets: [lakersML, sunsML, totalOver],
      bestBet: lakersML,
    })
    
    const output = formatGameAnalysisForContext(result)
    
    // Both alternatives should be visible
    expect(output).toContain('OTHER OPTIONS')
    expect(output).toContain('Phoenix Suns ML')
    expect(output).toContain('Over 224.5')
    // Should NOT mention disqualification
    expect(output).not.toContain('removed')
    expect(output).not.toContain('DISQUALIFIED')
  })
})

// ============================================================
// Fix 2: "No strong value" advisory for negative EV + injuries
// ============================================================
describe('formatGameAnalysisForContext: no-strong-value advisory', () => {
  it('shows advisory when best bet has negative EV and injuries caused disqualifications', () => {
    const lakersML = makeBet({
      team: 'Los Angeles Lakers',
      betType: 'moneyline',
      score: -31,
      edge: -9.4,
      expectedValue: -13.78,
    })
    const sunsML = makeBet({
      team: 'Phoenix Suns',
      betType: 'moneyline',
      score: 0,
      injuryDisqualified: true,
    })
    
    const result = makeResult({
      bets: [lakersML, sunsML],
      bestBet: lakersML,
      injuries: makeSunsInjuries(5),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).toContain('INJURY-IMPACTED GAME')
    expect(output).toContain('NO STRONG VALUE')
    expect(output).toContain('skip')
  })

  it('does NOT show advisory when best bet has positive EV', () => {
    const lakersML = makeBet({
      team: 'Los Angeles Lakers',
      betType: 'moneyline',
      score: 65,
      edge: 5.0,
      expectedValue: 10,
    })
    const sunsML = makeBet({
      team: 'Phoenix Suns',
      betType: 'moneyline',
      score: 0,
      injuryDisqualified: true,
    })
    
    const result = makeResult({
      bets: [lakersML, sunsML],
      bestBet: lakersML,
      injuries: makeSunsInjuries(5),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).not.toContain('INJURY-IMPACTED GAME')
    expect(output).not.toContain('NO STRONG VALUE')
  })

  it('does NOT show advisory when no injuries caused disqualifications', () => {
    const lakersML = makeBet({
      team: 'Los Angeles Lakers',
      betType: 'moneyline',
      score: -31,
      edge: -9.4,
      expectedValue: -13.78,
    })
    
    const result = makeResult({
      bets: [lakersML],
      bestBet: lakersML,
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).not.toContain('INJURY-IMPACTED GAME')
  })
})

// ============================================================
// Fix 3: Injury report displays correctly
// ============================================================
describe('formatGameAnalysisForContext: injury report', () => {
  it('shows SEVERE label for 4+ players OUT', () => {
    const lakersML = makeBet()
    const result = makeResult({
      bets: [lakersML],
      bestBet: lakersML,
      injuries: makeSunsInjuries(5),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).toContain('INJURY REPORT')
    expect(output).toContain('SEVERE')
    expect(output).toContain('Devin Booker')
  })

  it('shows SIGNIFICANT label for 2-3 players OUT', () => {
    const lakersML = makeBet()
    const result = makeResult({
      bets: [lakersML],
      bestBet: lakersML,
      injuries: makeSunsInjuries(2),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).toContain('INJURY REPORT')
    expect(output).toContain('SIGNIFICANT')
  })

  it('shows NOTABLE label for 1 player OUT', () => {
    const lakersML = makeBet()
    const result = makeResult({
      bets: [lakersML],
      bestBet: lakersML,
      injuries: makeSunsInjuries(1),
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).toContain('INJURY REPORT')
    expect(output).toContain('NOTABLE')
  })

  it('does not show injury report when no injuries', () => {
    const lakersML = makeBet()
    const result = makeResult({
      bets: [lakersML],
      bestBet: lakersML,
    })
    
    const output = formatGameAnalysisForContext(result)
    
    expect(output).not.toContain('INJURY REPORT')
  })
})
