import { describe, expect, it } from 'vitest'
import { makeResearchOddsRows } from '@/lib/research-odds-archive'
import type { ESPNOdds } from '@/lib/espn'

const CAPTURE = '2026-10-13T17:00:00Z'
function example(overrides: Partial<ESPNOdds> = {}): ESPNOdds {
  return {
    gameId: 'game-123',
    sport: 'basketball', league: 'NBA',
    homeTeam: 'Home', awayTeam: 'Away', provider: 'Real Quoting Book',
    commenceTime: '2026-10-14T01:00:00Z',
    spread: null, spreadOdds: null, overUnder: null, overUnderOdds: null,
    moneyline: { home: -120, away: 110 }, homeFavorite: true,
    gameStatus: 'pre', statusDetail: '',
    ...overrides,
  }
}
describe('Research odds archiving — no database or remote calls', () => {
  it('captures the real retrieval time and named provider without fabrication', () => {
    const rows = makeResearchOddsRows([example()], CAPTURE)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      gameId: 'game-123', bookmaker: 'Real Quoting Book',
      capturedAt: CAPTURE, checkpoint: '36h', homeAmerican: -120, awayAmerican: 110,
      source: 'espn_feed'
    })
  })
  it('assigns 4h and 1h windows from actual remaining time', () => {
    expect(makeResearchOddsRows([example({ commenceTime: '2026-10-13T20:00:00Z' })], CAPTURE)[0].checkpoint)
      .toBe('4h')
    expect(makeResearchOddsRows([example({ commenceTime: '2026-10-13T17:20:00Z' })], CAPTURE)[0].checkpoint)
      .toBe('1h')
  })
  it('never captures a started or completed event or any post-start quote', () => {
    expect(makeResearchOddsRows([example({ commenceTime: CAPTURE })], CAPTURE)).toEqual([])
    expect(makeResearchOddsRows([example({ gameStatus: 'in' })], CAPTURE)).toEqual([])
    expect(makeResearchOddsRows([example({ gameStatus: 'post' })], CAPTURE)).toEqual([])
  })
  it('never invents a bookmaker or missing price', () => {
    expect(makeResearchOddsRows([example({ provider: '' })], CAPTURE)).toEqual([])
    expect(makeResearchOddsRows([example({ moneyline: null })], CAPTURE)).toEqual([])
    expect(makeResearchOddsRows([example({ moneyline: { home: 0, away: -105 } })], CAPTURE)).toEqual([])
  })
  it('excludes games too far away and leagues with 3-way draws', () => {
    expect(makeResearchOddsRows([example({ commenceTime: '2026-10-20T00:00:00Z' })], CAPTURE)).toEqual([])
    expect(makeResearchOddsRows([example({ league: 'English Premier League' })], CAPTURE)).toEqual([])
  })
  it('does not duplicate the exact same game/book/checkpoint within a feed', () => {
    expect(makeResearchOddsRows([example(), example()], CAPTURE)).toHaveLength(1)
    expect(makeResearchOddsRows([example(), example({ provider: 'Another Book' })], CAPTURE)).toHaveLength(2)
  })
  it('refuses invalid observation timestamps', () => {
    expect(() => makeResearchOddsRows([example()], 'yesterday')).toThrow()
  })
})
