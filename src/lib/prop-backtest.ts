/**
 * Player Prop Backtesting Engine
 *
 * Runs the model against historical game logs to measure actual accuracy.
 * For each player with enough tracked games, simulates walk-forward predictions:
 *   - Uses games before index i as "history" to build averages/stddev
 *   - Predicts over/under for game i using those stats
 *   - Compares prediction to actual result
 *   - Aggregates calibration, hit rate, and ROI metrics
 */

import { getPlayerStatsData, calculateOverProbability, calculateOverProbabilityPoisson } from './player-stats'

const COUNT_STATS = new Set([
  'threePointersMade', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns',
  'goals', 'homeRuns', 'steals', 'blocks',
])

const SPORT_STATS: Record<string, string[]> = {
  NBA: ['points', 'rebounds', 'assists', 'threePointersMade'],
  NCAAB: ['points', 'rebounds', 'assists', 'threePointersMade'],
  NFL: ['passingYards', 'rushingYards', 'receivingYards', 'passingTouchdowns'],
  NCAAF: ['passingYards', 'rushingYards', 'receivingYards', 'passingTouchdowns'],
  NHL: ['goals', 'hockeyAssists', 'shots'],
  MLB: ['hits', 'homeRuns', 'rbis', 'strikeouts'],
}

const MODEL_WEIGHT_VS_MARKET = 0.35

export interface BacktestPrediction {
  playerName: string
  sport: string
  statType: string
  line: number
  predictedProb: number
  actualValue: number
  hit: boolean
  confidence: 'high' | 'medium' | 'low'
}

export interface CalibrationBucket {
  range: string
  predictedAvg: number
  actualHitRate: number
  count: number
}

export interface BacktestResults {
  totalPredictions: number
  overallHitRate: number
  overallCalibrationError: number
  calibrationBuckets: CalibrationBucket[]
  byStatType: Record<string, { predictions: number; hitRate: number; calibrationError: number }>
  bySport: Record<string, { predictions: number; hitRate: number; calibrationError: number }>
  byConfidence: Record<string, { predictions: number; hitRate: number }>
  simulatedROI: number
  playersAnalyzed: number
  timestamp: string
}

function weightedAverage(values: number[], decay: number): number {
  if (values.length === 0) return 0
  let wSum = 0
  let wTotal = 0
  for (let i = 0; i < values.length; i++) {
    const w = Math.pow(decay, i)
    wSum += values[i] * w
    wTotal += w
  }
  return wTotal > 0 ? wSum / wTotal : 0
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return mean * 0.3
  const sq = values.map(v => Math.pow(v - mean, 2))
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / sq.length)
}

export async function runPropBacktest(): Promise<BacktestResults> {
  const statsData = await getPlayerStatsData()
  const predictions: BacktestPrediction[] = []
  let playersAnalyzed = 0

  if (!statsData) {
    return emptyResults()
  }

  for (const player of Object.values(statsData.players)) {
    const logs = player.gameLogs
    if (logs.length < 8) continue

    const statTypes = SPORT_STATS[player.sport] || []
    if (statTypes.length === 0) continue

    playersAnalyzed++

    for (const stat of statTypes) {
      const allValues = logs
        .map(log => (log as unknown as Record<string, number | undefined>)[stat])
        .filter((v): v is number => v !== undefined && v !== null)

      if (allValues.length < 8) continue

      for (let i = 0; i < Math.min(allValues.length - 5, 5); i++) {
        const actualValue = allValues[i]
        const historyValues = allValues.slice(i + 1)

        if (historyValues.length < 5) continue

        const avg = weightedAverage(historyValues.slice(0, 20), 0.85)
        const sd = stdDev(historyValues.slice(0, 20), avg)

        const line = avg

        const recentSlice = historyValues.slice(0, 5)
        const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length

        const recentMinutes = logs.slice(i + 1, i + 6).map(l => l.minutes).filter(m => m > 0)
        const seasonMinutes = player.averages.minutes || 0
        let minutesMult = 1.0
        if (recentMinutes.length >= 3 && seasonMinutes > 0) {
          const recentMinAvg = recentMinutes.reduce((a, b) => a + b, 0) / recentMinutes.length
          const projected = seasonMinutes * 0.5 + recentMinAvg * 0.5
          minutesMult = Math.max(0.75, Math.min(1.25, projected / seasonMinutes))
        }

        const adjustedAvg = avg * minutesMult
        const blendedAvg = adjustedAvg * 0.6 + recentAvg * minutesMult * 0.4

        const isCount = COUNT_STATS.has(stat)
        const statProb = isCount && blendedAvg > 0
          ? calculateOverProbabilityPoisson(blendedAvg, line)
          : calculateOverProbability(blendedAvg, sd, line, 1.0)

        const marketImplied = 0.5
        const blendedProb = (statProb * MODEL_WEIGHT_VS_MARKET) + (marketImplied * (1 - MODEL_WEIGHT_VS_MARKET))

        const gamesPlayed = historyValues.length
        const cv = avg > 0 ? sd / avg : 0.5
        const reliability = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)))

        let confidence: 'high' | 'medium' | 'low' = 'low'
        if (gamesPlayed >= 15 && reliability >= 65) confidence = 'high'
        else if (gamesPlayed >= 8 && reliability >= 50) confidence = 'medium'

        const pickOver = blendedProb > 0.5
        const predictedProb = pickOver ? blendedProb : (1 - blendedProb)

        const actualHit = pickOver ? actualValue > line : actualValue < line

        predictions.push({
          playerName: player.playerName,
          sport: player.sport,
          statType: stat,
          line,
          predictedProb: Math.max(0.15, Math.min(0.85, predictedProb)),
          actualValue,
          hit: actualHit,
          confidence,
        })
      }
    }
  }

  if (predictions.length === 0) return emptyResults()

  const overallHits = predictions.filter(p => p.hit).length
  const overallHitRate = overallHits / predictions.length

  const buckets: CalibrationBucket[] = []
  const ranges = [
    { min: 0.15, max: 0.40, label: '15-40%' },
    { min: 0.40, max: 0.50, label: '40-50%' },
    { min: 0.50, max: 0.55, label: '50-55%' },
    { min: 0.55, max: 0.60, label: '55-60%' },
    { min: 0.60, max: 0.70, label: '60-70%' },
    { min: 0.70, max: 0.85, label: '70-85%' },
  ]

  let totalCalError = 0
  let calBucketCount = 0

  for (const range of ranges) {
    const inBucket = predictions.filter(p => p.predictedProb >= range.min && p.predictedProb < range.max)
    if (inBucket.length === 0) continue

    const avgPred = inBucket.reduce((s, p) => s + p.predictedProb, 0) / inBucket.length
    const actualRate = inBucket.filter(p => p.hit).length / inBucket.length
    const error = Math.abs(avgPred - actualRate)

    totalCalError += error
    calBucketCount++

    buckets.push({
      range: range.label,
      predictedAvg: Math.round(avgPred * 1000) / 10,
      actualHitRate: Math.round(actualRate * 1000) / 10,
      count: inBucket.length,
    })
  }

  const overallCalibrationError = calBucketCount > 0 ? totalCalError / calBucketCount : 0

  const byStatType: BacktestResults['byStatType'] = {}
  const statGroups = new Map<string, BacktestPrediction[]>()
  for (const p of predictions) {
    const existing = statGroups.get(p.statType) || []
    existing.push(p)
    statGroups.set(p.statType, existing)
  }
  for (const [stat, preds] of Array.from(statGroups.entries())) {
    const hits = preds.filter(p => p.hit).length
    const avgPred = preds.reduce((s, p) => s + p.predictedProb, 0) / preds.length
    const actualRate = hits / preds.length
    byStatType[stat] = {
      predictions: preds.length,
      hitRate: Math.round(actualRate * 1000) / 10,
      calibrationError: Math.round(Math.abs(avgPred - actualRate) * 1000) / 10,
    }
  }

  const bySport: BacktestResults['bySport'] = {}
  const sportGroups = new Map<string, BacktestPrediction[]>()
  for (const p of predictions) {
    const existing = sportGroups.get(p.sport) || []
    existing.push(p)
    sportGroups.set(p.sport, existing)
  }
  for (const [sport, preds] of Array.from(sportGroups.entries())) {
    const hits = preds.filter(p => p.hit).length
    const avgPred = preds.reduce((s, p) => s + p.predictedProb, 0) / preds.length
    const actualRate = hits / preds.length
    bySport[sport] = {
      predictions: preds.length,
      hitRate: Math.round(actualRate * 1000) / 10,
      calibrationError: Math.round(Math.abs(avgPred - actualRate) * 1000) / 10,
    }
  }

  const byConfidence: BacktestResults['byConfidence'] = {}
  for (const conf of ['high', 'medium', 'low'] as const) {
    const preds = predictions.filter(p => p.confidence === conf)
    if (preds.length === 0) continue
    const hits = preds.filter(p => p.hit).length
    byConfidence[conf] = {
      predictions: preds.length,
      hitRate: Math.round((hits / preds.length) * 1000) / 10,
    }
  }

  let totalWagered = 0
  let totalReturned = 0
  for (const p of predictions) {
    if (p.predictedProb < 0.52) continue
    totalWagered += 100
    if (p.hit) {
      totalReturned += 100 + (100 / 1.1)
    }
  }
  const simulatedROI = totalWagered > 0
    ? Math.round(((totalReturned - totalWagered) / totalWagered) * 1000) / 10
    : 0

  return {
    totalPredictions: predictions.length,
    overallHitRate: Math.round(overallHitRate * 1000) / 10,
    overallCalibrationError: Math.round(overallCalibrationError * 1000) / 10,
    calibrationBuckets: buckets,
    byStatType,
    bySport,
    byConfidence,
    simulatedROI,
    playersAnalyzed,
    timestamp: new Date().toISOString(),
  }
}

export function formatBacktestResults(results: BacktestResults): string {
  const lines: string[] = [
    'PLAYER PROP MODEL BACKTEST',
    '==========================',
    '',
    `Players Analyzed: ${results.playersAnalyzed}`,
    `Total Predictions: ${results.totalPredictions}`,
    `Overall Hit Rate: ${results.overallHitRate}%`,
    `Calibration Error: ${results.overallCalibrationError}% (lower = better)`,
    `Simulated ROI: ${results.simulatedROI > 0 ? '+' : ''}${results.simulatedROI}%`,
    '',
  ]

  if (results.calibrationBuckets.length > 0) {
    lines.push('CALIBRATION (predicted vs actual):')
    for (const b of results.calibrationBuckets) {
      const diff = b.actualHitRate - b.predictedAvg
      const diffStr = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)
      lines.push(`  ${b.range}: predicted ${b.predictedAvg}% → actual ${b.actualHitRate}% (${diffStr}%, n=${b.count})`)
    }
    lines.push('')
  }

  if (Object.keys(results.bySport).length > 0) {
    lines.push('BY SPORT:')
    for (const [sport, data] of Object.entries(results.bySport)) {
      lines.push(`  ${sport}: ${data.hitRate}% hit rate, ${data.calibrationError}% cal error (n=${data.predictions})`)
    }
    lines.push('')
  }

  if (Object.keys(results.byStatType).length > 0) {
    lines.push('BY STAT TYPE:')
    for (const [stat, data] of Object.entries(results.byStatType)) {
      lines.push(`  ${stat}: ${data.hitRate}% hit rate, ${data.calibrationError}% cal error (n=${data.predictions})`)
    }
    lines.push('')
  }

  if (Object.keys(results.byConfidence).length > 0) {
    lines.push('BY CONFIDENCE:')
    for (const [conf, data] of Object.entries(results.byConfidence)) {
      lines.push(`  ${conf}: ${data.hitRate}% hit rate (n=${data.predictions})`)
    }
  }

  return lines.join('\n')
}

function emptyResults(): BacktestResults {
  return {
    totalPredictions: 0,
    overallHitRate: 0,
    overallCalibrationError: 0,
    calibrationBuckets: [],
    byStatType: {},
    bySport: {},
    byConfidence: {},
    simulatedROI: 0,
    playersAnalyzed: 0,
    timestamp: new Date().toISOString(),
  }
}
