import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchAllESPNOdds } from '@/lib/espn'
import { convertESPNOddsToGame } from '@/lib/combined-data'

afterEach(() => { vi.unstubAllGlobals() })

describe('Real ESPN-shaped playoff scoreboard -> priced model game', () => {
  it('preserves verified NLCS Game 3 series score across ESPN odds and market conversion', async () => {
    const scoreboard = {
      events: [{
        id: '401908032', date: '2026-10-15T00:00Z', season: {type:3},
        status: {type:{state:'pre',completed:false}},
        competitions: [{
          notes:[{type:'event',headline:'NLCS - Game 3'}],
          competitors:[
            {homeAway:'home',team:{id:'19',displayName:'Los Angeles Dodgers'}},
            {homeAway:'away',team:{id:'8',displayName:'Milwaukee Brewers'}}
          ],
          series:{type:'playoff',completed:false,totalCompetitions:7,
            summary:'MIL leads series 2-0',
            competitors:[{id:'19',wins:0,ties:0},{id:'8',wins:2,ties:0}]}
        }]
      }]
    }
    const summary = {
      header:{season:{type:3},competitions:[{
        date:'2026-10-15T00:00Z',status:{type:{state:'pre',shortDetail:'Scheduled'}},
        competitors:[
          {homeAway:'home',team:{displayName:'Los Angeles Dodgers'}},
          {homeAway:'away',team:{displayName:'Milwaukee Brewers'}}
        ]
      }]},
      pickcenter:[{provider:{name:'DraftKings'},spread:-1.5,
        homeTeamOdds:{spreadOdds:+128,moneyLine:-165,favorite:true},
        awayTeamOdds:{spreadOdds:-147,moneyLine:+149,favorite:false},
        overUnder:8.5,overOdds:-110,underOdds:-110}]
    }
    const fetchMock = vi.fn(async (url: string) => ({
      ok:true,
      json:async() => url.includes('summary?event=') ? summary : scoreboard,
    }))
    vi.stubGlobal('fetch',fetchMock)
    const result = await fetchAllESPNOdds(['MLB'])
    expect(result.games).toHaveLength(1)
    const odds = result.games[0]
    expect(odds.seasonType).toBe(3)
    expect(odds.playoffContext).toMatchObject({
      status:'verified',gameNumber:3,round:'NLCS',
      homeSeriesWins:0,awaySeriesWins:2,homeFacingElimination:false
    })
    const game = convertESPNOddsToGame(odds)
    expect(game.playoffContext?.status).toBe('verified')
    expect(game.playoffContext?.awaySeriesWins).toBe(2)
    expect(game.spreads[0].outcomes[1].price).toBe(-147)
    expect(fetchMock).toHaveBeenCalledTimes(3) // two date scoreboards, one odds summary
  })
})
