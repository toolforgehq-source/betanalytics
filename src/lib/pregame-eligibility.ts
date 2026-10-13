/**
 * Validation gate for model recommendations carried over from old caches.
 *
 * We cannot assume all previously cached picks are eligible: before seasonType
 * was persisted, NBA preseason exhibitions were compared to regular-season Elo.
 * Check ESPN scoreboard season types for missing metadata. When uncertain, hide
 * a candidate rather than treat an unverified exhibition as a "lock".
 */
import { kvGet, isDbConfigured } from '@/lib/pg-kv'

export interface GameToVerify {
  gameId: string
  sport: string
  commenceTime: string
}

const ESPN_LEAGUES: Record<string, string> = {
  basketball_nba: 'basketball/nba',
  icehockey_nhl: 'hockey/nhl',
  americanfootball_nfl: 'football/nfl',
  baseball_mlb: 'baseball/mlb',
  basketball_ncaab: 'basketball/mens-college-basketball',
  americanfootball_ncaaf: 'football/college-football',
}

const verified = new Map<string,{blocked:boolean,until:number}>()

function dateET(iso:string): string {
  const date=new Date(iso)
  if(!Number.isFinite(date.getTime())) return ''
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date)
  const val=(name:string)=>parts.find(x=>x.type===name)?.value||''
  return val('year')+val('month')+val('day')
}

export async function getBlockedPregameGameIds(
  candidates: GameToVerify[],
  fetcher: typeof fetch = fetch
): Promise<Set<string>> {
  const blocked=new Set<string>()
  const unique=new Map<string,GameToVerify>(candidates.filter(x=>x.gameId&&x.sport).map(x=>[String(x.gameId),x] as const))
  if(!unique.size)return blocked
  const cached=new Map<string,number>()
  try {
    if(isDbConfigured()) {
      const raw=await kvGet('espn_odds_cache')
      if(raw){
        const data=JSON.parse(raw) as {games?:Array<{gameId:string,seasonType?:number}>}
        for(const game of data.games||[]) {
          if(game.seasonType===1||game.seasonType===2||game.seasonType===3) {
            cached.set(game.gameId,game.seasonType)
          }
        }
      }
    }
  }catch(e){console.warn('[picks] Could not read ESPN season metadata',e)}

  const unresolved=new Map<string,GameToVerify[]>()
  for(const [id,game] of unique){
    const known=cached.get(id)
    if(known!==undefined) {
      if(known===1)blocked.add(id)
      continue
    }
    const memo=verified.get(id)
    if(memo&&memo.until>Date.now()){
      if(memo.blocked)blocked.add(id)
      continue
    }
    const league=ESPN_LEAGUES[game.sport]
    const date=dateET(game.commenceTime)
    if(!league||!date) {
      blocked.add(id)
      continue
    }
    const key=league+'|'+date
    unresolved.set(key,[...(unresolved.get(key)||[]),game])
    blocked.add(id) // fail closed until verified against live season metadata
  }
  // One ESPN scoreboard per sport/day rather than one network request per bet.
  await Promise.all([...unresolved].map(async([key,games])=>{
    const [league,date]=key.split('|')
    try{
      const response=await fetcher(
        'https://site.api.espn.com/apis/site/v2/sports/'+league+
        '/scoreboard?dates='+date+'&limit=500',
        {cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)}
      )
      if(!response.ok)return
      const data=await response.json() as {
        events?:Array<{id?:string,season?:{type?:number}}>
      }
      if(!Array.isArray(data.events))return
      const seasonById=new Map<string,number | undefined>(data.events
        .filter((x):x is {id:string,season?:{type?:number}}=>typeof x.id==='string')
        .map(x=>[x.id,x.season?.type] as const))
      for(const game of games){
        const season=seasonById.get(game.gameId)
        if(season===2||season===3) {
          blocked.delete(game.gameId)
          verified.set(game.gameId,{blocked:false,until:Date.now()+15*60000})
        }else if(season===1){
          verified.set(game.gameId,{blocked:true,until:Date.now()+15*60000})
        }
      }
    }catch(e){console.warn('[picks] Season verification failed for '+key,e)}
  }))
  return blocked
}
