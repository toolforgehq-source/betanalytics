import { describe, expect, it } from 'vitest'
import { reconstructPregameSeriesStates, evaluatePlayoffSeriesHoldout, type PlayoffBacktestExample } from '@/lib/playoff-backtest'
import type { GameResult } from '@/lib/elo'
const g=(id:string,date:string,num:number,homeScore:number,awayScore:number):GameResult=>({
  gameId:id,date,league:'MLB',homeTeamId:'19',awayTeamId:'8',
  homeTeamName:'Los Angeles Dodgers',awayTeamName:'Milwaukee Brewers',
  homeScore,awayScore,seasonType:3,playoffRound:'NLCS',playoffGameNumber:num,
})
const row=(id:string,seasonYear:number,wins:number,actual:0|1):PlayoffBacktestExample=>({
  gameId:id,league:'MLB',seasonYear,seriesGameNumber:3,homeSeriesWins:wins,
  awaySeriesWins:2-wins,homeEloProbability:0.5,homeWon:actual,
})
describe('Read-only playoff series A/B and lookahead isolation',()=>{
  it('reconstructs pregame Game 3 only from Games 1 and 2 regardless of input order',()=>{
    const samples=[
      g('g3','2026-10-14T22:00:00Z',3,9,1),
      g('g1','2026-10-10T22:00:00Z',1,1,2),
      g('g2','2026-10-12T22:00:00Z',2,4,7),
    ]
    const series = reconstructPregameSeriesStates(samples)
    expect(series.get('g1')).toMatchObject({seriesGameNumber:1,homeSeriesWins:0,awaySeriesWins:0})
    expect(series.get('g2')).toMatchObject({seriesGameNumber:2,homeSeriesWins:0,awaySeriesWins:1})
    expect(series.get('g3')).toMatchObject({seriesGameNumber:3,homeSeriesWins:0,awaySeriesWins:2})
    // Removing any earlier game invalidates a future series-state observation.
    expect(reconstructPregameSeriesStates([samples[0],samples[2]]).has('g3')).toBe(false)
  })

  it('does not leak the result of another game on the same day',()=>{
    const rows=[g('g1','2026-10-10T18:00:00Z',1,8,5),
      g('g2','2026-10-10T23:00:00Z',2,2,7)]
    const s=reconstructPregameSeriesStates(rows)
    expect(s.get('g1')).toMatchObject({homeSeriesWins:0})
    // A same-day Game 2 cannot use Game 1 final in a pregame daily walk-forward.
    expect(s.has('g2')).toBe(false)
  })

  it('declines to fit or activate an unsupported series urgency effect',()=>{
    const rows=Array.from({length:11},(_,i)=>row(String(i),2025,2,1))
    const result=evaluatePlayoffSeriesHoldout(rows,2026)
    expect(result.consideredValid).toBe(false)
    expect(result.training.bestCoefficient).toBeNull()
    expect(result.holdout.seriesCandidate.brier).toBeNull()
    expect(result.activatedInProduction).toBe(false)
  })

  it('never trains on the 2026 holdout when choosing a research coefficient',()=>{
    const train=Array.from({length:100},(_,i)=>row('train'+i,2025,i%2===0?2:0,i%2===0?1:0))
    const holdout=Array.from({length:50},(_,i)=>row('held'+i,2026,i%2===0?2:0,i%2===0?1:0))
    const inverted=holdout.map(x=>({...x,homeWon:(x.homeWon===1?0:1) as 0|1}))
    const a=evaluatePlayoffSeriesHoldout([...train,...holdout])
    const b=evaluatePlayoffSeriesHoldout([...train,...inverted])
    expect(a.consideredValid).toBe(true)
    expect(a.training.bestCoefficient).toBe(b.training.bestCoefficient)
    expect(a.holdout.seriesCandidate.brier).not.toEqual(b.holdout.seriesCandidate.brier)
    expect(a.activatedInProduction).toBe(false)
  })
})
