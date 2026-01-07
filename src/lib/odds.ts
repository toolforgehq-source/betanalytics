/**
 * The Odds API Integration with Redis Caching
 * 
 * Fetches real betting odds from The Odds API and caches them in Redis
 * to stay under the 500 requests/month free tier limit.
 * 
 * Fetch schedule: 3x daily (8am, 2pm, 8pm ET) = ~270 requests/month
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports'

// Sports to fetch in priority order
const SPORTS = [
  { key: 'basketball_nba', name: 'NBA' },
  { key: 'americanfootball_nfl', name: 'NFL' },
  { key: 'icehockey_nhl', name: 'NHL' },
  { key: 'basketball_ncaab', name: 'NCAAB' },
  { key: 'baseball_mlb', name: 'MLB' },
]

// Cache expiry: 4 hours (in seconds)
const CACHE_EXPIRY_SECONDS = 4 * 60 * 60

// Redis cache keys
const ODDS_CACHE_KEY = 'betanalytics:odds:data'

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
  if (!redis) return null
  
  try {
    const response = await fetch(`${redis.url}/get/${ODDS_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` }
    })
    
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data.result) return null
    
    return JSON.parse(data.result) as OddsData
  } catch (error) {
    console.error('Error getting cached odds:', error)
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
      headers: { 'Accept': 'application/json' }
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
  
  // Priority sportsbooks
  const priorityBooks = ['draftkings', 'fanduel', 'betmgm', 'pointsbetus', 'bovada']
  
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
  }
  return names[key] || key
}

/**
 * Fetch fresh odds from The Odds API for all sports
 */
export async function fetchAllOdds(): Promise<OddsData> {
  const allGames: Game[] = []
  
  // Fetch odds for each sport (only NBA, NFL, NHL for now)
  const sportsToFetch = SPORTS.slice(0, 3) // NBA, NFL, NHL
  
  for (const sport of sportsToFetch) {
    const games = await fetchSportOdds(sport.key, sport.name)
    allGames.push(...games)
  }
  
  const oddsData: OddsData = {
    games: allGames,
    lastUpdated: new Date().toISOString(),
    isStale: false,
  }
  
  // Cache the fresh data
  await setCachedOdds(oddsData)
  
  return oddsData
}

/**
 * Get current odds - returns cached data if fresh, fetches new if stale
 * This is the main function to call from the chat API
 */
export async function getCurrentOdds(): Promise<OddsData> {
  // First, try to get cached data
  const cached = await getCachedOdds()
  
  if (cached) {
    // Check if cache is still fresh (less than 4 hours old)
    const lastUpdated = new Date(cached.lastUpdated)
    const now = new Date()
    const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60)
    
    if (hoursSinceUpdate < 4) {
      // Cache is fresh, return it
      return cached
    }
    
    // Cache is stale, try to fetch new data
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
 * Format odds data for Claude's context
 * Creates a readable summary of today's games and odds
 */
export function formatOddsForContext(oddsData: OddsData): string {
  if (!oddsData.games.length) {
    return `No games currently available. Last checked: ${formatTimestamp(oddsData.lastUpdated)}`
  }
  
  const lines: string[] = []
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
  
  Array.from(gamesBySport.entries()).forEach(([sport, games]) => {
    lines.push(`--- ${sport} ---`)
    
    for (const game of games.slice(0, 10)) { // Limit to 10 games per sport
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
    
    lines.push('')
  })
  
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
