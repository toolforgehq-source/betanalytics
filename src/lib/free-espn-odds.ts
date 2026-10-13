/**
 * FREE ESPN odds adapter.
 *
 * Uses the same ESPN pickcenter records as the existing scheduled picks engine.
 * Keeps only real quoted lines and prices: NEVER invent juice or a bookmaker.
 * CapturedAt is our fetch timestamp, NOT a guaranteed sportsbook quote time.
 */
import type { ESPNOdds, ESPNOddsData } from '@/lib/espn'
import type { Game, OddsData, BookmakerOdds } from '@/lib/odds'

const SPORT_KEYS: Record<string, string> = {
  NBA: 'basketball_nba',
  NFL: 'americanfootball_nfl',
  NHL: 'icehockey_nhl',
  MLB: 'baseball_mlb',
  NCAAB: 'basketball_ncaab',
  NCAAF: 'americanfootball_ncaaf',
  'English Premier League': 'soccer_epl',
  'La Liga': 'soccer_spain_la_liga',
  Bundesliga: 'soccer_germany_bundesliga',
  'Serie A': 'soccer_italy_serie_a',
  'Ligue 1': 'soccer_france_ligue_one',
  MLS: 'soccer_usa_mls',
  'UEFA Champions League': 'soccer_uefa_champs_league',
}
const isPrice = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && (p >= 100 || p <= -100)

export function espnOddsToGame(espn: ESPNOdds, at: number = Date.now()): Game | null {
  const sport = SPORT_KEYS[espn.league]
  const start = Date.parse(espn.commenceTime)
  if (!sport || !Number.isFinite(start) || start <= at ||
      espn.gameStatus !== 'pre' || espn.seasonType === 1 || !espn.gameId ||
      !espn.homeTeam?.trim() || !espn.awayTeam?.trim() ||
      !espn.provider?.trim()) return null

  const book = espn.provider.trim()
  const spreads: BookmakerOdds[] = []
  const totals: BookmakerOdds[] = []
  const moneylines: BookmakerOdds[] = []
  if (espn.spread !== null && Number.isFinite(espn.spread) &&
      espn.spreadOdds && isPrice(espn.spreadOdds.home) && isPrice(espn.spreadOdds.away)) {
    spreads.push({
      bookmaker: book, market: 'spreads',
      outcomes: [
        { name: espn.homeTeam, price: espn.spreadOdds.home, point: espn.spread },
        { name: espn.awayTeam, price: espn.spreadOdds.away, point: -espn.spread },
      ]
    })
  }
  if (espn.overUnder !== null && espn.overUnder > 0 && Number.isFinite(espn.overUnder) &&
      espn.overUnderOdds && isPrice(espn.overUnderOdds.over) && isPrice(espn.overUnderOdds.under)) {
    totals.push({
      bookmaker: book, market: 'totals',
      outcomes: [
        { name: 'Over', price: espn.overUnderOdds.over, point: espn.overUnder },
        { name: 'Under', price: espn.overUnderOdds.under, point: espn.overUnder }
      ]
    })
  }
  if (espn.moneyline && isPrice(espn.moneyline.home) && isPrice(espn.moneyline.away)) {
    const outcomes: BookmakerOdds['outcomes'] = [
      { name: espn.homeTeam, price: espn.moneyline.home },
      { name: espn.awayTeam, price: espn.moneyline.away },
    ]
    // Three-way soccer regulation market must include its draw price.
    if (sport.startsWith('soccer_')) {
      if (isPrice(espn.moneyline.draw)) {
        outcomes.push({ name: 'Draw', price: espn.moneyline.draw })
      }
    } else {
      moneylines.push({ bookmaker: book, market: 'h2h', outcomes })
    }
    if (sport.startsWith('soccer_') && outcomes.length === 3) {
      moneylines.push({ bookmaker: book, market: 'h2h', outcomes })
    }
  }
  if (!spreads.length && !totals.length && !moneylines.length) return null
  return { id: espn.gameId, sport, sportName: espn.league,
    homeTeam: espn.homeTeam, awayTeam: espn.awayTeam,
    commenceTime: espn.commenceTime, spreads, totals, moneylines }
}

export function convertESPNFeedToOdds(data: ESPNOddsData, now: number = Date.now()): OddsData {
  const games = (data.games || [])
    .map(x => espnOddsToGame(x, now))
    .filter((x): x is Game => x !== null)
  // If ESPN returns no usable prices, do not represent an empty feed as fresh.
  return {
    games,
    lastUpdated: data.lastUpdated,
    isStale: !!data.error || games.length === 0,
  }
}
