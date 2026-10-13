import { describe, expect, it } from 'vitest'
import { evaluateHistoricalElo, replayHistoricalElo, type HistoricalEloGame } from '@/lib/elo-proof-lab'

function game(
  index: number,
  overrides: Partial<HistoricalEloGame> = {}
): HistoricalEloGame {
  const start = new Date(Date.UTC(2024, 0, index + 1, 18)).toISOString()
  const observed = new Date(Date.parse(start) - 60 * 60 * 1000).toISOString()
  const known = new Date(Date.parse(start) + 3 * 60 * 60 * 1000).toISOString()
  return {
    gameId: 'g' + index, league: 'NBA', homeTeamId: 'A', awayTeamId: 'B',
    commenceTime: start, resultKnownAt: known,
    homeScore: index % 2 ? 102 : 110, awayScore: 100,
    odds: { bookmaker: 'TestBook', observedAt: observed, homeAmerican: -110, awayAmerican: -110 },
    ...overrides,
  }
}

describe('Elo proof lab: time integrity', () => {
  it('does not allow odds captured at or after kickoff', () => {
    const g = game(1)
    expect(() => replayHistoricalElo([{ ...g, odds: { ...g.odds!, observedAt: g.commenceTime } }], 'NBA'))
      .toThrow(/after kickoff/)
  })

  it('does not allow outcome availability before kickoff', () => {
    expect(() => replayHistoricalElo([game(1, { resultKnownAt: game(1).commenceTime })], 'NBA'))
      .toThrow(/after kickoff/)
  })

  it('rejects mixed leagues, duplicate IDs, and invalid prices', () => {
    expect(() => replayHistoricalElo([game(1, { league: 'NFL' })], 'NBA')).toThrow(/Mixed sports/)
    expect(() => replayHistoricalElo([game(1), game(1)], 'NBA')).toThrow(/duplicate/)
    expect(() => replayHistoricalElo([game(1, { odds: { ...game(1).odds!, homeAmerican: -20 } })], 'NBA'))
      .toThrow(/American odds/)
  })

  it('does not mis-grade a drawn game as a two-way win/loss', () => {
    expect(() => replayHistoricalElo([game(1, { homeScore: 100, awayScore: 100 })], 'NBA'))
      .toThrow(/drawn regulation result/)
  })

  it('does not invent results from games still in progress at observation time', () => {
    const history = Array.from({ length: 8 }, (_, i) => game(i))
    const baseline = replayHistoricalElo(history, 'NBA')
    const modified = history.map(g => g.gameId === 'g7'
      ? { ...g, homeScore: 1, awayScore: 200 }
      : g)
    const replayed = replayHistoricalElo(modified, 'NBA')
    // g7 prediction is recorded before its own result and should not change.
    expect(replayed.predictions.find(x => x.gameId === 'g7')?.eloHomeProb)
      .toBeCloseTo(baseline.predictions.find(x => x.gameId === 'g7')!.eloHomeProb, 12)
  })

  it('does not use results from another game not yet known at the snapshot time', () => {
    const past = Array.from({ length: 6 }, (_, i) => game(i))
    const upcoming = game(7)
    const intervening = game(6, {
      resultKnownAt: new Date(Date.parse(upcoming.odds!.observedAt) + 30 * 60000).toISOString(),
    })
    const dataset = [...past, intervening, upcoming]
    const one = replayHistoricalElo(dataset, 'NBA')
    const another = replayHistoricalElo(dataset.map(g => g.gameId === 'g6'
      ? { ...g, homeScore: 1, awayScore: 200 }
      : g), 'NBA')
    expect(one.predictions.find(x => x.gameId === 'g7')?.eloHomeProb)
      .toBeCloseTo(another.predictions.find(x => x.gameId === 'g7')!.eloHomeProb, 12)
  })

  it('excludes stale snapshots and does not replace them with closing lines', () => {
    const baseline = Array.from({ length: 7 }, (_, i) => game(i))
    const g = game(7)
    const out = replayHistoricalElo([...baseline, {
      ...g, odds: { ...g.odds!, observedAt: new Date(Date.parse(g.commenceTime) - 60 * 3600000).toISOString() },
    }], 'NBA')
    expect(out.stalePrices).toBe(1)
    expect(out.predictions.some(x => x.gameId === 'g7')).toBe(false)
  })
})

describe('Elo proof lab: baseline and holdout isolation', () => {
  it('uses 50/50 no-vig market probabilities for symmetric -110 lines', () => {
    const report = evaluateHistoricalElo(Array.from({ length: 25 }, (_, i) => game(i)),
      'NBA', game(14).commenceTime, { minTrainPredictions: 1 })
    expect(report.holdoutMarket.brier).toBeCloseTo(0.25, 9)
  })

  it('falls back to the market when training evidence is insufficient', () => {
    const report = evaluateHistoricalElo(Array.from({ length: 12 }, (_, i) => game(i)),
      'NBA', game(8).commenceTime, { minTrainPredictions: 100 })
    expect(report.selectedEloWeight).toBe(0)
    expect(report.trained).toBe(false)
    expect(report.holdoutBets.bets).toBe(0)
    expect(report.hasEvidenceToConsiderLivePaperTrial).toBe(false)
  })

  it('does not tune the blend using future holdout outcomes', () => {
    const train = Array.from({ length: 40 }, (_, i) => game(i))
    const testChange = train.map(g => Number(g.gameId.slice(1)) >= 22
      ? { ...g, homeScore: g.awayScore - 5 }
      : g)
    const cutoff = game(22).commenceTime
    const config = { minTrainPredictions: 2 }
    const a = evaluateHistoricalElo(train, 'NBA', cutoff, config)
    const b = evaluateHistoricalElo(testChange, 'NBA', cutoff, config)
    expect(a.trainingPredictions).toBe(b.trainingPredictions)
    expect(a.selectedEloWeight).toBe(b.selectedEloWeight)
  })

  it('excludes training games not finished until the holdout period', () => {
    const all = Array.from({ length: 12 }, (_, i) => game(i))
    all[7] = {
      ...all[7],
      resultKnownAt: new Date(Date.parse(game(9).commenceTime) + 24 * 3600000).toISOString()
    }
    const cutoff = game(9).commenceTime
    const report = evaluateHistoricalElo(all, 'NBA', cutoff, { minTrainPredictions: 1 })
    expect(report.excludedAcrossCutoff).toBe(1)
  })

  it('never announces a validated betting edge from a tiny sample', () => {
    const report = evaluateHistoricalElo(Array.from({ length: 35 }, (_, i) => game(i)),
      'NBA', game(22).commenceTime, { minTrainPredictions: 1, minEdge: 0 })
    expect(report.holdoutPredictions).toBeGreaterThan(0)
    expect(report.hasEvidenceToConsiderLivePaperTrial).toBe(false)
    expect(report.warnings.some(x => x.includes('300 games'))).toBe(true)
  })

  it('keeps score-only games as rating history while excluding missing odds from bet metrics', () => {
    const data = Array.from({ length: 10 }, (_, i) => game(i))
    const result = replayHistoricalElo(data.map((g, i) => i < 6 ? { ...g, odds: undefined } : g), 'NBA')
    expect(result.predictions.map(x => x.gameId)).toEqual(['g6', 'g7', 'g8', 'g9'])
  })
})
