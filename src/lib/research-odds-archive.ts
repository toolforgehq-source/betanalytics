/**
 * Timestamped, first-observed moneyline research archive.
 *
 * CapturedAt is when BetAnalytics FETCHED ESPN's odds, not the original sportsbook
 * quote time. Do not claim these prices were necessarily executable at that time.
 * No real-money bets, predictions or outcomes are stored by this module.
 */
import { neon } from '@neondatabase/serverless'
import type { ESPNOdds } from '@/lib/espn'

export interface ResearchOddsRow {
  league: string
  gameId: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  bookmaker: string
  capturedAt: string
  checkpoint: '1h' | '4h' | '36h'
  homeAmerican: number
  awayAmerican: number
  source: 'espn_feed'
}

const SUPPORTED = new Set(['NBA', 'NFL', 'NHL', 'MLB', 'NCAAB', 'NCAAF'])

function validAmerican(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && (n <= -100 || n >= 100)
}

/** Pure converter: can be tested without any API key or database. */
export function makeResearchOddsRows(games: ESPNOdds[], capturedAt: string): ResearchOddsRow[] {
  const time = Date.parse(capturedAt)
  if (!Number.isFinite(time) || !/^\d{4}-\d\d-\d\dT/.test(capturedAt)) {
    throw new Error('A valid timestamp is required')
  }
  const rows: ResearchOddsRow[] = [], seen = new Set<string>()
  for (const game of games) {
    // Three-way markets with draws are deliberately unsupported.
    if (game.gameStatus !== 'pre') continue
    if (!SUPPORTED.has(game.league) || !game.moneyline || !game.gameId ||
        !game.homeTeam || !game.awayTeam || !game.provider?.trim()) continue
    if (!validAmerican(game.moneyline.home) || !validAmerican(game.moneyline.away)) continue
    const start = Date.parse(game.commenceTime)
    if (!Number.isFinite(start) || start <= time || (start - time) > 36 * 3600000) continue
    const hoursLeft = (start - time) / 3600000
    const checkpoint: ResearchOddsRow['checkpoint'] = hoursLeft < 1 ? '1h' :
      hoursLeft < 4 ? '4h' : '36h'
    const bookmaker = game.provider.trim()
    const id = [game.league, game.gameId, bookmaker, checkpoint].join('|')
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({
      league: game.league, gameId: game.gameId,
      homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      commenceTime: game.commenceTime, bookmaker, capturedAt, checkpoint,
      homeAmerican: game.moneyline.home, awayAmerican: game.moneyline.away,
      source: 'espn_feed',
    })
  }
  return rows
}

let schemaInitialized = false

/**
 * Append only; keeps at most one quote per game/book/checkpoint.
 * Isolated from the existing 48-hour line-movement cache.
 * Only invoked by the approved, authenticated cron after release.
 */
export async function archiveResearchOdds(
  games: ESPNOdds[],
  capturedAt: string = new Date().toISOString()
): Promise<{ candidates: number; stored: boolean }> {
  const rows = makeResearchOddsRows(games, capturedAt)
  const databaseUrl = process.env.DATABASE_URL
  if (rows.length === 0 || !databaseUrl) return { candidates: rows.length, stored: false }
  if (rows.length > 1000) throw new Error('Unexpectedly large price batch')
  const sql = neon(databaseUrl, { fetchOptions: { cache: 'no-store' } })
  if (!schemaInitialized) {
    await sql`CREATE TABLE IF NOT EXISTS research_moneyline_snapshots (
      league TEXT NOT NULL,
      game_id TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      commence_time TIMESTAMPTZ NOT NULL,
      bookmaker TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      checkpoint TEXT NOT NULL,
      home_american INTEGER NOT NULL,
      away_american INTEGER NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (league, game_id, bookmaker, checkpoint)
    )`
    schemaInitialized = true
  }
  const statements = rows.map(row => sql`
    INSERT INTO research_moneyline_snapshots (
      league, game_id, home_team, away_team, commence_time,
      bookmaker, captured_at, checkpoint, home_american, away_american, source
    ) VALUES (
      ${row.league}, ${row.gameId}, ${row.homeTeam}, ${row.awayTeam},
      ${row.commenceTime}::timestamptz, ${row.bookmaker},
      ${row.capturedAt}::timestamptz, ${row.checkpoint},
      ${row.homeAmerican}, ${row.awayAmerican}, ${row.source}
    ) ON CONFLICT (league, game_id, bookmaker, checkpoint) DO NOTHING
  `)
  await sql.transaction(statements)
  return { candidates: rows.length, stored: true }
}
