import { describe, it, expect } from 'vitest'
import {
  footballScoreboardUrl, parseFootballWeek, validateFootballSeason,
  fetchVerifiedFootballSeason
} from '@/lib/football-history'
import { replayEloRatings, type GameResult } from '@/lib/elo'

function event(
  id: string, home: string, away: string, date: string,
  seasonYear: number, type: number = 2, completed = true
) {
  return {
    id, date, season: { year: seasonYear, type },
    status: { type: { completed } },
    competitions: [{
      neutralSite: false,
      competitors: [
        { homeAway: 'home', score: '24', team: { id: home, displayName: home } },
        { homeAway: 'away', score: '17', team: { id: away, displayName: away } }
      ]
    }]
  }
}

function mockGame(i: number, league: 'NFL'|'NCAAF', type: 2 | 3): GameResult {
  return {
    gameId: `${league}-${type}-${i}`,
    league,
    homeTeamId: String(i % 32 + 1),
    awayTeamId: String((i+1) % 32 + 1),
    homeTeamName: `Team ${i % 32 + 1}`,
    awayTeamName: `Team ${(i+1)%32+1}`,
    homeScore: 20, awayScore: 10,
    date: type === 2 ? '2025-10-10T20:00:00Z' : '2026-01-10T20:00:00Z',
    seasonType: type
  }
}

describe('Football historical coverage and season continuity', () => {
  it('asks ESPN for full FBS and NFL seasons, not top-25 only', () => {
    expect(footballScoreboardUrl('NCAAF',2025,2,8)).toContain('groups=80')
    expect(footballScoreboardUrl('NCAAF',2025,2,8)).toContain('dates=2025')
    expect(footballScoreboardUrl('NFL',2024,3,5)).toContain('seasontype=3')
    expect(footballScoreboardUrl('NFL',2024,3,5)).not.toContain('groups=')
  })

  it('rejects preseason, wrong season, future games and the Pro Bowl', () => {
    const asOf = new Date('2026-10-17T12:00:00Z')
    const raw = [
      event('a','21','6','2026-09-11T00:00:00Z',2026),
      event('b','AFC','NFC','2026-01-10T00:00:00Z',2026,3),
      event('c','1','2','2026-09-11T00:00:00Z',2025),
      event('d','1','2','2026-09-11T00:00:00Z',2026,1),
      event('e','1','2','2026-10-18T00:00:00Z',2026),
      event('f','1','2','2026-09-11T00:00:00Z',2026,2,false)
    ]
    const parsed = parseFootballWeek(raw,'NFL',2026,asOf)
    expect(parsed.map(g=>g.gameId)).toEqual(['a'])
  })

  it('validates 272 NFL regular games plus 13 real postseason games, not 14 including the Pro Bowl', () => {
    const asOf = new Date('2026-10-17T12:00:00Z')
    const full = [
      ...Array.from({length:272},(_,i)=>mockGame(i,'NFL',2)),
      ...Array.from({length:13},(_,i)=>mockGame(i,'NFL',3))
    ]
    expect(validateFootballSeason('NFL',2025,full,asOf)).toMatchObject({
      complete:true,regular:272,postseason:13
    })
    expect(()=>validateFootballSeason('NFL',2025,[...full,mockGame(14,'NFL',3)],asOf)).toThrow('Incomplete NFL')
  })

  it('does not require a full future season, and refuses empty past regular-season weeks', async () => {
    const asOf = new Date('2026-10-17T12:00:00Z')
    let calls = 0
    const fetcher = (async (input: RequestInfo | URL) => {
      calls++
      const url = new URL(String(input))
      const isFirstWeek = url.searchParams.get('week')==='1' &&
        url.searchParams.get('seasontype')==='2'
      return Response.json({ events: isFirstWeek ?
        [event('valid-2026','21','6','2026-09-11T00:00:00Z',2026)] : []
      })
    }) as typeof fetch
    const out = await fetchVerifiedFootballSeason('NFL',2026,{fetcher,asOf,concurrency:4})
    expect(out.regularSeasonGames).toBe(1)
    expect(out.verifiedCompleteSeason).toBe(false)
    expect(calls).toBe(23)
  })

  it('carries prior rating across NFL seasons but resets current-season game evidence', () => {
    const games: GameResult[]=[
      {...mockGame(0,'NFL',2),gameId:'2025-game',date:'2025-10-10T20:00:00Z'},
      {...mockGame(0,'NFL',2),gameId:'2026-game',date:'2026-09-10T20:00:00Z'}
    ]
    const out=replayEloRatings(games)
    expect(out.newGamesProcessed).toBe(2)
    expect(out.ratings.ratings['NFL:1'].gamesPlayed).toBe(1)
    expect(out.ratings.ratings['NFL:2'].gamesPlayed).toBe(1)
  })
})
