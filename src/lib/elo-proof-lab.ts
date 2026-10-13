/**
 * Research-only moneyline evaluation. No API calls, database writes, recommendations
 * or wagering. Historical price snapshots and actual result-known timestamps are
 * required so no result can affect a prediction made before that result was known.
 *
 * Important: this is a chronological, single-pass Elo replay, not a clone of the
 * production app's optional multi-pass recalibration / season rollover workflow.
 */
import { calculateWinProbability, updateRatingsAfterGame } from '@/lib/elo'

export interface HistoricalMoneylineOdds {
  /** When the quoted prices were actually observed; must precede kickoff. */
  observedAt: string
  bookmaker: string
  homeAmerican: number
  awayAmerican: number
}

export interface HistoricalEloGame {
  gameId: string
  league: string
  homeTeamId: string
  awayTeamId: string
  commenceTime: string
  /** When the FINAL result was available to a real bettor, not just kickoff. */
  resultKnownAt: string
  homeScore: number
  awayScore: number
  isNeutralSite?: boolean
  /** Games without recorded odds still improve the Elo training history. */
  odds?: HistoricalMoneylineOdds
}

export interface EvaluatedPrediction {
  gameId: string
  league: string
  observedAt: string
  commenceTime: string
  resultKnownAt: string
  homeWin: boolean
  eloHomeProb: number
  marketHomeProb: number
  homeAmerican: number
  awayAmerican: number
}

export interface PredictionMetrics {
  count: number
  brier: number | null
  logLoss: number | null
  accuracy: number | null
  /** Expected calibration error across fixed probability bins, not proof of edge. */
  calibrationError: number | null
}

export interface BetAudit {
  candidates: number
  bets: number
  wins: number
  losses: number
  unitsProfit: number
  roi: number | null
  /** Normal approximation; indicative only, not robust to correlated bets. */
  lower95Roi: number | null
  upper95Roi: number | null
}

export interface HistoricalEloReport {
  league: string
  cutoff: string
  totalGames: number
  historicalPrices: number
  missingPrices: number
  stalePrices: number
  insufficientHistory: number
  excludedAcrossCutoff: number
  trainingPredictions: number
  holdoutPredictions: number
  /** Elo weight selected using TRAINING outcomes only; 0 = no-vig market. */
  selectedEloWeight: number
  trained: boolean
  trainBrier: number | null
  holdoutMarket: PredictionMetrics
  holdoutElo: PredictionMetrics
  holdoutSelected: PredictionMetrics
  holdoutBets: BetAudit
  /** Conservative research gate, not a profitability guarantee. */
  hasEvidenceToConsiderLivePaperTrial: boolean
  warnings: string[]
}

interface RatingState {
  rating: number
  gamesPlayed: number
  lastPlayedAt: string | null
}

const DEFAULT_RATING = 1500
const WEIGHT_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

function timestamp(value: string, field: string): number {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error(field + ' must be an offset-aware ISO timestamp')
  }
  const n = Date.parse(value)
  if (!Number.isFinite(n)) throw new Error('Invalid ' + field)
  return n
}

function probability(p: number): number {
  return Math.max(0.000001, Math.min(0.999999, p))
}

function impliedOdds(american: number): number {
  if (!Number.isFinite(american) || (american > -100 && american < 100)) {
    throw new Error('American odds must be <= -100 or >= +100')
  }
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100)
}

function profitForUnit(american: number): number {
  return american > 0 ? american / 100 : 100 / -american
}

function noVigHome(odds: HistoricalMoneylineOdds): number {
  const h = impliedOdds(odds.homeAmerican)
  const a = impliedOdds(odds.awayAmerican)
  if (h + a < 0.99 || h + a > 1.5) {
    throw new Error('Implausible two-way market: ' + odds.bookmaker)
  }
  return h / (h + a)
}

function metrics(predictions: EvaluatedPrediction[], p: (x: EvaluatedPrediction) => number): PredictionMetrics {
  if (!predictions.length) {
    return { count: 0, brier: null, logLoss: null, accuracy: null, calibrationError: null }
  }
  let brier = 0, logLoss = 0, correct = 0, calibrationError = 0
  const bins = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, actual: 0 }))
  for (const x of predictions) {
    const est = probability(p(x)), actual = x.homeWin ? 1 : 0
    brier += (est - actual) ** 2
    logLoss -= actual * Math.log(est) + (1 - actual) * Math.log(1 - est)
    correct += (est >= 0.5) === x.homeWin ? 1 : 0
    const bin = bins[Math.min(9, Math.floor(est * 10))]
    bin.n++
    bin.predicted += est
    bin.actual += actual
  }
  for (const b of bins) {
    if (b.n) calibrationError += (b.n / predictions.length) * Math.abs((b.predicted - b.actual) / b.n)
  }
  return {
    count: predictions.length,
    brier: brier / predictions.length,
    logLoss: logLoss / predictions.length,
    accuracy: correct / predictions.length,
    calibrationError
  }
}

function blended(x: EvaluatedPrediction, weight: number): number {
  return x.eloHomeProb * weight + x.marketHomeProb * (1 - weight)
}

/** Prices are always scored at the RECORDED quoted price, never the eventual close. */
function simulateBets(data: EvaluatedPrediction[], weight: number, minEdge: number): BetAudit {
  let candidates = 0, wins = 0, losses = 0, sum = 0, sumSq = 0
  for (const x of data) {
    const home = blended(x, weight)
    const away = 1 - home
    const homePayout = profitForUnit(x.homeAmerican)
    const awayPayout = profitForUnit(x.awayAmerican)
    const homeEv = home * homePayout - (1 - home)
    const awayEv = away * awayPayout - home
    const maxEv = Math.max(homeEv, awayEv)
    if (maxEv <= 0) continue
    candidates++
    const takeHome = homeEv >= awayEv
    const betProb = takeHome ? home : away
    const odds = takeHome ? x.homeAmerican : x.awayAmerican
    if (maxEv < minEdge || betProb < 0.5) continue
    const won = takeHome === x.homeWin
    if (won) wins++
    else losses++
    const profit = won ? profitForUnit(odds) : -1
    sum += profit
    sumSq += profit * profit
  }
  const bets = wins + losses
  const roi = bets ? sum / bets : null
  const variance = bets > 1 ? Math.max(0, (sumSq - sum * sum / bets) / (bets - 1)) : 0
  const margin = bets > 1 ? 1.96 * Math.sqrt(variance / bets) : null
  return {
    candidates, bets, wins, losses, unitsProfit: sum, roi,
    lower95Roi: roi !== null && margin !== null ? roi - margin : null,
    upper95Roi: roi !== null && margin !== null ? roi + margin : null
  }
}

function validate(games: HistoricalEloGame[], league: string): HistoricalEloGame[] {
  const seen = new Set<string>()
  for (const g of games) {
    if (g.league !== league) throw new Error('Mixed sports must be evaluated separately')
    if (!g.gameId || seen.has(g.gameId)) throw new Error('Missing/duplicate gameId: ' + g.gameId)
    seen.add(g.gameId)
    if (!g.homeTeamId || !g.awayTeamId || g.homeTeamId === g.awayTeamId) throw new Error('Invalid team IDs')
    const start = timestamp(g.commenceTime, 'commenceTime')
    const known = timestamp(g.resultKnownAt, 'resultKnownAt')
    if (known <= start) throw new Error('Result availability must be after kickoff')
    if (![g.homeScore, g.awayScore].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid final scores')
    if (g.odds) {
      const seenAt = timestamp(g.odds.observedAt, 'odds.observedAt')
      if (seenAt >= start) throw new Error('Odds snapshot was observed after kickoff: ' + g.gameId)
      if (!g.odds.bookmaker?.trim()) throw new Error('Missing sportsbook')
      noVigHome(g.odds)
      if (g.homeScore === g.awayScore) throw new Error('Two-way moneyline cannot grade a drawn regulation result: ' + g.gameId)
    }
  }
  return [...games]
}

function key(league: string, teamId: string): string { return league + ':' + teamId }

/**
 * Chronological prequential evaluation:
 * (a) move only already-known results into Elo,
 * (b) predict using that exact timestamp's odds,
 * (c) move on. Scores from later games cannot train earlier forecasts.
 */
export function replayHistoricalElo(
  games: HistoricalEloGame[],
  league: string,
  maxPriceAgeHours = 36
): { predictions: EvaluatedPrediction[], stalePrices: number, insufficientHistory: number } {
  if (!Number.isFinite(maxPriceAgeHours) || maxPriceAgeHours <= 0) throw new Error('Bad maxPriceAgeHours')
  const validated = validate(games, league)
  const resolved = [...validated].sort((a, b) => Date.parse(a.resultKnownAt) - Date.parse(b.resultKnownAt))
  const priced = validated.filter(g => g.odds).sort((a, b) =>
    Date.parse(a.odds!.observedAt) - Date.parse(b.odds!.observedAt) ||
    a.gameId.localeCompare(b.gameId)
  )
  const ratings = new Map<string, RatingState>()
  const get = (teamId: string): RatingState => {
    const id = key(league, teamId)
    let x = ratings.get(id)
    if (!x) { x = { rating: DEFAULT_RATING, gamesPlayed: 0, lastPlayedAt: null }; ratings.set(id, x) }
    return x
  }
  let resultsCursor = 0, stalePrices = 0, insufficientHistory = 0
  const predictions: EvaluatedPrediction[] = []
  for (const game of priced) {
    const when = Date.parse(game.odds!.observedAt)
    while (resultsCursor < resolved.length && Date.parse(resolved[resultsCursor].resultKnownAt) <= when) {
      const settled = resolved[resultsCursor++]
      const home = get(settled.homeTeamId), away = get(settled.awayTeamId)
      const elapsed = (last: string | null): number => last ?
        Math.max(0, Math.floor((Date.parse(settled.commenceTime) - Date.parse(last)) / 86400000)) : 100
      const recency = (days: number): number => days <= 7 ? 1.15 : days >= 14 ? 0.85 : 1
      let kMultiplier = (recency(elapsed(home.lastPlayedAt)) + recency(elapsed(away.lastPlayedAt))) / 2
      if (league === 'MLB' && Math.max(home.gamesPlayed, away.gamesPlayed) < 30) kMultiplier *= 2
      const updated = updateRatingsAfterGame(
        home.rating, away.rating, settled.homeScore, settled.awayScore,
        league, kMultiplier, settled.isNeutralSite === true
      )
      home.rating = updated.newHomeRating
      away.rating = updated.newAwayRating
      home.gamesPlayed++
      away.gamesPlayed++
      home.lastPlayedAt = settled.commenceTime
      away.lastPlayedAt = settled.commenceTime
    }
    if ((Date.parse(game.commenceTime) - when) > maxPriceAgeHours * 3600000) { stalePrices++; continue }
    const home = get(game.homeTeamId), away = get(game.awayTeamId)
    if (Math.min(home.gamesPlayed, away.gamesPlayed) < 5) { insufficientHistory++; continue }
    predictions.push({
      gameId: game.gameId, league, observedAt: game.odds!.observedAt,
      commenceTime: game.commenceTime, resultKnownAt: game.resultKnownAt,
      homeWin: game.homeScore > game.awayScore,
      eloHomeProb: calculateWinProbability(home.rating, away.rating, league, game.isNeutralSite === true),
      marketHomeProb: noVigHome(game.odds!),
      homeAmerican: game.odds!.homeAmerican,
      awayAmerican: game.odds!.awayAmerican
    })
  }
  return { predictions, stalePrices, insufficientHistory }
}

/**
 * Select blend ONLY on past data, then freeze it for the separate holdout.
 * No win/loss observation from the holdout is available for model selection.
 */
export function evaluateHistoricalElo(
  games: HistoricalEloGame[],
  league: string,
  cutoff: string,
  options?: { minTrainPredictions?: number, minEdge?: number, maxPriceAgeHours?: number }
): HistoricalEloReport {
  const t = timestamp(cutoff, 'cutoff')
  const minTrain = options?.minTrainPredictions ?? 100
  const minEdge = options?.minEdge ?? 0.03
  if (!Number.isInteger(minTrain) || minTrain < 1) throw new Error('Invalid minTrainPredictions')
  if (!Number.isFinite(minEdge) || minEdge < 0 || minEdge > 1) throw new Error('Invalid minEdge')
  const replay = replayHistoricalElo(games, league, options?.maxPriceAgeHours ?? 36)
  const train = replay.predictions.filter(p => Date.parse(p.observedAt) < t && Date.parse(p.resultKnownAt) < t)
  const test = replay.predictions.filter(p => Date.parse(p.observedAt) >= t)
  const excludedAcrossCutoff = replay.predictions.length - train.length - test.length
  const trained = train.length >= minTrain
  // Market-only is the safe baseline until enough training evidence exists.
  let weight = 0
  if (trained) {
    let best = Infinity
    for (const candidate of WEIGHT_GRID) {
      const loss = metrics(train, p => blended(p, candidate)).logLoss!
      if (loss < best - 1e-12) { best = loss; weight = candidate }
    }
  }
  const market = metrics(test, x => x.marketHomeProb)
  const elo = metrics(test, x => x.eloHomeProb)
  const selected = metrics(test, x => blended(x, weight))
  const bets = simulateBets(test, weight, minEdge)
  const warnings: string[] = []
  if (!trained) warnings.push('Insufficient training results: the evaluator falls back to no-vig market estimates.')
  if (test.length < 300) warnings.push('Holdout includes fewer than 300 games; precision estimates are unreliable.')
  if (bets.bets < 100) warnings.push('Fewer than 100 qualifying bets; return estimates have very wide uncertainty.')
  if (replay.stalePrices > 0) warnings.push('Stale quoted prices were excluded, not backfilled with later prices.')
  if (bets.bets && bets.lower95Roi !== null && bets.lower95Roi <= 0) {
    warnings.push('Observed profit does not rule out a non-positive true return.')
  }
  warnings.push('Historical lines must be genuine timestamped snapshots. This test cannot establish data provenance.')
  warnings.push('Single-pass replay omits production multi-pass/season-regression logic; test production parity separately.')
  const passed = trained && test.length >= 300 && bets.bets >= 100 &&
    selected.logLoss !== null && market.logLoss !== null &&
    selected.logLoss < market.logLoss &&
    bets.lower95Roi !== null && bets.lower95Roi > 0
  return {
    league, cutoff, totalGames: games.length,
    historicalPrices: games.filter(x => x.odds).length,
    missingPrices: games.filter(x => !x.odds).length,
    stalePrices: replay.stalePrices, insufficientHistory: replay.insufficientHistory,
    excludedAcrossCutoff, trainingPredictions: train.length,
    holdoutPredictions: test.length, selectedEloWeight: weight, trained,
    trainBrier: metrics(train, x => blended(x, weight)).brier,
    holdoutMarket: market, holdoutElo: elo, holdoutSelected: selected,
    holdoutBets: bets, hasEvidenceToConsiderLivePaperTrial: passed, warnings
  }
}
