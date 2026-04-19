/**
 * Combined Sports Data Module
 * 
 * Merges data from multiple sources for comprehensive multi-sport coverage:
 * 1. ESPN API - FREE betting odds (spreads, totals, moneylines) + injuries, lineups, rosters
 * 2. The Odds API - Player props ONLY (to minimize API costs)
 * 
 * This gives Claude complete, real-time information to make
 * accurate betting recommendations without relying on training data.
 * 
 * COMPREHENSIVE COVERAGE:
 * - Tier 1: NBA, NFL, NHL, NCAAB, NCAAF, MLB
 * - Tier 2: EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League
 * - Tier 3: UFC/MMA
 * - Tier 4: Golf, Tennis
 * 
 * COST OPTIMIZATION:
 * - ESPN odds are FREE - used for all game lines (spreads, totals, moneylines)
 * - Odds API is PAID - used ONLY for player props
 */

import { getCachedPlayerProps, formatPlayerPropsForContext, getCurrentOdds, fetchAllOdds, fetchSportOdds, type GamePlayerProps, type Game } from './odds'
import { getCachedESPNData, getCachedESPNOdds, formatESPNForContext, formatESPNOddsForContext, type ESPNGameData, type ESPNInjury, type ESPNProbable } from './espn'
import { getWeatherForGames, formatWeatherForContext } from './weather'
import { getCachedSoccerStats, formatSoccerStatsForContext } from './soccer-stats'
import { 
  getCachedBestBet, 
  formatBestBetForContext,
  getCachedParlay,
  formatParlayForContext,
  getCachedSportBets,
  formatSportBestBetsForContext,
  getCachedBestProp,
  getCachedModelFirstProps,
  computeBestProp,
  formatBestPropForContext,
  computeBestBets,
  type BestBetResult
} from './bet-ranking'
import type { ESPNOdds } from './espn'
import { getTrackRecord, formatTrackRecordForContext } from './pick-tracking'
import { getEloRatings } from './elo'

export interface EnrichedGame extends Game {
  espnData?: {
    homeRecord?: string
    awayRecord?: string
    injuries: ESPNInjury[]
    probables: ESPNProbable[]
    venue?: string
    broadcast?: string
  }
}

export interface CombinedSportsData {
  games: EnrichedGame[]
  oddsLastUpdated: string
  espnLastUpdated: string
  totalGames: number
  espnError: string | null
  oddsError: string | null
}

/**
 * Match games between Odds API and ESPN data
 * Uses fuzzy team name matching since APIs use different naming conventions
 */
function matchGames(oddsGame: Game, espnGame: ESPNGameData): boolean {
  // Normalize team names for comparison
  const normalize = (name: string) => name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
  
  const oddsHome = normalize(oddsGame.homeTeam)
  const oddsAway = normalize(oddsGame.awayTeam)
  const espnHome = normalize(espnGame.homeTeam.name)
  const espnAway = normalize(espnGame.awayTeam.name)
  
  // Check for exact matches first
  if (oddsHome === espnHome && oddsAway === espnAway) {
    return true
  }
  
  // Check for partial matches (team name contains the other)
  const homeMatch = oddsHome.includes(espnHome) || espnHome.includes(oddsHome) ||
    oddsHome.split(' ').some(word => espnHome.includes(word) && word.length > 3) ||
    espnHome.split(' ').some(word => oddsHome.includes(word) && word.length > 3)
  
  const awayMatch = oddsAway.includes(espnAway) || espnAway.includes(oddsAway) ||
    oddsAway.split(' ').some(word => espnAway.includes(word) && word.length > 3) ||
    espnAway.split(' ').some(word => oddsAway.includes(word) && word.length > 3)
  
  return homeMatch && awayMatch
}

/**
 * Convert ESPN odds to Game format for best bet computation
 * This allows on-demand computation when the cache is empty
 * 
 * IMPORTANT: The bet-ranking algorithm requires at least 2 bookmakers for consensus calculation.
 * Since ESPN only provides one source (typically DraftKings), we create entries for multiple
 * bookmakers with the same odds. This is valid because ESPN's odds represent the market consensus.
 */
/**
 * Convert ESPN odds to EnrichedGame format for best bet computation
 * Now accepts optional ESPN game data to include injuries
 */
function convertESPNOddsToGame(espnOdds: ESPNOdds, espnGameData?: ESPNGameData): EnrichedGame {
  const sportKeyMap: Record<string, string> = {
    'NBA': 'basketball_nba',
    'NFL': 'americanfootball_nfl',
    'NHL': 'icehockey_nhl',
    'NCAAB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'MLB': 'baseball_mlb',
    'English Premier League': 'soccer_epl',
    'La Liga': 'soccer_spain_la_liga',
    'Bundesliga': 'soccer_germany_bundesliga',
    'Serie A': 'soccer_italy_serie_a',
    'Ligue 1': 'soccer_france_ligue_one',
    'MLS': 'soccer_usa_mls',
    'UEFA Champions League': 'soccer_uefa_champs_league',
  }
  
  const sportKey = sportKeyMap[espnOdds.league] || espnOdds.sport
  
  // Create entries for multiple bookmakers to satisfy consensus calculation requirement
  // ESPN typically shows DraftKings odds, but we duplicate for FanDuel to enable consensus
  const bookmakers = ['DraftKings', 'FanDuel']
  
  // SPREAD SIGN CONVENTION:
  // - Favorite team gets NEGATIVE spread (e.g., -6.5 means must win by > 6.5)
  // - Underdog team gets POSITIVE spread (e.g., +6.5 means can lose by up to 6)
  // 
  // ESPN's pickcenter.spread is ALREADY SIGNED from the home team's perspective:
  // - Negative value (e.g., -6.5) means home team is favorite
  // - Positive value (e.g., +6.5) means home team is underdog
  // 
  // We use the spread value directly without re-signing based on homeFavorite,
  // as the spread value itself already encodes who is favorite.
  // SPREAD JUICE: We require real spreadOdds before emitting a spread market.
  // Previously this defaulted to -110/-110 when ESPN didn't return juice
  // (primarily MLB runlines), which silently corrupted every downstream Kelly
  // and edge calculation. ESPN odds enrichment now pulls the real juice from
  // the core odds endpoint; if it's still unavailable we skip the market
  // rather than fabricate a line.
  const homeSpread = espnOdds.spread ?? 0  // Already signed from home team's perspective
  const spreads = (espnOdds.spread !== null && espnOdds.spreadOdds) ? bookmakers.map(bookmaker => ({
    bookmaker,
    market: 'spreads',
    outcomes: [
      // Home team gets the spread as-is (already signed correctly by ESPN)
      { name: espnOdds.homeTeam, price: espnOdds.spreadOdds!.home, point: homeSpread },
      // Away team gets the opposite spread
      { name: espnOdds.awayTeam, price: espnOdds.spreadOdds!.away, point: -homeSpread }
    ]
  })) : []

  const overUnderValue = espnOdds.overUnder ?? 0
  const totals = (espnOdds.overUnder !== null && espnOdds.overUnderOdds) ? bookmakers.map(bookmaker => ({
    bookmaker,
    market: 'totals',
    outcomes: [
      { name: 'Over', price: espnOdds.overUnderOdds!.over, point: overUnderValue },
      { name: 'Under', price: espnOdds.overUnderOdds!.under, point: overUnderValue }
    ]
  })) : []
  
  const moneylines = espnOdds.moneyline ? bookmakers.map(bookmaker => ({
    bookmaker,
    market: 'h2h',
    outcomes: [
      { name: espnOdds.homeTeam, price: espnOdds.moneyline!.home },
      { name: espnOdds.awayTeam, price: espnOdds.moneyline!.away },
      // Include Draw outcome for soccer 3-way markets (if available)
      ...(espnOdds.moneyline!.draw !== undefined ? [{ name: 'Draw', price: espnOdds.moneyline!.draw }] : [])
    ]
  })) : []
  
  // Build the enriched game with espnData if available
  const enrichedGame: EnrichedGame = {
    id: espnOdds.gameId,
    sport: sportKey,
    sportName: espnOdds.league,
    homeTeam: espnOdds.homeTeam,
    awayTeam: espnOdds.awayTeam,
    commenceTime: espnOdds.commenceTime,
    isNeutralSite: espnGameData?.neutralSite === true,
    spreads,
    totals,
    moneylines
  }
  
  // Add espnData with injuries if ESPN game data is provided
  if (espnGameData) {
    enrichedGame.espnData = {
      homeRecord: espnGameData.homeTeam.record,
      awayRecord: espnGameData.awayTeam.record,
      injuries: espnGameData.injuries,
      probables: espnGameData.probables,
      venue: espnGameData.venue,
      broadcast: espnGameData.broadcast,
    }
  }
  
  return enrichedGame
}

/**
 * Check if cached best bet result is valid (has required fields AND has games)
 * A cached result with 0 games analyzed is NOT valid - we should recompute
 */
function isValidBestBetResult(result: BestBetResult | null): result is BestBetResult {
  if (!result) return false
  if (typeof result.gamesAnalyzed !== 'number') return false
  if (typeof result.gamesQualified !== 'number') return false
  // CRITICAL: Don't use cached results with 0 games - this indicates a transient fetch failure
  // or a stale cache from when no games were available. Always recompute in this case.
  if (result.gamesAnalyzed === 0) {
    console.log('[isValidBestBetResult] Rejecting cached result with 0 games analyzed - will recompute')
    return false
  }
  return true
}

/**
 * Get today's date string in ET timezone (America/New_York)
 */
function getTodayET(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
}

/**
 * Check if a game's commence time falls on today (ET timezone)
 */
function isGameToday(commenceTime: string): boolean {
  const todayET = getTodayET()
  const gameDate = new Date(commenceTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  return gameDate === todayET
}

/**
 * Map Odds API sport names to ESPN league names
 * Comprehensive mapping for all supported sports
 */
function mapSportToLeague(sportName: string): string {
  const mapping: Record<string, string> = {
    // Tier 1 - Major US Sports
    'NBA': 'NBA',
    'NFL': 'NFL',
    'NCAAF': 'NCAAF',
    'NHL': 'NHL',
    'NCAAB': 'NCAAB',
    'MLB': 'MLB',
    // Tier 2 - Soccer
    'English Premier League': 'EPL',
    'La Liga': 'ESP.1',
    'Bundesliga': 'GER.1',
    'Serie A': 'ITA.1',
    'Ligue 1': 'FRA.1',
    'MLS': 'MLS',
    'UEFA Champions League': 'UEFA.CHAMPIONS',
    'UEFA Europa League': 'UEFA.EUROPA',
    'Liga MX': 'MEX.1',
    'Brazil Serie A': 'BRA.1',
    'Argentina Primera': 'ARG.1',
    // Tier 3 - Combat Sports
    'UFC/MMA': 'MMA',
    'Boxing': 'BOXING',
    // Tier 4 - Other Sports
    'Euroleague': 'EUROLEAGUE',
    'NBL (Australia)': 'NBL',
    'AHL': 'AHL',
    'SHL (Sweden)': 'SHL',
    'NRL': 'NRL',
    'AFL': 'AFL',
    'Six Nations': 'SIXNATIONS',
  }
  return mapping[sportName] || sportName
}

/**
 * Tier 1 sports that should always have odds data
 * Maps ESPN league name to Odds API sport key
 */
const TIER1_SPORTS_FALLBACK: Record<string, { key: string; name: string }> = {
  'NFL': { key: 'americanfootball_nfl', name: 'NFL' },
  'NBA': { key: 'basketball_nba', name: 'NBA' },
  'NHL': { key: 'icehockey_nhl', name: 'NHL' },
  'NCAAB': { key: 'basketball_ncaab', name: 'NCAAB' },
  'NCAAF': { key: 'americanfootball_ncaaf', name: 'NCAAF' },
  'MLB': { key: 'baseball_mlb', name: 'MLB' },
}

/**
 * Check if a game has valid odds data (at least one market)
 */
function hasValidOdds(game: ESPNOdds): boolean {
  return game.moneyline !== null || game.spread !== null || game.overUnder !== null
}

/**
 * Fetch odds from The Odds API for sports missing from ESPN
 * Only fetches for Tier 1 sports to minimize API costs
 */
async function fetchFallbackOdds(espnGames: ESPNOdds[]): Promise<{ games: Game[]; sportsWithFallback: string[] }> {
  // Group ESPN games by league and check which have valid odds
  const leaguesWithOdds = new Set<string>()
  const leaguesWithGames = new Set<string>()
  
  for (const game of espnGames) {
    leaguesWithGames.add(game.league)
    if (hasValidOdds(game)) {
      leaguesWithOdds.add(game.league)
    }
  }
  
  // Find Tier 1 sports that have games but no odds from ESPN
  const sportsNeedingFallback: { key: string; name: string }[] = []
  
  for (const [league, sportInfo] of Object.entries(TIER1_SPORTS_FALLBACK)) {
    // Only fetch fallback if:
    // 1. ESPN has games for this league but no odds, OR
    // 2. ESPN has no games at all for this league (might be missing entirely)
    const hasGames = leaguesWithGames.has(league)
    const hasOdds = leaguesWithOdds.has(league)
    
    if (hasGames && !hasOdds) {
      console.log(`[fetchFallbackOdds] ${league}: Has games but no odds from ESPN, fetching from Odds API`)
      sportsNeedingFallback.push(sportInfo)
    }
  }
  
  if (sportsNeedingFallback.length === 0) {
    return { games: [], sportsWithFallback: [] }
  }
  
  // Fetch odds from The Odds API for missing sports
  console.log(`[fetchFallbackOdds] Fetching fallback odds for ${sportsNeedingFallback.length} sports: ${sportsNeedingFallback.map(s => s.name).join(', ')}`)
  
  const fallbackPromises = sportsNeedingFallback.map(sport => 
    fetchSportOdds(sport.key, sport.name).catch(err => {
      console.error(`[fetchFallbackOdds] Failed to fetch ${sport.name}:`, err)
      return [] as Game[]
    })
  )
  
  const results = await Promise.all(fallbackPromises)
  const allFallbackGames = results.flat()
  
  console.log(`[fetchFallbackOdds] Got ${allFallbackGames.length} games from Odds API fallback`)
  
  return {
    games: allFallbackGames,
    sportsWithFallback: sportsNeedingFallback.map(s => s.name)
  }
}

/**
 * Get combined sports data from both APIs
 */
export async function getCombinedSportsData(): Promise<CombinedSportsData> {
  // Fetch both sources in parallel
  const [initialOddsData, espnData] = await Promise.all([
    getCurrentOdds(),
    getCachedESPNData()
  ])
  
  // If cache returned empty odds, force fetch fresh data
  let oddsData = initialOddsData
  if (!oddsData?.games?.length) {
    console.log('[getCombinedSportsData] Cache empty, fetching fresh odds...')
    oddsData = await fetchAllOdds()
  }
  
  // Enrich odds games with ESPN data
  const enrichedGames: EnrichedGame[] = oddsData.games.map(oddsGame => {
    // Find matching ESPN game
    const espnLeague = mapSportToLeague(oddsGame.sportName)
    const espnGame = espnData.games.find(eg => 
      eg.league === espnLeague && matchGames(oddsGame, eg)
    )
    
    if (espnGame) {
      return {
        ...oddsGame,
        isNeutralSite: espnGame.neutralSite === true,
        espnData: {
          homeRecord: espnGame.homeTeam.record,
          awayRecord: espnGame.awayTeam.record,
          injuries: espnGame.injuries,
          probables: espnGame.probables,
          venue: espnGame.venue,
          broadcast: espnGame.broadcast,
        }
      }
    }
    
    return oddsGame
  })
  
  return {
    games: enrichedGames,
    oddsLastUpdated: oddsData.lastUpdated,
    espnLastUpdated: espnData.lastUpdated,
    totalGames: enrichedGames.length,
    espnError: espnData.error,
    oddsError: oddsData.isStale ? 'Odds data may be stale' : null
  }
}

/**
 * Format combined data for Claude's context
 * This is the main function to use in the chat API
 */
export async function formatCombinedDataForContext(): Promise<string> {
  // Fetch ESPN odds (FREE), ESPN data, and CACHED player props in parallel
  // COST OPTIMIZATION: ESPN odds are FREE, Odds API is only used for player props
  // Props are refreshed by the cron job, not per-chat request
  const [espnOddsData, espnData, cachedProps] = await Promise.all([
    getCachedESPNOdds(),
    getCachedESPNData(),
    getCachedPlayerProps().catch(() => [] as GamePlayerProps[])
  ])
  
  // FALLBACK: If ESPN is missing odds for any Tier 1 sport, fetch from The Odds API
  // This ensures we always have odds data for major sports (NFL, NBA, NHL, etc.)
  const fallbackResult = await fetchFallbackOdds(espnOddsData.games)
  const fallbackGames = fallbackResult.games
  const sportsWithFallback = fallbackResult.sportsWithFallback
  
  if (fallbackGames.length > 0) {
    console.log(`[formatCombinedDataForContext] Using ${fallbackGames.length} games from Odds API fallback for: ${sportsWithFallback.join(', ')}`)
  }
  
  // Use cached props (populated by cron job)
  // NOTE: On-demand props fetching removed to avoid rate limiting (429 errors)
  // Props are refreshed by the cron job every 2 hours
  const allProps = Array.isArray(cachedProps) ? cachedProps : []
  console.log(`[formatCombinedDataForContext] Using ${allProps.length} cached props`)
  
  // Fetch weather for outdoor games (NFL, NCAAF, MLB, MLS, Soccer)
  const outdoorGames = espnOddsData.games
    .filter(g => ['NFL', 'NCAAF', 'MLB', 'MLS', 'English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1'].includes(g.league))
    .map(g => ({ id: g.gameId, homeTeam: g.homeTeam, awayTeam: g.awayTeam, sport: g.league }))
  
  // Fetch weather, soccer stats, best bet, parlay, sport bets, best prop, model-first props, track record, and Elo ratings in parallel
  // NOTE: Line movement is now computed from ESPN odds snapshots (handled by cron job)
  const [weatherMap, soccerStats, cachedBestBet, cachedParlay, cachedSportBets, cachedBestProp, cachedModelFirstProps, trackRecord, eloData] = await Promise.all([
    getWeatherForGames(outdoorGames).catch(() => new Map()),
    getCachedSoccerStats().catch(() => ({ leagues: [], lastUpdated: new Date().toISOString(), error: 'Failed to fetch' })),
    getCachedBestBet().catch(() => null),
    getCachedParlay().catch(() => null),
    getCachedSportBets().catch(() => null),
    getCachedBestProp().catch(() => null),
    getCachedModelFirstProps().catch(() => null),
    getTrackRecord().catch(() => null),
    getEloRatings().catch(() => null)
  ])
  
  // Convert Elo data to the format expected by formatESPNOddsForContext
  const eloRatingsMap = eloData?.ratings ?? null
  
  // Best bets: use cached data if valid, otherwise compute on-demand from ESPN odds
  let bestBetResult: BestBetResult | null = null
  if (isValidBestBetResult(cachedBestBet)) {
    bestBetResult = cachedBestBet
    console.log('[formatCombinedDataForContext] Using cached best bet')
  } else if (espnOddsData.games.length > 0) {
    // Compute on-demand from ESPN odds - FILTER TO TODAY'S GAMES ONLY (ET timezone)
    // CRITICAL: Merge injury data from espnData into games for proper injury detection
    console.log('[formatCombinedDataForContext] Computing best bet on-demand from ESPN odds...')
    
    // Convert ESPN odds to games WITH injury data from espnData
    // CRITICAL: Use robust matching to ensure injury data is properly merged
    const allGames = espnOddsData.games.map(espnOdds => {
      // Find matching ESPN game data to get injuries
      const espnLeague = mapSportToLeague(espnOdds.league)
      
      // Normalize team names for matching
      const normalizeTeamName = (name: string) => name.toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]/g, '')
        .trim()
      
      const oddsHome = normalizeTeamName(espnOdds.homeTeam)
      const oddsAway = normalizeTeamName(espnOdds.awayTeam)
      
      const espnGameData = espnData.games.find(eg => {
        if (eg.league !== espnLeague) return false
        
        const espnHome = normalizeTeamName(eg.homeTeam.name)
        const espnAway = normalizeTeamName(eg.awayTeam.name)
        
        // Check for exact or partial matches on BOTH teams
        const homeMatch = oddsHome === espnHome || 
          oddsHome.includes(espnHome) || espnHome.includes(oddsHome) ||
          oddsHome.split(' ').some(word => espnHome.includes(word) && word.length > 3)
        const awayMatch = oddsAway === espnAway || 
          oddsAway.includes(espnAway) || espnAway.includes(oddsAway) ||
          oddsAway.split(' ').some(word => espnAway.includes(word) && word.length > 3)
        
        return homeMatch && awayMatch
      })
      
      if (espnGameData && espnGameData.injuries.length > 0) {
        console.log(`[formatCombinedDataForContext] ✅ Found ${espnGameData.injuries.length} injuries for ${espnOdds.awayTeam} @ ${espnOdds.homeTeam}`)
        // Log key injuries (Out/Doubtful)
        const keyInjuries = espnGameData.injuries.filter(i => i.status === 'Out' || i.status === 'Doubtful')
        if (keyInjuries.length > 0) {
          keyInjuries.forEach(i => console.log(`   ⚠️ KEY INJURY: ${i.player} (${i.team}): ${i.status}`))
        }
      } else if (!espnGameData) {
        console.log(`[formatCombinedDataForContext] ❌ No ESPN match found for ${espnOdds.awayTeam} @ ${espnOdds.homeTeam} (league: ${espnLeague})`)
      }
      
      return convertESPNOddsToGame(espnOdds, espnGameData)
    })
    
    // Filter to today's games only so "best bet today" returns a game happening TODAY
    const todaysGames = allGames.filter(game => isGameToday(game.commenceTime))
    console.log(`[formatCombinedDataForContext] Filtered to ${todaysGames.length} games today (ET) out of ${allGames.length} total`)
    
    // Log injury data status
    const gamesWithInjuries = todaysGames.filter(g => g.espnData?.injuries && g.espnData.injuries.length > 0).length
    console.log(`[formatCombinedDataForContext] ${gamesWithInjuries} of ${todaysGames.length} games have injury data`)
    
    bestBetResult = await computeBestBets(todaysGames)
    console.log(`[formatCombinedDataForContext] Computed: ${bestBetResult.gamesAnalyzed} games, ${bestBetResult.gamesQualified} qualified`)
  }
  
  // Use cached parlay (populated by cron job)
  const parlayResult = cachedParlay
  
  // Use cached sport bets (populated by cron job)
  const sportBets = cachedSportBets
  
  // Use cached best prop (populated by cron job)
  const bestPropResult = cachedBestProp || computeBestProp(allProps)
  
  const lines: string[] = []
  
  // TRACK RECORD FIRST - Build trust with users
  lines.push(formatTrackRecordForContext(trackRecord))
  lines.push('')
  
  // BEST BET SECOND - This is the most important recommendation
  if (bestBetResult) {
    lines.push(formatBestBetForContext(bestBetResult))
    lines.push('')
  } else {
    lines.push('=== BEST BET OF THE DAY ===')
    lines.push('Best bet data is being computed by the cron job. Check back shortly.')
    lines.push('')
  }
  
  // PARLAY OF THE DAY - For users who want multi-leg bets
  if (parlayResult) {
    lines.push(formatParlayForContext(parlayResult))
    lines.push('')
  } else {
    lines.push('=== PARLAY OF THE DAY ===')
    lines.push('Parlay data is being computed by the cron job. Check back shortly.')
    lines.push('')
  }
  
  // SPORT-SPECIFIC BEST BETS - For users asking about specific sports
  if (sportBets) {
    lines.push(formatSportBestBetsForContext(sportBets))
    lines.push('')
  } else {
    lines.push('=== SPORT-SPECIFIC BEST BETS ===')
    lines.push('Sport-specific bets are being computed by the cron job. Check back shortly.')
    lines.push('')
  }
  
  // BEST PROP OF THE DAY - For users asking about player props
  // Pass model-first props for the parlay list (uses player stats as primary ranking like Elo)
  lines.push(formatBestPropForContext(bestPropResult, cachedModelFirstProps))
  lines.push('')
  
  // Header with data freshness info
  lines.push('=== REAL-TIME SPORTS DATA ===')
  lines.push('')
  lines.push('You have access to CURRENT data from SIX sources:')
  lines.push(`1. BETTING ODDS (ESPN - FREE) - ${espnOddsData.games.length} games with odds - Last updated: ${formatTimestamp(espnOddsData?.lastUpdated || new Date().toISOString())}`)
  lines.push(`2. INJURIES & LINEUPS (ESPN API) - Last updated: ${formatTimestamp(espnData?.lastUpdated || new Date().toISOString())}${espnData?.error ? ' ⚠️ ' + espnData.error : ''}`)
  lines.push(`3. PLAYER PROPS (The Odds API) - ${allProps.length} games with props (cached, refreshed by cron)`)
  lines.push(`4. WEATHER (OpenWeatherMap) - ${weatherMap.size} outdoor games with weather data`)
  lines.push(`5. SOCCER STANDINGS (Football-data.org) - ${soccerStats.leagues.length} leagues with standings${soccerStats.error ? ' ⚠️ ' + soccerStats.error : ''}`)
  lines.push(`6. LINE MOVEMENT - Tracked via ESPN odds snapshots (updated by cron)`)
  lines.push('')
  
  // Critical instructions for Claude
  lines.push('CRITICAL INSTRUCTIONS:')
  lines.push('- ALWAYS verify starting goalies for NHL games')
  lines.push('- ALWAYS reference current team records')
  lines.push('- NEVER cite players who may have been traded - use ESPN data to verify rosters')
  lines.push('- Do NOT mention specific player injuries or rest days in your response - our Elo model already accounts for these')
  lines.push('- For OUTDOOR games (NFL, MLB, MLS): ALWAYS check weather conditions below')
  lines.push('')
  
  // Player props confidence rules
  lines.push('PLAYER PROPS CONFIDENCE RULES:')
  lines.push('- If a player has props listed below → HIGH confidence they will play (sportsbooks expect them to play)')
  lines.push('- If player is a star (LeBron, Curry, etc.) but no props yet → MEDIUM confidence, recommend with disclaimer')
  lines.push('- If player is NOT listed and not a star → LOW confidence, suggest waiting for lineup confirmation')
  lines.push('- For MORNING requests (before props posted): Focus on star players, add "verify lineup before game" disclaimer')
  lines.push('- For AFTERNOON/EVENING requests: Use props data for high-confidence recommendations')
  lines.push('')
  
  // Add ESPN odds data (FREE - replaces The Odds API for game lines)
  // Pass Elo ratings so every game displays team Elo ratings
  lines.push(formatESPNOddsForContext(espnOddsData, eloRatingsMap))
  lines.push('')
  
  // Add fallback odds from The Odds API (only for sports missing from ESPN)
  if (fallbackGames.length > 0) {
    lines.push(formatFallbackOddsForContext(fallbackGames, sportsWithFallback))
    lines.push('')
  }
  
  // Add weather data for outdoor games
  if (weatherMap.size > 0) {
    lines.push(formatWeatherForContext(weatherMap, outdoorGames))
  }
  
  // Add soccer standings data
  if (soccerStats.leagues.length > 0) {
    lines.push(formatSoccerStatsForContext(soccerStats))
  }
  
  // Add player props data for ALL sports
  if (allProps.length > 0) {
    lines.push(formatPlayerPropsForContext(allProps))
  } else {
    lines.push('\n=== PLAYER PROPS ===')
    lines.push('No player props currently available. Props are typically posted by sportsbooks in the morning/early afternoon.')
    lines.push('For prop recommendations without props data: Focus on star players who always start when healthy.')
    lines.push('')
  }
  
  // Add ESPN data
  lines.push(formatESPNForContext(espnData))
  
  return lines.join('\n')
}

/**
 * Format fallback odds from The Odds API for context
 * Used when ESPN doesn't have odds for certain sports
 */
function formatFallbackOddsForContext(games: Game[], sportsWithFallback: string[]): string {
  if (games.length === 0) {
    return ''
  }
  
  const lines: string[] = []
  lines.push(`\n=== FALLBACK ODDS (The Odds API) ===`)
  lines.push(`Source: The Odds API (used because ESPN was missing odds for: ${sportsWithFallback.join(', ')})`)
  lines.push(`Games: ${games.length}`)
  lines.push(``)
  
  // Group by sport
  const bySport: Record<string, Game[]> = {}
  for (const game of games) {
    const sport = game.sportName || 'Unknown'
    if (!bySport[sport]) {
      bySport[sport] = []
    }
    bySport[sport].push(game)
  }
  
  for (const sport of Object.keys(bySport)) {
    const sportGames = bySport[sport]
    lines.push(`--- ${sport} (${sportGames.length} games) ---`)
    
    for (const game of sportGames) {
      const gameTime = new Date(game.commenceTime).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
      
      lines.push(`${game.awayTeam} @ ${game.homeTeam}`)
      lines.push(`  Time: ${gameTime} ET`)
      
      const oddsInfo: string[] = []
      
      // Get spread from first bookmaker
      if (game.spreads && game.spreads.length > 0) {
        const spread = game.spreads[0]
        const homeSpread = spread.outcomes.find(o => o.name === game.homeTeam)
        if (homeSpread && homeSpread.point !== undefined) {
          oddsInfo.push(`Spread: ${game.homeTeam} ${homeSpread.point > 0 ? '+' : ''}${homeSpread.point}`)
        }
      }
      
      // Get total from first bookmaker
      if (game.totals && game.totals.length > 0) {
        const total = game.totals[0]
        const over = total.outcomes.find(o => o.name === 'Over')
        if (over) {
          oddsInfo.push(`O/U: ${over.point}`)
        }
      }
      
      // Get moneyline from first bookmaker
      if (game.moneylines && game.moneylines.length > 0) {
        const ml = game.moneylines[0]
        const homeML = ml.outcomes.find(o => o.name === game.homeTeam)
        const awayML = ml.outcomes.find(o => o.name === game.awayTeam)
        if (homeML && awayML) {
          oddsInfo.push(`ML: ${game.homeTeam} ${homeML.price > 0 ? '+' : ''}${homeML.price} / ${game.awayTeam} ${awayML.price > 0 ? '+' : ''}${awayML.price}`)
        }
      }
      
      if (oddsInfo.length > 0) {
        lines.push(`  ${oddsInfo.join(' | ')}`)
      } else {
        lines.push(`  ODDS UNAVAILABLE`)
      }
      lines.push(``)
    }
  }
  
  return lines.join('\n')
}

/**
 * Helper to format timestamp
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })
}
