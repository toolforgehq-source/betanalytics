/**
 * Calibration System Module
 * 
 * This module tracks predicted probabilities vs actual outcomes to:
 * 1. Measure model calibration (are 60% predictions hitting 60%?)
 * 2. Apply correction factors to improve accuracy over time
 * 3. Self-improve the model based on historical performance
 * 
 * A well-calibrated model is essential for profitable betting.
 */

import { kvHset, kvHget, kvHgetall, kvSet, isDbConfigured } from '@/lib/pg-kv'

// ============================================
// TYPES
// ============================================

export interface CalibrationRecord {
  id: string
  gameId: string
  sport: string
  betType: 'spread' | 'moneyline' | 'total' | 'prop'
  team: string
  
  // Prediction
  predictedProbability: number  // Our model's probability (0-1)
  probabilityBucket: string     // e.g., "55-60" for bucketing
  
  // Outcome
  outcome: 'win' | 'loss' | 'push' | 'pending'
  
  // Metadata
  timestamp: string
}

export interface CalibrationBucket {
  bucket: string              // e.g., "55-60"
  minProb: number
  maxProb: number
  midpoint: number            // Expected win rate for this bucket
  
  totalPicks: number
  wins: number
  losses: number
  pushes: number
  
  actualWinRate: number       // Actual win rate (wins / (wins + losses))
  calibrationError: number    // Difference from expected (actual - midpoint)
  correctionFactor: number    // Factor to apply to future predictions
}

export interface CalibrationStats {
  totalRecords: number
  completedRecords: number
  
  // Overall calibration
  meanCalibrationError: number    // Average error across all buckets
  brierScore: number              // Brier score (lower is better, 0 is perfect)
  
  // Buckets
  buckets: CalibrationBucket[]
  
  // By sport
  bySport: Record<string, {
    records: number
    meanError: number
    brierScore: number
  }>
  
  // By bet type
  byBetType: Record<string, {
    records: number
    meanError: number
    brierScore: number
  }>
}

// Redis keys
const CALIBRATION_RECORDS_KEY = 'calibration:records'
const CALIBRATION_FACTORS_KEY = 'calibration:factors'

// Probability buckets (5% increments)
const BUCKETS = [
  { bucket: '50-55', minProb: 0.50, maxProb: 0.55, midpoint: 0.525 },
  { bucket: '55-60', minProb: 0.55, maxProb: 0.60, midpoint: 0.575 },
  { bucket: '60-65', minProb: 0.60, maxProb: 0.65, midpoint: 0.625 },
  { bucket: '65-70', minProb: 0.65, maxProb: 0.70, midpoint: 0.675 },
  { bucket: '70-75', minProb: 0.70, maxProb: 0.75, midpoint: 0.725 },
  { bucket: '75-80', minProb: 0.75, maxProb: 0.80, midpoint: 0.775 },
  { bucket: '80-85', minProb: 0.80, maxProb: 0.85, midpoint: 0.825 },
  { bucket: '85-90', minProb: 0.85, maxProb: 0.90, midpoint: 0.875 },
  { bucket: '90-95', minProb: 0.90, maxProb: 0.95, midpoint: 0.925 },
  { bucket: '95-100', minProb: 0.95, maxProb: 1.00, midpoint: 0.975 },
]

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Get the bucket for a probability
 */
function getBucket(probability: number): typeof BUCKETS[0] | null {
  // Clamp probability to valid range
  const prob = Math.max(0.50, Math.min(0.999, probability))
  
  for (const bucket of BUCKETS) {
    if (prob >= bucket.minProb && prob < bucket.maxProb) {
      return bucket
    }
  }
  
  // Edge case: exactly 1.0
  if (prob >= 0.95) return BUCKETS[BUCKETS.length - 1]
  
  return null
}

/**
 * Store a calibration record
 */
export async function storeCalibrationRecord(
  record: Omit<CalibrationRecord, 'id' | 'probabilityBucket' | 'outcome' | 'timestamp'>
): Promise<CalibrationRecord | null> {
  if (!isDbConfigured()) return null
  
  const bucket = getBucket(record.predictedProbability)
  if (!bucket) {
    console.warn(`[Calibration] Invalid probability: ${record.predictedProbability}`)
    return null
  }
  
  const id = `${record.gameId}_${record.team}_${record.betType}_${Date.now()}`
  
  const fullRecord: CalibrationRecord = {
    ...record,
    id,
    probabilityBucket: bucket.bucket,
    outcome: 'pending',
    timestamp: new Date().toISOString()
  }
  
  try {
    await kvHset(CALIBRATION_RECORDS_KEY, id, JSON.stringify(fullRecord))
    console.log(`[Calibration] Stored record: ${record.team} ${record.betType} at ${(record.predictedProbability * 100).toFixed(1)}%`)
    return fullRecord
  } catch (error) {
    console.error('[Calibration] Error storing record:', error)
    return null
  }
}

/**
 * Update a record with outcome
 */
export async function updateCalibrationOutcome(
  recordId: string,
  outcome: 'win' | 'loss' | 'push'
): Promise<CalibrationRecord | null> {
  if (!isDbConfigured()) return null
  
  try {
    const recordData = await kvHget(CALIBRATION_RECORDS_KEY, recordId)
    if (!recordData) return null
    
    const record: CalibrationRecord = JSON.parse(recordData)
    const updatedRecord: CalibrationRecord = { ...record, outcome }
    
    await kvHset(CALIBRATION_RECORDS_KEY, recordId, JSON.stringify(updatedRecord))
    return updatedRecord
  } catch (error) {
    console.error('[Calibration] Error updating outcome:', error)
    return null
  }
}

/**
 * Get all calibration records
 */
export async function getAllCalibrationRecords(): Promise<CalibrationRecord[]> {
  if (!isDbConfigured()) return []
  
  try {
    const allRecords = await kvHgetall(CALIBRATION_RECORDS_KEY)
    if (!allRecords) return []
    
    return Object.values(allRecords).map(r => JSON.parse(r) as CalibrationRecord)
  } catch (error) {
    console.error('[Calibration] Error getting records:', error)
    return []
  }
}

/**
 * Calculate calibration statistics
 */
export async function calculateCalibrationStats(): Promise<CalibrationStats> {
  const records = await getAllCalibrationRecords()
  
  const stats: CalibrationStats = {
    totalRecords: records.length,
    completedRecords: 0,
    meanCalibrationError: 0,
    brierScore: 0,
    buckets: [],
    bySport: {},
    byBetType: {}
  }
  
  if (records.length === 0) return stats
  
  // Filter completed records (exclude pending and pushes for win rate calc)
  const completedRecords = records.filter(r => r.outcome === 'win' || r.outcome === 'loss')
  stats.completedRecords = completedRecords.length
  
  if (completedRecords.length === 0) return stats
  
  // Calculate Brier score
  let brierSum = 0
  for (const record of completedRecords) {
    const outcome = record.outcome === 'win' ? 1 : 0
    brierSum += Math.pow(record.predictedProbability - outcome, 2)
  }
  stats.brierScore = brierSum / completedRecords.length
  
  // Calculate bucket statistics
  const bucketMap = new Map<string, { wins: number; losses: number; pushes: number; total: number }>()
  
  for (const bucket of BUCKETS) {
    bucketMap.set(bucket.bucket, { wins: 0, losses: 0, pushes: 0, total: 0 })
  }
  
  for (const record of records) {
    const bucketData = bucketMap.get(record.probabilityBucket)
    if (bucketData) {
      bucketData.total++
      if (record.outcome === 'win') bucketData.wins++
      else if (record.outcome === 'loss') bucketData.losses++
      else if (record.outcome === 'push') bucketData.pushes++
    }
  }
  
  let totalCalibrationError = 0
  let bucketsWithData = 0
  
  for (const bucketDef of BUCKETS) {
    const data = bucketMap.get(bucketDef.bucket)!
    const decided = data.wins + data.losses
    
    const actualWinRate = decided > 0 ? data.wins / decided : 0
    const calibrationError = decided > 0 ? actualWinRate - bucketDef.midpoint : 0
    
    // Correction factor: if we're overconfident (actual < expected), reduce future predictions
    // If we're underconfident (actual > expected), increase future predictions
    const correctionFactor = decided >= 10 ? calibrationError : 0 // Only apply with enough data
    
    stats.buckets.push({
      bucket: bucketDef.bucket,
      minProb: bucketDef.minProb,
      maxProb: bucketDef.maxProb,
      midpoint: bucketDef.midpoint,
      totalPicks: data.total,
      wins: data.wins,
      losses: data.losses,
      pushes: data.pushes,
      actualWinRate,
      calibrationError,
      correctionFactor
    })
    
    if (decided > 0) {
      totalCalibrationError += Math.abs(calibrationError)
      bucketsWithData++
    }
  }
  
  stats.meanCalibrationError = bucketsWithData > 0 ? totalCalibrationError / bucketsWithData : 0
  
  // By sport
  const sportGroups = new Map<string, CalibrationRecord[]>()
  for (const record of completedRecords) {
    const existing = sportGroups.get(record.sport) || []
    existing.push(record)
    sportGroups.set(record.sport, existing)
  }
  
  for (const [sport, sportRecords] of Array.from(sportGroups.entries())) {
    const wins = sportRecords.filter(r => r.outcome === 'win').length
    const actualRate = wins / sportRecords.length
    const expectedRate = sportRecords.reduce((sum, r) => sum + r.predictedProbability, 0) / sportRecords.length
    
    let sportBrier = 0
    for (const record of sportRecords) {
      const outcome = record.outcome === 'win' ? 1 : 0
      sportBrier += Math.pow(record.predictedProbability - outcome, 2)
    }
    
    stats.bySport[sport] = {
      records: sportRecords.length,
      meanError: actualRate - expectedRate,
      brierScore: sportBrier / sportRecords.length
    }
  }
  
  // By bet type
  const betTypeGroups = new Map<string, CalibrationRecord[]>()
  for (const record of completedRecords) {
    const existing = betTypeGroups.get(record.betType) || []
    existing.push(record)
    betTypeGroups.set(record.betType, existing)
  }
  
  for (const [betType, typeRecords] of Array.from(betTypeGroups.entries())) {
    const wins = typeRecords.filter(r => r.outcome === 'win').length
    const actualRate = wins / typeRecords.length
    const expectedRate = typeRecords.reduce((sum, r) => sum + r.predictedProbability, 0) / typeRecords.length
    
    let typeBrier = 0
    for (const record of typeRecords) {
      const outcome = record.outcome === 'win' ? 1 : 0
      typeBrier += Math.pow(record.predictedProbability - outcome, 2)
    }
    
    stats.byBetType[betType] = {
      records: typeRecords.length,
      meanError: actualRate - expectedRate,
      brierScore: typeBrier / typeRecords.length
    }
  }
  
  return stats
}

/**
 * Static regression-to-mean calibration (Platt scaling approximation)
 * 
 * This compresses extreme probabilities toward 50% to counteract Elo overconfidence.
 * Even with the sport-specific scaling factors in elo.ts, the blended probability
 * can still be too extreme because:
 * 1. Elo doesn't account for day-to-day variance (injuries, rest, motivation)
 * 2. Sports have more randomness than pure skill suggests
 * 3. The best team in any sport still loses 30-40% of their games
 *
 * The compression factor (0.85) is calibrated from historical sports betting data:
 *   - Raw 75% → Calibrated 71.25% (much closer to real outcomes)
 *   - Raw 60% → Calibrated 58.5% (small adjustment for moderate confidence)
 *   - Raw 50% → Calibrated 50% (no change at coin flip)
 *
 * This is applied BEFORE the historical bucket correction, so both work together:
 *   Step 1: Static compression prevents wild overconfidence
 *   Step 2: Historical correction fine-tunes based on actual results (once we have data)
 */
const STATIC_COMPRESSION = 0.85  // Compress distance from 50% by 15%

/**
 * Sport-specific calibration corrections based on historical performance.
 * 
 * Historical data (31 settled picks):
 *   NCAAB: 18-9 (67%) — model's 60-65% bucket overestimates by ~4%
 *   NHL: 1-2 (33%) — model severely overestimates hockey
 *   Soccer: 0-1 (0%) — model severely overestimates soccer
 * 
 * These multipliers are applied to the distance from 50% AFTER static compression,
 * further compressing probabilities for sports where the model is overconfident.
 * 
 * Example for NCAAB (0.94x): 62% → distance = 12% → compressed = 12% * 0.94 = 11.28% → 61.28%
 * Example for NHL (0.80x): 62% → distance = 12% → compressed = 12% * 0.80 = 9.6% → 59.6%
 */
const SPORT_CALIBRATION_CORRECTIONS: Record<string, number> = {
  // NCAAB: slight overconfidence (-4% in 60-65% bucket)
  'basketball_ncaab': 0.94,
  // NHL: severe overconfidence (model says ~55% but actual is ~33%)
  'icehockey_nhl': 0.80,
  // MLB: moderate overconfidence — baseball is inherently high-variance
  // (best teams win ~60%, worst ~40%), so compress predictions toward 50%
  'baseball_mlb': 0.88,
  // Soccer leagues: severe overconfidence (0% actual on limited data)
  'soccer_spain_la_liga': 0.75,
  'soccer_epl': 0.75,
  'soccer_germany_bundesliga': 0.75,
  'soccer_italy_serie_a': 0.75,
  'soccer_france_ligue_one': 0.75,
}

function applyStaticCalibration(rawProbability: number, sport?: string): number {
  // Step 1: Compress toward 0.5: calibrated = 0.5 + compression * (raw - 0.5)
  let calibrated = 0.5 + STATIC_COMPRESSION * (rawProbability - 0.5)
  
  // Step 2: Apply sport-specific correction if available
  if (sport) {
    const sportCorrection = SPORT_CALIBRATION_CORRECTIONS[sport.toLowerCase()]
    if (sportCorrection !== undefined) {
      calibrated = 0.5 + sportCorrection * (calibrated - 0.5)
    }
  }
  
  return calibrated
}

/**
 * Get correction factor for a probability
 * Returns the adjusted probability based on:
 * 1. Static compression (always active — prevents extreme overconfidence)
 * 2. Historical calibration (active after 30+ settled bets — fine-tunes from actual results)
 */
export async function getCalibratedProbability(
  rawProbability: number,
  sport?: string
): Promise<number> {
  // Step 1: Always apply static compression (+ sport-specific correction) to prevent overconfident extremes
  let calibratedProb = applyStaticCalibration(rawProbability, sport)
  
  // Step 2: If we have enough historical data, also apply bucket correction
  const stats = await calculateCalibrationStats()
  
  // Threshold lowered from 50 to 30 to activate historical correction sooner.
  // With 30+ settled picks, the bucket correction provides meaningful signal
  // that improves probability accuracy for Kelly Criterion sizing.
  if (stats.completedRecords >= 30) {
    const bucket = stats.buckets.find(b => 
      calibratedProb >= b.minProb && calibratedProb < b.maxProb
    )
    
    if (bucket && bucket.totalPicks >= 10) {
      // Apply historical correction on top of static compression
      calibratedProb = calibratedProb + bucket.correctionFactor
    }
  }
  
  // Clamp to valid range
  return Math.max(0.01, Math.min(0.99, calibratedProb))
}

/**
 * Store calibration factors for quick lookup
 */
export async function storeCalibrationFactors(): Promise<void> {
  if (!isDbConfigured()) return
  
  const stats = await calculateCalibrationStats()
  
  const factors: Record<string, number> = {}
  for (const bucket of stats.buckets) {
    if (bucket.totalPicks >= 10) {
      factors[bucket.bucket] = bucket.correctionFactor
    }
  }
  
  try {
    await kvSet(CALIBRATION_FACTORS_KEY, JSON.stringify(factors))
    console.log('[Calibration] Stored calibration factors')
  } catch (error) {
    console.error('[Calibration] Error storing factors:', error)
  }
}

/**
 * Format calibration stats for display
 */
export function formatCalibrationStatsForDisplay(stats: CalibrationStats): string {
  const lines: string[] = [
    '📈 MODEL CALIBRATION REPORT',
    '═══════════════════════════════════',
    '',
    `Total Records: ${stats.totalRecords}`,
    `Completed (Win/Loss): ${stats.completedRecords}`,
    '',
    `Brier Score: ${stats.brierScore.toFixed(4)} (lower is better, 0.25 = random)`,
    `Mean Calibration Error: ${(stats.meanCalibrationError * 100).toFixed(1)}%`,
    ''
  ]
  
  if (stats.buckets.some(b => b.totalPicks > 0)) {
    lines.push('CALIBRATION BY PROBABILITY BUCKET:')
    lines.push('Bucket     | Picks | Wins | Actual | Expected | Error')
    lines.push('-----------|-------|------|--------|----------|------')
    
    for (const bucket of stats.buckets) {
      if (bucket.totalPicks > 0) {
        const decided = bucket.wins + bucket.losses
        const actualStr = decided > 0 ? `${(bucket.actualWinRate * 100).toFixed(0)}%` : 'N/A'
        const expectedStr = `${(bucket.midpoint * 100).toFixed(0)}%`
        const errorStr = decided > 0 ? `${bucket.calibrationError > 0 ? '+' : ''}${(bucket.calibrationError * 100).toFixed(1)}%` : 'N/A'
        
        lines.push(`${bucket.bucket.padEnd(10)} | ${String(bucket.totalPicks).padStart(5)} | ${String(bucket.wins).padStart(4)} | ${actualStr.padStart(6)} | ${expectedStr.padStart(8)} | ${errorStr.padStart(5)}`)
      }
    }
    lines.push('')
  }
  
  if (Object.keys(stats.bySport).length > 0) {
    lines.push('BY SPORT:')
    for (const [sport, sportStats] of Object.entries(stats.bySport)) {
      const errorStr = sportStats.meanError > 0 ? '+' : ''
      lines.push(`  ${sport}: ${sportStats.records} picks, ${errorStr}${(sportStats.meanError * 100).toFixed(1)}% error, Brier: ${sportStats.brierScore.toFixed(3)}`)
    }
    lines.push('')
  }
  
  if (Object.keys(stats.byBetType).length > 0) {
    lines.push('BY BET TYPE:')
    for (const [betType, typeStats] of Object.entries(stats.byBetType)) {
      const errorStr = typeStats.meanError > 0 ? '+' : ''
      lines.push(`  ${betType}: ${typeStats.records} picks, ${errorStr}${(typeStats.meanError * 100).toFixed(1)}% error, Brier: ${typeStats.brierScore.toFixed(3)}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * Interpret calibration quality
 */
export function interpretCalibration(brierScore: number, meanError: number): string {
  if (brierScore < 0.20 && meanError < 0.03) {
    return 'EXCELLENT - Model is well-calibrated. Predictions closely match actual outcomes.'
  } else if (brierScore < 0.22 && meanError < 0.05) {
    return 'GOOD - Model is reasonably calibrated. Minor adjustments may help.'
  } else if (brierScore < 0.25) {
    return 'FAIR - Model needs calibration. Consider applying correction factors.'
  } else {
    return 'POOR - Model is poorly calibrated (worse than random). Significant adjustments needed.'
  }
}
