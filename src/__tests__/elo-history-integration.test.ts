/**
 * Real ESPN history audit. Opt-in via ELO_SHADOW_REBUILD=1.
 * Generates immutable research files. Never writes to Neon, Vercel, or live Elo.
 */
import { describe, expect, it } from 'vitest'
import { collectFreeEloHistory } from '@/lib/free-elo-bootstrap'
import { replayEloRatings, calculateWinProbability, getEloSeasonYear, applySeasonRegression, type GameResult, type EloRatings } from '@/lib/elo'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { reconstructPregameSeriesStates, evaluatePlayoffSeriesHoldout, type PlayoffBacktestExample } from '@/lib/playoff-backtest'

const enabled = process.env.ELO_SHADOW_REBUILD === '1'
const LEAGUE_TEAMS_MIN: Record<string,number> = {
  MLB: 30, NFL: 32, NHL: 32, NBA: 30, NCAAF: 100, NCAAB: 300
}

describe.skipIf(!enabled)('Read-only full Elo reconstruction from real ESPN results', () => {
  it('reconstructs and publishes evidence with adequate league coverage', async () => {
    const collectedAt = new Date()
    const { games, byLeague } = await collectFreeEloHistory(collectedAt,fetch,{ extendedProPlayoffResearch:true })
    expect(games.length).toBeGreaterThan(2000)
    const { ratings, processedIds, newGamesProcessed } = replayEloRatings(games)
    expect(newGamesProcessed).toBe(games.length)
    const pregameSeries = reconstructPregameSeriesStates(games)
    const playoffAB: PlayoffBacktestExample[] = []
    // Out-of-sample walk-forward predictions: ratings as of the PREVIOUS day only.
    // We do not use same-day results, injury data scraped after the fact, or final Elo.
    const days = new Map<string,GameResult[]>()
    for (const g of games) {
      const day = g.date.slice(0,10)
      if (!days.has(day)) days.set(day,[])
      days.get(day)!.push(g)
    }
    type Pregame = { gameId:string, league:string, date:string,
      homeTeam:string, awayTeam:string, homeScore:number, awayScore:number,
      actualHomeWin:number, pHome:number, minGamesCurrentSeason:number,
      isNeutralSite:boolean }
    const pregame: Pregame[] = []
    let state: EloRatings | null = null
    let seen = new Set<string>()
    for (const [,dayGames] of Array.from(days.entries()).sort((a,b) => a[0].localeCompare(b[0]))) {
      for (const game of dayGames) {
        const h = state?.ratings[`${game.league}:${game.homeTeamId}`]
        const a = state?.ratings[`${game.league}:${game.awayTeamId}`]
        if (!h || !a || game.homeScore === game.awayScore) continue
        const season = getEloSeasonYear(game.league, new Date(game.date))
        const homeNew = season > getEloSeasonYear(game.league,new Date(h.lastUpdated))
        const awayNew = season > getEloSeasonYear(game.league,new Date(a.lastUpdated))
        const homeGames = homeNew ? 0 : h.gamesPlayed
        const awayGames = awayNew ? 0 : a.gamesPlayed
        if (Math.min(homeGames,awayGames) < 5) continue
        const homeRating = homeNew ? applySeasonRegression(h.rating, game.league) : h.rating
        const awayRating = awayNew ? applySeasonRegression(a.rating, game.league) : a.rating
        const p = calculateWinProbability(homeRating,awayRating,game.league,game.isNeutralSite === true)
        const series = pregameSeries.get(game.gameId)
        if (series && series.seriesGameNumber>=2) {
          playoffAB.push({
            gameId:game.gameId,league:series.league,seasonYear:series.seasonYear,
            seriesGameNumber:series.seriesGameNumber,
            homeSeriesWins:series.homeSeriesWins,awaySeriesWins:series.awaySeriesWins,
            homeEloProbability:p,homeWon:game.homeScore>game.awayScore ? 1 : 0,
          })
        }
        pregame.push({gameId:game.gameId,league:game.league,date:game.date,
          homeTeam:game.homeTeamName,awayTeam:game.awayTeamName,
          homeScore:game.homeScore,awayScore:game.awayScore,
          actualHomeWin:game.homeScore > game.awayScore ? 1 : 0,
          pHome:p,minGamesCurrentSeason:Math.min(homeGames,awayGames),
          isNeutralSite:game.isNeutralSite === true})
      }
      const next = replayEloRatings(dayGames,state,seen)
      state = next.ratings
      seen = next.processedIds
    }
    const brierByLeague = Object.fromEntries(Object.keys(byLeague).map(league => {
      const ps = pregame.filter(g => g.league === league)
      const brier = ps.length
        ? ps.reduce((sum,g) => sum + Math.pow(g.pHome-g.actualHomeWin,2),0)/ps.length : null
      return [league,{predictions:ps.length,brierScore:brier, naiveFiftyFiftyBrier:0.25,
        eligibleTenPlus:ps.filter(g=>g.minGamesCurrentSeason>=10).length}]
    }))
    const playoffHoldout = evaluatePlayoffSeriesHoldout(playoffAB,2026)
    const coverage = Object.fromEntries(Object.keys(byLeague).map(league => {
      const teams = Object.values(ratings.ratings).filter(r => r.league === league)
      const activeTeams = teams.filter(r => r.gamesPlayed >= 5)
      return [league, { games: byLeague[league as keyof typeof byLeague], teams: teams.length,
        teamsWithFiveOrMoreCurrentSeasonGames: activeTeams.length }]
    }))
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
      coverage, walkForwardEloOnlyBrier:brierByLeague,
      playoffSeriesHoldout:playoffHoldout,
      gamesByLeagueAndYear: Object.fromEntries(Object.keys(byLeague).map(league => [league,
        Object.fromEntries(Array.from(new Set(games.filter(g => g.league === league).map(g => g.date.slice(0,4))))
          .map(y => [y, games.filter(g => g.league === league && g.date.startsWith(y)).length]))])),
      liveDatabaseTouched:false
    }
    writeFileSync(join(outdir,'elo-shadow-report.json'),JSON.stringify(metadata,null,2))
    writeFileSync(join(outdir,'elo-shadow-input-games.json'),chronology)
    writeFileSync(join(outdir,'elo-shadow-ratings.json'),JSON.stringify(ratings))
    writeFileSync(join(outdir,'elo-baseline-asof-pregame.json'),JSON.stringify(pregame))
    writeFileSync(join(outdir,'elo-playoff-holdout.json'),JSON.stringify(playoffHoldout,null,2))
    writeFileSync(join(outdir,'elo-playoff-pregame-samples.json'),JSON.stringify(playoffAB))
    console.log('SHADOW_ELO_REPORT='+JSON.stringify(metadata))
    for (const [league, stats] of Object.entries(coverage)) {
      expect(stats.teams, league + ': missing teams').toBeGreaterThanOrEqual(LEAGUE_TEAMS_MIN[league])
    }
    expect(coverage.NCAAB.teamsWithFiveOrMoreCurrentSeasonGames).toBeGreaterThan(250)
    // In mid-October, most FBS teams have played only 5-7 games.
    // Coverage must be broad, but actual picks still require 10+ games/team.
    expect(games.filter(g => g.league === 'NCAAF' && g.date.startsWith('2026-')).length).toBeGreaterThan(200)
    expect(coverage.NCAAF.teamsWithFiveOrMoreCurrentSeasonGames).toBeGreaterThanOrEqual(30)
    expect(processedIds.size).toBe(games.length)
  }, 600_000)
})
