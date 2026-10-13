import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pg-kv', () => ({
  isDbConfigured: () => false,
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}))
vi.mock('@/lib/espn', () => ({
  fetchAllESPNOdds: vi.fn()
}))

import { fetchAllESPNOdds } from '@/lib/espn'
const mockedFetch = vi.mocked(fetchAllESPNOdds)

const exampleFeed = {
  lastUpdated: '2026-10-13T19:00:00Z', error: null,
  games: [{
    gameId: 'nhl-1', sport: 'hockey', league: 'NHL',
    homeTeam: 'Home', awayTeam: 'Away',
    commenceTime: '2099-10-13T23:00:00Z',
    provider: 'Draft Kings', spread: null, spreadOdds: null,
    overUnder: null, overUnderOdds: null,
    moneyline: { home: -110, away: -110 }, homeFavorite: false,
    gameStatus: 'pre' as const, statusDetail: ''
  }]
}

describe('Free odds primary — no paid key needed', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('ODDS_API_KEY', '')
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('USE_PAID_ODDS_FALLBACK', '')
    mockedFetch.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('returns real ESPN odds from the dashboard service without DATABASE_URL or ODDS_API_KEY', async () => {
    mockedFetch.mockResolvedValue(exampleFeed)
    const { getCurrentOdds } = await import('@/lib/odds')
    const r = await getCurrentOdds()
    expect(r.source).toBe('ESPN')
    expect(r.isStale).toBe(false)
    expect(r.games).toHaveLength(1)
    expect(r.games[0].moneylines[0].bookmaker).toBe('Draft Kings')
    expect(mockedFetch).toHaveBeenCalledWith(['NBA', 'NFL', 'NHL', 'NCAAB', 'NCAAF', 'MLB'])
  })

  it('marks an empty free feed stale and makes no paid requests', async () => {
    mockedFetch.mockResolvedValue({ games: [], lastUpdated: new Date().toISOString(), error: null })
    const oldFetch = global.fetch
    const netSpy = vi.fn().mockRejectedValue(new Error('Unexpected network request'))
    global.fetch = netSpy
    try {
      const { getCurrentOdds } = await import('@/lib/odds')
      const r = await getCurrentOdds()
      expect(r.games).toEqual([])
      expect(r.isStale).toBe(true)
      expect(netSpy).not.toHaveBeenCalled()
    } finally {
      global.fetch = oldFetch
    }
  })
})
