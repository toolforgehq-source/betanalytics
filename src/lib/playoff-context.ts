/**
 * Playoff Intelligence v1 — verified pregame series situation.
 *
 * ESPN scoreboards expose league season type, round/game number, series
 * totalCompetitions and current series wins keyed by *team ID*.
 *
 * DO NOT turn "must win" into an arbitrary win-probability bonus. Those
 * adjustments are 0 until a point-in-time, out-of-sample study shows value.
 * Unknown or inconsistent context cannot produce a playoff Lock/Strong.
 */
export type SeriesLeague = 'MLB' | 'NBA' | 'NHL'

export interface PlayoffContext {
  seasonType: 3
  status: 'verified' | 'unverified'
  source: 'espn_scoreboard'
  round: string | null
  gameNumber: number | null
  bestOf: number | null
  winsNeeded: number | null
  homeSeriesWins: number | null
  awaySeriesWins: number | null
  homeFacingElimination: boolean
  awayFacingElimination: boolean
  /** The series can end after this game if this team wins. */
  homeCanClinch: boolean
  awayCanClinch: boolean
  summary: string
  reason?: string
  /** No made-up clutch/elimination probability adjustments. */
  probabilityAdjustmentPct: 0
}

type RawCompetitor = { homeAway?: string; team?: { id?: string; displayName?: string } }
type RawSeriesCompetitor = { id?: string; wins?: number; ties?: number }
interface RawSeriesEvent {
  id?: string
  season?: { type?: number | string }
  status?: { type?: { state?: string; completed?: boolean } }
  competitions?: Array<{
    notes?: Array<{ type?: string; headline?: string }>
    competitors?: RawCompetitor[]
    series?: {
      type?: string; completed?: boolean; totalCompetitions?: number
      summary?: string; competitors?: RawSeriesCompetitor[]
    }
  }>
}

export function isSeriesLeague(league: string): league is SeriesLeague {
  return league === 'MLB' || league === 'NBA' || league === 'NHL'
}

/** JSON-safe, purely structural parser: never infer a score from a matchup name. */
export function parseESPNPlayoffContext(event: RawSeriesEvent, league: string): PlayoffContext | null {
  if (!isSeriesLeague(league) || Number(event?.season?.type) !== 3) return null
  const competition = event?.competitions?.[0]
  const title = competition?.notes?.find(n => /\bGame\s*\d+\b/i.test(n.headline || ''))?.headline || ''
  const gameMatch = title.match(/^(.*?)\s*-\s*Game\s+(\d+)\b/i)
  const round = gameMatch?.[1]?.trim() || null
  const gameNumber = gameMatch ? Number(gameMatch[2]) : null
  const series = competition?.series
  const homeId = competition?.competitors?.find(c => c.homeAway === 'home')?.team?.id
  const awayId = competition?.competitors?.find(c => c.homeAway === 'away')?.team?.id
  const bestOf = series?.totalCompetitions ?? null
  const homeRows = series?.competitors?.filter(c => c.id === homeId) || []
  const awayRows = series?.competitors?.filter(c => c.id === awayId) || []
  const homeWins = homeRows.length === 1 ? homeRows[0].wins : null
  const awayWins = awayRows.length === 1 ? awayRows[0].wins : null
  const winsNeeded = bestOf !== null ? Math.floor(bestOf / 2) + 1 : null
  const summary = series?.summary || ''
  const summaryMatch = summary.match(/(\d+)\s*-\s*(\d+)/)
  const summaryMatchesWins = !summaryMatch || (
    [Number(summaryMatch[1]), Number(summaryMatch[2])].sort((a,b)=>a-b).join(':') ===
    [homeWins, awayWins].sort((a,b)=>Number(a)-Number(b)).join(':') &&
    (!/\btied\b/i.test(summary) || homeWins === awayWins)
  )

  const complete = event?.status?.type?.completed === true ||
    event?.status?.type?.state === 'post'
  const pregame = event?.status?.type?.state === 'pre' && !complete
  const valid = Boolean(
    pregame && summaryMatchesWins && series?.type === 'playoff' && series.completed === false &&
    typeof homeId === 'string' && homeId.length > 0 &&
    typeof awayId === 'string' && awayId.length > 0 && homeId !== awayId &&
    Number.isInteger(gameNumber) && gameNumber! > 0 &&
    Number.isInteger(bestOf) && bestOf! >= 3 && bestOf! <= 7 && bestOf! % 2 === 1 &&
    Number.isInteger(homeWins) && homeWins! >= 0 &&
    Number.isInteger(awayWins) && awayWins! >= 0 &&
    homeWins! < winsNeeded! && awayWins! < winsNeeded! &&
    homeWins! + awayWins! === gameNumber! - 1
  )

  const safeWins = valid ? (homeWins as number) : null
  const safeAwayWins = valid ? (awayWins as number) : null
  const homeFacingElimination = valid && safeAwayWins === winsNeeded! - 1
  const awayFacingElimination = valid && safeWins === winsNeeded! - 1
  const displaySummary = valid
    ? `${round} Game ${gameNumber} · ${homeWins}-${awayWins} (home-away) · best of ${bestOf}`
    : 'Playoff series score unavailable or inconsistent; do not promote as a high-confidence pick'

  return {
    seasonType: 3,
    status: valid ? 'verified' : 'unverified',
    source: 'espn_scoreboard',
    round: valid ? round : null,
    gameNumber: valid ? gameNumber : null,
    bestOf: valid ? bestOf : null,
    winsNeeded: valid ? winsNeeded : null,
    homeSeriesWins: safeWins,
    awaySeriesWins: safeAwayWins,
    homeFacingElimination: Boolean(homeFacingElimination),
    awayFacingElimination: Boolean(awayFacingElimination),
    homeCanClinch: Boolean(valid && safeWins === winsNeeded! - 1),
    awayCanClinch: Boolean(valid && safeAwayWins === winsNeeded! - 1),
    summary:displaySummary,
    reason: valid ? undefined : 'Pregame series data failed game number, team-ID, status, or series-win validation',
    probabilityAdjustmentPct: 0,
  }
}

/** Record available context, not unsupported "must win = +2%" adjustments. */
export function formatPlayoffContext(context: PlayoffContext, homeTeam: string, awayTeam: string): string {
  if (context.status !== 'verified') return 'Postseason game — verified series context unavailable'
  const parts = [`${context.round} Game ${context.gameNumber}`,
    `Series: ${awayTeam} ${context.awaySeriesWins}, ${homeTeam} ${context.homeSeriesWins} (best of ${context.bestOf})`]
  if (context.homeFacingElimination) parts.push(`${homeTeam} faces elimination`)
  if (context.awayFacingElimination) parts.push(`${awayTeam} faces elimination`)
  if (context.homeCanClinch) parts.push(`${homeTeam} can clinch the series`)
  if (context.awayCanClinch) parts.push(`${awayTeam} can clinch the series`)
  parts.push('Unvalidated series urgency adjustment: 0.0 percentage points')
  return parts.join(' · ')
}

/** Historical A/B scaffolding: measured adjustments may be installed later.
 * The shipped production adjustment remains exactly zero.
 */
export function adjustForSeriesContext(baseHomeWinProbability: number, context: PlayoffContext | null): number {
  // Intentional no-op until walk-forward validation demonstrates a reliable edge.
  void context
  return baseHomeWinProbability
}
