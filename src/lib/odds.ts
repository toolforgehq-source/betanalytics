/**
 * The Odds API Integration with Redis Caching
 * 
 * Fetches real betting odds from The Odds API for 25+ sports
 * and caches them in Redis to stay under API rate limits.
 * 
 * COMPREHENSIVE MULTI-SPORT COVERAGE:
 * - Tier 1: NBA, NFL, NHL, NCAAB, NCAAF, MLB (daily US sports)
 * - Tier 2: Soccer (EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League)
 * - Tier 3: Combat Sports (UFC/MMA, Boxing)
 * - Tier 4: Other Sports (Golf, Tennis, Cricket, Rugby, AFL, Esports)
 * 
 * Uses Promise.allSettled for graceful degradation when sources fail.
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports'

// Comprehensive sports coverage - organized by tier
// Tier 1: Daily major US sports (highest priority)
// Tier 2: Major soccer leagues (high priority)
// Tier 3: Combat sports and events (medium priority)
// Tier 4: Other sports (lower priority but still covered)

const ALL_SPORTS = [
  // ============================================
  // TIER 1: MAJOR US SPORTS (Daily Coverage)
  // ============================================
  { key: 'basketball_nba', name: 'NBA', tier: 1, category: 'basketball' },
  { key: 'americanfootball_nfl', name: 'NFL', tier: 1, category: 'football' },
  { key: 'icehockey_nhl', name: 'NHL', tier: 1, category: 'hockey' },
  { key: 'basketball_ncaab', name: 'NCAAB', tier: 1, category: 'basketball' },
  { key: 'americanfootball_ncaaf', name: 'NCAAF', tier: 1, category: 'football' },
  { key: 'baseball_mlb', name: 'MLB', tier: 1, category: 'baseball' },
  
  // ============================================
  // TIER 2: MAJOR SOCCER LEAGUES
  // ============================================
  { key: 'soccer_epl', name: 'English Premier League', tier: 2, category: 'soccer' },
  { key: 'soccer_spain_la_liga', name: 'La Liga', tier: 2, category: 'soccer' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga', tier: 2, category: 'soccer' },
  { key: 'soccer_italy_serie_a', name: 'Serie A', tier: 2, category: 'soccer' },
  { key: 'soccer_france_ligue_one', name: 'Ligue 1', tier: 2, category: 'soccer' },
  { key: 'soccer_usa_mls', name: 'MLS', tier: 2, category: 'soccer' },
  { key: 'soccer_uefa_champs_league', name: 'UEFA Champions League', tier: 2, category: 'soccer' },
  { key: 'soccer_uefa_europa_league', name: 'UEFA Europa League', tier: 2, category: 'soccer' },
  { key: 'soccer_mexico_ligamx', name: 'Liga MX', tier: 2, category: 'soccer' },
  { key: 'soccer_brazil_campeonato', name: 'Brazil Serie A', tier: 2, category: 'soccer' },
  { key: 'soccer_argentina_primera_division', name: 'Argentina Primera', tier: 2, category: 'soccer' },
  
  // ============================================
  // TIER 3: COMBAT SPORTS & EVENTS
  // ============================================
  { key: 'mma_mixed_martial_arts', name: 'UFC/MMA', tier: 3, category: 'combat' },
  { key: 'boxing_boxing', name: 'Boxing', tier: 3, category: 'combat' },
  
  // ============================================
  // TIER 4: OTHER MAJOR SPORTS
  // ============================================
  // Basketball (International)
  { key: 'basketball_euroleague', name: 'Euroleague', tier: 4, category: 'basketball' },
  { key: 'basketball_nbl', name: 'NBL (Australia)', tier: 4, category: 'basketball' },
  
  // Hockey (International)
  { key: 'icehockey_sweden_hockey_league', name: 'SHL (Sweden)', tier: 4, category: 'hockey' },
  { key: 'icehockey_liiga', name: 'Liiga (Finland)', tier: 4, category: 'hockey' },
  { key: 'icehockey_ahl', name: 'AHL', tier: 4, category: 'hockey' },
  
  // Golf (Majors & Tours)
  { key: 'golf_masters_tournament_winner', name: 'Masters', tier: 4, category: 'golf' },
  { key: 'golf_pga_championship_winner', name: 'PGA Championship', tier: 4, category: 'golf' },
  { key: 'golf_us_open_winner', name: 'US Open (Golf)', tier: 4, category: 'golf' },
  { key: 'golf_the_open_championship_winner', name: 'The Open', tier: 4, category: 'golf' },
  
  // Tennis
  { key: 'tennis_atp_aus_open', name: 'Australian Open', tier: 4, category: 'tennis' },
  { key: 'tennis_atp_french_open', name: 'French Open', tier: 4, category: 'tennis' },
  { key: 'tennis_atp_wimbledon', name: 'Wimbledon', tier: 4, category: 'tennis' },
  { key: 'tennis_atp_us_open', name: 'US Open (Tennis)', tier: 4, category: 'tennis' },
  
  // Cricket
  { key: 'cricket_big_bash', name: 'Big Bash', tier: 4, category: 'cricket' },
  { key: 'cricket_international_t20', name: 'International T20', tier: 4, category: 'cricket' },
  { key: 'cricket_odi', name: 'ODI Cricket', tier: 4, category: 'cricket' },
  { key: 'cricket_ipl', name: 'IPL', tier: 4, category: 'cricket' },
  
  // Rugby
  { key: 'rugbyleague_nrl', name: 'NRL', tier: 4, category: 'rugby' },
  { key: 'rugbyunion_six_nations', name: 'Six Nations', tier: 4, category: 'rugby' },
  
  // Australian Rules
  { key: 'aussierules_afl', name: 'AFL', tier: 4, category: 'aussierules' },
  
  // Motor Sports (futures only typically)
  { key: 'motorsport_formula_one', name: 'Formula 1', tier: 4, category: 'motorsport' },
  { key: 'motorsport_nascar', name: 'NASCAR', tier: 4, category: 'motorsport' },
  
  // Additional Soccer Leagues
  { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie', tier: 4, category: 'soccer' },
  { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga', tier: 4, category: 'soccer' },
  { key: 'soccer_belgium_first_div', name: 'Belgian First Div', tier: 4, category: 'soccer' },
  { key: 'soccer_turkey_super_league', name: 'Turkish Super Lig', tier: 4, category: 'soccer' },
  { key: 'soccer_australia_aleague', name: 'A-League', tier: 4, category: 'soccer' },
  { key: 'soccer_japan_j_league', name: 'J-League', tier: 4, category: 'soccer' },
  { key: 'soccer_korea_kleague1', name: 'K-League', tier: 4, category: 'soccer' },
  { key: 'soccer_conmebol_copa_libertadores', name: 'Copa Libertadores', tier: 4, category: 'soccer' },
  
  // Lacrosse
  { key: 'lacrosse_ncaa', name: 'NCAA Lacrosse', tier: 4, category: 'lacrosse' },
]

// ALL_SPORTS is used directly, no legacy alias needed

// Cache expiry: 4 hours (in seconds)
const CACHE_EXPIRY_SECONDS = 4 * 60 * 60

// Redis cache keys
const ODDS_CACHE_KEY = 'betanalytics:odds:data'
const PROPS_CACHE_KEY = 'betanalytics:props:data'

// Props cache expiry: 2 hours (shorter than odds since props change more frequently)
const PROPS_CACHE_EXPIRY_SECONDS = 2 * 60 * 60

export interface Game {
  id: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  spreads: BookmakerOdds[]
  totals: BookmakerOdds[]
  moneylines: BookmakerOdds[]
}

export interface BookmakerOdds {
  bookmaker: string
  market: string
  outcomes: Outcome[]
}

export interface Outcome {
  name: string
  price: number
  point?: number
}

export interface OddsData {
  games: Game[]
  lastUpdated: string
  isStale: boolean
  coverage?: CoverageReport
}

// Coverage report for transparency about what data is available
export interface SportCoverage {
  key: string
  name: string
  tier: number
  category: string
  gamesAvailable: number
  propsAvailable: boolean
  status: 'active' | 'no_games' | 'error' | 'offseason'
  error?: string
}

export interface CoverageReport {
  timestamp: string
  totalSports: number
  activeSports: number
  totalGames: number
  sportsCoverage: SportCoverage[]
  summary: {
    tier1: { sports: number; games: number }
    tier2: { sports: number; games: number }
    tier3: { sports: number; games: number }
    tier4: { sports: number; games: number }
  }
}

// API Response types from The Odds API
interface OddsApiGame {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsApiBookmaker[]
}

interface OddsApiBookmaker {
  key: string
  title: string
  markets: OddsApiMarket[]
}

interface OddsApiMarket {
  key: string
  outcomes: OddsApiOutcome[]
}

interface OddsApiOutcome {
  name: string
  price: number
  point?: number
}

/**
 * Get Redis client for caching
 */
async function getRedisClient() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.warn('Redis not configured, caching disabled')
    return null
  }
  
  return { url, token }
}

/**
 * Get cached odds data from Redis
 */
async function getCachedOdds(): Promise<OddsData | null> {
  const redis = await getRedisClient()
  if (!redis) {
    console.log('[getCachedOdds] Redis not configured')
    return null
  }
  
  try {
    console.log(`[getCachedOdds] Fetching from Redis: ${redis.url}/get/${ODDS_CACHE_KEY}`)
    const response = await fetch(`${redis.url}/get/${ODDS_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) {
      console.log(`[getCachedOdds] Redis response not OK: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    console.log(`[getCachedOdds] Redis response has result: ${!!data.result}, type: ${typeof data.result}`)
    if (!data.result) return null
    
    const parsed = JSON.parse(data.result) as OddsData
    console.log(`[getCachedOdds] Parsed ${parsed.games?.length || 0} games from cache`)
    return parsed
  } catch (error) {
    console.error('[getCachedOdds] Error getting cached odds:', error)
    return null
  }
}

/**
 * Save odds data to Redis cache
 */
async function setCachedOdds(oddsData: OddsData): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  
  try {
    await fetch(`${redis.url}/set/${ODDS_CACHE_KEY}`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(oddsData))
    })
    
    // Set expiry
    await fetch(`${redis.url}/expire/${ODDS_CACHE_KEY}/${CACHE_EXPIRY_SECONDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
  } catch (error) {
    console.error('Error caching odds:', error)
  }
}

/**
 * Get cached player props from Redis
 */
export async function getCachedPlayerProps(): Promise<GamePlayerProps[] | null> {
  const redis = await getRedisClient()
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${PROPS_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
      cache: 'no-store',
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    const propsData = JSON.parse(data.result) as { props: GamePlayerProps[], lastUpdated: string }
    
    // Check if cache is still valid (within 2 hours)
    const cacheAge = Date.now() - new Date(propsData.lastUpdated).getTime()
    if (cacheAge > PROPS_CACHE_EXPIRY_SECONDS * 1000) {
      console.log('[getCachedPlayerProps] Cache expired')
      return null
    }
    
    console.log(`[getCachedPlayerProps] Returning ${propsData.props.length} cached props`)
    return propsData.props
  } catch (error) {
    console.error('Error getting cached props:', error)
    return null
  }
}

/**
 * Save player props to Redis cache
 * Note: Props payloads can be very large, so we store a trimmed version
 */
export async function setCachedPlayerProps(props: GamePlayerProps[]): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) {
    console.log('[setCachedPlayerProps] Redis not configured')
    return false
  }
  
  try {
    // Trim props to reduce payload size - keep only essential data
    const trimmedProps = props.map(game => ({
      ...game,
      // Keep only first 15 players per game to reduce size
      playersWithProps: game.playersWithProps?.slice(0, 15) || [],
      // Keep only first 100 props per game (most important ones)
      props: game.props?.slice(0, 100) || [],
    }))
    
    const cacheData = {
      props: trimmedProps,
      lastUpdated: new Date().toISOString()
    }
    
    const payload = JSON.stringify(JSON.stringify(cacheData))
    const payloadSizeKB = Math.round(payload.length / 1024)
    console.log(`[setCachedPlayerProps] Payload size: ${payloadSizeKB}KB for ${props.length} games`)
    
    const setResponse = await fetch(`${redis.url}/set/${PROPS_CACHE_KEY}`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json'
      },
      body: payload
    })
    
    if (!setResponse.ok) {
      const errorText = await setResponse.text()
      console.error(`[setCachedPlayerProps] Redis SET failed: ${setResponse.status} - ${errorText}`)
      return false
    }
    
    // Set expiry
    const expireResponse = await fetch(`${redis.url}/expire/${PROPS_CACHE_KEY}/${PROPS_CACHE_EXPIRY_SECONDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!expireResponse.ok) {
      console.error(`[setCachedPlayerProps] Redis EXPIRE failed: ${expireResponse.status}`)
    }
    
    console.log(`[setCachedPlayerProps] Successfully cached ${trimmedProps.length} games (${payloadSizeKB}KB)`)
    return true
  } catch (error) {
    console.error('[setCachedPlayerProps] Error:', error)
    return false
  }
}

/**
 * Fetch odds for a single sport from The Odds API
 */
async function fetchSportOdds(sportKey: string, sportName: string): Promise<Game[]> {
  const apiKey = process.env.ODDS_API_KEY
  
  if (!apiKey) {
    console.error('ODDS_API_KEY not configured')
    return []
  }
  
  try {
    const url = `${ODDS_API_BASE}/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store', // Disable Next.js fetch caching to ensure fresh data
    })
    
    if (!response.ok) {
      console.error(`Odds API error for ${sportKey}:`, response.status)
      return []
    }
    
    const data: OddsApiGame[] = await response.json()
    
    // Transform API response to our format
    return data.map((game: OddsApiGame) => ({
      id: game.id,
      sport: sportKey,
      sportName: sportName,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      spreads: extractMarket(game.bookmakers, 'spreads'),
      totals: extractMarket(game.bookmakers, 'totals'),
      moneylines: extractMarket(game.bookmakers, 'h2h'),
    }))
  } catch (error) {
    console.error(`Error fetching ${sportKey} odds:`, error)
    return []
  }
}

/**
 * Extract a specific market from bookmakers data
 */
function extractMarket(bookmakers: OddsApiBookmaker[], marketKey: string): BookmakerOdds[] {
  if (!bookmakers) return []
  
  // Expanded list of sportsbooks to ensure we capture all games
  const priorityBooks = [
    'draftkings', 'fanduel', 'betmgm', 'pointsbetus', 'bovada',
    'williamhill_us', 'caesars', 'betrivers', 'unibet_us', 'barstool',
    'wynnbet', 'superbook', 'twinspires', 'betus', 'lowvig',
    'mybookieag', 'betonlineag'
  ]
  
  return bookmakers
    .filter(bm => priorityBooks.includes(bm.key))
    .map(bm => {
      const market = bm.markets?.find((m: OddsApiMarket) => m.key === marketKey)
      if (!market) return null
      
      return {
        bookmaker: formatBookmakerName(bm.key),
        market: marketKey,
        outcomes: market.outcomes.map((o: OddsApiOutcome) => ({
          name: o.name,
          price: o.price,
          point: o.point,
        }))
      }
    })
    .filter(Boolean) as BookmakerOdds[]
}

/**
 * Format bookmaker key to display name
 */
function formatBookmakerName(key: string): string {
  const names: Record<string, string> = {
    'draftkings': 'DraftKings',
    'fanduel': 'FanDuel',
    'betmgm': 'BetMGM',
    'pointsbetus': 'PointsBet',
    'bovada': 'Bovada',
    'williamhill_us': 'William Hill',
    'caesars': 'Caesars',
    'betrivers': 'BetRivers',
    'unibet_us': 'Unibet',
    'barstool': 'Barstool',
    'wynnbet': 'WynnBET',
    'superbook': 'SuperBook',
    'twinspires': 'TwinSpires',
    'betus': 'BetUS',
    'lowvig': 'LowVig',
    'mybookieag': 'MyBookie',
    'betonlineag': 'BetOnline',
  }
  return names[key] || key
}

/**
 * Validate a game has all required data
 */
function validateGame(game: Game): boolean {
  if (!game.id || !game.homeTeam || !game.awayTeam || !game.commenceTime) {
    console.error('Invalid game structure:', game.id)
    return false
  }
  
  // Must have at least one market with odds
  const hasOdds = game.spreads.length > 0 || game.totals.length > 0 || game.moneylines.length > 0
  if (!hasOdds) {
    console.error('Game has no odds:', game.id)
    return false
  }
  
  return true
}

/**
 * Get sport display name from key
 */
export function getSportTitle(sportKey: string): string {
  const sport = ALL_SPORTS.find(s => s.key === sportKey)
  return sport?.name || sportKey
}

/**
 * Fetch fresh odds from The Odds API
 * Uses Promise.allSettled for graceful degradation - one failing sport won't break others
 * 
 * @param tier1Only - If true, only fetch Tier 1 sports (NBA, NFL, NHL, NCAAB, NCAAF, MLB)
 *                    This dramatically reduces API usage from ~50 requests to ~6 requests
 */
export async function fetchAllOdds(tier1Only: boolean = false): Promise<OddsData> {
  const apiKey = process.env.ODDS_API_KEY
  
  if (!apiKey) {
    console.error('ODDS_API_KEY not configured')
    return {
      games: [],
      lastUpdated: new Date().toISOString(),
      isStale: true,
    }
  }
  
  // Filter to Tier 1 sports only if requested (reduces API usage from ~50 to ~6 requests)
  const sportsToFetch = tier1Only ? ALL_SPORTS.filter(s => s.tier === 1) : ALL_SPORTS
  
  console.log(`■ Fetching odds for ${sportsToFetch.length} sports${tier1Only ? ' (Tier 1 only)' : ''} using Promise.allSettled...`)
  
  // Fetch sports in parallel using Promise.allSettled for graceful degradation
  const fetchPromises = sportsToFetch.map(async (sport) => {
    const games = await fetchSportOdds(sport.key, sport.name)
    return { 
      sport: sport.key, 
      sportName: sport.name, 
      tier: sport.tier,
      category: sport.category,
      games 
    }
  })
  
  // Use Promise.allSettled so one failing sport doesn't break the entire fetch
  const settledResults = await Promise.allSettled(fetchPromises)
  
  // Aggregate all games and build coverage report
  const allGames: Game[] = []
  const sportsCoverage: SportCoverage[] = []
  const tierSummary = {
    tier1: { sports: 0, games: 0 },
    tier2: { sports: 0, games: 0 },
    tier3: { sports: 0, games: 0 },
    tier4: { sports: 0, games: 0 },
  }
  
  for (let i = 0; i < settledResults.length; i++) {
    const result = settledResults[i]
    const sportConfig = sportsToFetch[i]
    
    if (result.status === 'fulfilled') {
      const { sport, sportName, tier, category, games } = result.value
      
      // Determine status
      let status: 'active' | 'no_games' | 'error' | 'offseason' = 'no_games'
      if (games.length > 0) {
        status = 'active'
      }
      
      sportsCoverage.push({
        key: sport,
        name: sportName,
        tier,
        category,
        gamesAvailable: games.length,
        propsAvailable: false, // Will be updated by props fetch
        status,
      })
      
      // Update tier summary
      const tierKey = `tier${tier}` as keyof typeof tierSummary
      if (games.length > 0) {
        tierSummary[tierKey].sports++
        tierSummary[tierKey].games += games.length
      }
      
      // Validate and add games
      for (const game of games) {
        if (validateGame(game)) {
          allGames.push(game)
        }
      }
      
      console.log(`■ ${sportName}: ${games.length} games`)
    } else {
      // Promise rejected - sport fetch failed
      const errorMsg = result.reason instanceof Error ? result.reason.message : 'Unknown error'
      console.error(`■ Failed to fetch ${sportConfig.key}: ${errorMsg}`)
      
      sportsCoverage.push({
        key: sportConfig.key,
        name: sportConfig.name,
        tier: sportConfig.tier,
        category: sportConfig.category,
        gamesAvailable: 0,
        propsAvailable: false,
        status: 'error',
        error: errorMsg,
      })
    }
  }
  
  // Build coverage report
  const activeSports = sportsCoverage.filter(s => s.status === 'active').length
  const coverage: CoverageReport = {
    timestamp: new Date().toISOString(),
    totalSports: ALL_SPORTS.length,
    activeSports,
    totalGames: allGames.length,
    sportsCoverage,
    summary: tierSummary,
  }
  
  console.log(`■ Coverage: ${activeSports}/${ALL_SPORTS.length} sports active, ${allGames.length} total games`)
  console.log(`■ Tier 1: ${tierSummary.tier1.sports} sports, ${tierSummary.tier1.games} games`)
  console.log(`■ Tier 2: ${tierSummary.tier2.sports} sports, ${tierSummary.tier2.games} games`)
  
  const oddsData: OddsData = {
    games: allGames,
    lastUpdated: new Date().toISOString(),
    isStale: false,
    coverage,
  }
  
  // IMPORTANT: Only cache if we got actual games
  // Don't overwrite good cached data with empty data (e.g., when API quota exhausted)
  if (allGames.length > 0) {
    await setCachedOdds(oddsData)
    console.log(`[fetchAllOdds] Cached ${allGames.length} games`)
  } else {
    console.warn('[fetchAllOdds] NOT caching - no games returned (API may be down or quota exhausted)')
    // Mark as stale since we couldn't get fresh data
    oddsData.isStale = true
  }
  
  return oddsData
}

/**
 * Get current odds - returns cached data if fresh, fetches new if stale
 * This is the main function to call from the chat API
 */
/**
 * Check if cached games have upcoming events
 * Returns true if there are games starting within the next 48 hours
 * This prevents serving "yesterday's games" even if cache TTL hasn't expired
 */
function hasUpcomingGames(games: Game[]): boolean {
  if (!games || games.length === 0) return false
  
  const now = new Date()
  const fortyEightHoursFromNow = new Date(now.getTime() + 48 * 60 * 60 * 1000)
  
  // Check if any game starts between now and 48 hours from now
  const upcomingGames = games.filter(game => {
    const gameTime = new Date(game.commenceTime)
    return gameTime > now && gameTime < fortyEightHoursFromNow
  })
  
  console.log(`[hasUpcomingGames] Found ${upcomingGames.length} games in next 48 hours out of ${games.length} total`)
  return upcomingGames.length > 0
}

export async function getCurrentOdds(): Promise<OddsData> {
  // First, try to get cached data
  console.log('[getCurrentOdds] Checking cache...')
  const cached = await getCachedOdds()
  console.log(`[getCurrentOdds] Cache result: ${cached ? (cached.games?.length || 0) + ' games' : 'null'}`)
  
  if (cached && cached.games) {
    // Check if cache is still fresh (less than 2 hours old) - reduced from 4 hours
    const lastUpdated = new Date(cached.lastUpdated)
    const now = new Date()
    const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60)
    console.log(`[getCurrentOdds] Cache age: ${hoursSinceUpdate.toFixed(2)} hours`)
    
    // SMART STALENESS CHECK:
    // 1. Time-based: Cache must be less than 2 hours old
    // 2. Content-based: Cache must have upcoming games (not yesterday's completed games)
    const isFreshByTime = hoursSinceUpdate < 2
    const hasUpcoming = hasUpcomingGames(cached.games)
    
    console.log(`[getCurrentOdds] Fresh by time: ${isFreshByTime}, Has upcoming games: ${hasUpcoming}`)
    
    if (isFreshByTime && hasUpcoming) {
      // Cache is fresh AND has upcoming games, return it
      console.log(`[getCurrentOdds] Returning cached data with ${cached.games.length} games`)
      return cached
    }
    
    // Cache is stale (by time OR by content), try to fetch new data
    console.log(`[getCurrentOdds] Cache stale - fetching fresh data...`)
    try {
      return await fetchAllOdds()
    } catch (error) {
      console.error('Error fetching fresh odds, returning stale cache:', error)
      // Return stale cache with flag
      return { ...cached, isStale: true }
    }
  }
  
  // No cache, must fetch fresh
  try {
    return await fetchAllOdds()
  } catch (error) {
    console.error('Error fetching odds with no cache:', error)
    // Return empty data
    return {
      games: [],
      lastUpdated: new Date().toISOString(),
      isStale: true,
    }
  }
}

/**
 * Format coverage report for Claude's context
 * Shows what sports were checked and what data is available
 */
export function formatCoverageForContext(coverage: CoverageReport | undefined): string {
  if (!coverage) {
    return `\n=== COVERAGE REPORT ===\nNo coverage data available.\n`
  }
  
  const lines: string[] = []
  lines.push(`\n=== DATA COVERAGE REPORT ===`)
  lines.push(`Last Updated: ${formatTimestamp(coverage.timestamp)}`)
  lines.push(`Sports Checked: ${coverage.totalSports} | Active: ${coverage.activeSports} | Total Games: ${coverage.totalGames}`)
  lines.push(``)
  
  // Tier summary
  lines.push(`TIER SUMMARY:`)
  lines.push(`  Tier 1 (Major US): ${coverage.summary.tier1.sports} sports active, ${coverage.summary.tier1.games} games`)
  lines.push(`  Tier 2 (Soccer): ${coverage.summary.tier2.sports} sports active, ${coverage.summary.tier2.games} games`)
  lines.push(`  Tier 3 (Combat): ${coverage.summary.tier3.sports} sports active, ${coverage.summary.tier3.games} games`)
  lines.push(`  Tier 4 (Other): ${coverage.summary.tier4.sports} sports active, ${coverage.summary.tier4.games} games`)
  lines.push(``)
  
  // Active sports
  const activeSports = coverage.sportsCoverage.filter(s => s.status === 'active')
  if (activeSports.length > 0) {
    lines.push(`ACTIVE SPORTS WITH GAMES:`)
    for (const sport of activeSports) {
      lines.push(`  - ${sport.name}: ${sport.gamesAvailable} games`)
    }
    lines.push(``)
  }
  
  // Sports with no games (offseason or no events)
  const noGamesSports = coverage.sportsCoverage.filter(s => s.status === 'no_games')
  if (noGamesSports.length > 0) {
    lines.push(`SPORTS CHECKED (no games today):`)
    const noGamesNames = noGamesSports.map(s => s.name).join(', ')
    lines.push(`  ${noGamesNames}`)
    lines.push(``)
  }
  
  // Errors
  const errorSports = coverage.sportsCoverage.filter(s => s.status === 'error')
  if (errorSports.length > 0) {
    lines.push(`SPORTS WITH ERRORS:`)
    for (const sport of errorSports) {
      lines.push(`  - ${sport.name}: ${sport.error || 'Unknown error'}`)
    }
    lines.push(``)
  }
  
  return lines.join('\n')
}

/**
 * Format odds data for Claude's context
 * Creates a readable summary of today's games and odds
 */
export function formatOddsForContext(oddsData: OddsData): string {
  // Always include coverage report first for transparency
  let coverageSection = ''
  if (oddsData?.coverage) {
    coverageSection = formatCoverageForContext(oddsData.coverage)
  }
  
  if (!oddsData?.games?.length) {
    return `${coverageSection}
=== CURRENT BETTING ODDS ===

⚠️ ODDS DATA UNAVAILABLE ⚠️

No betting odds data is currently available. This is likely due to:
- API quota exhausted (most common)
- API service temporarily down
- Network connectivity issues

Last attempted fetch: ${formatTimestamp(oddsData?.lastUpdated || new Date().toISOString())}

CRITICAL INSTRUCTIONS FOR CLAUDE:
- DO NOT list any games or schedules - you have NO current game data
- DO NOT say "we have X games available" - this would be false
- DO NOT make up or guess game schedules from training data
- TELL THE USER: "Our odds data feed is temporarily unavailable. Please try again later or contact support if this persists."
- If user asks about specific games, say: "I cannot verify current odds - our data feed is down."

This is a temporary issue. The data will refresh automatically when the API is available again.`
  }
  
  const lines: string[] = []
  lines.push(coverageSection)
  lines.push(`=== CURRENT BETTING ODDS ===`)
  lines.push(`Last Updated: ${formatTimestamp(oddsData.lastUpdated)}${oddsData.isStale ? ' (STALE - may be outdated)' : ''}`)
  lines.push('')
  
  // Group games by sport
  const gamesBySport = new Map<string, Game[]>()
  for (const game of oddsData.games) {
    const existing = gamesBySport.get(game.sportName) || []
    existing.push(game)
    gamesBySport.set(game.sportName, existing)
  }
  
  // Show summary of available sports first
  lines.push(`AVAILABLE SPORTS TODAY (${gamesBySport.size} sports with games):`)
  const sportCounts: string[] = []
  Array.from(gamesBySport.entries()).forEach(([sport, games]) => {
    sportCounts.push(`${sport}: ${games.length}`)
  })
  lines.push(sportCounts.join(' | '))
  lines.push(`Total: ${oddsData.games.length} games`)
  lines.push('')
  
  // Sort sports by tier (Tier 1 first)
  const sportOrder = ['NBA', 'NFL', 'NHL', 'NCAAB', 'NCAAF', 'MLB', 'English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'MLS', 'UEFA Champions League', 'UFC/MMA', 'Boxing']
  const sortedSports = Array.from(gamesBySport.entries()).sort((a, b) => {
    const aIndex = sportOrder.indexOf(a[0])
    const bIndex = sportOrder.indexOf(b[0])
    if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0])
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  })
  
  for (const [sport, games] of sortedSports) {
    lines.push(`--- ${sport} (${games.length} games) ---`)
    
    // Sort games by commence time (soonest first) and show up to 15 games per sport
    const sortedGames = [...games].sort((a, b) => 
      new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
    )
    
    for (const game of sortedGames.slice(0, 15)) {
      lines.push('')
      lines.push(`${game.awayTeam} @ ${game.homeTeam}`)
      lines.push(`Game Time: ${formatGameTime(game.commenceTime)}`)
      
      // Best spread
      const bestSpread = findBestSpread(game)
      if (bestSpread) {
        lines.push(`Spread: ${bestSpread.team} ${bestSpread.point > 0 ? '+' : ''}${bestSpread.point} (${formatOdds(bestSpread.price)}) - ${bestSpread.bookmaker}`)
      }
      
      // Best total
      const bestTotal = findBestTotal(game)
      if (bestTotal) {
        lines.push(`Total: ${bestTotal.type} ${bestTotal.point} (${formatOdds(bestTotal.price)}) - ${bestTotal.bookmaker}`)
      }
      
      // Moneylines
      const moneylines = formatMoneylines(game)
      if (moneylines) {
        lines.push(`Moneyline: ${moneylines}`)
      }
    }
    
    if (games.length > 15) {
      lines.push(`... and ${games.length - 15} more ${sport} games`)
    }
    
    lines.push('')
  }
  
  return lines.join('\n')
}

/**
 * Find the best spread odds for the home team
 */
function findBestSpread(game: Game): { team: string; point: number; price: number; bookmaker: string } | null {
  let best: { team: string; point: number; price: number; bookmaker: string } | null = null
  
  for (const spread of game.spreads) {
    for (const outcome of spread.outcomes) {
      if (outcome.name === game.homeTeam && outcome.point !== undefined) {
        if (!best || outcome.price > best.price) {
          best = {
            team: outcome.name,
            point: outcome.point,
            price: outcome.price,
            bookmaker: spread.bookmaker,
          }
        }
      }
    }
  }
  
  return best
}

/**
 * Find the best over total odds
 */
function findBestTotal(game: Game): { type: string; point: number; price: number; bookmaker: string } | null {
  let best: { type: string; point: number; price: number; bookmaker: string } | null = null
  
  for (const total of game.totals) {
    for (const outcome of total.outcomes) {
      if (outcome.name === 'Over' && outcome.point !== undefined) {
        if (!best || outcome.price > best.price) {
          best = {
            type: 'Over',
            point: outcome.point,
            price: outcome.price,
            bookmaker: total.bookmaker,
          }
        }
      }
    }
  }
  
  return best
}

/**
 * Format moneylines for display
 */
function formatMoneylines(game: Game): string | null {
  if (!game.moneylines.length) return null
  
  const ml = game.moneylines[0] // Use first bookmaker
  const home = ml.outcomes.find(o => o.name === game.homeTeam)
  const away = ml.outcomes.find(o => o.name === game.awayTeam)
  
  if (!home || !away) return null
  
  return `${game.awayTeam} ${formatOdds(away.price)} / ${game.homeTeam} ${formatOdds(home.price)} (${ml.bookmaker})`
}

/**
 * Format American odds with + or - prefix
 */
function formatOdds(price: number): string {
  return price > 0 ? `+${price}` : `${price}`
}

/**
 * Format timestamp for display
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

/**
 * Format game time for display
 */
function formatGameTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

// ============================================
// PLAYER PROPS INTEGRATION
// ============================================

export interface PlayerProp {
  playerName: string
  market: string // e.g., 'player_points', 'player_rebounds', 'player_assists'
  line: number
  overOdds: number
  underOdds: number
  bookmaker: string
}

export interface GamePlayerProps {
  gameId: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  sport: string
  props: PlayerProp[]
  playersWithProps: string[] // List of unique player names with props (indicates expected to play)
}

// Player prop markets available (used for reference)
// NBA: player_points, player_rebounds, player_assists, player_threes
// NFL: player_pass_tds, player_rush_yds, player_reception_yds
// NHL: player_points, player_assists

/**
 * Fetch player props for a specific game event
 * This tells us which players sportsbooks expect to play (if they have props, they're expected to play)
 */
export async function fetchGamePlayerProps(eventId: string, sportKey: string): Promise<GamePlayerProps | null> {
  const apiKey = process.env.ODDS_API_KEY
  
  if (!apiKey) {
    console.error('[fetchGamePlayerProps] ODDS_API_KEY not configured')
    return null
  }
  
  try {
    // Determine which prop markets to fetch based on sport
    let markets: string[]
    if (sportKey.includes('basketball')) {
      markets = ['player_points', 'player_rebounds', 'player_assists', 'player_threes']
    } else if (sportKey.includes('football')) {
      markets = ['player_pass_tds', 'player_rush_yds', 'player_reception_yds']
    } else if (sportKey.includes('hockey')) {
      markets = ['player_points', 'player_assists']
    } else {
      markets = ['player_points']
    }
    
    const marketsParam = markets.join(',')
    const url = `${ODDS_API_BASE}/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&oddsFormat=american`
    
    console.log(`[fetchGamePlayerProps] Fetching props for event ${eventId}`)
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!response.ok) {
      console.error(`[fetchGamePlayerProps] API error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    // Extract player props from the response
    const props: PlayerProp[] = []
    const playersSet = new Set<string>()
    
    if (data.bookmakers) {
      for (const bookmaker of data.bookmakers) {
        for (const market of bookmaker.markets || []) {
          // Group outcomes by player (Over/Under pairs)
          const playerOutcomes = new Map<string, { over?: { price: number; point: number }; under?: { price: number; point: number } }>()
          
          for (const outcome of market.outcomes || []) {
            const playerName = outcome.description
            if (!playerName) continue
            
            if (!playerOutcomes.has(playerName)) {
              playerOutcomes.set(playerName, {})
            }
            
            const playerData = playerOutcomes.get(playerName)!
            if (outcome.name === 'Over') {
              playerData.over = { price: outcome.price, point: outcome.point }
            } else if (outcome.name === 'Under') {
              playerData.under = { price: outcome.price, point: outcome.point }
            }
          }
          
          // Create props from paired outcomes
          Array.from(playerOutcomes.entries()).forEach(([playerName, outcomes]) => {
            if (outcomes.over && outcomes.under) {
              playersSet.add(playerName)
              props.push({
                playerName,
                market: market.key,
                line: outcomes.over.point,
                overOdds: outcomes.over.price,
                underOdds: outcomes.under.price,
                bookmaker: formatBookmakerName(bookmaker.key),
              })
            }
          })
        }
      }
    }
    
    return {
      gameId: eventId,
      homeTeam: data.home_team || '',
      awayTeam: data.away_team || '',
      commenceTime: data.commence_time || '',
      sport: sportKey,
      props,
      playersWithProps: Array.from(playersSet),
    }
  } catch (error) {
    console.error(`[fetchGamePlayerProps] Error:`, error)
    return null
  }
}

/**
 * Fetch player props for all games of a sport (for today's games)
 * Returns list of players expected to play based on sportsbook prop availability
 */
export async function fetchSportPlayerProps(sportKey: string): Promise<GamePlayerProps[]> {
  const apiKey = process.env.ODDS_API_KEY
  
  if (!apiKey) {
    console.error('[fetchSportPlayerProps] ODDS_API_KEY not configured')
    return []
  }
  
  try {
    // First get the list of events for this sport
    const eventsUrl = `${ODDS_API_BASE}/${sportKey}/events?apiKey=${apiKey}`
    const eventsResponse = await fetch(eventsUrl, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    
    if (!eventsResponse.ok) {
      console.error(`[fetchSportPlayerProps] Events API error: ${eventsResponse.status}`)
      return []
    }
    
    const events = await eventsResponse.json()
    
    // Filter to today's games only (within next 24 hours)
    const now = new Date()
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    
    const todaysEvents = events.filter((event: { commence_time: string }) => {
      const gameTime = new Date(event.commence_time)
      return gameTime >= now && gameTime <= tomorrow
    })
    
    console.log(`[fetchSportPlayerProps] Found ${todaysEvents.length} games today for ${sportKey}`)
    
    // Fetch props for each game (limit to first 5 to manage API usage)
    const propsPromises = todaysEvents.slice(0, 5).map((event: { id: string }) => 
      fetchGamePlayerProps(event.id, sportKey)
    )
    
    const results = await Promise.all(propsPromises)
    return results.filter((r): r is GamePlayerProps => r !== null)
  } catch (error) {
    console.error(`[fetchSportPlayerProps] Error:`, error)
    return []
  }
}

/**
 * Format player props for Claude's context
 * Includes confidence indicators based on prop availability
 */
export function formatPlayerPropsForContext(propsData: GamePlayerProps[]): string {
  if (!propsData.length) {
    return `\n=== PLAYER PROPS ===\nNo player props currently available. Props are typically posted by sportsbooks in the morning/early afternoon for evening games.\n`
  }
  
  const lines: string[] = []
  lines.push(`\n=== PLAYER PROPS (${propsData.length} games) ===`)
  lines.push(`IMPORTANT: If a player has props listed, sportsbooks expect them to play.`)
  lines.push(`This is HIGH CONFIDENCE data for "expected to play" status.`)
  lines.push(``)
  
  for (const game of propsData) {
    // Add sport label for clarity
    let sportLabel = 'GAME'
    if (game.sport.includes('basketball_nba')) sportLabel = 'NBA'
    else if (game.sport.includes('basketball_ncaab')) sportLabel = 'NCAAB'
    else if (game.sport.includes('football_nfl')) sportLabel = 'NFL'
    else if (game.sport.includes('football_ncaaf')) sportLabel = 'NCAAF'
    else if (game.sport.includes('hockey')) sportLabel = 'NHL'
    
    lines.push(`--- [${sportLabel}] ${game.awayTeam} @ ${game.homeTeam} ---`)
    lines.push(`Game Time: ${formatGameTime(game.commenceTime)}`)
    lines.push(`Players Expected to Play (${game.playersWithProps.length}): ${game.playersWithProps.join(', ')}`)
    lines.push(``)
    
    // Group props by player
    const propsByPlayer = new Map<string, PlayerProp[]>()
    for (const prop of game.props) {
      const existing = propsByPlayer.get(prop.playerName) || []
      existing.push(prop)
      propsByPlayer.set(prop.playerName, existing)
    }
    
    // Show top props for each player (limit to first 10 players)
    const playerEntries = Array.from(propsByPlayer.entries()).slice(0, 10)
    for (const [playerName, playerProps] of playerEntries) {
      const propStrings: string[] = []
      
      // Basketball props (NBA, NCAAB)
      const pointsProp = playerProps.find(p => p.market === 'player_points')
      const reboundsProp = playerProps.find(p => p.market === 'player_rebounds')
      const assistsProp = playerProps.find(p => p.market === 'player_assists')
      const threesProp = playerProps.find(p => p.market === 'player_threes')
      
      // Football props (NFL, NCAAF)
      const passYdsProp = playerProps.find(p => p.market === 'player_pass_yds')
      const rushYdsProp = playerProps.find(p => p.market === 'player_rush_yds')
      const passTdsProp = playerProps.find(p => p.market === 'player_pass_tds')
      const recYdsProp = playerProps.find(p => p.market === 'player_reception_yds')
      
      // Hockey props (NHL)
      const hockeyPointsProp = playerProps.find(p => p.market === 'player_points' && game.sport.includes('hockey'))
      const hockeyAssistsProp = playerProps.find(p => p.market === 'player_assists' && game.sport.includes('hockey'))
      
      // Format basketball props
      if (pointsProp && !game.sport.includes('hockey')) propStrings.push(`Pts O/U ${pointsProp.line} (${formatOdds(pointsProp.overOdds)}/${formatOdds(pointsProp.underOdds)})`)
      if (reboundsProp) propStrings.push(`Reb O/U ${reboundsProp.line}`)
      if (assistsProp && !game.sport.includes('hockey')) propStrings.push(`Ast O/U ${assistsProp.line}`)
      if (threesProp) propStrings.push(`3PT O/U ${threesProp.line}`)
      
      // Format football props
      if (passYdsProp) propStrings.push(`Pass Yds O/U ${passYdsProp.line} (${formatOdds(passYdsProp.overOdds)}/${formatOdds(passYdsProp.underOdds)})`)
      if (rushYdsProp) propStrings.push(`Rush Yds O/U ${rushYdsProp.line}`)
      if (passTdsProp) propStrings.push(`Pass TDs O/U ${passTdsProp.line}`)
      if (recYdsProp) propStrings.push(`Rec Yds O/U ${recYdsProp.line}`)
      
      // Format hockey props
      if (hockeyPointsProp) propStrings.push(`Pts O/U ${hockeyPointsProp.line} (${formatOdds(hockeyPointsProp.overOdds)}/${formatOdds(hockeyPointsProp.underOdds)})`)
      if (hockeyAssistsProp) propStrings.push(`Ast O/U ${hockeyAssistsProp.line}`)
      
      if (propStrings.length > 0) {
        lines.push(`  ${playerName}: ${propStrings.join(' | ')}`)
      }
    }
    lines.push(``)
  }
  
  lines.push(`\nPROP RECOMMENDATION RULES:`)
  lines.push(`- If player has props listed above → HIGH confidence they'll play, can recommend props`)
  lines.push(`- If player NOT listed but is a star (LeBron, Curry, etc.) → MEDIUM confidence, recommend with disclaimer`)
  lines.push(`- If player NOT listed and not a star → LOW confidence, suggest waiting for lineup confirmation`)
  lines.push(``)
  
  return lines.join('\n')
}
