/**
 * Team-Specific Home Court/Field/Ice Advantage Module
 * 
 * This module tracks and calculates team-specific home advantage instead of
 * using league-wide averages. Some teams are significantly better at home
 * than others, and this can provide an edge over Vegas.
 * 
 * Key insights:
 * - League average HCA is ~3-4% in most sports
 * - Some teams have HCA of 8%+ (e.g., Denver Nuggets altitude, college teams)
 * - Some teams have minimal HCA (<2%)
 * - This variance is often underweighted by betting markets
 */

import { kvHset, kvHget, isDbConfigured } from '@/lib/pg-kv'

// ============================================
// TYPES
// ============================================

export interface TeamHomeStats {
  teamName: string
  league: string
  season: string
  
  // Home record
  homeWins: number
  homeLosses: number
  homeWinPct: number
  
  // Away record
  awayWins: number
  awayLosses: number
  awayWinPct: number
  
  // Home advantage metrics
  homeAdvantage: number           // Difference: homeWinPct - awayWinPct
  homeAdvantageVsLeague: number   // How much better/worse than league average
  
  // Point differential
  homePointDiff: number           // Average point differential at home
  awayPointDiff: number           // Average point differential away
  
  // Confidence
  sampleSize: number              // Total games played
  confidence: 'high' | 'medium' | 'low'
  
  lastUpdated: string
}

export interface LeagueHomeAdverage {
  league: string
  season: string
  averageHomeWinPct: number
  averageHomeAdvantage: number    // League-wide home advantage
  standardDeviation: number       // How much teams vary
  lastUpdated: string
}

export interface HomeAdvantageAdjustment {
  teamName: string
  isHome: boolean
  
  // Raw stats
  teamHomeAdvantage: number       // Team's specific HCA
  leagueAverage: number           // League average HCA
  
  // Adjustment
  adjustment: number              // Probability adjustment vs using league average
  
  // Context
  notes: string[]
  confidence: 'high' | 'medium' | 'low'
}

// ============================================
// CONSTANTS
// ============================================

// Default league-wide home advantages (used when no data available)
const DEFAULT_LEAGUE_HCA: Record<string, number> = {
  'NBA': 0.035,       // ~3.5% home advantage
  'NHL': 0.030,       // ~3% home advantage
  'MLB': 0.025,       // ~2.5% home advantage (smallest in major sports)
  'NFL': 0.035,       // ~3.5% home advantage
  'NCAAB': 0.045,     // ~4.5% home advantage (college crowds are intense)
  'NCAAF': 0.040,     // ~4% home advantage
  'soccer_epl': 0.035,
  'soccer_spain_la_liga': 0.035,
  'soccer_germany_bundesliga': 0.035,
  'soccer_italy_serie_a': 0.035,
  'soccer_france_ligue_one': 0.035,
  'soccer_usa_mls': 0.030,
  'soccer_uefa_champs_league': 0.030,
}

// Teams with known exceptional home advantages
// These are used as priors when we don't have enough data
const KNOWN_STRONG_HOME_TEAMS: Record<string, string[]> = {
  'NBA': [
    'Denver Nuggets',     // Altitude advantage
    'Utah Jazz',          // Altitude + crowd
    'Miami Heat',         // Crowd intensity
  ],
  'NFL': [
    'Seattle Seahawks',   // 12th man, loud stadium
    'Kansas City Chiefs', // Arrowhead Stadium
    'New Orleans Saints', // Superdome
  ],
  'NCAAB': [
    'Duke Blue Devils',   // Cameron Indoor
    'Kansas Jayhawks',    // Allen Fieldhouse
    'Kentucky Wildcats',  // Rupp Arena
    'Gonzaga Bulldogs',   // The Kennel
  ],
  'NCAAF': [
    'LSU Tigers',         // Death Valley at night
    'Clemson Tigers',     // Death Valley
    'Ohio State Buckeyes', // The Horseshoe
    'Alabama Crimson Tide', // Bryant-Denny
  ],
}

// Redis keys
const TEAM_HOME_STATS_KEY = 'home_advantage:team_stats'
const LEAGUE_AVERAGES_KEY = 'home_advantage:league_averages'

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '')
    .trim()
}

/**
 * Store team home stats
 */
export async function storeTeamHomeStats(stats: TeamHomeStats): Promise<void> {
  if (!isDbConfigured()) return
  
  try {
    const key = `${stats.league}_${normalizeTeamName(stats.teamName)}_${stats.season}`
    await kvHset(TEAM_HOME_STATS_KEY, key, JSON.stringify(stats))
    console.log(`[HomeAdvantage] Stored stats for ${stats.teamName}`)
  } catch (error) {
    console.error('[HomeAdvantage] Error storing stats:', error)
  }
}

/**
 * Get team home stats
 */
export async function getTeamHomeStats(
  teamName: string,
  league: string,
  season?: string
): Promise<TeamHomeStats | null> {
  if (!isDbConfigured()) return null
  
  const currentSeason = season || getCurrentSeason(league)
  
  try {
    const key = `${league}_${normalizeTeamName(teamName)}_${currentSeason}`
    const data = await kvHget(TEAM_HOME_STATS_KEY, key)
    if (!data) return null
    return JSON.parse(data) as TeamHomeStats
  } catch (error) {
    console.error('[HomeAdvantage] Error getting stats:', error)
    return null
  }
}

/**
 * Store league averages
 */
export async function storeLeagueAverages(averages: LeagueHomeAdverage): Promise<void> {
  if (!isDbConfigured()) return
  
  try {
    const key = `${averages.league}_${averages.season}`
    await kvHset(LEAGUE_AVERAGES_KEY, key, JSON.stringify(averages))
  } catch (error) {
    console.error('[HomeAdvantage] Error storing league averages:', error)
  }
}

/**
 * Get league averages
 */
export async function getLeagueAverages(
  league: string,
  season?: string
): Promise<LeagueHomeAdverage | null> {
  if (!isDbConfigured()) return null
  
  const currentSeason = season || getCurrentSeason(league)
  
  try {
    const key = `${league}_${currentSeason}`
    const data = await kvHget(LEAGUE_AVERAGES_KEY, key)
    if (!data) return null
    return JSON.parse(data) as LeagueHomeAdverage
  } catch (error) {
    console.error('[HomeAdvantage] Error getting league averages:', error)
    return null
  }
}

/**
 * Get current season string based on league
 */
function getCurrentSeason(league: string): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  
  // Different leagues have different season structures
  if (league === 'NFL' || league === 'NCAAF') {
    // NFL/NCAAF season spans Aug-Feb
    return month >= 8 ? `${year}` : `${year - 1}`
  } else if (league === 'NBA' || league === 'NHL' || league === 'NCAAB') {
    // NBA/NHL/NCAAB season spans Oct-June
    return month >= 10 ? `${year}-${year + 1}` : `${year - 1}-${year}`
  } else if (league === 'MLB') {
    // MLB season is within calendar year
    return `${year}`
  } else {
    // Soccer leagues typically span Aug-May
    return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`
  }
}

/**
 * Check if team is known to have strong home advantage
 */
function isKnownStrongHomeTeam(teamName: string, league: string): boolean {
  const strongTeams = KNOWN_STRONG_HOME_TEAMS[league] || []
  const normTeam = normalizeTeamName(teamName)
  
  return strongTeams.some(t => {
    const normStrong = normalizeTeamName(t)
    return normTeam.includes(normStrong) || normStrong.includes(normTeam)
  })
}

/**
 * Calculate home advantage adjustment for a team
 * Returns the adjustment to apply to probability when team is at home
 */
export async function calculateHomeAdvantageAdjustment(
  teamName: string,
  league: string,
  isHome: boolean
): Promise<HomeAdvantageAdjustment> {
  const notes: string[] = []
  
  // Get team-specific stats
  const teamStats = await getTeamHomeStats(teamName, league)
  const leagueAvg = await getLeagueAverages(league)
  
  // Default league HCA
  const defaultHCA = DEFAULT_LEAGUE_HCA[league] || 0.035
  const leagueAverage = leagueAvg?.averageHomeAdvantage || defaultHCA
  
  let teamHomeAdvantage: number
  let confidence: 'high' | 'medium' | 'low'
  
  if (teamStats && teamStats.sampleSize >= 20) {
    // We have enough data - use team-specific HCA
    teamHomeAdvantage = teamStats.homeAdvantage
    confidence = teamStats.confidence
    
    if (teamHomeAdvantage > leagueAverage + 0.03) {
      notes.push(`Strong home team: ${(teamHomeAdvantage * 100).toFixed(1)}% HCA vs ${(leagueAverage * 100).toFixed(1)}% league avg`)
    } else if (teamHomeAdvantage < leagueAverage - 0.02) {
      notes.push(`Weak home team: ${(teamHomeAdvantage * 100).toFixed(1)}% HCA vs ${(leagueAverage * 100).toFixed(1)}% league avg`)
    }
  } else if (teamStats && teamStats.sampleSize >= 10) {
    // Some data - blend with league average
    const weight = teamStats.sampleSize / 30 // Weight increases with sample size
    teamHomeAdvantage = (teamStats.homeAdvantage * weight) + (leagueAverage * (1 - weight))
    confidence = 'medium'
    notes.push('Limited sample size - blending with league average')
  } else {
    // No data - use league average with known team adjustments
    teamHomeAdvantage = leagueAverage
    confidence = 'low'
    
    // Apply known strong home team bonus
    if (isKnownStrongHomeTeam(teamName, league)) {
      teamHomeAdvantage += 0.02 // +2% for known strong home teams
      notes.push('Known strong home team (+2%)')
    }
  }
  
  // Calculate adjustment vs using league average
  // If team has stronger HCA than average, they get a boost at home
  const adjustment = isHome 
    ? (teamHomeAdvantage - leagueAverage) / 2  // Half the difference as adjustment
    : -(teamHomeAdvantage - leagueAverage) / 2 // Inverse for away team
  
  if (Math.abs(adjustment) > 0.005) {
    const direction = adjustment > 0 ? '+' : ''
    notes.push(`Home advantage adjustment: ${direction}${(adjustment * 100).toFixed(1)}%`)
  }
  
  return {
    teamName,
    isHome,
    teamHomeAdvantage,
    leagueAverage,
    adjustment,
    notes,
    confidence,
  }
}

/**
 * Calculate home stats from game results
 * This can be called by a cron job to update team stats
 */
export function calculateTeamHomeStats(
  teamName: string,
  league: string,
  season: string,
  games: Array<{
    isHome: boolean
    won: boolean
    pointDiff: number
  }>
): TeamHomeStats {
  const homeGames = games.filter(g => g.isHome)
  const awayGames = games.filter(g => !g.isHome)
  
  const homeWins = homeGames.filter(g => g.won).length
  const homeLosses = homeGames.filter(g => !g.won).length
  const awayWins = awayGames.filter(g => g.won).length
  const awayLosses = awayGames.filter(g => !g.won).length
  
  const homeWinPct = homeGames.length > 0 ? homeWins / homeGames.length : 0.5
  const awayWinPct = awayGames.length > 0 ? awayWins / awayGames.length : 0.5
  
  const homePointDiff = homeGames.length > 0
    ? homeGames.reduce((sum, g) => sum + g.pointDiff, 0) / homeGames.length
    : 0
  const awayPointDiff = awayGames.length > 0
    ? awayGames.reduce((sum, g) => sum + g.pointDiff, 0) / awayGames.length
    : 0
  
  const homeAdvantage = homeWinPct - awayWinPct
  const leagueAvg = DEFAULT_LEAGUE_HCA[league] || 0.035
  const homeAdvantageVsLeague = homeAdvantage - leagueAvg
  
  const sampleSize = games.length
  let confidence: 'high' | 'medium' | 'low'
  if (sampleSize >= 40) confidence = 'high'
  else if (sampleSize >= 20) confidence = 'medium'
  else confidence = 'low'
  
  return {
    teamName,
    league,
    season,
    homeWins,
    homeLosses,
    homeWinPct,
    awayWins,
    awayLosses,
    awayWinPct,
    homeAdvantage,
    homeAdvantageVsLeague,
    homePointDiff,
    awayPointDiff,
    sampleSize,
    confidence,
    lastUpdated: new Date().toISOString(),
  }
}

/**
 * Calculate league-wide averages from all team stats
 */
export function calculateLeagueAverages(
  league: string,
  season: string,
  allTeamStats: TeamHomeStats[]
): LeagueHomeAdverage {
  if (allTeamStats.length === 0) {
    return {
      league,
      season,
      averageHomeWinPct: 0.5 + (DEFAULT_LEAGUE_HCA[league] || 0.035) / 2,
      averageHomeAdvantage: DEFAULT_LEAGUE_HCA[league] || 0.035,
      standardDeviation: 0.05,
      lastUpdated: new Date().toISOString(),
    }
  }
  
  const homeAdvantages = allTeamStats.map(s => s.homeAdvantage)
  const avgHomeAdvantage = homeAdvantages.reduce((a, b) => a + b, 0) / homeAdvantages.length
  
  const avgHomeWinPct = allTeamStats.reduce((sum, s) => sum + s.homeWinPct, 0) / allTeamStats.length
  
  // Calculate standard deviation
  const squaredDiffs = homeAdvantages.map(ha => Math.pow(ha - avgHomeAdvantage, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length
  const standardDeviation = Math.sqrt(avgSquaredDiff)
  
  return {
    league,
    season,
    averageHomeWinPct: avgHomeWinPct,
    averageHomeAdvantage: avgHomeAdvantage,
    standardDeviation,
    lastUpdated: new Date().toISOString(),
  }
}

/**
 * Format home advantage info for display
 */
export function formatHomeAdvantageForDisplay(adjustment: HomeAdvantageAdjustment): string {
  const lines: string[] = []
  
  const location = adjustment.isHome ? 'HOME' : 'AWAY'
  lines.push(`${adjustment.teamName} (${location})`)
  lines.push(`  Team HCA: ${(adjustment.teamHomeAdvantage * 100).toFixed(1)}%`)
  lines.push(`  League Avg: ${(adjustment.leagueAverage * 100).toFixed(1)}%`)
  
  if (Math.abs(adjustment.adjustment) > 0.005) {
    const sign = adjustment.adjustment > 0 ? '+' : ''
    lines.push(`  Adjustment: ${sign}${(adjustment.adjustment * 100).toFixed(1)}%`)
  }
  
  if (adjustment.notes.length > 0) {
    for (const note of adjustment.notes) {
      lines.push(`  - ${note}`)
    }
  }
  
  lines.push(`  Confidence: ${adjustment.confidence}`)
  
  return lines.join('\n')
}

/**
 * Get combined home advantage adjustment for a game
 * Returns net adjustment for home team
 */
export async function getGameHomeAdvantageAdjustment(
  homeTeam: string,
  awayTeam: string,
  league: string
): Promise<{
  homeTeamAdjustment: HomeAdvantageAdjustment
  awayTeamAdjustment: HomeAdvantageAdjustment
  netAdjustment: number
  notes: string[]
}> {
  const homeAdj = await calculateHomeAdvantageAdjustment(homeTeam, league, true)
  const awayAdj = await calculateHomeAdvantageAdjustment(awayTeam, league, false)
  
  // Net adjustment is home team's advantage minus away team's road performance
  const netAdjustment = homeAdj.adjustment - awayAdj.adjustment
  
  const notes: string[] = [...homeAdj.notes, ...awayAdj.notes]
  
  if (Math.abs(netAdjustment) > 0.01) {
    const sign = netAdjustment > 0 ? '+' : ''
    notes.push(`Net home advantage adjustment: ${sign}${(netAdjustment * 100).toFixed(1)}%`)
  }
  
  return {
    homeTeamAdjustment: homeAdj,
    awayTeamAdjustment: awayAdj,
    netAdjustment,
    notes,
  }
}
