/**
 * Verified multi-season football history ingestion for offline Elo research.
 *
 * Intentionally READ-ONLY: this module never updates the live Elo KV keys.
 * Consumers must run out-of-time verification before promoting a snapshot.
 */
import { parseCompletedESPNEvents } from './free-elo-bootstrap'
import { type GameResult } from './elo'

export type FootballLeague = 'NFL' | 'NCAAF'
export interface FootballHistoryResult {
  league: FootballLeague
  seasonYear: number
  games: GameResult[]
  regularSeasonGames: number
  postseasonGames: number
  distinctTeams: number
  verifiedCompleteSeason: boolean
}

const REGULAR_WEEKS: Record<FootballLeague, number> = { NFL: 18, NCAAF: 16 }
const POSTSEASON_WEEKS: Record<FootballLeague, number> = { NFL: 5, NCAAF: 1 }

export function footballScoreboardUrl(league: FootballLeague, year: number, type: 2 | 3, week: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Number.isInteger(week) || week < 1 || week > 25) throw new Error('Invalid football scoreboard season/week')
  const path = league === 'NFL' ? 'nfl' : 'college-football'
  return `https://site.api.espn.com/apis/site/v2/sports/football/${path}/scoreboard?week=${week}&seasontype=${type}&dates=${year}&limit=${league === 'NCAAF' ? 500 : 100}${league === 'NCAAF' ? '&groups=80' : ''}`
}

/** Parse only authentic, finished games for the requested season, before asOf. */
export function parseFootballWeek(
  events: unknown[], league: FootballLeague, seasonYear: number, asOf: Date
): GameResult[] {
  if (!Array.isArray(events) || !Number.isFinite(asOf.getTime())) throw new Error('Invalid football history payload')
  const subset = events.filter(event => {
    if (!event || typeof event !== 'object') return false
    const e = event as { season?: { year?: number }; date?: string }
    return e.season?.year === seasonYear && !!e.date &&
      Number.isFinite(Date.parse(e.date)) && Date.parse(e.date) < asOf.getTime()
  })
  // The shared parser also excludes all-star/exhibition opponents (NFL AFC/NFC),
  // games without verified finals, preseason and malformed team identities.
  return parseCompletedESPNEvents(subset, league)
}

/** A *full* past season must pass actual coverage checks before it can inform Elo. */
export function validateFootballSeason(
  league: FootballLeague, year: number, games: GameResult[], asOf: Date
): { complete: boolean; regular: number; postseason: number; teams: number } {
  const complete = asOf.getTime() > Date.UTC(year + 1, 3, 1)
  const regular = games.filter(g => g.seasonType === 2).length
  const postseason = games.filter(g => g.seasonType === 3).length
  const teams = new Set(games.flatMap(g => [g.homeTeamId, g.awayTeamId])).size

  if (complete) {
    // The 32-team NFL plays exactly 272 regular-season games and 13 playoffs.
    // Do NOT count the Pro Bowl as a 14th playoff game.
    if (league === 'NFL' && (regular !== 272 || postseason !== 13 || teams < 32)) {
      throw new Error(`Incomplete NFL ${year}: ${regular} regular, ${postseason} playoffs, ${teams} teams`)
    }
    // FBS scoreboards also include FBS-vs-FCS games; count is not a fixed
    // NFL-like constant. Use a conservative coverage floor, not an exact target.
    if (league === 'NCAAF' && (regular < 800 || postseason < 35 || teams < 130)) {
      throw new Error(`Incomplete NCAAF ${year}: ${regular} regular, ${postseason} bowls, ${teams} teams`)
    }
  }
  return { complete, regular, postseason, teams }
}

export async function fetchVerifiedFootballSeason(
  league: FootballLeague,
  seasonYear: number,
  options: { fetcher?: typeof fetch; asOf?: Date; concurrency?: number } = {}
): Promise<FootballHistoryResult> {
  const fetcher = options.fetcher ?? fetch
  const asOf = options.asOf ?? new Date()
  const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 3))
  const jobs: Array<{ type: 2 | 3; week: number }> = []
  for (let week = 1; week <= REGULAR_WEEKS[league]; week++) jobs.push({ type: 2, week })
  for (let week = 1; week <= POSTSEASON_WEEKS[league]; week++) jobs.push({ type: 3, week })
  const all: GameResult[] = []
  const completedSeason = asOf.getTime() > Date.UTC(seasonYear + 1, 3, 1)
  for (let offset = 0; offset < jobs.length; offset += concurrency) {
    const batch = jobs.slice(offset, offset + concurrency)
    const batches = await Promise.all(batch.map(async job => {
      const url = footballScoreboardUrl(league, seasonYear, job.type, job.week)
      const response = await fetcher(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(25000)
      })
      if (!response.ok) throw new Error(`ESPN history HTTP ${response.status}: ${url}`)
      const payload = await response.json() as { events?: unknown[] }
      if (!Array.isArray(payload.events)) throw new Error(`Missing ESPN events: ${url}`)
      if (payload.events.length >= (league === 'NCAAF' ? 500 : 100)) {
        throw new Error(`Possibly truncated ESPN week: ${url}`)
      }
      const parsed = parseFootballWeek(payload.events, league, seasonYear, asOf)
      // No missing weeks allowed for already-completed seasons, except NFL
      // postseason Week 4 (Pro Bowl only) and college weeks without games.
      if (completedSeason && job.type === 2 && parsed.length === 0 &&
          !(league === 'NCAAF' && job.week >= 15)) {
        throw new Error(`Zero completed regular-season games: ${url}`)
      }
      return parsed
    }))
    batches.forEach(games => all.push(...games))
  }
  // ESPN may repeat a game between period views. Never count a result twice.
  const byGameId = new Map<string, GameResult>()
  for (const game of all) {
    const old = byGameId.get(game.gameId)
    if (old && (old.homeScore !== game.homeScore || old.awayScore !== game.awayScore)) {
      throw new Error(`Conflicting ESPN finals: ${league} ${game.gameId}`)
    }
    byGameId.set(game.gameId, game)
  }
  const games = Array.from(byGameId.values())
    .sort((a, b) => Date.parse(a.date)-Date.parse(b.date) || a.gameId.localeCompare(b.gameId))
  const quality = validateFootballSeason(league, seasonYear, games, asOf)
  return {
    league, seasonYear, games,
    regularSeasonGames: quality.regular,
    postseasonGames: quality.postseason,
    distinctTeams: quality.teams,
    verifiedCompleteSeason: quality.complete
  }
}

export async function fetchVerifiedFootballHistory(
  startYear: number, endYear: number,
  options: { fetcher?: typeof fetch; asOf?: Date } = {}
): Promise<FootballHistoryResult[]> {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) ||
      endYear < startYear || endYear-startYear > 8) throw new Error('Invalid football historical range')
  const result: FootballHistoryResult[] = []
  for (let year = startYear; year <= endYear; year++) {
    for (const league of ['NCAAF','NFL'] as const) {
      result.push(await fetchVerifiedFootballSeason(league,year,options))
    }
  }
  return result
}
