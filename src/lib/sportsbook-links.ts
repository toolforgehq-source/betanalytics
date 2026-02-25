/**
 * Sportsbook Deep Links
 * 
 * Generates deep links to major sportsbooks for specific bets.
 * Uses web URLs that open the sportsbook app or website to the relevant game/bet.
 * 
 * These links use standard web URLs — affiliate tracking can be added later
 * by appending query parameters or using affiliate redirect URLs.
 */

export interface SportsbookLink {
  name: string
  url: string
  color: string       // Tailwind color class for the button
  logo?: string       // Optional logo URL
}

export interface BetDeepLinks {
  team: string
  opponent: string
  betType: 'moneyline' | 'spread' | 'total' | 'prop'
  sport: string
  sportName: string
  line?: number
  links: SportsbookLink[]
}

// ============================================
// SPORTSBOOK URL GENERATORS
// ============================================

/**
 * Map sport keys to sportsbook-specific sport slugs
 */
const DRAFTKINGS_SPORTS: Record<string, string> = {
  'basketball_nba': 'basketball/nba',
  'basketball_ncaab': 'basketball/college-basketball',
  'americanfootball_nfl': 'football/nfl',
  'americanfootball_ncaaf': 'football/college-football',
  'icehockey_nhl': 'hockey/nhl',
  'baseball_mlb': 'baseball/mlb',
  'soccer_epl': 'soccer/england---premier-league',
  'soccer_spain_la_liga': 'soccer/spain---la-liga',
  'soccer_germany_bundesliga': 'soccer/germany---bundesliga',
  'soccer_italy_serie_a': 'soccer/italy---serie-a',
  'soccer_france_ligue_one': 'soccer/france---ligue-1',
  'soccer_usa_mls': 'soccer/mls',
  'soccer_uefa_champs_league': 'soccer/uefa-champions-league',
  'mma_mixed_martial_arts': 'mma',
}

const FANDUEL_SPORTS: Record<string, string> = {
  'basketball_nba': 'basketball/nba',
  'basketball_ncaab': 'basketball/college-basketball',
  'americanfootball_nfl': 'football/nfl',
  'americanfootball_ncaaf': 'football/college-football',
  'icehockey_nhl': 'hockey/nhl',
  'baseball_mlb': 'baseball/mlb',
  'soccer_epl': 'soccer/epl',
  'soccer_spain_la_liga': 'soccer/la-liga',
  'soccer_germany_bundesliga': 'soccer/bundesliga',
  'soccer_italy_serie_a': 'soccer/serie-a',
  'soccer_france_ligue_one': 'soccer/ligue-1',
  'soccer_usa_mls': 'soccer/mls',
  'soccer_uefa_champs_league': 'soccer/champions-league',
  'mma_mixed_martial_arts': 'mma/ufc',
}

const BETMGM_SPORTS: Record<string, string> = {
  'basketball_nba': 'basketball/nba',
  'basketball_ncaab': 'basketball/college-basketball',
  'americanfootball_nfl': 'football/nfl',
  'americanfootball_ncaaf': 'football/college-football',
  'icehockey_nhl': 'hockey/nhl',
  'baseball_mlb': 'baseball/mlb',
  'soccer_epl': 'soccer/english-premier-league',
  'soccer_spain_la_liga': 'soccer/spanish-la-liga',
  'soccer_germany_bundesliga': 'soccer/german-bundesliga',
  'soccer_italy_serie_a': 'soccer/italian-serie-a',
  'soccer_france_ligue_one': 'soccer/french-ligue-1',
  'soccer_usa_mls': 'soccer/mls',
  'soccer_uefa_champs_league': 'soccer/champions-league',
  'mma_mixed_martial_arts': 'mma/ufc',
}

const CAESARS_SPORTS: Record<string, string> = {
  'basketball_nba': 'basketball/nba',
  'basketball_ncaab': 'basketball/ncaa',
  'americanfootball_nfl': 'football/nfl',
  'americanfootball_ncaaf': 'football/ncaaf',
  'icehockey_nhl': 'hockey/nhl',
  'baseball_mlb': 'baseball/mlb',
  'soccer_epl': 'soccer/england-premier-league',
  'soccer_spain_la_liga': 'soccer/spain-la-liga',
  'soccer_usa_mls': 'soccer/usa-mls',
  'mma_mixed_martial_arts': 'mma/ufc',
}

/**
 * Generate DraftKings deep link
 */
function getDraftKingsLink(sport: string): string {
  const sportSlug = DRAFTKINGS_SPORTS[sport]
  if (sportSlug) {
    return `https://sportsbook.draftkings.com/leagues/${sportSlug}`
  }
  return 'https://sportsbook.draftkings.com'
}

/**
 * Generate FanDuel deep link
 */
function getFanDuelLink(sport: string): string {
  const sportSlug = FANDUEL_SPORTS[sport]
  if (sportSlug) {
    return `https://sportsbook.fanduel.com/navigation/${sportSlug}`
  }
  return 'https://sportsbook.fanduel.com'
}

/**
 * Generate BetMGM deep link
 */
function getBetMGMLink(sport: string): string {
  const sportSlug = BETMGM_SPORTS[sport]
  if (sportSlug) {
    return `https://sports.betmgm.com/en/sports/${sportSlug}`
  }
  return 'https://sports.betmgm.com'
}

/**
 * Generate Caesars deep link
 */
function getCaesarsLink(sport: string): string {
  const sportSlug = CAESARS_SPORTS[sport]
  if (sportSlug) {
    return `https://www.caesars.com/sportsbook-and-casino/${sportSlug}`
  }
  return 'https://www.caesars.com/sportsbook-and-casino'
}

/**
 * Generate deep links for all major sportsbooks for a given bet
 */
export function generateDeepLinks(
  team: string,
  opponent: string,
  betType: 'moneyline' | 'spread' | 'total' | 'prop',
  sport: string,
  sportName: string,
  line?: number,
  bestBook?: string
): BetDeepLinks {
  const links: SportsbookLink[] = [
    {
      name: 'DraftKings',
      url: getDraftKingsLink(sport),
      color: 'bg-[#53D337] hover:bg-[#47b830] text-black',
    },
    {
      name: 'FanDuel',
      url: getFanDuelLink(sport),
      color: 'bg-[#1493FF] hover:bg-[#1180e0] text-white',
    },
    {
      name: 'BetMGM',
      url: getBetMGMLink(sport),
      color: 'bg-[#BFA05C] hover:bg-[#a88d50] text-black',
    },
    {
      name: 'Caesars',
      url: getCaesarsLink(sport),
      color: 'bg-[#0A3D2C] hover:bg-[#0d4f39] text-white',
    },
  ]

  // If we know which book has best price, put it first
  if (bestBook) {
    const normalizedBest = bestBook.toLowerCase()
    const bestIndex = links.findIndex(l => l.name.toLowerCase().includes(normalizedBest) || normalizedBest.includes(l.name.toLowerCase()))
    if (bestIndex > 0) {
      const [best] = links.splice(bestIndex, 1)
      links.unshift(best)
    }
  }

  return {
    team,
    opponent,
    betType,
    sport,
    sportName,
    line,
    links,
  }
}

/**
 * Format sportsbook links as markdown for chat responses
 */
export function formatLinksForChat(deepLinks: BetDeepLinks): string {
  const lines: string[] = []
  lines.push('')
  lines.push('**Place This Bet:**')
  
  for (const link of deepLinks.links) {
    lines.push(`- [${link.name}](${link.url})`)
  }
  
  return lines.join('\n')
}

/**
 * Format a simple "best book" link for inline use
 */
export function formatBestBookLink(bestBook: string, sport: string): string {
  const normalizedBook = bestBook.toLowerCase()
  
  if (normalizedBook.includes('draftkings') || normalizedBook.includes('draft kings')) {
    return `[${bestBook}](${getDraftKingsLink(sport)})`
  }
  if (normalizedBook.includes('fanduel') || normalizedBook.includes('fan duel')) {
    return `[${bestBook}](${getFanDuelLink(sport)})`
  }
  if (normalizedBook.includes('betmgm') || normalizedBook.includes('mgm')) {
    return `[${bestBook}](${getBetMGMLink(sport)})`
  }
  if (normalizedBook.includes('caesars')) {
    return `[${bestBook}](${getCaesarsLink(sport)})`
  }
  if (normalizedBook.includes('pointsbet')) {
    return `[${bestBook}](https://pointsbet.com)`
  }
  if (normalizedBook.includes('betrivers')) {
    return `[${bestBook}](https://betrivers.com)`
  }
  
  return bestBook
}

/**
 * Get all sportsbook links for a given sport (for display on picks/odds pages)
 */
export function getAllBookLinks(sport: string): SportsbookLink[] {
  return [
    {
      name: 'DraftKings',
      url: getDraftKingsLink(sport),
      color: 'bg-[#53D337] hover:bg-[#47b830] text-black',
    },
    {
      name: 'FanDuel',
      url: getFanDuelLink(sport),
      color: 'bg-[#1493FF] hover:bg-[#1180e0] text-white',
    },
    {
      name: 'BetMGM',
      url: getBetMGMLink(sport),
      color: 'bg-[#BFA05C] hover:bg-[#a88d50] text-black',
    },
    {
      name: 'Caesars',
      url: getCaesarsLink(sport),
      color: 'bg-[#0A3D2C] hover:bg-[#0d4f39] text-white',
    },
  ]
}
