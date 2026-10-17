/**
 * Research-only historical ingestion. Queries ESPN season/week scoreboards and
 * saves a verified JSON snapshot + report as CI artifacts, NEVER live Neon KV.
 *
 * Usage: node research/backfill-football.mjs [--through=2026-10-17T12:00:00Z]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { runBacktest } from './football-elo.mjs'

const throughArg = process.argv.find(a => a.startsWith('--through='))
const cutoff = Date.parse(throughArg?.split('=')[1] || '2026-10-17T12:00:00Z')
if (!Number.isFinite(cutoff)) throw new Error('Invalid cutoff timestamp')
const ROOT=path.resolve('research-output')
await fs.mkdir(ROOT,{recursive:true})

const specs=[]
for(let year=2022;year<=2026;year++) for(const league of ['NCAAF','NFL']){
  // Only play completed weeks in the partial 2026 season.
  const maxRegular=year===2026?(league==='NCAAF'?8:7):(league==='NCAAF'?16:18)
  for(let week=1;week<=maxRegular;week++) specs.push({league,year,seasonType:2,week})
  if(year<2026) {
    const maxPost=league==='NCAAF'?1:5
    for(let week=1;week<=maxPost;week++) specs.push({league,year,seasonType:3,week})
  }
}
function makeUrl(s) {
  const leaguePath=s.league==='NFL'?'nfl':'college-football'
  const limit=s.league==='NFL'?100:500
  return 'https://site.api.espn.com/apis/site/v2/sports/football/'+leaguePath+
    '/scoreboard?dates='+s.year+'&seasontype='+s.seasonType+'&week='+s.week+
    '&limit='+limit+(s.league==='NCAAF'?'&groups=80':'')
}
async function getJson(spec) {
  const url=makeUrl(spec)
  let problem
  for(let attempt=1;attempt<=4;attempt++){
    try {
      const response=await fetch(url,{headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(40000)})
      if(!response.ok) throw new Error('HTTP '+response.status)
      const json=await response.json()
      if(!Array.isArray(json.events)) throw new Error('Missing ESPN events[]')
      if(json.events.length>=500) throw new Error('Likely truncated ESPN week')
      return {spec,url,events:json.events}
    }catch(error){problem=error;if(attempt!==4) await new Promise(ok=>setTimeout(ok,750*attempt*attempt))}
  }
  throw new Error('Incomplete '+spec.league+' '+spec.year+' week '+spec.week+
    ' season type '+spec.seasonType+': '+String(problem))
}
function parseGame(ev,s,url){
  if(ev.status?.type?.completed!==true || ev.season?.type!==s.seasonType ||
     ev.season?.year!==s.year || !ev.id || !Number.isFinite(Date.parse(ev.date)) ||
     Date.parse(ev.date)>=cutoff) return null
  const comp=ev.competitions?.[0]
  const home=comp?.competitors?.find(z=>z.homeAway==='home')
  const away=comp?.competitors?.find(z=>z.homeAway==='away')
  const hs=Number(home?.score),as=Number(away?.score)
  const hId=home?.team?.id, aId=away?.team?.id
  if(!hId || !aId || String(hId)===String(aId) ||
     home?.score===null || home?.score===undefined ||
     away?.score===null || away?.score===undefined ||
     !Number.isInteger(hs) || !Number.isInteger(as) || hs<0 || as<0) return null
  return {gameId:String(ev.id),league:s.league,seasonYear:s.year,seasonType:s.seasonType,
    week:s.week,date:ev.date,homeTeamId:String(hId),awayTeamId:String(aId),
    homeTeamName:home.team.displayName||home.team.name,
    awayTeamName:away.team.displayName||away.team.name,
    homeScore:hs,awayScore:as,
    neutralSite:comp.neutralSite===true||comp.venue?.neutralSite===true,
    sourceUrl:url}
}

const byWeek=[],games=[],seen=new Map()
const batchSize=3
for(let i=0;i<specs.length;i+=batchSize){
  const batch=specs.slice(i,i+batchSize)
  const result=await Promise.all(batch.map(getJson))
  for(const {spec,url,events} of result){
    let count=0
    for(const event of events){
      const game=parseGame(event,spec,url)
      if(!game)continue
      const key=game.league+':'+game.gameId
      const old=seen.get(key)
      if(old) {
        if(old.homeScore!==game.homeScore || old.awayScore!==game.awayScore ||
           old.homeTeamId!==game.homeTeamId || old.awayTeamId!==game.awayTeamId) {
          throw new Error('Conflicting ESPN records for '+key)
        }
        continue
      }
      seen.set(key,game);games.push(game);count++
    }
    byWeek.push({...spec,source:url,rawEvents:events.length,completed:count})
  }
  if((i+batch.length)%30<batchSize) console.log('Fetched '+Math.min(i+batchSize,specs.length)+
      '/'+specs.length+' weekly scoreboards; valid games '+games.length)
}
// Full-season completeness: gaps must fail rather than silently bias ratings.
for(let year=2022;year<=2025;year++)for(const league of ['NFL','NCAAF']){
  const regular=games.filter(g=>g.league===league&&g.seasonYear===year&&g.seasonType===2)
  const postseason=games.filter(g=>g.league===league&&g.seasonYear===year&&g.seasonType===3)
  if(regular.length<(league==='NFL'?240:740) ||
     postseason.length<(league==='NFL'?12:30)) {
     throw new Error('INCOMPLETE HISTORICAL SEASON '+league+' '+year+
       ' regular '+regular.length+', postseason '+postseason.length)
  }
}
games.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.gameId.localeCompare(b.gameId))
await fs.writeFile(path.join(ROOT,'football-games-2022-2026.json'),
  JSON.stringify({source:'ESPN scoreboard',cutoff:new Date(cutoff).toISOString(),
    dataVersion:'football-elo-research-v1',byWeek,games},null,2))
const reports={}
for(const league of ['NCAAF','NFL']){
  reports[league]=runBacktest(games,league)
  // Do not include individual training-game outcomes in the summary.
  const diagnostics=reports[league].diagnostics
  reports[league].diagnostics={
    holdout2026Count:diagnostics.year2026EligibleEvidence.length,
    holdout2026MinEffective:Math.min(...diagnostics.year2026EligibleEvidence).toFixed(1),
    holdout2026MedianEffective:diagnostics.year2026EligibleEvidence.length?
      diagnostics.year2026EligibleEvidence[Math.floor(diagnostics.year2026EligibleEvidence.length/2)].toFixed(1):'N/A'
  }
}
const summary={cutoff:new Date(cutoff).toISOString(),totalRealGames:games.length,
  seasonCounts:games.reduce((a,g)=>{const k=g.seasonYear+':'+g.league+':'+g.seasonType;a[k]=(a[k]||0)+1;return a},{}),
  conclusions:'No historical sportsbook odds in this data. This evaluates game forecasts, NOT betting ROI or positive EV.',
  modelReports:reports}
await fs.writeFile(path.join(ROOT,'football-backtest-report.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({totalGames:games.length,cutoff:summary.cutoff,
  selection:['NFL','NCAAF'].map(k=>({league:k,
    tunedOn2024:reports[k].winner,
    baseline2025:reports[k].baseline[2025],
    elo2025:reports[k].holdout2025,
    baseline2026:reports[k].baseline[2026],
    elo2026:reports[k].holdout2026}))},null,2))
