/**
 * Research-only football Elo. No DB writes, no sportsbook picks, no silent promotion.
 * Ratings survive seasons; uncertainty uses exponentially discounted real game
 * observations rather than an impossible 10/20 current-season game requirement.
 */
export const FOOTBALL_PARAMS = Object.freeze({
  NFL: { scale: 550, home: 48, k: 28, regression: 0.33, memory: 0.67 },
  NCAAF: { scale: 600, home: 65, k: 36, regression: 0.45, memory: 0.55 }
})

export function teamKey(league, id) { return league + ':' + String(id) }

export function winProbability(homeRating, awayRating, params, neutral = false) {
  const diff = homeRating + (neutral ? 0 : params.home) - awayRating
  return 1 / (1 + Math.pow(10, -diff / params.scale))
}

function initialTeam(game, side) {
  return {
    id: String(game[side + 'TeamId']),
    name: String(game[side + 'TeamName']),
    rating: 1500, lastSeason: null, gamesThisSeason: 0,
    seasonCounts: {}
  }
}

function prepareForSeason(team, season, params) {
  if (team.lastSeason === null) {
    team.lastSeason = season
    return
  }
  if (season < team.lastSeason) throw new Error('Game order reversed')
  while (team.lastSeason < season) {
    team.rating = 1500 + (team.rating - 1500) * (1 - params.regression)
    team.lastSeason++
    team.gamesThisSeason = 0
  }
}

export function effectiveSampleSize(team, season, params) {
  let n = 0
  for (const [year, played] of Object.entries(team.seasonCounts)) {
    const age = season - Number(year)
    if (age >= 0) n += played * Math.pow(params.memory, age)
  }
  return Number(n.toFixed(2))
}

function getResult(game) {
  return game.homeScore === game.awayScore ? 0.5 : game.homeScore > game.awayScore ? 1 : 0
}

function updateTeams(home, away, game, probability, params) {
  const outcome = getResult(game)
  const margin = Math.min(45, Math.abs(game.homeScore - game.awayScore))
  // Margin informs team strength, but is bounded to avoid blowout overreaction.
  const mov = Math.min(1.75, Math.max(0.65, 0.75 + 0.25 * Math.log2(1 + margin)))
  const delta = params.k * mov * (outcome - probability)
  home.rating += delta
  away.rating -= delta
  for (const team of [home, away]) {
    team.gamesThisSeason++
    team.seasonCounts[game.seasonYear] = (team.seasonCounts[game.seasonYear] || 0) + 1
  }
}

function checkedGames(games, league) {
  const ids = new Set()
  return games.filter(g => g.league === league).map(g => {
    if (!g.gameId || !g.homeTeamId || !g.awayTeamId || g.homeTeamId === g.awayTeamId ||
        !Number.isInteger(g.homeScore) || !Number.isInteger(g.awayScore) ||
        g.homeScore < 0 || g.awayScore < 0 ||
        !Number.isFinite(Date.parse(g.date)) || !Number.isInteger(g.seasonYear)) {
      throw new Error('Invalid historical game: ' + JSON.stringify(g).slice(0, 180))
    }
    const key = league + ':' + g.gameId
    if (ids.has(key)) throw new Error('Duplicate event: ' + key)
    ids.add(key)
    return g
  }).sort((a,b) => Date.parse(a.date) - Date.parse(b.date) || a.gameId.localeCompare(b.gameId))
}

/**
 * From the ESPN groups=80 feed, non-FBS opponents occasionally appear.
 * Use year-specific participation to avoid treating a one-game FCS opponent as
 * a generic FBS-rated 1500 team. This enrollment filter uses schedule presence,
 * NOT game results; check separately for eligibility/lookahead in research.
 */
export function filterCompetitiveGames(games, league) {
  const all = checkedGames(games, league)
  if (league !== 'NCAAF') return all
  const counts = new Map()
  for (const game of all) for (const id of [game.homeTeamId, game.awayTeamId]) {
    const key = game.seasonYear + ':' + id
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  // 2026 dataset is intentionally partial: prior-season FBS membership can help.
  const roster = new Set([...counts.entries()].filter(([key,n]) =>
    n >= (key.startsWith('2026:') ? 4 : 7)).map(([key])=>key))
  return all.filter(g => {
    const a = g.seasonYear + ':' + g.homeTeamId
    const b = g.seasonYear + ':' + g.awayTeamId
    return roster.has(a) && roster.has(b)
  })
}

export function evaluateElo(games, league, params, options = {}) {
  const all = filterCompetitiveGames(games, league)
  const ratings = new Map()
  const predictions = []
  for (const g of all) {
    const hKey = teamKey(league,g.homeTeamId), aKey = teamKey(league,g.awayTeamId)
    const home = ratings.get(hKey) || initialTeam(g,'home')
    const away = ratings.get(aKey) || initialTeam(g,'away')
    prepareForSeason(home, g.seasonYear, params)
    prepareForSeason(away, g.seasonYear, params)
    const p = winProbability(home.rating,away.rating,params,g.neutralSite === true)
    const sample = Math.min(effectiveSampleSize(home,g.seasonYear,params),
                            effectiveSampleSize(away,g.seasonYear,params))
    if (g.homeScore !== g.awayScore) predictions.push({
      gameId:g.gameId, date:g.date, season:g.seasonYear, week:g.week,
      league, home:g.homeTeamName, away:g.awayTeamName,
      p, outcome:getResult(g), sample, neutral:g.neutralSite === true,
      homeRating:Math.round(home.rating), awayRating:Math.round(away.rating)
    })
    updateTeams(home,away,g,p,params)
    ratings.set(hKey,home)
    ratings.set(aKey,away)
  }
  return {predictions, ratings, gamesUsed:all.length,
    teamsRated:ratings.size, params}
}

export function summarize(predictions) {
  if (!predictions.length) return {n:0,brier:null,logLoss:null,accuracy:null,avgSample:0}
  const n=predictions.length
  const brier=predictions.reduce((s,g)=>s+(g.p-g.outcome)**2,0)/n
  const logLoss=predictions.reduce((s,g)=>s-(g.outcome*Math.log(Math.max(g.p,1e-8))+
       (1-g.outcome)*Math.log(Math.max(1-g.p,1e-8))),0)/n
  const accuracy=predictions.filter(g=>(g.p >= .5)===(g.outcome===1)).length/n
  const avgSample=predictions.reduce((s,g)=>s+g.sample,0)/n
  return {n,brier:+brier.toFixed(5),logLoss:+logLoss.toFixed(5),
    accuracy:+accuracy.toFixed(5),avgSample:+avgSample.toFixed(2)}
}

function scoreYear(predictions,season) {
  return summarize(predictions.filter(p=>p.season===season))
}

/** Tune against 2024 only; 2025/2026 remain strictly untouched holdout sets. */
export function runBacktest(games, league) {
  const base=FOOTBALL_PARAMS[league]
  if (!base) throw new Error('Unsupported league: '+league)
  const choices=[
    {name:'current-season-reset',regression:1, memory:0},
    {name:'carry-25',regression:.75,memory:.3},
    {name:'carry-45',regression:.55,memory:.45},
    {name:'carry-65',regression:.35,memory:.65},
    {name:'carry-80',regression:.2,memory:.8}
  ]
  const results=choices.map(choice=>{
    const config={...base,...choice}
    const computed=evaluateElo(games,league,config)
    const byYear={}
    for (const year of [2024,2025,2026]) byYear[year]=scoreYear(computed.predictions,year)
    return {name:choice.name,params:config,byYear,computed}
  })
  const eligible=results.filter(v=>v.byYear[2024].n>=
    (league==='NFL'?200:350))
  if(!eligible.length) throw new Error('Incomplete 2024 validation data for '+league)
  eligible.sort((a,b)=>a.byYear[2024].brier-b.byYear[2024].brier)
  const best=eligible[0]
  // Pure home field baseline: fitted ONLY to prior years.
  const prior=best.computed.predictions.filter(p=>p.season<=2023 && !p.neutral)
  const homeRate=prior.length?prior.reduce((s,p)=>s+p.outcome,0)/prior.length:.5
  const baselines={}
  for(const yr of [2024,2025,2026]){
    const gamesOfYear=best.computed.predictions.filter(p=>p.season===yr)
    baselines[yr]=summarize(gamesOfYear.map(p=>({...p,p:p.neutral?.5:homeRate})))
  }
  return {league,selectedOn:'2024 validation Brier only',winner:best.name,
    params:best.params,homeBaselineRate:+homeRate.toFixed(4),
    gamesUsed:best.computed.gamesUsed,teamsRated:best.computed.teamsRated,
    baseline:baselines,
    results:results.map(v=>({name:v.name,byYear:v.byYear})),
    holdout2025:best.byYear[2025],holdout2026:best.byYear[2026],
    diagnostics:{year2026EligibleEvidence:
      best.computed.predictions.filter(p=>p.season===2026).map(p=>p.sample).sort((a,b)=>a-b)}
  }
}
