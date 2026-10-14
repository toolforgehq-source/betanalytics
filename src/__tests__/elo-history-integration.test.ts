/**
 * Real ESPN history audit. Opt-in via ELO_SHADOW_REBUILD=1.
 * Generates immutable research files. Never writes to Neon, Vercel, or live Elo.
 */
import { describe, expect, it } from 'vitest'
import { collectFreeEloHistory } from '@/lib/free-elo-bootstrap'
import { replayEloRatings } from '@/lib/elo'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const enabled = process.env.ELO_SHADOW_REBUILD === '1'
const LEAGUE_TEAMS_MIN: Record<string,number> = {
  MLB: 30, NFL: 32, NHL: 32, NBA: 30, NCAAF: 100, NCAAB: 300
}

describe.skipIf(!enabled)('Read-only full Elo reconstruction from real ESPN results', () => {
  it('reconstructs and publishes evidence with adequate league coverage', async () => {
    const collectedAt = new Date()
    const { games, byLeague } = await collectFreeEloHistory(collectedAt)
    expect(games.length).toBeGreaterThan(2000)
    const { ratings, processedIds, newGamesProcessed } = replayEloRatings(games)
    expect(newGamesProcessed).toBe(games.length)
    const coverage = Object.fromEntries(Object.keys(byLeague).map(league => {
      const teams = Object.values(ratings.ratings).filter(r => r.league === league)
      const activeTeams = teams.filter(r => r.gamesPlayed >= 5)
      expect(teams.length, league + ': zero/insufficient teams').toBeGreaterThanOrEqual(LEAGUE_TEAMS_MIN[league])
      return [league, { games: byLeague[league as keyof typeof byLeague], teams: teams.length,
        teamsWithFiveOrMoreCurrentSeasonGames: activeTeams.length }]
    }))
    expect(coverage.NCAAB.teamsWithFiveOrMoreCurrentSeasonGames).toBeGreaterThan(250)
    expect(coverage.NCAAF.teamsWithFiveOrMoreCurrentSeasonGames).toBeGreaterThan(90)
    expect(processedIds.size).toBe(games.length)

    const outdir = join(process.cwd(),'artifacts')
    mkdirSync(outdir,{recursive:true})
    const chronology = JSON.stringify(games)
    const inputChecksum = createHash('sha256').update(chronology).digest('hex')
    const metadata = {
      type:'read-only-shadow-rebuild', model:'elo-integrity-v2',
      source:'ESPN public scoreboards (verified completed regular/postseason games)',
      collectedAt:collectedAt.toISOString(), inputSha256:inputChecksum,
      from: games[0]?.date, to:games[games.length-1]?.date,
      totalGames:games.length, totalTeams:Object.keys(ratings.ratings).length,
      coverage, liveDatabaseTouched:false
    }
    writeFileSync(join(outdir,'elo-shadow-report.json'),JSON.stringify(metadata,null,2))
    writeFileSync(join(outdir,'elo-shadow-input-games.json'),chronology)
    writeFileSync(join(outdir,'elo-shadow-ratings.json'),JSON.stringify(ratings))
    console.log('SHADOW_ELO_REPORT='+JSON.stringify(metadata))
  }, 600_000)
})
