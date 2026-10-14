import type { GameResult } from './elo'

export interface PregameSeriesState {
  league: 'MLB' | 'NBA' | 'NHL'
  seasonYear: number
  seriesGameNumber: number
  homeSeriesWins: number
  awaySeriesWins: number
}

/** Build PRE-game series scores from *prior completed games only*.
 * Never use ESPN series.summary on historical completed games; it includes
 * the very outcome we're supposed to predict and would leak the answer.
 * For same-day matches, predictions use the state before the entire day.
 */
export function reconstructPregameSeriesStates(games: GameResult[]): Map<string, PregameSeriesState> {
  const results = new Map<string, PregameSeriesState>()
  const series = new Map<string, Map<string, number>>()
  const sorted = [...games].sort((a,b) => Date.parse(a.date)-Date.parse(b.date) || a.gameId.localeCompare(b.gameId))
  const byDay = new Map<string, GameResult[]>()
  for (const game of sorted) {
    const day = game.date.slice(0,10)
    if (!byDay.has(day)) byDay.set(day,[])
    byDay.get(day)!.push(game)
  }
  const keyFor = (g: GameResult) => `${g.league}:${g.date.slice(0,4)}:${g.playoffRound}:${[g.homeTeamId,g.awayTeamId].sort().join(':')}`
  const eligible = (g: GameResult) =>
    g.seasonType===3 && ['MLB','NHL','NBA'].includes(g.league) &&
    Boolean(g.playoffRound) && Number.isInteger(g.playoffGameNumber) &&
    g.playoffGameNumber!>=1 && g.homeScore!==g.awayScore

  for (const dayGames of byDay.values()) {
    for (const game of dayGames) {
      if (!eligible(game)) continue
      const wins = series.get(keyFor(game)) || new Map<string,number>()
      const home = wins.get(game.homeTeamId) || 0
      const away = wins.get(game.awayTeamId) || 0
      // Missing earlier games must not be mistaken for a Game N pregame record.
      if (home+away !== game.playoffGameNumber!-1) continue
      results.set(game.gameId,{
        league:game.league as PregameSeriesState['league'],
        seasonYear:Number(game.date.slice(0,4)),
        seriesGameNumber:game.playoffGameNumber!,
        homeSeriesWins:home, awaySeriesWins:away,
      })
    }
    for (const game of dayGames) {
      if (!eligible(game)) continue
      const key = keyFor(game)
      const wins=series.get(key) || new Map<string,number>()
      const winner=game.homeScore>game.awayScore ? game.homeTeamId : game.awayTeamId
      wins.set(winner,(wins.get(winner)||0)+1)
      series.set(key,wins)
    }
  }
  return results
}

/**
 * Research-only, chronological playoff context evaluation.
 *
 * Inputs MUST contain Elo probabilities saved before each game and series wins
 * reconstructed from completed PRIOR games (not ESPN's final series.summary).
 * No coefficient learned here is automatically applied to live betting.
 */
export interface PlayoffBacktestExample {
  gameId: string
  league: 'MLB' | 'NBA' | 'NHL'
  seasonYear: number
  seriesGameNumber: number
  homeSeriesWins: number
  awaySeriesWins: number
  homeEloProbability: number
  homeWon: 0 | 1
}

interface Metrics {
  games: number
  brier: number | null
  logLoss: number | null
}
export interface PlayoffBacktestReport {
  training: { years: number[]; examples: number; bestCoefficient: number | null }
  holdout: { years: number[]; baseline: Metrics; seriesCandidate: Metrics; brierImprovement: number | null }
  consideredValid: boolean
  activatedInProduction: false
  note: string
}
function clampProbability(p: number): number { return Math.min(0.999,Math.max(0.001,p)) }
export function seriesCandidateProbability(example: PlayoffBacktestExample, coefficient: number): number {
  const p = clampProbability(example.homeEloProbability)
  const logOdds = Math.log(p / (1-p))
  // Team leading series is represented by + homeWins-awayWins.
  const seriesDelta = example.homeSeriesWins - example.awaySeriesWins
  return clampProbability(1 / (1 + Math.exp(-(logOdds + coefficient * seriesDelta))))
}
function metrics(
  examples: PlayoffBacktestExample[], coefficient: number
): Metrics {
  if(!examples.length) return {games:0,brier:null,logLoss:null}
  let brier = 0, logLoss = 0
  for (const ex of examples) {
    const p = seriesCandidateProbability(ex, coefficient)
    brier += (p-ex.homeWon)**2
    logLoss += -(ex.homeWon*Math.log(p)+(1-ex.homeWon)*Math.log(1-p))
  }
  return {games:examples.length,brier:brier/examples.length,logLoss:logLoss/examples.length}
}
export function evaluatePlayoffSeriesHoldout(
  examples: PlayoffBacktestExample[], holdoutYear = 2026, minTrain = 80, minHoldout = 40
): PlayoffBacktestReport {
  const valid = examples.filter(ex =>
    Number.isFinite(ex.homeEloProbability) && ex.homeEloProbability>0 &&
    ex.homeEloProbability<1 && (ex.homeWon===0 || ex.homeWon===1) &&
    Number.isInteger(ex.seriesGameNumber) && ex.seriesGameNumber>=2 &&
    Number.isInteger(ex.homeSeriesWins) && Number.isInteger(ex.awaySeriesWins) &&
    ex.homeSeriesWins>=0 && ex.awaySeriesWins>=0 &&
    ex.homeSeriesWins+ex.awaySeriesWins===ex.seriesGameNumber-1
  )
  const train = valid.filter(x=>x.seasonYear<holdoutYear)
  const test = valid.filter(x=>x.seasonYear===holdoutYear)
  const trainYears = Array.from(new Set(train.map(x=>x.seasonYear))).sort()
  const testYears = Array.from(new Set(test.map(x=>x.seasonYear))).sort()
  const enough = train.length>=minTrain && test.length>=minHoldout
  const zero = metrics(test,0)
  if(!enough) {
    return {
      training:{years:trainYears,examples:train.length,bestCoefficient:null},
      holdout:{years:testYears,baseline:zero,seriesCandidate:{games:test.length,brier:null,logLoss:null},brierImprovement:null},
      consideredValid:false,activatedInProduction:false,
      note:'Insufficient genuinely point-in-time train/holdout series games; keep model adjustment at zero.'
    }
  }
  // Coefficient is fitted ONLY on past years, never on the 2026 holdout.
  const candidates=[-0.25,-0.20,-0.15,-0.10,-0.05,0,0.05,0.10,0.15,0.20,0.25]
  const fitted=candidates.map(coefficient=>({coefficient,result:metrics(train,coefficient)}))
    .sort((a,b)=>(a.result.brier??Infinity)-(b.result.brier??Infinity) ||
      Math.abs(a.coefficient)-Math.abs(b.coefficient))[0]
  const candidate=metrics(test,fitted.coefficient)
  const improvement = zero.brier!==null && candidate.brier!==null ? zero.brier-candidate.brier : null
  return {
    training:{years:trainYears,examples:train.length,bestCoefficient:fitted.coefficient},
    holdout:{years:testYears,baseline:zero,seriesCandidate:candidate,brierImprovement:improvement},
    consideredValid:true,activatedInProduction:false,
    note:'Exploratory Elo-only, unpriced Brier/log-loss A/B; no sportsbook EV or model change is justified by a single holdout.'
  }
}
