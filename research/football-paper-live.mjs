/**
 * Paper-only prospective football experiment.
 *
 * This never changes production picks/Elo, never places bets, and never
 * backfills quotes after kickoff. Publishes immutable first-seen predictions
 * and separately time-stamped DraftKings prices sourced from ESPN pickcenter.
 */
import fs from 'node:fs/promises'
import { evaluateElo, winProbability, effectiveSampleSize, FOOTBALL_PARAMS } from './football-elo.mjs'

const P = {
  NFL: {...FOOTBALL_PARAMS.NFL, regression: 0.20, memory: 0.80},
  NCAAF: {...FOOTBALL_PARAMS.NCAAF, regression: 0.35, memory: 0.65}
}
const NOW = Date.now()
const OUTPUT = process.env.PAPER_OUTPUT || '/tmp/football-paper-latest.json'
const HISTORY = process.env.PAPER_HISTORY || '/tmp/football-history.json'
const PREVIOUS = process.env.PAPER_PREVIOUS || '/tmp/football-paper-previous.json'

const validPrice = n => Number.isInteger(n) && (n >= 100 || n <= -100)
const payout = odds => odds > 0 ? odds / 100 : 100 / -odds
const breakeven = odds => 1 / (1 + payout(odds))
const profit = (odds, won) => won ? payout(odds) : -1
const etDate = value => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
const isPregame = e => e?.status?.type?.state === 'pre' &&
  Date.parse(e.date) > NOW + 5 * 60_000

function urlFor(league,week) {
  return 'https://site.api.espn.com/apis/site/v2/sports/football/' +
    (league==='NFL'?'nfl':'college-football') +
    '/scoreboard?dates=2026&seasontype=2&week=' + week +
    '&limit=' + (league==='NFL'?100:500) + (league==='NCAAF'?'&groups=80':'')
}
async function fetchJson(url) {
  let last
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const res=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)})
      if (!res.ok) throw new Error(url+' HTTP '+res.status)
      return await res.json()
    } catch(e){last=e;await new Promise(ok=>setTimeout(ok,300*(attempt+1)))}
  }
  throw new Error(String(last))
}
function parseFinal(e,league,week) {
  if(!e.status?.type?.completed || e.season?.type!==2 || e.season?.year!==2026 ||
    Date.parse(e.date)>NOW) return null
  const c=e.competitions?.[0]
  const home=c?.competitors?.find(z=>z.homeAway==='home')
  const away=c?.competitors?.find(z=>z.homeAway==='away')
  const hs=Number(home?.score), as=Number(away?.score)
  if(!e.id||!home?.team?.id||!away?.team?.id||
    home.team.id===away.team.id||
    home?.score===undefined||away?.score===undefined||
    !Number.isInteger(hs)||!Number.isInteger(as)) return null
  return {gameId:String(e.id),league,seasonYear:2026,seasonType:2,
    week,date:e.date,homeTeamId:String(home.team.id),
    homeTeamName:home.team.displayName,awayTeamId:String(away.team.id),
    awayTeamName:away.team.displayName,homeScore:hs,awayScore:as,
    neutralSite:c.neutralSite===true||c.venue?.neutralSite===true}
}
function getFixture(e,league) {
  const c=e.competitions?.[0]
  const home=c?.competitors?.find(z=>z.homeAway==='home')
  const away=c?.competitors?.find(z=>z.homeAway==='away')
  if(!e.id||!home?.team?.id||!away?.team?.id||!home.team.displayName||!away.team.displayName)
    return null
  return {gameId:String(e.id),league,season:2026,
    date:e.date,homeTeamId:String(home.team.id),awayTeamId:String(away.team.id),
    home:home.team.displayName,away:away.team.displayName,
    neutral:!!(c.neutralSite||c.venue?.neutralSite)}
}
function teamForSeason(team,params){
  if(!team) return null
  let rating=team.rating,year=team.lastSeason
  while(year<2026){rating=1500+(rating-1500)*(1-params.regression);year++}
  return rating
}
function forecast(f,ratings) {
  const params=P[f.league]
  const h=ratings.get(f.league+':'+f.homeTeamId)
  const a=ratings.get(f.league+':'+f.awayTeamId)
  if(!h||!a) return null
  const homeRating=teamForSeason(h,params),awayRating=teamForSeason(a,params)
  const evidence=Math.min(effectiveSampleSize(h,2026,params),
    effectiveSampleSize(a,2026,params))
  if(!Number.isFinite(homeRating)||!Number.isFinite(awayRating)) return null
  return {
    gameId:f.gameId,league:f.league,gameDate:etDate(f.date),kickoff:f.date,
    home:f.home,away:f.away,homeTeamId:f.homeTeamId,awayTeamId:f.awayTeamId,
    homeRating:Math.round(homeRating),awayRating:Math.round(awayRating),
    effectiveGames:evidence,homeWin:winProbability(homeRating,awayRating,params,f.neutral),
    capturedAt:new Date(NOW).toISOString(),
    quoteCapturedAt:null,bookmaker:null,homePrice:null,awayPrice:null,
    paperSelection:null,result:null,
    source:'ESPN schedule, independently replayed multi-season Elo'
  }
}
async function quote(f){
  const url='https://site.web.api.espn.com/apis/site/v2/sports/football/' +
    (f.league==='NFL'?'nfl':'college-football') + '/summary?event='+encodeURIComponent(f.gameId)
  const x=await fetchJson(url)
  const dk=(x.pickcenter||[]).find(z=>z.provider?.name==='DraftKings')
  const h=dk?.homeTeamOdds?.moneyLine,a=dk?.awayTeamOdds?.moneyLine
  if(!validPrice(h)||!validPrice(a))return null
  if(String(dk.homeTeamOdds?.teamId)!==f.homeTeamId||
    String(dk.awayTeamOdds?.teamId)!==f.awayTeamId) return null
  return {homePrice:h,awayPrice:a,bookmaker:'DraftKings (via ESPN)',
    quoteSource:url}
}
export function paperCandidate(rec) {
  if(!validPrice(rec.homePrice)||!validPrice(rec.awayPrice))return null
  const sides=[
    {side:'home',team:rec.home,prob:rec.homeWin,price:rec.homePrice},
    {side:'away',team:rec.away,prob:1-rec.homeWin,price:rec.awayPrice}
  ].map(x=>({...x,edgePct:(x.prob-breakeven(x.price))*100,
    expectedReturn:x.prob*payout(x.price)-(1-x.prob)}))
  const best=sides.sort((a,b)=>b.expectedReturn-a.expectedReturn)[0]
  if(rec.effectiveGames<6 || best.edgePct<3 || best.edgePct>8 ||
      best.price < -169 || best.price>400 || best.prob<.20||best.prob>.78) return null
  return {side:best.side,team:best.team,price:best.price,
    probability:+best.prob.toFixed(4),edgePct:+best.edgePct.toFixed(2),
    expectedReturn:+best.expectedReturn.toFixed(4),
    selectedAt:new Date(NOW).toISOString(),stakeUnits:1,
    label:'RESEARCH PAPER SELECTION — not an official bet'}
}
function settle(rec,result){
  if(!result||rec.result)return
  const homeWon=result.homeScore>result.awayScore
  const draw=result.homeScore===result.awayScore
  const selected=rec.paperSelection
  rec.result={
    finalizedAt:new Date(NOW).toISOString(),
    homeScore:result.homeScore,awayScore:result.awayScore,
    correctWinner:draw?null:(rec.homeWin>=.5)===homeWon,
    paperUnits:selected ? (draw ? 0 :
      profit(selected.price,selected.side==='home'?homeWon:!homeWon)) : null
  }
}
const historical=JSON.parse(await fs.readFile(HISTORY,'utf8'))
const historicGames=Array.isArray(historical)?historical:historical.games
if(!Array.isArray(historicGames)||historicGames.length<4500)throw new Error('Full multi-season history unavailable')
let previous={records:[]}
try{previous=JSON.parse(await fs.readFile(PREVIOUS,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
if(previous.records && !Array.isArray(previous.records))throw new Error('Invalid prior paper ledger')
const records=new Map((previous.records||[]).map(g=>[g.league+':'+g.gameId,g]))
const weekly=await Promise.all([
  ...[7,8,9].map(w=>({league:'NCAAF',week:w})),
  ...[6,7,8].map(w=>({league:'NFL',week:w}))
].map(async spec=>({...spec,raw:await fetchJson(urlFor(spec.league,spec.week))})))
const fixtureMap=new Map(), finalMap=new Map()
for(const b of weekly)for(const e of b.raw.events||[]) {
  const f=getFixture(e,b.league)
  if(!f||e.season?.type!==2||e.season?.year!==2026)continue
  if(isPregame(e))fixtureMap.set(b.league+':'+f.gameId,f)
  const done=parseFinal(e,b.league,b.week)
  if(done)finalMap.set(b.league+':'+f.gameId,done)
}
const gamesById=new Map(historicGames.map(g=>[g.league+':'+g.gameId,g]))
for(const [key,g] of finalMap){
  const old=gamesById.get(key)
  if(old&&(old.homeScore!==g.homeScore||old.awayScore!==g.awayScore))
    throw new Error('Score changed for existing historical game '+key)
  gamesById.set(key,g)
}
const ratings={}
for(const league of ['NCAAF','NFL'])
  ratings[league]=evaluateElo([...gamesById.values()],league,P[league]).ratings

let newRecords=0,quotes=0,quoteFailures=0,missingRatings=0
for(const f of fixtureMap.values()){
  const key=f.league+':'+f.gameId
  let record=records.get(key)
  if(!record){
    record=forecast(f,ratings[f.league])
    if(!record){missingRatings++;continue}
    records.set(key,record)
    newRecords++
  }
}
const withoutQuote=[...fixtureMap.values()].filter(f=>{
  const g=records.get(f.league+':'+f.gameId)
  return g&&!g.quoteCapturedAt
})
// Fetch independent sportsbook quotes with bounded concurrency.
for(let i=0;i<withoutQuote.length;i+=6){
  const batch=withoutQuote.slice(i,i+6)
  const results=await Promise.all(batch.map(async f=> {
    try{return await quote(f)}catch(e){return null}
  }))
  for(let j=0;j<batch.length;j++) {
    const f=batch[j],rec=records.get(f.league+':'+f.gameId),q=results[j]
    if(q && Date.parse(rec.kickoff)>NOW+5*60_000) {
      rec.homePrice=q.homePrice;rec.awayPrice=q.awayPrice
      rec.bookmaker=q.bookmaker;rec.quoteSource=q.quoteSource
      rec.quoteCapturedAt=new Date(NOW).toISOString();quotes++
    }else quoteFailures++
  }
}
for(const [key,done] of finalMap)if(records.has(key))settle(records.get(key),done)

// Freeze at most THREE actual paper-moneyline selections per ET day,
// and never retroactively swap losing selections for newly discovered edges.
const toRank=[...records.values()].filter(g=>
  g.quoteCapturedAt&&!g.paperSelection&&!g.result&&
  Date.parse(g.kickoff)>NOW+5*60_000)
  .map(g=>({g,choice:paperCandidate(g)}))
  .filter(z=>z.choice).sort((a,b)=>b.choice.expectedReturn-a.choice.expectedReturn)
for(const {g,choice} of toRank) {
  const already=[...records.values()].filter(x=>x.gameDate===g.gameDate&&x.paperSelection).length
  if(already>=3) continue
  g.paperSelection=choice
}
const all=[...records.values()].sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff))
const settled=all.filter(g=>g.paperSelection&&g.result)
const paperUnits=settled.reduce((s,g)=>s+g.result.paperUnits,0)
const paperWins=settled.filter(g=>g.result.paperUnits>0).length
const upcoming=all.filter(g=>Date.parse(g.kickoff)>NOW&&!g.result)
const status={
  schema:1,mode:'PAPER_ONLY',model:'football-multiseason-v1',
  generatedAt:new Date(NOW).toISOString(),snapshotIsImmutable:true,
  disclaimer:'Research only. Odds are captured from ESPN and are not guaranteed executable. Game-winner Elo is not a validated profitable betting model.',
  source:'ESPN event scoreboard and ESPN DraftKings pickcenter',
  backfillHistoryGames:gamesById.size,
  count:{allForecasts:all.length,upcoming:upcoming.length,
    upcomingWithOdds:upcoming.filter(g=>g.quoteCapturedAt).length,
    selected:all.filter(g=>g.paperSelection).length,
    settledPaper: settled.length,paperWins,paperUnits:+paperUnits.toFixed(3),
    missingRatings,quotesCaptured:quotes,quoteFailures,newRecords},
  upcoming:upcoming.slice(0,140),
  records:all
}
await fs.writeFile(OUTPUT,JSON.stringify(status,null,2))
console.log(JSON.stringify({generatedAt:status.generatedAt,counts:status.count,
  selectedUpcoming:upcoming.filter(g=>g.paperSelection).map(g=>({
    game:g.away+' @ '+g.home,side:g.paperSelection.team,price:g.paperSelection.price,edge:g.paperSelection.edgePct
  }))},null,2))
