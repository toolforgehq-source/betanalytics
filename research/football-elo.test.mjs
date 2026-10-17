import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOOTBALL_PARAMS, winProbability, effectiveSampleSize,
  filterCompetitiveGames, evaluateElo, summarize, runBacktest
} from './football-elo.mjs'

function game(year,week,home,away,scoreH,scoreA,league='NFL') {
  const n=year*100+week
  return {gameId:String(n)+'-'+home+'-'+away,league,seasonYear:year,week,
    date:new Date(Date.UTC(year,8,Math.min(28,week+1))).toISOString(),
    homeTeamId:home,awayTeamId:away,homeTeamName:home,awayTeamName:away,
    homeScore:scoreH,awayScore:scoreA,neutralSite:false,seasonType:2}
}

test('probability respects home advantage and neutral fields',()=>{
  const p=FOOTBALL_PARAMS.NFL
  assert.equal(winProbability(1500,1500,p,true),.5)
  assert.ok(winProbability(1500,1500,p,false)>.5)
  assert.ok(winProbability(1600,1500,p,false)>winProbability(1500,1600,p,false))
})

test('old-season observations remain useful but discounted',()=>{
  const team={seasonCounts:{2024:14,2025:13,2026:3}}
  const v=effectiveSampleSize(team,2026,FOOTBALL_PARAMS.NCAAF)
  assert.ok(v>3)
  assert.ok(v<30)
  assert.ok(effectiveSampleSize(team,2026,{...FOOTBALL_PARAMS.NCAAF,memory:0})===3)
})

test('a season transition regresses rating and resets current games without discarding history',()=>{
  const g=[
    game(2024,1,'A','B',35,7),
    game(2024,2,'A','B',35,7),
    game(2025,1,'A','B',10,14)
  ]
  const withHistory=evaluateElo(g,'NFL',FOOTBALL_PARAMS.NFL)
  const reset=evaluateElo(g,'NFL',{...FOOTBALL_PARAMS.NFL,regression:1,memory:0})
  const finalHistory=withHistory.predictions.at(-1)
  const finalReset=reset.predictions.at(-1)
  assert.ok(finalHistory.homeRating>finalReset.homeRating)
  assert.ok(finalHistory.sample>0)
  assert.equal(finalReset.sample,0)
})

test('a game is scored before updating Elo, including chronological sorting',()=>{
  const games=[game(2024,2,'A','B',14,28),game(2024,1,'A','B',28,14)]
  const res=evaluateElo(games,'NFL',FOOTBALL_PARAMS.NFL)
  assert.equal(res.predictions[0].week,1)
  assert.equal(res.predictions[0].homeRating,1500)
  assert.ok(res.predictions[1].homeRating>1500)
})

test('one-off FCS opponents do not distort FBS training set',()=>{
  const games=[]
  for(let week=1;week<=8;week++){
    games.push(game(2025,week,'FBS_A','FBS_B',17,10,'NCAAF'))
  }
  games.push(game(2025,9,'FBS_A','FCS_X',60,0,'NCAAF'))
  assert.equal(filterCompetitiveGames(games,'NCAAF').length,8)
})

test('incomplete training data cannot silently qualify as a valid backtest',()=>{
  assert.throws(()=>runBacktest([game(2024,1,'A','B',20,10)],'NFL'),/Incomplete 2024/)
})

test('scoring: perfect forecasts beat 50-50 in Brier and log loss',()=>{
  const perfect=summarize([{p:.9,outcome:1,sample:1},{p:.1,outcome:0,sample:2}])
  const random=summarize([{p:.5,outcome:1,sample:1},{p:.5,outcome:0,sample:2}])
  assert.ok(perfect.brier<random.brier)
  assert.ok(perfect.logLoss<random.logLoss)
  assert.equal(perfect.accuracy,1)
})

test('duplicate ESPN event IDs fail closed',()=>{
  const one=game(2024,1,'A','B',21,10)
  assert.throws(()=>evaluateElo([one,one],'NFL',FOOTBALL_PARAMS.NFL),/Duplicate event/)
})
