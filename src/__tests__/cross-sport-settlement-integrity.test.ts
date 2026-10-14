import { describe, expect, it } from 'vitest'
import {
  calculateWinProbability, calculateSpreadCoverProbability,
  calculateExpectedMargin, calculateTotalProbability
} from '@/lib/elo'
import { calculateExpectedValue } from '@/lib/bet-ranking'
import { modelSettlement, blendSpreadWithPush, isFreshPregameQuote,
  validatedSituationalShift } from '@/lib/model-policy'
import { getSpreadSettlementProbabilities } from '@/lib/spread-settlement'
import { isEligibleForTopPicks } from '@/lib/enforce-picks'

const leagues=['MLB','NBA','NHL','NFL','NCAAF','NCAAB'] as const
describe('Elo-first probabilities across ALL supported major sports',()=>{
  for (const league of leagues) {
    it(`${league} Elo home and away win probabilities sum to one`,()=>{
      const home=calculateWinProbability(1550,1480,league)
      expect(home).toBeGreaterThan(0)
      expect(home).toBeLessThan(1)
      expect(home+(1-home)).toBeCloseTo(1,12)
      expect(calculateExpectedMargin(1500,1500,league)).toBeGreaterThan(0)
    })
    it(`${league} opposite whole-number spread markets account for push symmetrically`,()=>{
      const h=calculateSpreadCoverProbability(1540,1500,-3,league,true)
      const a=calculateSpreadCoverProbability(1540,1500,-3,league,false)
      expect(h.pushProbability).toBeGreaterThan(0)
      expect(h.pushProbability).toBeCloseTo(a.pushProbability,9)
      expect(h.probability+a.probability+h.pushProbability).toBeCloseTo(1,9)
      expect(h.lossProbability).toBeCloseTo(a.probability,9)
    })
    it(`${league} half-point spreads never push and money stays coherent`,()=>{
      const h=calculateSpreadCoverProbability(1540,1500,-1.5,league,true)
      const a=calculateSpreadCoverProbability(1540,1500,-1.5,league,false)
      expect(h.pushProbability).toBe(0)
      expect(h.probability+a.probability).toBeCloseTo(1,9)
    })
    it(`${league} model totals output legitimate probabilities`,()=>{
      for(const side of [true,false]){
        const p=calculateTotalProbability(1520,1480,league==='NBA'?224.5:league==='NCAAB'?145.5:
          league==='NFL'?44.5:league==='NCAAF'?54.5:league==='MLB'?8.5:6.5,league,side)
        expect(p.probability).toBeGreaterThan(0)
        expect(p.probability).toBeLessThan(1)
      }
    })
  }
})
describe('Strict bookmaker settlement and Elo probability integrity',()=>{
  it('MLB underdog +1.5 can lose by one run and still cover (no push)',()=>{
    const h=getSpreadSettlementProbabilities(0.25,2.5,-1.5,false)
    expect(h.push).toBe(0)
    expect(h.win+h.lose).toBeCloseTo(1,10)
  })
  it('exact NFL three-point margin pushes an NFL -3 spread',()=>{
    const h=getSpreadSettlementProbabilities(3,13.5,-3,true)
    expect(h.push).toBeGreaterThan(0)
    const conditional=h.win/(1-h.push)
    expect(blendSpreadWithPush(h.win,h.push,conditional,1)).toBeCloseTo(h.win,10)
    expect(blendSpreadWithPush(h.win,h.push,0.54,0)).toBeCloseTo(0.54*(1-h.push),10)
  })
  it('push-aware breakeven and EV return the stake on a refund',()=>{
    expect(modelSettlement(0.55,0.1,-110).lose).toBeCloseTo(0.35,10)
    expect(calculateExpectedValue(-110,0.55,0.1)).toBeCloseTo(
      (0.55*100/1.1-0.35*100),7)
    expect(modelSettlement(0,1,-110).returnPerUnit).toBe(0)
  })
  it('whole-number spread without a push model is ineligible for official top three',()=>{
    const candidate={
      sport:'americanfootball_nfl', sportName:'NFL',
      betType:'spread',line:-3, bestPrice:-110,
      eloProbability:57,homeElo:1550,awayElo:1500,eloConfidence:'high',
      commenceTime:'2026-12-01T20:00:00Z'
    }
    expect(isEligibleForTopPicks(candidate)).toBe(false)
    expect(isEligibleForTopPicks({...candidate,pushProbability:0.035})).toBe(true)
  })
  it('hypothetical rivalry, revenge, rest and desperation bonuses never affect Elo',()=>{
    for(const league of leagues)
      expect(validatedSituationalShift(league,'moneyline',0.15)).toBe(0)
  })
  it('refuses stale, invalid or already-started market snapshots',()=>{
    const now=Date.parse('2026-10-14T19:00:00Z')
    expect(isFreshPregameQuote('2026-10-14T18:40:00Z','2026-10-15T00:00:00Z',now)).toBe(true)
    expect(isFreshPregameQuote('2026-10-14T17:00:00Z','2026-10-15T00:00:00Z',now)).toBe(false)
    expect(isFreshPregameQuote('2026-10-14T18:40:00Z','2026-10-14T17:00:00Z',now)).toBe(false)
    expect(isFreshPregameQuote(undefined,'2026-10-15T00:00:00Z',now)).toBe(false)
  })
})
