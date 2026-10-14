import { describe, expect, it } from 'vitest'
import {
  parseESPNPlayoffContext, formatPlayoffContext,
  adjustForSeriesContext, type PlayoffContext,
} from '@/lib/playoff-context'
import { isEligibleForTopPicks } from '@/lib/enforce-picks'
import { convertESPNOddsToGame } from '@/lib/combined-data'
import type { ESPNOdds } from '@/lib/espn'

function event(homeWins: number, awayWins: number, gameNo: number, overrides: Record<string, unknown> = {}) {
  return {
    id: '401908032',
    season: { type: 3 },
    status: { type: { state: 'pre', completed: false } },
    competitions: [{
      notes: [{ type: 'event', headline: `NLCS - Game ${gameNo}` }],
      competitors: [
        { homeAway: 'home', team: { id: '19', displayName: 'Los Angeles Dodgers' } },
        { homeAway: 'away', team: { id: '8', displayName: 'Milwaukee Brewers' } },
      ],
      series: {
        type: 'playoff', title: 'Playoff Series',
        summary: homeWins === awayWins
          ? `Series tied ${homeWins}-${awayWins}`
          : awayWins > homeWins ? `MIL leads series ${awayWins}-${homeWins}`
          : `LAD leads series ${homeWins}-${awayWins}`,
        completed: false, totalCompetitions: 7,
        competitors: [{ id: '19', wins: homeWins, ties: 0 },{ id: '8', wins: awayWins, ties: 0 }],
      },
    }],
    ...overrides,
  }
}
function sampleQuote(): ESPNOdds {
  return {
    gameId: '401908032',sport: 'baseball',league:'MLB',homeTeam:'Los Angeles Dodgers',
    awayTeam:'Milwaukee Brewers',commenceTime:'2026-10-15T00:00:00Z',
    provider:'DraftKings',spread: -1.5,spreadOdds:{home:+128,away:-147},
    overUnder:8.5,overUnderOdds:{over:-110,under:-110},
    moneyline:{home:-165,away:+149},homeFavorite:true,
    gameStatus:'pre',seasonType:3,statusDetail:'Scheduled',
  }
}
function candidate(ctx: PlayoffContext | null, seasonType = 3) {
  return {
    gameId:'401908032',team:'Milwaukee Brewers',sport:'baseball_mlb',sportName:'MLB',
    betType:'spread',bestPrice:-110,eloProbability:60,homeElo:1552,
    awayElo:1537,eloConfidence:'high',score:84,seasonType,
    playoffContext:ctx,
  }
}
describe('Verified playoff series context — ESPN Brewers/Dodgers NLCS', () => {
  it('reads Game 3, Milwaukee up 2-0, with no fabricated must-win adjustment', () => {
    const ctx = parseESPNPlayoffContext(event(0,2,3),'MLB')
    expect(ctx).not.toBeNull()
    expect(ctx?.status).toBe('verified')
    expect(ctx?.round).toBe('NLCS')
    expect(ctx?.gameNumber).toBe(3)
    expect(ctx?.bestOf).toBe(7)
    expect(ctx?.homeSeriesWins).toBe(0)
    expect(ctx?.awaySeriesWins).toBe(2)
    expect(ctx?.homeFacingElimination).toBe(false)
    expect(ctx?.awayFacingElimination).toBe(false)
    expect(ctx?.probabilityAdjustmentPct).toBe(0)
    expect(formatPlayoffContext(ctx!, 'Los Angeles Dodgers','Milwaukee Brewers')).toContain('Milwaukee Brewers 2')
    expect(adjustForSeriesContext(0.47,ctx)).toBe(0.47)
    expect(isEligibleForTopPicks(candidate(ctx))).toBe(true)
  })

  it('detects a closeout/elimination game without assuming the trailing team wins', () => {
    const ctx = parseESPNPlayoffContext(event(0,3,4),'MLB')!
    expect(ctx.status).toBe('verified')
    expect(ctx.homeFacingElimination).toBe(true)
    expect(ctx.awayCanClinch).toBe(true)
    expect(formatPlayoffContext(ctx,'Dodgers','Brewers')).toContain('Dodgers faces elimination')
    expect(adjustForSeriesContext(0.3,ctx)).toBe(0.3)
  })

  it('never confuses home/away series wins and does not invent an urgency bonus', () => {
    const ctx = parseESPNPlayoffContext(event(3,2,6),'MLB')!
    expect(ctx.homeSeriesWins).toBe(3)
    expect(ctx.awaySeriesWins).toBe(2)
    expect(ctx.awayFacingElimination).toBe(true)
    expect(ctx.homeCanClinch).toBe(true)
  })

  it('fails closed for impossible series score, mismatched game number and team IDs', () => {
    const invalidScore = parseESPNPlayoffContext(event(0,2,4),'MLB')
    expect(invalidScore?.status).toBe('unverified')
    expect(isEligibleForTopPicks(candidate(invalidScore))).toBe(false)
    const impossible = event(0,2,3)
    impossible.competitions[0].series.competitors[1].id = 'not-the-brewers'
    expect(parseESPNPlayoffContext(impossible,'MLB')?.status).toBe('unverified')
    expect(isEligibleForTopPicks(candidate(null))).toBe(false)
    const contradicted = event(0,2,3)
    contradicted.competitions[0].series.summary = 'Series tied 1-1'
    expect(parseESPNPlayoffContext(contradicted,'MLB')?.status).toBe('unverified')
  })

  it('rejects postgame ESPN records — prevents leaking the result into pregame analysis', () => {
    expect(parseESPNPlayoffContext(event(0,2,3, {status:{type:{state:'post',completed:true}}}),'MLB')?.status).toBe('unverified')
    expect(parseESPNPlayoffContext(event(0,2,3, {season:{type:2}}),'MLB')).toBeNull()
    expect(isEligibleForTopPicks(candidate(null,2))).toBe(true)
  })

  it('also works for NBA and NHL series; not single-elimination college games', () => {
    const game = event(1,1,3)
    game.competitions[0].notes[0].headline = 'NBA Finals - Game 3'
    expect(parseESPNPlayoffContext(game,'NBA')?.status).toBe('verified')
    game.competitions[0].notes[0].headline = 'Stanley Cup Final - Game 3'
    expect(parseESPNPlayoffContext(game,'NHL')?.status).toBe('verified')
    expect(parseESPNPlayoffContext(game,'NCAAB')).toBeNull()
  })

  it('propagates structured context into the odds-derived candidate', () => {
    const ctx = parseESPNPlayoffContext(event(0,2,3),'MLB')!
    const g = convertESPNOddsToGame({...sampleQuote(), playoffContext:ctx})
    expect(g.seasonType).toBe(3)
    expect(g.playoffContext?.awaySeriesWins).toBe(2)
    expect(g.spreads[0].outcomes[1].point).toBe(1.5)
  })
})
