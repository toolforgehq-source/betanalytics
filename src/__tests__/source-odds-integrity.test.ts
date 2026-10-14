import { describe, expect, it } from 'vitest'
import { convertESPNOddsToGame } from '@/lib/combined-data'
import type { ESPNOdds } from '@/lib/espn'

function espnQuote(): ESPNOdds {
  return {
    gameId:'fixture-1',sport:'baseball',league:'MLB',homeTeam:'Home Team',
    awayTeam:'Away Team',commenceTime:'2026-10-15T20:00:00Z',provider:'DraftKings',
    spread:-1.5,spreadOdds:{home:+140,away:-165},
    overUnder:8.5,overUnderOdds:{over:-110,under:-110},
    moneyline:{home:-150,away:+130},homeFavorite:true,
    gameStatus:'pre',statusDetail:'Scheduled'
  }
}
describe('One-source ESPN prices must never invent a second sportsbook',()=>{
  it('keeps source attribution identical for every market',()=>{
    const g=convertESPNOddsToGame(espnQuote())
    for(const market of [g.moneylines,g.spreads,g.totals]){
      expect(market).toHaveLength(1)
      expect(market[0].bookmaker).toBe('DraftKings')
    }
    expect(g.moneylines[0].outcomes).toHaveLength(2)
    expect(g.moneylines[0].outcomes.map(x=>x.price)).toEqual([-150,+130])
  })
  it('does not invent totals or spreads when ESPN does not provide prices',()=>{
    const g=convertESPNOddsToGame({...espnQuote(),spreadOdds:null,overUnderOdds:null})
    expect(g.spreads).toHaveLength(0)
    expect(g.totals).toHaveLength(0)
  })
})
