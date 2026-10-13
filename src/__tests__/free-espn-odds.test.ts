import { describe, expect, it } from 'vitest'
import { convertESPNFeedToOdds, espnOddsToGame } from '@/lib/free-espn-odds'
import type { ESPNOdds } from '@/lib/espn'

const NOW = Date.parse('2026-10-13T19:00:00Z')
const make = (overrides: Partial<ESPNOdds> = {}): ESPNOdds => ({
  gameId: 'id-1', sport: 'hockey', league: 'NHL',
  homeTeam: 'Home Team', awayTeam: 'Away Team',
  commenceTime: '2026-10-14T00:00:00Z',
  provider: 'Draft Kings',
  spread: -1.5, spreadOdds: { home: 225, away: -278 },
  overUnder: 6.5, overUnderOdds: { over: 114, under: -135 },
  moneyline: { home: -115, away: -105 },
  homeFavorite: true, gameStatus: 'pre', statusDetail: '',
  ...overrides,
})

describe('Free ESPN odds adapter', () => {
  it('preserves observed NHL prices and original sportsbook', () => {
    const g = espnOddsToGame(make(), NOW)!
    expect(g.sport).toBe('icehockey_nhl')
    expect(g.moneylines[0].bookmaker).toBe('Draft Kings')
    expect(g.moneylines[0].outcomes).toEqual([
      { name: 'Home Team', price: -115 }, { name: 'Away Team', price: -105 }
    ])
    expect(g.spreads[0].outcomes[0]).toEqual({ name: 'Home Team', price: 225, point: -1.5 })
    expect(g.totals[0].outcomes[1]).toEqual({ name: 'Under', price: -135, point: 6.5 })
  })

  it('does not invent -110 prices or discard valid moneylines when spread juice missing', () => {
    const g = espnOddsToGame(make({ spreadOdds: null, overUnderOdds: null }), NOW)!
    expect(g.spreads).toEqual([])
    expect(g.totals).toEqual([])
    expect(g.moneylines).toHaveLength(1)
  })

  it('does not fabricate a bookmaker, accept bad odds, or include started games', () => {
    expect(espnOddsToGame(make({ provider: '' }), NOW)).toBeNull()
    expect(espnOddsToGame(make({ moneyline: null, spread: null, overUnder: null }), NOW)).toBeNull()
    expect(espnOddsToGame(make({ gameStatus: 'in' }), NOW)).toBeNull()
    expect(espnOddsToGame(make({ commenceTime: new Date(NOW).toISOString() }), NOW)).toBeNull()
    expect(espnOddsToGame(make({ moneyline: { home: 0, away: -105 }, spreadOdds: null, overUnderOdds: null }), NOW)).toBeNull()
  })

  it('never emits a two-way soccer moneyline when draw quote is missing', () => {
    expect(espnOddsToGame(make({
      league: 'English Premier League',
      moneyline: { home: 125, away: 200 }, spread: null, overUnder: null
    }), NOW)).toBeNull()
    expect(espnOddsToGame(make({
      league: 'English Premier League', moneyline: { home: 125, away: 200, draw: 220 },
      spread: null, overUnder: null
    }), NOW)!.moneylines[0].outcomes).toHaveLength(3)
  })

  it('rejects ESPN preseason exhibition odds even when moneylines are quoted', () => {
    expect(espnOddsToGame(make({ seasonType: 1 }), NOW)).toBeNull()
    expect(espnOddsToGame(make({ seasonType: 2 }), NOW)).not.toBeNull()
    expect(espnOddsToGame(make({ seasonType: 3 }), NOW)).not.toBeNull()
  })

  it('marks an empty feed stale, even if upstream did not return an error', () => {
    const r = convertESPNFeedToOdds({
      games: [], lastUpdated: new Date(NOW).toISOString(), error: null
    }, NOW)
    expect(r.isStale).toBe(true)
    expect(r.games).toEqual([])
  })

  it('produces multiple pregame offerings and drops completed ones', () => {
    const r = convertESPNFeedToOdds({
      games: [
        make(), make({ gameId: 'id-2', gameStatus: 'post' }),
        make({ gameId: 'id-3', provider: 'Another Book' })
      ], lastUpdated: new Date(NOW).toISOString(), error: null
    }, NOW)
    expect(r.isStale).toBe(false)
    expect(r.games.map(x => x.id)).toEqual(['id-1', 'id-3'])
  })
})
