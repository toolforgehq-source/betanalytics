/**
 * Situational Factors Module
 * 
 * This module calculates situational adjustments that modify the base Elo probability.
 * These factors are often underweighted by Vegas and can provide an edge.
 * 
 * Factors included:
 * 1. Back-to-back games (fatigue)
 * 2. Rest advantage (days between games)
 * 3. Travel fatigue (timezone changes)
 * 4. Recent form (last 10 games vs season)
 * 5. Weather impact (for outdoor sports)
 * 6. Sharp money indicators (line movement)
 * 
 * All adjustments are expressed as probability adjustments (e.g., -0.03 = -3%)
 */

import type { WeatherData, WeatherImpact } from './weather'
import type { LineMovement } from './line-movement'
import { 
  calculateMotivationFactors, 
  calculateMotivationAdjustment,
  type MotivationAdjustment 
} from './motivation-factors'

// ============================================
// TYPES
// ============================================

export interface SituationalFactors {
  // Back-to-back and rest
  isBackToBack: boolean           // Team played yesterday
  restDays: number                // Days since last game
  opponentRestDays: number        // Opponent's days since last game
  restAdvantage: number           // Difference in rest days
  
  // Travel
  travelDistance: 'none' | 'short' | 'medium' | 'long' | 'cross_country'
  timezoneChange: number          // Hours of timezone change (e.g., 3 for West to East)
  
  // Recent form
  last10Record: { wins: number; losses: number } | null
  last10WinPct: number | null     // Win percentage in last 10 games
  seasonWinPct: number | null     // Season win percentage
  formTrend: 'hot' | 'cold' | 'neutral'  // Based on last 10 vs season
  
  // Weather (for outdoor sports)
  weatherImpact: WeatherImpact | null
  
  // Sharp money (line movement)
  sharpMoneyIndicator: boolean    // True if sharp money detected
  lineMovementDirection: 'toward' | 'away' | 'neutral'  // Toward = line moving in team's favor
  lineMovementMagnitude: 'small' | 'medium' | 'large'
}

export interface SituationalAdjustment {
  totalAdjustment: number         // Total probability adjustment (e.g., -0.05 = -5%)
  breakdown: {
    backToBack: number            // Adjustment for back-to-back
    restAdvantage: number         // Adjustment for rest advantage
    travel: number                // Adjustment for travel fatigue
    recentForm: number            // Adjustment for recent form
    weather: number               // Adjustment for weather
    sharpMoney: number            // Adjustment for sharp money
    motivation: number            // Adjustment for motivation factors (rivalry, revenge, etc.)
  }
  factors: SituationalFactors
  motivationAdjustment?: MotivationAdjustment  // Detailed motivation breakdown
  confidence: 'high' | 'medium' | 'low'  // How confident we are in the adjustment
  notes: string[]                 // Human-readable notes about the factors
}

// ============================================
// ADJUSTMENT CONSTANTS
// ============================================

// Back-to-back adjustments (probability reduction for team on B2B)
const BACK_TO_BACK_ADJUSTMENT: Record<string, number> = {
  'NBA': -0.04,      // -4% for NBA back-to-back (significant fatigue)
  'NHL': -0.03,      // -3% for NHL back-to-back
  'MLB': -0.01,      // -1% for MLB (less physical, but still matters)
  'NFL': 0,          // NFL doesn't have B2B
  'NCAAB': -0.03,    // -3% for college basketball
  'NCAAF': 0,        // College football doesn't have B2B
  // Soccer - rare but impactful
  'soccer_epl': -0.04,
  'soccer_spain_la_liga': -0.04,
  'soccer_germany_bundesliga': -0.04,
  'soccer_italy_serie_a': -0.04,
  'soccer_france_ligue_one': -0.04,
  'soccer_usa_mls': -0.03,
  'soccer_uefa_champs_league': -0.04,
}

// Rest advantage adjustments (per day of rest advantage, capped)
// If Team A has 3 days rest and Team B has 1 day, Team A gets +2 days advantage
const REST_ADVANTAGE_PER_DAY: Record<string, number> = {
  'NBA': 0.015,      // +1.5% per day of rest advantage (max +4.5% for 3+ days)
  'NHL': 0.012,      // +1.2% per day
  'MLB': 0.005,      // +0.5% per day (less impactful)
  'NFL': 0.02,       // +2% per day (big deal in NFL)
  'NCAAB': 0.015,
  'NCAAF': 0.02,
  'soccer_epl': 0.015,
  'soccer_spain_la_liga': 0.015,
  'soccer_germany_bundesliga': 0.015,
  'soccer_italy_serie_a': 0.015,
  'soccer_france_ligue_one': 0.015,
  'soccer_usa_mls': 0.012,
  'soccer_uefa_champs_league': 0.015,
}

// Maximum rest advantage adjustment
const MAX_REST_ADVANTAGE = 0.045  // Cap at 4.5%

// Travel fatigue adjustments
const TRAVEL_ADJUSTMENTS: Record<string, number> = {
  'none': 0,
  'short': -0.005,       // -0.5% for short travel
  'medium': -0.01,       // -1% for medium travel
  'long': -0.015,        // -1.5% for long travel
  'cross_country': -0.025, // -2.5% for cross-country (West to East is worst)
}

// Timezone change adjustment (per hour, for West to East travel)
const TIMEZONE_ADJUSTMENT_PER_HOUR = -0.005  // -0.5% per hour of timezone change

// Recent form adjustments
const FORM_ADJUSTMENTS = {
  'hot': 0.02,           // +2% if team is hot (last 10 significantly better than season)
  'cold': -0.02,         // -2% if team is cold
  'neutral': 0,
}

// Weather impact adjustments (for outdoor sports)
const WEATHER_ADJUSTMENTS: Record<WeatherImpact['level'], number> = {
  'none': 0,
  'low': 0,
  'moderate': -0.01,     // -1% for moderate weather impact
  'high': -0.02,         // -2% for high weather impact
  'severe': -0.03,       // -3% for severe weather
}

// Sharp money adjustments
const SHARP_MONEY_ADJUSTMENT = 0.02  // +2% if sharp money is on your side

// Line movement adjustments
const LINE_MOVEMENT_ADJUSTMENTS = {
  'toward_small': 0.005,    // +0.5% if line moving slightly in your favor
  'toward_medium': 0.01,    // +1% if line moving moderately in your favor
  'toward_large': 0.015,    // +1.5% if line moving significantly in your favor
  'away_small': -0.005,
  'away_medium': -0.01,
  'away_large': -0.015,
  'neutral': 0,
}

// ============================================
// TEAM LOCATION DATA (for travel calculations)
// ============================================

// US timezone mapping for teams (hours from UTC)
// Negative = West, Positive = East
const TEAM_TIMEZONES: Record<string, number> = {
  // NBA - Eastern Conference
  'Boston Celtics': -5, 'Brooklyn Nets': -5, 'New York Knicks': -5, 'Philadelphia 76ers': -5,
  'Toronto Raptors': -5, 'Chicago Bulls': -6, 'Cleveland Cavaliers': -5, 'Detroit Pistons': -5,
  'Indiana Pacers': -5, 'Milwaukee Bucks': -6, 'Atlanta Hawks': -5, 'Charlotte Hornets': -5,
  'Miami Heat': -5, 'Orlando Magic': -5, 'Washington Wizards': -5,
  // NBA - Western Conference
  'Denver Nuggets': -7, 'Minnesota Timberwolves': -6, 'Oklahoma City Thunder': -6,
  'Portland Trail Blazers': -8, 'Utah Jazz': -7, 'Golden State Warriors': -8,
  'LA Clippers': -8, 'Los Angeles Lakers': -8, 'Phoenix Suns': -7, 'Sacramento Kings': -8,
  'Dallas Mavericks': -6, 'Houston Rockets': -6, 'Memphis Grizzlies': -6,
  'New Orleans Pelicans': -6, 'San Antonio Spurs': -6,
  
  // NHL - Eastern Conference
  'Boston Bruins': -5, 'Buffalo Sabres': -5, 'Detroit Red Wings': -5, 'Florida Panthers': -5,
  'Montreal Canadiens': -5, 'Ottawa Senators': -5, 'Tampa Bay Lightning': -5, 'Toronto Maple Leafs': -5,
  'Carolina Hurricanes': -5, 'Columbus Blue Jackets': -5, 'New Jersey Devils': -5,
  'New York Islanders': -5, 'New York Rangers': -5, 'Philadelphia Flyers': -5,
  'Pittsburgh Penguins': -5, 'Washington Capitals': -5,
  // NHL - Western Conference
  'Arizona Coyotes': -7, 'Chicago Blackhawks': -6, 'Colorado Avalanche': -7,
  'Dallas Stars': -6, 'Minnesota Wild': -6, 'Nashville Predators': -6, 'St. Louis Blues': -6,
  'Winnipeg Jets': -6, 'Anaheim Ducks': -8, 'Calgary Flames': -7, 'Edmonton Oilers': -7,
  'Los Angeles Kings': -8, 'San Jose Sharks': -8, 'Seattle Kraken': -8, 'Vancouver Canucks': -8,
  'Vegas Golden Knights': -8,
  
  // NFL teams (similar pattern)
  'Buffalo Bills': -5, 'Miami Dolphins': -5, 'New England Patriots': -5, 'New York Jets': -5,
  'New York Giants': -5, 'Baltimore Ravens': -5, 'Cincinnati Bengals': -5, 'Cleveland Browns': -5,
  'Pittsburgh Steelers': -5, 'Houston Texans': -6, 'Indianapolis Colts': -5, 'Jacksonville Jaguars': -5,
  'Tennessee Titans': -6, 'Denver Broncos': -7, 'Kansas City Chiefs': -6, 'Las Vegas Raiders': -8,
  'Los Angeles Chargers': -8, 'Los Angeles Rams': -8, 'Dallas Cowboys': -6, 'Philadelphia Eagles': -5,
  'Washington Commanders': -5, 'Chicago Bears': -6, 'Detroit Lions': -5, 'Green Bay Packers': -6,
  'Minnesota Vikings': -6, 'Atlanta Falcons': -5, 'Carolina Panthers': -5, 'New Orleans Saints': -6,
  'Tampa Bay Buccaneers': -5, 'Arizona Cardinals': -7, 'San Francisco 49ers': -8, 'Seattle Seahawks': -8,
}

// Team coordinates (lat, lng) for actual travel distance calculation
// Used to calculate miles traveled for enhanced situational factors
const TEAM_COORDINATES: Record<string, { lat: number; lng: number; city: string }> = {
  // NBA Teams
  'Boston Celtics': { lat: 42.3662, lng: -71.0621, city: 'Boston' },
  'Brooklyn Nets': { lat: 40.6826, lng: -73.9754, city: 'Brooklyn' },
  'New York Knicks': { lat: 40.7505, lng: -73.9934, city: 'New York' },
  'Philadelphia 76ers': { lat: 39.9012, lng: -75.1720, city: 'Philadelphia' },
  'Toronto Raptors': { lat: 43.6435, lng: -79.3791, city: 'Toronto' },
  'Chicago Bulls': { lat: 41.8807, lng: -87.6742, city: 'Chicago' },
  'Cleveland Cavaliers': { lat: 41.4965, lng: -81.6882, city: 'Cleveland' },
  'Detroit Pistons': { lat: 42.3410, lng: -83.0550, city: 'Detroit' },
  'Indiana Pacers': { lat: 39.7640, lng: -86.1555, city: 'Indianapolis' },
  'Milwaukee Bucks': { lat: 43.0451, lng: -87.9174, city: 'Milwaukee' },
  'Atlanta Hawks': { lat: 33.7573, lng: -84.3963, city: 'Atlanta' },
  'Charlotte Hornets': { lat: 35.2251, lng: -80.8392, city: 'Charlotte' },
  'Miami Heat': { lat: 25.7814, lng: -80.1870, city: 'Miami' },
  'Orlando Magic': { lat: 28.5392, lng: -81.3839, city: 'Orlando' },
  'Washington Wizards': { lat: 38.8981, lng: -77.0209, city: 'Washington DC' },
  'Denver Nuggets': { lat: 39.7487, lng: -105.0077, city: 'Denver' },
  'Minnesota Timberwolves': { lat: 44.9795, lng: -93.2761, city: 'Minneapolis' },
  'Oklahoma City Thunder': { lat: 35.4634, lng: -97.5151, city: 'Oklahoma City' },
  'Portland Trail Blazers': { lat: 45.5316, lng: -122.6668, city: 'Portland' },
  'Utah Jazz': { lat: 40.7683, lng: -111.9011, city: 'Salt Lake City' },
  'Golden State Warriors': { lat: 37.7680, lng: -122.3877, city: 'San Francisco' },
  'LA Clippers': { lat: 34.0430, lng: -118.2673, city: 'Los Angeles' },
  'Los Angeles Lakers': { lat: 34.0430, lng: -118.2673, city: 'Los Angeles' },
  'Phoenix Suns': { lat: 33.4457, lng: -112.0712, city: 'Phoenix' },
  'Sacramento Kings': { lat: 38.5802, lng: -121.4997, city: 'Sacramento' },
  'Dallas Mavericks': { lat: 32.7905, lng: -96.8103, city: 'Dallas' },
  'Houston Rockets': { lat: 29.7508, lng: -95.3621, city: 'Houston' },
  'Memphis Grizzlies': { lat: 35.1382, lng: -90.0505, city: 'Memphis' },
  'New Orleans Pelicans': { lat: 29.9490, lng: -90.0821, city: 'New Orleans' },
  'San Antonio Spurs': { lat: 29.4270, lng: -98.4375, city: 'San Antonio' },
  // NHL Teams
  'Boston Bruins': { lat: 42.3662, lng: -71.0621, city: 'Boston' },
  'Buffalo Sabres': { lat: 42.8750, lng: -78.8764, city: 'Buffalo' },
  'Detroit Red Wings': { lat: 42.3410, lng: -83.0550, city: 'Detroit' },
  'Florida Panthers': { lat: 26.1584, lng: -80.3256, city: 'Sunrise' },
  'Montreal Canadiens': { lat: 45.4961, lng: -73.5693, city: 'Montreal' },
  'Ottawa Senators': { lat: 45.2969, lng: -75.9269, city: 'Ottawa' },
  'Tampa Bay Lightning': { lat: 27.9425, lng: -82.4519, city: 'Tampa' },
  'Toronto Maple Leafs': { lat: 43.6435, lng: -79.3791, city: 'Toronto' },
  'Carolina Hurricanes': { lat: 35.8033, lng: -78.7220, city: 'Raleigh' },
  'Columbus Blue Jackets': { lat: 39.9692, lng: -83.0061, city: 'Columbus' },
  'New Jersey Devils': { lat: 40.7334, lng: -74.1712, city: 'Newark' },
  'New York Islanders': { lat: 40.6826, lng: -73.9754, city: 'Brooklyn' },
  'New York Rangers': { lat: 40.7505, lng: -73.9934, city: 'New York' },
  'Philadelphia Flyers': { lat: 39.9012, lng: -75.1720, city: 'Philadelphia' },
  'Pittsburgh Penguins': { lat: 40.4395, lng: -79.9892, city: 'Pittsburgh' },
  'Washington Capitals': { lat: 38.8981, lng: -77.0209, city: 'Washington DC' },
  'Arizona Coyotes': { lat: 33.5319, lng: -112.2612, city: 'Tempe' },
  'Chicago Blackhawks': { lat: 41.8807, lng: -87.6742, city: 'Chicago' },
  'Colorado Avalanche': { lat: 39.7487, lng: -105.0077, city: 'Denver' },
  'Dallas Stars': { lat: 32.7905, lng: -96.8103, city: 'Dallas' },
  'Minnesota Wild': { lat: 44.9448, lng: -93.1010, city: 'St. Paul' },
  'Nashville Predators': { lat: 36.1591, lng: -86.7785, city: 'Nashville' },
  'St. Louis Blues': { lat: 38.6268, lng: -90.2027, city: 'St. Louis' },
  'Winnipeg Jets': { lat: 49.8925, lng: -97.1436, city: 'Winnipeg' },
  'Anaheim Ducks': { lat: 33.8078, lng: -117.8765, city: 'Anaheim' },
  'Calgary Flames': { lat: 51.0374, lng: -114.0519, city: 'Calgary' },
  'Edmonton Oilers': { lat: 53.5469, lng: -113.4979, city: 'Edmonton' },
  'Los Angeles Kings': { lat: 34.0430, lng: -118.2673, city: 'Los Angeles' },
  'San Jose Sharks': { lat: 37.3328, lng: -121.9013, city: 'San Jose' },
  'Seattle Kraken': { lat: 47.6221, lng: -122.3540, city: 'Seattle' },
  'Vancouver Canucks': { lat: 49.2778, lng: -123.1089, city: 'Vancouver' },
  'Vegas Golden Knights': { lat: 36.1029, lng: -115.1785, city: 'Las Vegas' },
}

/**
 * Calculate distance between two coordinates in miles using Haversine formula
 */
function calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

/**
 * Get team coordinates by fuzzy matching team name
 */
function getTeamCoordinates(teamName: string): { lat: number; lng: number; city: string } | null {
  const normalized = normalizeTeamName(teamName)
  
  for (const [team, coords] of Object.entries(TEAM_COORDINATES)) {
    if (normalizeTeamName(team).includes(normalized) || normalized.includes(normalizeTeamName(team))) {
      return coords
    }
  }
  
  // Try partial match on city or team nickname
  for (const [team, coords] of Object.entries(TEAM_COORDINATES)) {
    const teamParts = normalizeTeamName(team).split(' ')
    if (teamParts.some(part => normalized.includes(part) && part.length > 3)) {
      return coords
    }
  }
  
  return null
}

/**
 * Calculate actual travel distance in miles between two teams
 */
export function calculateTravelDistanceMiles(awayTeam: string, homeTeam: string): number | null {
  const awayCoords = getTeamCoordinates(awayTeam)
  const homeCoords = getTeamCoordinates(homeTeam)
  
  if (!awayCoords || !homeCoords) {
    return null
  }
  
  return calculateDistanceMiles(awayCoords.lat, awayCoords.lng, homeCoords.lat, homeCoords.lng)
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

/**
 * Find timezone for a team (fuzzy matching)
 */
function getTeamTimezone(teamName: string): number | null {
  const normalized = normalizeTeamName(teamName)
  
  for (const [team, tz] of Object.entries(TEAM_TIMEZONES)) {
    if (normalizeTeamName(team).includes(normalized) || normalized.includes(normalizeTeamName(team))) {
      return tz
    }
  }
  
  return null
}

/**
 * Calculate travel distance category based on timezone difference
 */
function calculateTravelDistance(
  awayTeamTimezone: number | null,
  homeTeamTimezone: number | null
): { distance: SituationalFactors['travelDistance']; timezoneChange: number } {
  if (awayTeamTimezone === null || homeTeamTimezone === null) {
    return { distance: 'none', timezoneChange: 0 }
  }
  
  const tzDiff = Math.abs(awayTeamTimezone - homeTeamTimezone)
  
  if (tzDiff === 0) {
    return { distance: 'none', timezoneChange: 0 }
  } else if (tzDiff === 1) {
    return { distance: 'short', timezoneChange: tzDiff }
  } else if (tzDiff === 2) {
    return { distance: 'medium', timezoneChange: tzDiff }
  } else if (tzDiff === 3) {
    return { distance: 'cross_country', timezoneChange: tzDiff }
  } else {
    return { distance: 'long', timezoneChange: tzDiff }
  }
}

/**
 * Determine form trend based on last 10 games vs season
 */
function determineFormTrend(last10WinPct: number | null, seasonWinPct: number | null): SituationalFactors['formTrend'] {
  if (last10WinPct === null || seasonWinPct === null) {
    return 'neutral'
  }
  
  const diff = last10WinPct - seasonWinPct
  
  if (diff >= 0.15) {
    return 'hot'  // Last 10 is 15%+ better than season
  } else if (diff <= -0.15) {
    return 'cold'  // Last 10 is 15%+ worse than season
  } else {
    return 'neutral'
  }
}

/**
 * Parse team record string (e.g., "30-14" or "30-14-4") into wins/losses
 */
function parseRecord(record: string | null | undefined): { wins: number; losses: number; ties?: number } | null {
  if (!record) return null
  
  const parts = record.split('-').map(p => parseInt(p.trim(), 10))
  if (parts.length < 2 || parts.some(isNaN)) return null
  
  return {
    wins: parts[0],
    losses: parts[1],
    ties: parts[2] // Optional for NHL/soccer
  }
}

/**
 * Calculate win percentage from record
 */
function calculateWinPct(record: { wins: number; losses: number; ties?: number } | null): number | null {
  if (!record) return null
  
  const totalGames = record.wins + record.losses + (record.ties || 0)
  if (totalGames === 0) return null
  
  // For sports with ties, count ties as 0.5 wins
  const effectiveWins = record.wins + (record.ties || 0) * 0.5
  return effectiveWins / totalGames
}

// ============================================
// MAIN FUNCTIONS
// ============================================

/**
 * Calculate situational factors for a team in a game
 * 
 * @param teamName - The team to analyze
 * @param opponentName - The opponent
 * @param sport - The sport/league (e.g., 'NBA', 'NHL')
 * @param isHome - Whether the team is playing at home
 * @param teamRecord - Team's season record (e.g., "30-14")
 * @param lastGameDate - Date of team's last game (ISO string)
 * @param opponentLastGameDate - Date of opponent's last game
 * @param weather - Weather data (for outdoor sports)
 * @param lineMovement - Line movement data
 * @param gameDate - The game's commence time (used for rest day calc instead of current time)
 */
export function calculateSituationalFactors(
  teamName: string,
  opponentName: string,
  sport: string,
  isHome: boolean,
  teamRecord?: string | null,
  lastGameDate?: string | null,
  opponentLastGameDate?: string | null,
  weather?: WeatherData | null,
  lineMovement?: LineMovement | null,
  gameDate?: Date | null
): SituationalFactors {
  const now = gameDate || new Date()
  
  // Calculate rest days
  let restDays = 3  // Default if unknown — see restDataMissing flag below
  let opponentRestDays = 3
  let restDataMissing = false
  
  if (lastGameDate) {
    const lastGame = new Date(lastGameDate)
    restDays = Math.floor((now.getTime() - lastGame.getTime()) / (1000 * 60 * 60 * 24))
  } else {
    restDataMissing = true
  }
  
  if (opponentLastGameDate) {
    const oppLastGame = new Date(opponentLastGameDate)
    opponentRestDays = Math.floor((now.getTime() - oppLastGame.getTime()) / (1000 * 60 * 60 * 24))
  } else {
    restDataMissing = true
  }
  
  if (restDataMissing) {
    console.log(`[situational-factors] Rest data missing for ${teamName} vs ${opponentName} — defaulting to ${restDays}/${opponentRestDays} rest days`)
  }
  
  const isBackToBack = restDays <= 1
  const restAdvantage = restDays - opponentRestDays
  
  // Calculate travel (only for away team)
  let travelDistance: SituationalFactors['travelDistance'] = 'none'
  let timezoneChange = 0
  
  if (!isHome) {
    const awayTz = getTeamTimezone(teamName)
    const homeTz = getTeamTimezone(opponentName)
    const travel = calculateTravelDistance(awayTz, homeTz)
    travelDistance = travel.distance
    timezoneChange = travel.timezoneChange
  }
  
  // Parse record for form analysis
  const parsedRecord = parseRecord(teamRecord)
  const seasonWinPct = calculateWinPct(parsedRecord)
  
  // For now, we don't have last 10 games data - this would need to be fetched
  // TODO: Add last 10 games tracking
  const last10Record = null
  const last10WinPct = null
  const formTrend = determineFormTrend(last10WinPct, seasonWinPct)
  
  // Weather impact
  const weatherImpact = weather?.impact || null
  
  // Line movement analysis
  let sharpMoneyIndicator = false
  let lineMovementDirection: SituationalFactors['lineMovementDirection'] = 'neutral'
  let lineMovementMagnitude: SituationalFactors['lineMovementMagnitude'] = 'small'
  
  if (lineMovement) {
    sharpMoneyIndicator = lineMovement.movement.sharpIndicator
    lineMovementMagnitude = lineMovement.movement.magnitude
    
    // Determine if line is moving toward or away from this team
    const isHomeTeam = isHome
    if (lineMovement.movement.direction === 'home') {
      lineMovementDirection = isHomeTeam ? 'toward' : 'away'
    } else if (lineMovement.movement.direction === 'away') {
      lineMovementDirection = isHomeTeam ? 'away' : 'toward'
    }
  }
  
  return {
    isBackToBack,
    restDays,
    opponentRestDays,
    restAdvantage,
    travelDistance,
    timezoneChange,
    last10Record,
    last10WinPct,
    seasonWinPct,
    formTrend,
    weatherImpact,
    sharpMoneyIndicator,
    lineMovementDirection,
    lineMovementMagnitude,
  }
}

/**
 * Calculate the total situational adjustment for a team
 * Returns a probability adjustment (e.g., -0.05 = -5%)
 */
export function calculateSituationalAdjustment(
  factors: SituationalFactors,
  sport: string,
  teamName?: string,
  opponentName?: string
): SituationalAdjustment {
  const notes: string[] = []
  const breakdown = {
    backToBack: 0,
    restAdvantage: 0,
    travel: 0,
    recentForm: 0,
    weather: 0,
    sharpMoney: 0,
    motivation: 0,
  }
  
  // 1. Back-to-back adjustment
  if (factors.isBackToBack) {
    breakdown.backToBack = BACK_TO_BACK_ADJUSTMENT[sport] || -0.03
    notes.push(`Back-to-back game: ${(breakdown.backToBack * 100).toFixed(1)}% adjustment`)
  }
  
  // 2. Rest advantage adjustment
  if (factors.restAdvantage !== 0) {
    const perDayAdj = REST_ADVANTAGE_PER_DAY[sport] || 0.01
    const rawAdj = factors.restAdvantage * perDayAdj
    breakdown.restAdvantage = Math.max(-MAX_REST_ADVANTAGE, Math.min(MAX_REST_ADVANTAGE, rawAdj))
    
    if (Math.abs(breakdown.restAdvantage) >= 0.01) {
      notes.push(`Rest advantage (${factors.restAdvantage > 0 ? '+' : ''}${factors.restAdvantage} days): ${(breakdown.restAdvantage * 100).toFixed(1)}%`)
    }
  }
  
  // 3. Travel adjustment (only for away team, already factored into factors)
  if (factors.travelDistance !== 'none') {
    breakdown.travel = TRAVEL_ADJUSTMENTS[factors.travelDistance] || 0
    
    // Additional timezone adjustment for West to East travel
    if (factors.timezoneChange > 0) {
      breakdown.travel += factors.timezoneChange * TIMEZONE_ADJUSTMENT_PER_HOUR
    }
    
    if (breakdown.travel !== 0) {
      notes.push(`Travel fatigue (${factors.travelDistance}, ${factors.timezoneChange}hr TZ change): ${(breakdown.travel * 100).toFixed(1)}%`)
    }
  }
  
  // 4. Recent form adjustment
  breakdown.recentForm = FORM_ADJUSTMENTS[factors.formTrend]
  if (breakdown.recentForm !== 0) {
    notes.push(`Recent form (${factors.formTrend}): ${(breakdown.recentForm * 100).toFixed(1)}%`)
  }
  
  // 5. Weather adjustment (for outdoor sports)
  if (factors.weatherImpact) {
    breakdown.weather = WEATHER_ADJUSTMENTS[factors.weatherImpact.level] || 0
    if (breakdown.weather !== 0) {
      notes.push(`Weather impact (${factors.weatherImpact.level}): ${(breakdown.weather * 100).toFixed(1)}%`)
    }
  }
  
  // 6. Sharp money adjustment
  if (factors.sharpMoneyIndicator && factors.lineMovementDirection === 'toward') {
    breakdown.sharpMoney = SHARP_MONEY_ADJUSTMENT
    notes.push(`Sharp money indicator: +${(breakdown.sharpMoney * 100).toFixed(1)}%`)
  } else if (factors.lineMovementDirection !== 'neutral') {
    const key = `${factors.lineMovementDirection}_${factors.lineMovementMagnitude}` as keyof typeof LINE_MOVEMENT_ADJUSTMENTS
    breakdown.sharpMoney = LINE_MOVEMENT_ADJUSTMENTS[key] || 0
    if (breakdown.sharpMoney !== 0) {
      notes.push(`Line movement (${factors.lineMovementDirection}, ${factors.lineMovementMagnitude}): ${(breakdown.sharpMoney * 100).toFixed(1)}%`)
    }
  }
  
  // 7. Motivation factors adjustment (rivalry games, revenge spots, etc.)
  let motivationAdjustment: MotivationAdjustment | undefined
  if (teamName && opponentName) {
    const motivationFactors = calculateMotivationFactors(teamName, opponentName, sport)
    motivationAdjustment = calculateMotivationAdjustment(motivationFactors)
    breakdown.motivation = motivationAdjustment.totalAdjustment
    
    if (motivationAdjustment.notes.length > 0) {
      for (const note of motivationAdjustment.notes) {
        notes.push(`Motivation: ${note}`)
      }
    }
  }
  
  // Calculate total adjustment
  const totalAdjustment = 
    breakdown.backToBack +
    breakdown.restAdvantage +
    breakdown.travel +
    breakdown.recentForm +
    breakdown.weather +
    breakdown.sharpMoney +
    breakdown.motivation
  
  // Determine confidence based on data availability
  let confidence: SituationalAdjustment['confidence'] = 'high'
  if (factors.last10WinPct === null && factors.seasonWinPct === null) {
    confidence = 'medium'
  }
  if (factors.restDays === 3 && factors.opponentRestDays === 3) {
    // Default values used, lower confidence
    confidence = confidence === 'high' ? 'medium' : 'low'
  }
  
  return {
    totalAdjustment,
    breakdown,
    factors,
    motivationAdjustment,
    confidence,
    notes,
  }
}

/**
 * Apply situational adjustment to a base probability
 * Ensures result stays within valid probability range [0.01, 0.99]
 */
export function applyAdjustment(baseProbability: number, adjustment: number): number {
  const adjusted = baseProbability + adjustment
  return Math.max(0.01, Math.min(0.99, adjusted))
}

/**
 * Format situational factors for display in recommendations
 */
export function formatSituationalFactorsForDisplay(adjustment: SituationalAdjustment): string {
  if (adjustment.notes.length === 0) {
    return ''
  }
  
  const lines: string[] = []
  lines.push('SITUATIONAL FACTORS:')
  
  for (const note of adjustment.notes) {
    lines.push(`  • ${note}`)
  }
  
  const totalPct = (adjustment.totalAdjustment * 100).toFixed(1)
  const sign = adjustment.totalAdjustment >= 0 ? '+' : ''
  lines.push(`  Total adjustment: ${sign}${totalPct}%`)
  
  return lines.join('\n')
}

/**
 * Get situational factors summary for a game
 * Returns a brief summary suitable for inclusion in bet recommendations
 */
export function getSituationalSummary(
  homeAdjustment: SituationalAdjustment,
  awayAdjustment: SituationalAdjustment
): string {
  const factors: string[] = []
  
  // Check for significant factors
  if (homeAdjustment.factors.isBackToBack) {
    factors.push('Home team on B2B')
  }
  if (awayAdjustment.factors.isBackToBack) {
    factors.push('Away team on B2B')
  }
  
  if (Math.abs(homeAdjustment.breakdown.restAdvantage) >= 0.02) {
    const advantage = homeAdjustment.breakdown.restAdvantage > 0 ? 'Home' : 'Away'
    factors.push(`${advantage} has rest advantage`)
  }
  
  if (awayAdjustment.factors.travelDistance === 'cross_country') {
    factors.push('Away team cross-country travel')
  }
  
  if (homeAdjustment.factors.formTrend === 'hot') {
    factors.push('Home team hot')
  } else if (homeAdjustment.factors.formTrend === 'cold') {
    factors.push('Home team cold')
  }
  
  if (awayAdjustment.factors.formTrend === 'hot') {
    factors.push('Away team hot')
  } else if (awayAdjustment.factors.formTrend === 'cold') {
    factors.push('Away team cold')
  }
  
  if (homeAdjustment.factors.sharpMoneyIndicator || awayAdjustment.factors.sharpMoneyIndicator) {
    factors.push('Sharp money detected')
  }
  
  if (homeAdjustment.factors.weatherImpact?.level === 'high' || 
      homeAdjustment.factors.weatherImpact?.level === 'severe') {
    factors.push(`Weather: ${homeAdjustment.factors.weatherImpact.level}`)
  }
  
  if (factors.length === 0) {
    return 'No significant situational factors'
  }
  
  return factors.join(' | ')
}

/**
 * Enhanced situational factors interface with detailed data
 */
export interface EnhancedSituationalData {
  homeTeam: string
  awayTeam: string
  // Rest data
  homeRestDays: number | null
  awayRestDays: number | null
  homeLastOpponent: string | null
  awayLastOpponent: string | null
  homeIsBackToBack: boolean
  awayIsBackToBack: boolean
  // Travel data
  travelDistanceMiles: number | null
  timezoneChange: number
  // Recent form
  homeLast10: { wins: number; losses: number } | null
  awayLast10: { wins: number; losses: number } | null
  homeStreak: string | null  // e.g., "W4" or "L2"
  awayStreak: string | null
  // Adjustments
  restAdjustment: number  // Positive favors home
  travelAdjustment: number  // Positive favors home (away team traveled)
  formAdjustment: number  // Positive favors home
  totalAdjustment: number
}

/**
 * Format enhanced situational factors in simplified bullet format
 * Example: "- Rest: Lakers back-to-back (played DEN Wed), Wizards 3 days rest (+2% WAS)"
 */
export function formatEnhancedSituationalFactors(data: EnhancedSituationalData): string {
  const lines: string[] = []
  
  // Rest factor
  const restLine = formatRestFactor(data)
  if (restLine) {
    lines.push(restLine)
  }
  
  // Travel factor
  const travelLine = formatTravelFactor(data)
  if (travelLine) {
    lines.push(travelLine)
  }
  
  // Recent form factor
  const formLine = formatFormFactor(data)
  if (formLine) {
    lines.push(formLine)
  }
  
  if (lines.length === 0) {
    return '- Situational factors: No significant edges detected'
  }
  
  return lines.join('\n')
}

function formatRestFactor(data: EnhancedSituationalData): string | null {
  const parts: string[] = []
  
  // Home team rest
  if (data.homeIsBackToBack) {
    const opponent = data.homeLastOpponent ? ` (played ${data.homeLastOpponent})` : ''
    parts.push(`${getShortName(data.homeTeam)} back-to-back${opponent}`)
  } else if (data.homeRestDays !== null) {
    parts.push(`${getShortName(data.homeTeam)} ${data.homeRestDays} days rest`)
  }
  
  // Away team rest
  if (data.awayIsBackToBack) {
    const opponent = data.awayLastOpponent ? ` (played ${data.awayLastOpponent})` : ''
    parts.push(`${getShortName(data.awayTeam)} back-to-back${opponent}`)
  } else if (data.awayRestDays !== null) {
    parts.push(`${getShortName(data.awayTeam)} ${data.awayRestDays} days rest`)
  }
  
  if (parts.length === 0) {
    return null
  }
  
  // Add adjustment
  const adjPct = Math.abs(data.restAdjustment * 100).toFixed(0)
  let adjText = ''
  if (data.restAdjustment > 0.005) {
    adjText = ` (+${adjPct}% ${getShortName(data.homeTeam)})`
  } else if (data.restAdjustment < -0.005) {
    adjText = ` (+${adjPct}% ${getShortName(data.awayTeam)})`
  }
  
  return `- Rest: ${parts.join(', ')}${adjText}`
}

function formatTravelFactor(data: EnhancedSituationalData): string | null {
  if (!data.travelDistanceMiles || data.travelDistanceMiles < 500) {
    return null
  }
  
  const miles = data.travelDistanceMiles.toLocaleString()
  let tzText = ''
  if (data.timezoneChange > 0) {
    tzText = `, ${data.timezoneChange}hr timezone change`
  }
  
  // Add adjustment
  const adjPct = Math.abs(data.travelAdjustment * 100).toFixed(0)
  let adjText = ''
  if (data.travelAdjustment > 0.005) {
    adjText = ` (+${adjPct}% ${getShortName(data.homeTeam)})`
  }
  
  return `- Travel: ${getShortName(data.awayTeam)} traveled ${miles} miles${tzText}${adjText}`
}

function formatFormFactor(data: EnhancedSituationalData): string | null {
  const parts: string[] = []
  
  // Home team form
  if (data.homeLast10) {
    const record = `${data.homeLast10.wins}-${data.homeLast10.losses}`
    const streak = data.homeStreak ? `, ${data.homeStreak}` : ''
    parts.push(`${getShortName(data.homeTeam)} ${record} L10${streak}`)
  }
  
  // Away team form
  if (data.awayLast10) {
    const record = `${data.awayLast10.wins}-${data.awayLast10.losses}`
    const streak = data.awayStreak ? `, ${data.awayStreak}` : ''
    parts.push(`${getShortName(data.awayTeam)} ${record} L10${streak}`)
  }
  
  if (parts.length === 0) {
    return null
  }
  
  // Add adjustment
  const adjPct = Math.abs(data.formAdjustment * 100).toFixed(0)
  let adjText = ''
  if (data.formAdjustment > 0.005) {
    adjText = ` (+${adjPct}% ${getShortName(data.homeTeam)})`
  } else if (data.formAdjustment < -0.005) {
    adjText = ` (+${adjPct}% ${getShortName(data.awayTeam)})`
  }
  
  return `- Form: ${parts.join(', ')}${adjText}`
}

/**
 * Get short team name (last word of team name)
 * e.g., "Los Angeles Lakers" -> "Lakers"
 */
function getShortName(teamName: string): string {
  const parts = teamName.split(' ')
  return parts[parts.length - 1]
}

/**
 * Build enhanced situational data from factors and adjustments
 */
export function buildEnhancedSituationalData(
  homeTeam: string,
  awayTeam: string,
  homeFactors: SituationalFactors,
  awayFactors: SituationalFactors,
  homeAdjustment: SituationalAdjustment,
  awayAdjustment: SituationalAdjustment
): EnhancedSituationalData {
  // Calculate travel distance in miles
  const travelMiles = calculateTravelDistanceMiles(awayTeam, homeTeam)
  
  return {
    homeTeam,
    awayTeam,
    // Rest data
    homeRestDays: homeFactors.restDays,
    awayRestDays: awayFactors.restDays,
    homeLastOpponent: null,  // Would need to be passed in from ESPN data
    awayLastOpponent: null,
    homeIsBackToBack: homeFactors.isBackToBack,
    awayIsBackToBack: awayFactors.isBackToBack,
    // Travel data
    travelDistanceMiles: travelMiles,
    timezoneChange: awayFactors.timezoneChange,
    // Recent form
    homeLast10: homeFactors.last10Record,
    awayLast10: awayFactors.last10Record,
    homeStreak: null,  // Would need to be calculated from recent games
    awayStreak: null,
    // Adjustments (from home team's perspective)
    restAdjustment: homeAdjustment.breakdown.restAdvantage + homeAdjustment.breakdown.backToBack,
    travelAdjustment: -awayAdjustment.breakdown.travel,  // Away team's travel penalty benefits home
    formAdjustment: homeAdjustment.breakdown.recentForm - awayAdjustment.breakdown.recentForm,
    totalAdjustment: homeAdjustment.totalAdjustment - awayAdjustment.totalAdjustment,
  }
}
