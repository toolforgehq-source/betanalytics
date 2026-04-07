/**
 * Motivation & Schedule Spot Factors Module
 * 
 * This module calculates motivation-based adjustments that Vegas often underweights:
 * 1. Rivalry games (increased intensity)
 * 2. Playoff elimination (reduced motivation for eliminated teams)
 * 3. Look-ahead spots (team may overlook current opponent for upcoming big game)
 * 4. Letdown spots (after big emotional win)
 * 5. Revenge games (lost to this opponent recently)
 * 
 * These factors are combined with other situational factors to adjust probabilities.
 */

import { kvHset, kvHget, kvHgetall, isDbConfigured } from '@/lib/pg-kv'

// ============================================
// TYPES
// ============================================

export interface MotivationFactors {
  // Rivalry
  isRivalryGame: boolean
  rivalryIntensity: 'none' | 'moderate' | 'intense'  // e.g., Lakers-Celtics is intense
  
  // Playoff situation
  isPlayoffEliminated: boolean      // Team eliminated from playoff contention
  isPlayoffClinched: boolean        // Team already clinched playoff spot (may rest players)
  playoffImplications: 'high' | 'medium' | 'low' | 'none'
  
  // Schedule spots
  isLookAheadSpot: boolean          // Big game coming up (may overlook current opponent)
  lookAheadOpponent: string | null  // Who they're looking ahead to
  isLetdownSpot: boolean            // After big emotional win
  previousGameContext: string | null // Context of previous game
  
  // Revenge
  isRevengeGame: boolean            // Lost to this opponent recently
  revengeContext: string | null     // e.g., "Lost by 20 at home last month"
  
  // Other motivation
  isHomeOpener: boolean             // First home game of season
  isSeasonFinale: boolean           // Last game of season
  coachOnHotSeat: boolean           // Coach job in jeopardy
  starPlayerReturn: boolean         // Key player returning from injury
}

export interface MotivationAdjustment {
  totalAdjustment: number
  breakdown: {
    rivalry: number
    playoffSituation: number
    scheduleSpot: number
    revenge: number
    other: number
  }
  factors: MotivationFactors
  notes: string[]
}

// ============================================
// ADJUSTMENT CONSTANTS
// ============================================

// Rivalry adjustments
const RIVALRY_ADJUSTMENTS = {
  'none': 0,
  'moderate': 0.015,    // +1.5% for moderate rivalry
  'intense': 0.025,     // +2.5% for intense rivalry (Lakers-Celtics, Yankees-Red Sox)
}

// Playoff situation adjustments
const PLAYOFF_ADJUSTMENTS = {
  eliminated: -0.03,    // -3% for eliminated teams (reduced motivation)
  clinched: -0.015,     // -1.5% for clinched teams (may rest players)
  highImplications: 0.02,  // +2% for high playoff implications
  mediumImplications: 0.01,
  lowImplications: 0,
}

// Schedule spot adjustments
const SCHEDULE_SPOT_ADJUSTMENTS = {
  lookAhead: -0.02,     // -2% for look-ahead spot
  letdown: -0.02,       // -2% for letdown spot
}

// Revenge adjustment
const REVENGE_ADJUSTMENT = 0.015  // +1.5% for revenge game

// Other motivation adjustments
const OTHER_ADJUSTMENTS = {
  homeOpener: 0.02,     // +2% for home opener (extra energy)
  seasonFinale: 0.01,   // +1% for season finale
  coachHotSeat: 0.015,  // +1.5% if coach job on the line
  starReturn: 0.02,     // +2% for star player returning
}

// ============================================
// RIVALRY DATA
// ============================================

// Known intense rivalries by sport
const RIVALRIES: Record<string, Array<[string, string, 'moderate' | 'intense']>> = {
  'NBA': [
    ['Lakers', 'Celtics', 'intense'],
    ['Lakers', 'Clippers', 'moderate'],
    ['Knicks', 'Nets', 'moderate'],
    ['Heat', 'Knicks', 'moderate'],
    ['Warriors', 'Cavaliers', 'moderate'],
    ['Mavericks', 'Spurs', 'moderate'],
    ['Bulls', 'Pistons', 'moderate'],
    ['Suns', 'Spurs', 'moderate'],
  ],
  'NFL': [
    ['Cowboys', 'Eagles', 'intense'],
    ['Cowboys', 'Giants', 'intense'],
    ['Cowboys', 'Commanders', 'moderate'],
    ['Packers', 'Bears', 'intense'],
    ['Steelers', 'Ravens', 'intense'],
    ['Patriots', 'Jets', 'moderate'],
    ['49ers', 'Seahawks', 'intense'],
    ['Chiefs', 'Raiders', 'moderate'],
    ['Broncos', 'Raiders', 'moderate'],
  ],
  'NHL': [
    ['Bruins', 'Canadiens', 'intense'],
    ['Rangers', 'Islanders', 'intense'],
    ['Penguins', 'Flyers', 'intense'],
    ['Blackhawks', 'Red Wings', 'moderate'],
    ['Maple Leafs', 'Canadiens', 'intense'],
    ['Avalanche', 'Red Wings', 'moderate'],
    ['Kings', 'Ducks', 'moderate'],
  ],
  'MLB': [
    ['Yankees', 'Red Sox', 'intense'],
    ['Dodgers', 'Giants', 'intense'],
    ['Cubs', 'Cardinals', 'intense'],
    ['Mets', 'Phillies', 'moderate'],
    ['White Sox', 'Cubs', 'moderate'],
    ['Angels', 'Dodgers', 'moderate'],
  ],
  'NCAAB': [
    ['Duke', 'North Carolina', 'intense'],
    ['Kentucky', 'Louisville', 'intense'],
    ['Kansas', 'Missouri', 'intense'],
    ['Michigan', 'Michigan State', 'intense'],
    ['Indiana', 'Purdue', 'intense'],
    ['UCLA', 'USC', 'moderate'],
    ['Arizona', 'Arizona State', 'moderate'],
  ],
  'NCAAF': [
    ['Ohio State', 'Michigan', 'intense'],
    ['Alabama', 'Auburn', 'intense'],
    ['Texas', 'Oklahoma', 'intense'],
    ['USC', 'UCLA', 'intense'],
    ['Florida', 'Georgia', 'intense'],
    ['Army', 'Navy', 'intense'],
    ['Clemson', 'South Carolina', 'moderate'],
  ],
}

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
 * Check if two teams are rivals
 */
function checkRivalry(
  team1: string,
  team2: string,
  league: string
): { isRivalry: boolean; intensity: 'none' | 'moderate' | 'intense' } {
  const leagueRivalries = RIVALRIES[league] || []
  
  const norm1 = normalizeTeamName(team1)
  const norm2 = normalizeTeamName(team2)
  
  for (const [teamA, teamB, intensity] of leagueRivalries) {
    const normA = normalizeTeamName(teamA)
    const normB = normalizeTeamName(teamB)
    
    if ((norm1.includes(normA) || normA.includes(norm1)) &&
        (norm2.includes(normB) || normB.includes(norm2))) {
      return { isRivalry: true, intensity }
    }
    if ((norm1.includes(normB) || normB.includes(norm1)) &&
        (norm2.includes(normA) || normA.includes(norm2))) {
      return { isRivalry: true, intensity }
    }
  }
  
  return { isRivalry: false, intensity: 'none' }
}

/**
 * Calculate motivation factors for a team
 * Note: Some factors require external data (playoff standings, recent results)
 * This function provides the framework; data can be populated as available
 */
export function calculateMotivationFactors(
  teamName: string,
  opponentName: string,
  league: string,
  options?: {
    isPlayoffEliminated?: boolean
    isPlayoffClinched?: boolean
    playoffImplications?: 'high' | 'medium' | 'low' | 'none'
    upcomingBigGame?: string        // Name of upcoming big opponent
    previousGameWasBig?: boolean    // Was previous game a big win?
    previousGameContext?: string
    recentLossToOpponent?: boolean  // Lost to this opponent in last 30 days?
    recentLossContext?: string
    isHomeOpener?: boolean
    isSeasonFinale?: boolean
    coachOnHotSeat?: boolean
    starPlayerReturn?: boolean
  }
): MotivationFactors {
  const rivalry = checkRivalry(teamName, opponentName, league)
  
  return {
    isRivalryGame: rivalry.isRivalry,
    rivalryIntensity: rivalry.intensity,
    
    isPlayoffEliminated: options?.isPlayoffEliminated || false,
    isPlayoffClinched: options?.isPlayoffClinched || false,
    playoffImplications: options?.playoffImplications || 'none',
    
    isLookAheadSpot: !!options?.upcomingBigGame,
    lookAheadOpponent: options?.upcomingBigGame || null,
    isLetdownSpot: options?.previousGameWasBig || false,
    previousGameContext: options?.previousGameContext || null,
    
    isRevengeGame: options?.recentLossToOpponent || false,
    revengeContext: options?.recentLossContext || null,
    
    isHomeOpener: options?.isHomeOpener || false,
    isSeasonFinale: options?.isSeasonFinale || false,
    coachOnHotSeat: options?.coachOnHotSeat || false,
    starPlayerReturn: options?.starPlayerReturn || false,
  }
}

/**
 * Calculate motivation adjustment from factors
 */
export function calculateMotivationAdjustment(
  factors: MotivationFactors
): MotivationAdjustment {
  const breakdown = {
    rivalry: 0,
    playoffSituation: 0,
    scheduleSpot: 0,
    revenge: 0,
    other: 0,
  }
  const notes: string[] = []
  
  // Rivalry adjustment
  if (factors.isRivalryGame) {
    breakdown.rivalry = RIVALRY_ADJUSTMENTS[factors.rivalryIntensity]
    if (factors.rivalryIntensity === 'intense') {
      notes.push('Intense rivalry game (+2.5%)')
    } else if (factors.rivalryIntensity === 'moderate') {
      notes.push('Rivalry game (+1.5%)')
    }
  }
  
  // Playoff situation
  if (factors.isPlayoffEliminated) {
    breakdown.playoffSituation = PLAYOFF_ADJUSTMENTS.eliminated
    notes.push('Team eliminated from playoffs (-3%)')
  } else if (factors.isPlayoffClinched) {
    breakdown.playoffSituation = PLAYOFF_ADJUSTMENTS.clinched
    notes.push('Playoff spot clinched - may rest players (-1.5%)')
  } else if (factors.playoffImplications === 'high') {
    breakdown.playoffSituation = PLAYOFF_ADJUSTMENTS.highImplications
    notes.push('High playoff implications (+2%)')
  } else if (factors.playoffImplications === 'medium') {
    breakdown.playoffSituation = PLAYOFF_ADJUSTMENTS.mediumImplications
    notes.push('Playoff implications (+1%)')
  }
  
  // Schedule spots
  if (factors.isLookAheadSpot) {
    breakdown.scheduleSpot += SCHEDULE_SPOT_ADJUSTMENTS.lookAhead
    notes.push(`Look-ahead spot (${factors.lookAheadOpponent} next) (-2%)`)
  }
  if (factors.isLetdownSpot) {
    breakdown.scheduleSpot += SCHEDULE_SPOT_ADJUSTMENTS.letdown
    const context = factors.previousGameContext ? ` after ${factors.previousGameContext}` : ''
    notes.push(`Letdown spot${context} (-2%)`)
  }
  
  // Revenge
  if (factors.isRevengeGame) {
    breakdown.revenge = REVENGE_ADJUSTMENT
    const context = factors.revengeContext ? ` (${factors.revengeContext})` : ''
    notes.push(`Revenge game${context} (+1.5%)`)
  }
  
  // Other motivation factors
  if (factors.isHomeOpener) {
    breakdown.other += OTHER_ADJUSTMENTS.homeOpener
    notes.push('Home opener (+2%)')
  }
  if (factors.isSeasonFinale) {
    breakdown.other += OTHER_ADJUSTMENTS.seasonFinale
    notes.push('Season finale (+1%)')
  }
  if (factors.coachOnHotSeat) {
    breakdown.other += OTHER_ADJUSTMENTS.coachHotSeat
    notes.push('Coach on hot seat (+1.5%)')
  }
  if (factors.starPlayerReturn) {
    breakdown.other += OTHER_ADJUSTMENTS.starReturn
    notes.push('Star player returning (+2%)')
  }
  
  const totalAdjustment = 
    breakdown.rivalry +
    breakdown.playoffSituation +
    breakdown.scheduleSpot +
    breakdown.revenge +
    breakdown.other
  
  return {
    totalAdjustment,
    breakdown,
    factors,
    notes,
  }
}

/**
 * Get combined motivation adjustment for a game
 * Returns adjustment for the specified team
 */
export function getMotivationAdjustment(
  teamName: string,
  opponentName: string,
  league: string,
  teamOptions?: Parameters<typeof calculateMotivationFactors>[3],
  opponentOptions?: Parameters<typeof calculateMotivationFactors>[3]
): { teamAdjustment: MotivationAdjustment; opponentAdjustment: MotivationAdjustment } {
  const teamFactors = calculateMotivationFactors(teamName, opponentName, league, teamOptions)
  const opponentFactors = calculateMotivationFactors(opponentName, teamName, league, opponentOptions)
  
  const teamAdjustment = calculateMotivationAdjustment(teamFactors)
  const opponentAdjustment = calculateMotivationAdjustment(opponentFactors)
  
  return { teamAdjustment, opponentAdjustment }
}

/**
 * Format motivation adjustment for display
 */
export function formatMotivationAdjustmentForDisplay(adjustment: MotivationAdjustment): string {
  if (adjustment.notes.length === 0) {
    return 'No significant motivation factors detected.'
  }
  
  const lines = ['MOTIVATION FACTORS:']
  for (const note of adjustment.notes) {
    lines.push(`  - ${note}`)
  }
  lines.push(`  Total: ${adjustment.totalAdjustment > 0 ? '+' : ''}${(adjustment.totalAdjustment * 100).toFixed(1)}%`)
  
  return lines.join('\n')
}

// ============================================
// PLAYOFF STANDINGS TRACKING (for future use)
// ============================================

export interface PlayoffStanding {
  teamName: string
  league: string
  conference?: string
  division?: string
  wins: number
  losses: number
  gamesBack: number
  playoffPosition: number | null  // null if not in playoff position
  isEliminated: boolean
  isClinched: boolean
  lastUpdated: string
}

const PLAYOFF_STANDINGS_KEY = 'motivation:playoff_standings'

/**
 * Store playoff standings (to be called by a cron job)
 */
export async function storePlayoffStandings(standings: PlayoffStanding[]): Promise<void> {
  if (!isDbConfigured()) return
  
  try {
    for (const standing of standings) {
      const key = `${standing.league}_${normalizeTeamName(standing.teamName)}`
      await kvHset(PLAYOFF_STANDINGS_KEY, key, JSON.stringify(standing))
    }
    console.log(`[Motivation] Stored ${standings.length} playoff standings`)
  } catch (error) {
    console.error('[Motivation] Error storing standings:', error)
  }
}

/**
 * Get playoff standing for a team
 */
export async function getPlayoffStanding(
  teamName: string,
  league: string
): Promise<PlayoffStanding | null> {
  if (!isDbConfigured()) return null
  
  try {
    const key = `${league}_${normalizeTeamName(teamName)}`
    const data = await kvHget(PLAYOFF_STANDINGS_KEY, key)
    if (!data) return null
    return JSON.parse(data) as PlayoffStanding
  } catch (error) {
    console.error('[Motivation] Error getting standing:', error)
    return null
  }
}

// ============================================
// RECENT MATCHUPS TRACKING (for revenge games)
// ============================================

export interface RecentMatchup {
  team1: string
  team2: string
  league: string
  date: string
  winner: string
  score: string
  margin: number
}

const RECENT_MATCHUPS_KEY = 'motivation:recent_matchups'

/**
 * Store a recent matchup result
 */
export async function storeRecentMatchup(matchup: RecentMatchup): Promise<void> {
  if (!isDbConfigured()) return
  
  try {
    const key = `${matchup.league}_${normalizeTeamName(matchup.team1)}_${normalizeTeamName(matchup.team2)}_${matchup.date}`
    await kvHset(RECENT_MATCHUPS_KEY, key, JSON.stringify(matchup))
  } catch (error) {
    console.error('[Motivation] Error storing matchup:', error)
  }
}

/**
 * Check if team recently lost to opponent (for revenge game detection)
 */
export async function checkRecentLoss(
  teamName: string,
  opponentName: string,
  league: string,
  daysBack: number = 60
): Promise<{ hasRecentLoss: boolean; context: string | null }> {
  if (!isDbConfigured()) return { hasRecentLoss: false, context: null }
  
  try {
    const allMatchups = await kvHgetall(RECENT_MATCHUPS_KEY)
    if (!allMatchups) return { hasRecentLoss: false, context: null }
    
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    
    const normTeam = normalizeTeamName(teamName)
    const normOpp = normalizeTeamName(opponentName)
    
    for (const matchupData of Object.values(allMatchups)) {
      const matchup: RecentMatchup = JSON.parse(matchupData)
      
      if (matchup.league !== league) continue
      
      const matchupDate = new Date(matchup.date)
      if (matchupDate < cutoffDate) continue
      
      const normTeam1 = normalizeTeamName(matchup.team1)
      const normTeam2 = normalizeTeamName(matchup.team2)
      const normWinner = normalizeTeamName(matchup.winner)
      
      // Check if this matchup involves our teams
      const involvesTeams = 
        (normTeam1.includes(normTeam) || normTeam.includes(normTeam1)) &&
        (normTeam2.includes(normOpp) || normOpp.includes(normTeam2)) ||
        (normTeam1.includes(normOpp) || normOpp.includes(normTeam1)) &&
        (normTeam2.includes(normTeam) || normTeam.includes(normTeam2))
      
      if (!involvesTeams) continue
      
      // Check if team lost
      const teamLost = !(normWinner.includes(normTeam) || normTeam.includes(normWinner))
      
      if (teamLost) {
        const context = `Lost ${matchup.score} on ${matchup.date}`
        return { hasRecentLoss: true, context }
      }
    }
    
    return { hasRecentLoss: false, context: null }
  } catch (error) {
    console.error('[Motivation] Error checking recent loss:', error)
    return { hasRecentLoss: false, context: null }
  }
}
