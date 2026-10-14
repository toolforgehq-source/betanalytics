import {describe,it,expect} from 'vitest'
import { selectOfficialPicksForTracking } from '@/lib/official-picks'
import type { BestBetResult, RankedBet } from '@/lib/bet-ranking'

const now = Date.parse('2026-10-14T18:00:00Z')
const bet=(gameId:string,score:number,overrides:Partial<RankedBet>={}):RankedBet => ({
  gameId,team:'Team '+gameId,betType:'moneyline',score,
  confidenceTier:'strong',commenceTime:'2026-10-15T20:00:00Z',
  ...overrides,
} as RankedBet)
const result=(officialPicks:RankedBet[]):BestBetResult=>({
  officialPicks,bestBet:officialPicks[0]??null,runnerUp:officialPicks[1]??null,
  allRankedBets:[],allEloBets:[],calculatedAt:'2026-10-14T18:00:00Z',
  gamesAnalyzed:5,gamesQualified:5,reason:null,closestMisses:[],
  mostLikelyWinners:[]
})
describe('Canonical top three graded exactly as published',()=>{
  it('keeps published order, one pick per game, no more than three',()=>{
    const recos=result([
      bet('A',90,{confidenceTier:'lock'}),
      bet('A',85,{team:'Opposite side of A'}),
      bet('B',80),bet('C',75),bet('D',70),
    ])
    expect(selectOfficialPicksForTracking(recos,now).map(b=>b.gameId)).toEqual(['A','B','C'])
  })
  it('never upgrades a value play or started game into top 3',()=>{
    const recos=result([
      bet('A',100,{confidenceTier:'value'}),
      bet('B',95,{commenceTime:'2026-10-14T17:00:00Z'}),
      bet('C',90,{confidenceTier:'strong'}),
    ])
    expect(selectOfficialPicksForTracking(recos,now).map(b=>b.gameId)).toEqual(['C'])
  })
  it('does not silently replace empty official picks with fallback candidates',()=>{
    const recos=result([])
    recos.bestBet=bet('unqualified',100)
    expect(selectOfficialPicksForTracking(recos,now)).toEqual([])
  })
})
