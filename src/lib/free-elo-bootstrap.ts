/**
 * Initial history seeding from ESPN public scoreboard (free).
 * Research-only data ingestion: never fabricate scores; never reset a populated DB.
 *
 * One-time initialization: process a verified complete batch chronologically
 * only when the shared Elo store is empty. Not suitable for historical backtests
 * because results are taken from today's historical scoreboard.
 */
import { isDbConfigured } from '@/lib/pg-kv'
import {
  type GameResult, getEloRatings, updateEloRatings,
  type EloRatings
} from '@/lib/elo'

export type BootstrapLeague = 'NHL' | 'NBA' | 'NFL' | 'MLB'
export const BOOTSTRAP_LEAGUES: readonly BootstrapLeague[] = ['NHL', 'NBA', 'NFL', 'MLB'] as const
const ESPN: Record<BootstrapLeague, string> = {
  NHL: 'hockey/nhl',
  NBA: 'basketball/nba',
  NFL: 'football/nfl',
  MLB: 'baseball/mlb',
}
const MIN_RESULTS: Record<BootstrapLeague, number> = {
  NHL: 200, NBA: 200, NFL: 40, MLB: 500,
}
const MONTH_WINDOW: Record<BootstrapLeague, number> = {
  NHL: 14, NBA: 14, NFL: 14, MLB: 9,
}

export function monthKeysForLeague(league: BootstrapLeague, today: Date): string[] {
  if (!Number.isFinite(today.getTime())) throw new Error('Invalid bootstrap date')
  const keys: string[] = []
  for (let back = MONTH_WINDOW[league] - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1))
    keys.push(d.toISOString().slice(0, 7).replace('-', ''))
  }
  return keys
}

export function parseCompletedESPNEvents(events: unknown[], league: BootstrapLeague): GameResult[] {
  const parsed: GameResult[] = []
  const seen = new Set<string>()
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue
    const event = raw as {
      id?: string, date?: string, season?: {type?: number},
      status?: {type?: {completed?: boolean}},
      competitions?: Array<{ neutralSite?: boolean, venue?: {neutralSite?: boolean},
        competitors?: Array<{homeAway?: string,score?: string | number,id?: string,
          team?:{id?:string,displayName?:string,name?:string}}>}>
    }
    if (!event.status?.type?.completed) continue
    if (event.season?.type !== undefined &&
        event.season.type !== 2 && event.season.type !== 3) continue
    if (!event.id || seen.has(event.id)) continue
    const comp = event.competitions?.[0]
    const h = comp?.competitors?.find(x => x.homeAway === 'home')
    const a = comp?.competitors?.find(x => x.homeAway === 'away')
    if (!h || !a || h.score === undefined || a.score === undefined ||
        h.score === null || a.score === null) continue
    const hs = Number(h.score), as = Number(a.score)
    const hId = h.team?.id ?? h.id, aId = a.team?.id ?? a.id
    if (!Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0 ||
        !hId || !aId || hId === aId ||
        !event.date || !Number.isFinite(Date.parse(event.date))) continue
    const homeName = h.team?.displayName || h.team?.name || ''
    const awayName = a.team?.displayName || a.team?.name || ''
    if (!homeName || !awayName) continue
    seen.add(event.id)
    parsed.push({
      gameId:event.id, league, homeTeamId:hId, awayTeamId:aId,
      homeTeamName:homeName, awayTeamName:awayName,
      homeScore:hs, awayScore:as, date:event.date,
      isNeutralSite:comp?.neutralSite === true || comp?.venue?.neutralSite === true
    })
  }
  return parsed
}

/** Requests are spread across months and capped; failed responses are errors, not zero matches. */
export async function collectFreeEloHistory(
  today: Date, fetcher: typeof fetch = fetch
): Promise<{ games: GameResult[], byLeague: Record<BootstrapLeague,number> }> {
  const combined: GameResult[] = []
  const counts = {} as Record<BootstrapLeague,number>
  for (const league of BOOTSTRAP_LEAGUES) {
    const seen = new Set<string>()
    let leagueCount = 0
    for (const month of monthKeysForLeague(league,today)) {
      const url = 'https://site.api.espn.com/apis/site/v2/sports/' +
        ESPN[league] + '/scoreboard?dates=' + month + '&limit=1000'
      const response = await fetcher(url,{headers:{Accept:'application/json'},cache:'no-store',
        signal:AbortSignal.timeout(12000)})
      if (!response.ok) throw new Error('ESPN history HTTP ' + response.status + ' for '+league+'/'+month)
      const data = await response.json() as {events?: unknown[]}
      if (!Array.isArray(data.events)) throw new Error('Invalid ESPN history for ' + league + '/' + month)
      if (data.events.length >= 1000) throw new Error('Possibly truncated ESPN results for ' + league + '/' + month)
      for (const game of parseCompletedESPNEvents(data.events, league)) {
        if (seen.has(game.gameId)) continue
        seen.add(game.gameId)
        if (new Date(game.date).getTime() > today.getTime()) continue
        combined.push(game)
        leagueCount++
      }
    }
    if (leagueCount < MIN_RESULTS[league]) {
      throw new Error('Incomplete '+league+' history: '+leagueCount+' games (needs '+MIN_RESULTS[league]+')')
    }
    counts[league]=leagueCount
  }
  combined.sort((a,b)=> Date.parse(a.date)-Date.parse(b.date) || a.gameId.localeCompare(b.gameId))
  return {games:combined,byLeague:counts}
}

export async function bootstrapEmptyElo(
  today: Date = new Date(),
  fetcher: typeof fetch = fetch
): Promise<{seeded:boolean,leagueCounts?:Record<BootstrapLeague,number>,teams?:number}> {
  if (!isDbConfigured()) throw new Error('DATABASE_URL not configured')
  const existing = await getEloRatings()
  if (existing && (existing.gamesProcessed > 0 || Object.keys(existing.ratings||{}).length)) {
    return {seeded:false,teams:Object.keys(existing.ratings||{}).length}
  }
  const {games,byLeague}=await collectFreeEloHistory(today,fetcher)
  // Recheck just before writing to avoid stepping on the daily-update job.
  const current = await getEloRatings()
  if (current && (current.gamesProcessed > 0 || Object.keys(current.ratings||{}).length)) {
    return {seeded:false,teams:Object.keys(current.ratings||{}).length}
  }
  const result: EloRatings = await updateEloRatings(games)
  if (!result.gamesProcessed || !Object.keys(result.ratings||{}).length) {
    throw new Error('Failed to persist initialized Elo ratings')
  }
  return {seeded:true,leagueCounts:byLeague,teams:Object.keys(result.ratings).length}
}
