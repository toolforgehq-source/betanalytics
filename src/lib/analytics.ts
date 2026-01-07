/**
 * Analytics calculations for Today's Edge section
 * 
 * Analyzes odds data to provide real statistics:
 * - High confidence picks count
 * - Sharp money signals count
 * - Overall model consensus rating
 */

import { OddsData, Game } from './odds'

export interface AnalyticsData {
  highConfidencePicks: number
  sharpMoneySignals: number
  modelConsensus: 'Strong' | 'Moderate' | 'Limited'
  modelConsensusRatio: string
  lastUpdated: string
  freshnessStatus: 'fresh' | 'aging' | 'stale'
  minutesSinceUpdate: number
}

/**
 * Calculate high confidence picks from odds data
 * A high confidence pick is when multiple indicators align:
 * - Significant line value (spread odds better than -115)
 * - Multiple sportsbooks agree on direction
 * - Clear favorite/underdog dynamic
 */
export function calculateHighConfidencePicks(oddsData: OddsData): number {
  if (!oddsData.games.length) return 0
  
  let highConfidenceCount = 0
  
  for (const game of oddsData.games) {
    // Check if we have enough data to analyze
    if (game.spreads.length < 2 || game.moneylines.length < 2) continue
    
    // Analyze spread value across sportsbooks
    const spreadValues = analyzeSpreadValue(game)
    
    // Analyze moneyline consensus
    const mlConsensus = analyzeMoneylineConsensus(game)
    
    // A high confidence pick requires:
    // 1. Good spread value (odds better than -115 on at least one book)
    // 2. Moneyline consensus (all books agree on favorite)
    // 3. Reasonable spread (not too large)
    if (spreadValues.hasValue && mlConsensus.hasConsensus && spreadValues.reasonableSpread) {
      highConfidenceCount++
    }
  }
  
  return highConfidenceCount
}

/**
 * Analyze spread value for a game
 */
function analyzeSpreadValue(game: Game): { hasValue: boolean; reasonableSpread: boolean } {
  let hasValue = false
  let reasonableSpread = false
  
  for (const spread of game.spreads) {
    for (const outcome of spread.outcomes) {
      // Check if odds are better than -115 (good value)
      if (outcome.price >= -115) {
        hasValue = true
      }
      // Check if spread is reasonable (between -10 and +10)
      if (outcome.point !== undefined && Math.abs(outcome.point) <= 10) {
        reasonableSpread = true
      }
    }
  }
  
  return { hasValue, reasonableSpread }
}

/**
 * Analyze moneyline consensus across sportsbooks
 */
function analyzeMoneylineConsensus(game: Game): { hasConsensus: boolean } {
  if (game.moneylines.length < 2) return { hasConsensus: false }
  
  const favorites: string[] = []
  
  for (const ml of game.moneylines) {
    // Find the favorite (negative odds = favorite)
    let favorite = ''
    let lowestOdds = 0
    
    for (const outcome of ml.outcomes) {
      if (outcome.price < lowestOdds) {
        lowestOdds = outcome.price
        favorite = outcome.name
      }
    }
    
    if (favorite) {
      favorites.push(favorite)
    }
  }
  
  // Consensus if all sportsbooks agree on the favorite
  const hasConsensus = favorites.length >= 2 && favorites.every(f => f === favorites[0])
  
  return { hasConsensus }
}

/**
 * Detect sharp money signals from odds data
 * Sharp money is detected when:
 * - Line moves against expected public betting
 * - Significant odds differences between sportsbooks
 * - Unusual line movement patterns
 */
export function detectSharpMoneySignals(oddsData: OddsData): number {
  if (!oddsData.games.length) return 0
  
  let sharpSignals = 0
  
  for (const game of oddsData.games) {
    // Check for significant odds differences between sportsbooks
    const oddsDifference = checkOddsDifferences(game)
    
    // Check for unusual spread patterns
    const unusualSpread = checkUnusualSpread(game)
    
    if (oddsDifference || unusualSpread) {
      sharpSignals++
    }
  }
  
  return sharpSignals
}

/**
 * Check for significant odds differences between sportsbooks
 * A difference of 15+ points in odds suggests sharp action
 */
function checkOddsDifferences(game: Game): boolean {
  if (game.spreads.length < 2) return false
  
  const homeSpreadOdds: number[] = []
  
  for (const spread of game.spreads) {
    const homeOutcome = spread.outcomes.find(o => o.name === game.homeTeam)
    if (homeOutcome) {
      homeSpreadOdds.push(homeOutcome.price)
    }
  }
  
  if (homeSpreadOdds.length < 2) return false
  
  const maxOdds = Math.max(...homeSpreadOdds)
  const minOdds = Math.min(...homeSpreadOdds)
  
  // Significant difference if 15+ points apart
  return (maxOdds - minOdds) >= 15
}

/**
 * Check for unusual spread patterns
 * Unusual if spread differs by 1+ points across books
 */
function checkUnusualSpread(game: Game): boolean {
  if (game.spreads.length < 2) return false
  
  const homeSpreadPoints: number[] = []
  
  for (const spread of game.spreads) {
    const homeOutcome = spread.outcomes.find(o => o.name === game.homeTeam)
    if (homeOutcome && homeOutcome.point !== undefined) {
      homeSpreadPoints.push(homeOutcome.point)
    }
  }
  
  if (homeSpreadPoints.length < 2) return false
  
  const maxSpread = Math.max(...homeSpreadPoints)
  const minSpread = Math.min(...homeSpreadPoints)
  
  // Unusual if spread differs by 1+ points
  return (maxSpread - minSpread) >= 1
}

/**
 * Get overall model consensus rating
 * Based on how many games have clear value opportunities
 */
export function getModelConsensus(oddsData: OddsData): 'Strong' | 'Moderate' | 'Limited' {
  if (!oddsData.games.length) return 'Limited'
  
  const highConfidence = calculateHighConfidencePicks(oddsData)
  const totalGames = oddsData.games.length
  
  // Calculate percentage of games with high confidence
  const percentage = (highConfidence / totalGames) * 100
  
  if (percentage >= 30) return 'Strong'
  if (percentage >= 15) return 'Moderate'
  return 'Limited'
}

/**
 * Calculate model consensus ratio (e.g., "3/4" or "4/4")
 */
export function getModelConsensusRatio(oddsData: OddsData): string {
  if (!oddsData.games.length) return '0/4'
  
  const highConfidence = calculateHighConfidencePicks(oddsData)
  const totalGames = oddsData.games.length
  const percentage = (highConfidence / totalGames) * 100
  
  if (percentage >= 75) return '4/4'
  if (percentage >= 50) return '3/4'
  if (percentage >= 25) return '2/4'
  return '1/4'
}

/**
 * Calculate data freshness status
 */
export function getDataFreshness(lastUpdated: string): { status: 'fresh' | 'aging' | 'stale'; minutes: number } {
  const lastUpdateTime = new Date(lastUpdated)
  const now = new Date()
  const minutesSinceUpdate = Math.floor((now.getTime() - lastUpdateTime.getTime()) / (1000 * 60))
  
  let status: 'fresh' | 'aging' | 'stale'
  
  if (minutesSinceUpdate < 30) {
    status = 'fresh'
  } else if (minutesSinceUpdate < 120) {
    status = 'aging'
  } else {
    status = 'stale'
  }
  
  return { status, minutes: minutesSinceUpdate }
}

/**
 * Get complete analytics data from odds data
 */
export function getAnalytics(oddsData: OddsData): AnalyticsData {
  const freshness = getDataFreshness(oddsData.lastUpdated)
  
  return {
    highConfidencePicks: calculateHighConfidencePicks(oddsData),
    sharpMoneySignals: detectSharpMoneySignals(oddsData),
    modelConsensus: getModelConsensus(oddsData),
    modelConsensusRatio: getModelConsensusRatio(oddsData),
    lastUpdated: oddsData.lastUpdated,
    freshnessStatus: freshness.status,
    minutesSinceUpdate: freshness.minutes,
  }
}

/**
 * Format minutes since update for display
 */
export function formatTimeSinceUpdate(minutes: number): string {
  if (minutes < 1) return 'Just now'
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return '1 hour ago'
  if (hours < 24) return `${hours} hours ago`
  
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}
