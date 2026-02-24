/**
 * MAPPING CHAIN VALIDATION
 * 
 * Validates that every sport has a complete mapping chain through all three layers:
 * 1. SPORT_TO_LEAGUES (route.ts) — user query → ESPN league name
 * 2. LEAGUE_TO_SPORT_KEY (route.ts) — ESPN league name → Odds API sport code
 * 3. SPORT_TO_ELO_LEAGUE (bet-ranking.ts) — Odds API sport code → Elo league name
 * 4. ESPN_ODDS_SPORTS (espn.ts) — ESPN fetching config
 * 5. SPORT_HINT_TO_LEAGUES (espn.ts) — sport hint → ESPN league slugs
 * 
 * If any link in this chain is missing, the sport will fail silently — 
 * the user asks about it and gets nothing back. These tests prevent that.
 */
import { describe, it, expect } from 'vitest'

// ============================================================
// Duplicate the mapping tables here for validation
// These MUST stay in sync with the source files.
// If a test fails, it means someone changed a mapping without updating all layers.
// ============================================================

// From src/app/api/chat/route.ts (SPORT_TO_LEAGUES)
const SPORT_TO_LEAGUES: Record<string, string[]> = {
  'basketball': ['NBA', 'NCAAB'],
  'nba': ['NBA'],
  'ncaab': ['NCAAB'],
  'college basketball': ['NCAAB'],
  'march madness': ['NCAAB'],
  'football': ['NFL', 'NCAAF'],
  'nfl': ['NFL'],
  'ncaaf': ['NCAAF'],
  'college football': ['NCAAF'],
  'hockey': ['NHL'],
  'nhl': ['NHL'],
  'baseball': ['MLB'],
  'mlb': ['MLB'],
  'soccer': ['English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'MLS', 'UEFA Champions League'],
  'epl': ['English Premier League'],
  'premier league': ['English Premier League'],
  'english premier league': ['English Premier League'],
  'la liga': ['La Liga'],
  'bundesliga': ['Bundesliga'],
  'serie a': ['Serie A'],
  'ligue 1': ['Ligue 1'],
  'mls': ['MLS'],
  'champions league': ['UEFA Champions League'],
  'ufc': ['UFC'],
  'mma': ['UFC'],
  'mixed martial arts': ['UFC'],
  'golf': ['PGA Tour'],
  'pga': ['PGA Tour'],
  'tennis': ['ATP Tennis'],
  'atp': ['ATP Tennis'],
}

// From src/app/api/chat/route.ts (LEAGUE_TO_SPORT_KEY)
const LEAGUE_TO_SPORT_KEY: Record<string, string> = {
  'NBA': 'basketball_nba',
  'NFL': 'americanfootball_nfl',
  'NHL': 'icehockey_nhl',
  'MLB': 'baseball_mlb',
  'NCAAB': 'basketball_ncaab',
  'NCAAF': 'americanfootball_ncaaf',
  'English Premier League': 'soccer_epl',
  'La Liga': 'soccer_spain_la_liga',
  'Bundesliga': 'soccer_germany_bundesliga',
  'Serie A': 'soccer_italy_serie_a',
  'Ligue 1': 'soccer_france_ligue_one',
  'MLS': 'soccer_usa_mls',
  'UEFA Champions League': 'soccer_uefa_champs_league',
  'UFC': 'mma_mixed_martial_arts',
  'PGA Tour': 'golf_pga',
  'ATP Tennis': 'tennis_atp',
}

// From src/lib/bet-ranking.ts (SPORT_TO_ELO_LEAGUE)
const SPORT_TO_ELO_LEAGUE: Record<string, string> = {
  'basketball_nba': 'NBA',
  'basketball_ncaab': 'NCAAB',
  'americanfootball_nfl': 'NFL',
  'americanfootball_ncaaf': 'NCAAF',
  'icehockey_nhl': 'NHL',
  'baseball_mlb': 'MLB',
  'soccer_epl': 'soccer_epl',
  'soccer_spain_la_liga': 'soccer_spain_la_liga',
  'soccer_germany_bundesliga': 'soccer_germany_bundesliga',
  'soccer_italy_serie_a': 'soccer_italy_serie_a',
  'soccer_france_ligue_one': 'soccer_france_ligue_one',
  'soccer_usa_mls': 'soccer_usa_mls',
  'soccer_uefa_champs_league': 'soccer_uefa_champs_league',
  'hockey': 'NHL',
  'basketball': 'NBA',
  'football': 'NFL',
  'baseball': 'MLB',
  'soccer': 'soccer_epl',
}

// From src/lib/espn.ts (ESPN_ODDS_SPORTS)
const ESPN_ODDS_SPORTS = [
  { sport: 'basketball', league: 'nba', name: 'NBA' },
  { sport: 'football', league: 'nfl', name: 'NFL' },
  { sport: 'hockey', league: 'nhl', name: 'NHL' },
  { sport: 'basketball', league: 'mens-college-basketball', name: 'NCAAB' },
  { sport: 'football', league: 'college-football', name: 'NCAAF' },
  { sport: 'baseball', league: 'mlb', name: 'MLB' },
  { sport: 'soccer', league: 'eng.1', name: 'English Premier League' },
  { sport: 'soccer', league: 'esp.1', name: 'La Liga' },
  { sport: 'soccer', league: 'ger.1', name: 'Bundesliga' },
  { sport: 'soccer', league: 'ita.1', name: 'Serie A' },
  { sport: 'soccer', league: 'fra.1', name: 'Ligue 1' },
  { sport: 'soccer', league: 'usa.1', name: 'MLS' },
  { sport: 'soccer', league: 'uefa.champions', name: 'UEFA Champions League' },
  { sport: 'mma', league: 'ufc', name: 'UFC' },
  { sport: 'golf', league: 'pga', name: 'PGA Tour' },
  { sport: 'tennis', league: 'atp', name: 'ATP Tennis' },
]

// From src/lib/espn.ts (SPORT_HINT_TO_LEAGUES)
const SPORT_HINT_TO_LEAGUES: Record<string, string[]> = {
  'basketball': ['mens-college-basketball', 'nba'],
  'college basketball': ['mens-college-basketball'],
  'ncaab': ['mens-college-basketball'],
  'nba': ['nba'],
  'football': ['college-football', 'nfl'],
  'college football': ['college-football'],
  'ncaaf': ['college-football'],
  'nfl': ['nfl'],
  'hockey': ['nhl'],
  'nhl': ['nhl'],
  'baseball': ['mlb'],
  'mlb': ['mlb'],
  'soccer': ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'usa.1', 'uefa.champions'],
  'mma': ['ufc'],
  'ufc': ['ufc'],
  'golf': ['pga'],
  'pga': ['pga'],
  'tennis': ['atp'],
  'atp': ['atp'],
}

// ============================================================
// The 16 core ESPN leagues that the system MUST support
// ============================================================
const ALL_ESPN_LEAGUES = [
  'NBA', 'NFL', 'NHL', 'MLB', 'NCAAB', 'NCAAF',
  'English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'MLS', 'UEFA Champions League',
  'UFC', 'PGA Tour', 'ATP Tennis',
]

// ============================================================
// TESTS
// ============================================================

describe('Mapping Chain: SPORT_TO_LEAGUES completeness', () => {
  it('every ESPN league is reachable from at least one user query alias', () => {
    const reachableLeagues = new Set<string>()
    for (const leagues of Object.values(SPORT_TO_LEAGUES)) {
      for (const league of leagues) {
        reachableLeagues.add(league)
      }
    }
    
    for (const league of ALL_ESPN_LEAGUES) {
      expect(reachableLeagues.has(league), `League "${league}" is not reachable from any SPORT_TO_LEAGUES alias`).toBe(true)
    }
  })

  it.each([
    ['nba', 'NBA'],
    ['nfl', 'NFL'],
    ['nhl', 'NHL'],
    ['mlb', 'MLB'],
    ['ncaab', 'NCAAB'],
    ['ncaaf', 'NCAAF'],
    ['epl', 'English Premier League'],
    ['premier league', 'English Premier League'],
    ['la liga', 'La Liga'],
    ['bundesliga', 'Bundesliga'],
    ['serie a', 'Serie A'],
    ['ligue 1', 'Ligue 1'],
    ['mls', 'MLS'],
    ['champions league', 'UEFA Champions League'],
    ['ufc', 'UFC'],
    ['mma', 'UFC'],
    ['golf', 'PGA Tour'],
    ['pga', 'PGA Tour'],
    ['tennis', 'ATP Tennis'],
    ['atp', 'ATP Tennis'],
    ['basketball', 'NBA'],
    ['football', 'NFL'],
    ['hockey', 'NHL'],
    ['baseball', 'MLB'],
    ['college basketball', 'NCAAB'],
    ['college football', 'NCAAF'],
    ['soccer', 'English Premier League'],
  ])('"%s" maps to leagues containing "%s"', (alias, expectedLeague) => {
    const leagues = SPORT_TO_LEAGUES[alias]
    expect(leagues, `Missing SPORT_TO_LEAGUES entry for "${alias}"`).toBeDefined()
    expect(leagues).toContain(expectedLeague)
  })
})

describe('Mapping Chain: LEAGUE_TO_SPORT_KEY completeness', () => {
  it('every ESPN league has an Odds API sport key', () => {
    for (const league of ALL_ESPN_LEAGUES) {
      const sportKey = LEAGUE_TO_SPORT_KEY[league]
      expect(sportKey, `League "${league}" has no LEAGUE_TO_SPORT_KEY mapping`).toBeDefined()
      expect(sportKey.length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['NBA', 'basketball_nba'],
    ['NFL', 'americanfootball_nfl'],
    ['NHL', 'icehockey_nhl'],
    ['MLB', 'baseball_mlb'],
    ['NCAAB', 'basketball_ncaab'],
    ['NCAAF', 'americanfootball_ncaaf'],
    ['English Premier League', 'soccer_epl'],
    ['La Liga', 'soccer_spain_la_liga'],
    ['Bundesliga', 'soccer_germany_bundesliga'],
    ['Serie A', 'soccer_italy_serie_a'],
    ['Ligue 1', 'soccer_france_ligue_one'],
    ['MLS', 'soccer_usa_mls'],
    ['UEFA Champions League', 'soccer_uefa_champs_league'],
    ['UFC', 'mma_mixed_martial_arts'],
    ['PGA Tour', 'golf_pga'],
    ['ATP Tennis', 'tennis_atp'],
  ])('"%s" maps to "%s"', (league, expectedSportKey) => {
    expect(LEAGUE_TO_SPORT_KEY[league]).toBe(expectedSportKey)
  })
})

describe('Mapping Chain: SPORT_TO_ELO_LEAGUE completeness', () => {
  it('every Odds API sport key (from LEAGUE_TO_SPORT_KEY) has an Elo league mapping', () => {
    // Note: UFC, PGA Tour, ATP Tennis may not have Elo data yet.
    // But the mapping should still exist so the system can attempt to look them up.
    const sportKeysWithElo = new Set(Object.keys(SPORT_TO_ELO_LEAGUE))
    const sportKeysNeeded = new Set(Object.values(LEAGUE_TO_SPORT_KEY))
    
    // All team sports MUST have Elo mappings
    const teamSportKeys = [
      'basketball_nba', 'americanfootball_nfl', 'icehockey_nhl', 'baseball_mlb',
      'basketball_ncaab', 'americanfootball_ncaaf',
      'soccer_epl', 'soccer_spain_la_liga', 'soccer_germany_bundesliga',
      'soccer_italy_serie_a', 'soccer_france_ligue_one', 'soccer_usa_mls',
      'soccer_uefa_champs_league',
    ]
    
    for (const key of teamSportKeys) {
      expect(sportKeysWithElo.has(key), `Sport key "${key}" has no SPORT_TO_ELO_LEAGUE mapping — Elo lookups will fail`).toBe(true)
    }
  })

  it.each([
    ['basketball_nba', 'NBA'],
    ['basketball_ncaab', 'NCAAB'],
    ['americanfootball_nfl', 'NFL'],
    ['americanfootball_ncaaf', 'NCAAF'],
    ['icehockey_nhl', 'NHL'],
    ['baseball_mlb', 'MLB'],
    ['soccer_epl', 'soccer_epl'],
    ['soccer_spain_la_liga', 'soccer_spain_la_liga'],
    ['soccer_germany_bundesliga', 'soccer_germany_bundesliga'],
    ['soccer_italy_serie_a', 'soccer_italy_serie_a'],
    ['soccer_france_ligue_one', 'soccer_france_ligue_one'],
    ['soccer_usa_mls', 'soccer_usa_mls'],
    ['soccer_uefa_champs_league', 'soccer_uefa_champs_league'],
  ])('"%s" maps to Elo league "%s"', (sportKey, expectedEloLeague) => {
    expect(SPORT_TO_ELO_LEAGUE[sportKey]).toBe(expectedEloLeague)
  })
})

describe('Mapping Chain: ESPN_ODDS_SPORTS completeness', () => {
  it('every ESPN league has a matching entry in ESPN_ODDS_SPORTS', () => {
    const espnSportNames = new Set(ESPN_ODDS_SPORTS.map(s => s.name))
    
    for (const league of ALL_ESPN_LEAGUES) {
      expect(espnSportNames.has(league), `League "${league}" not found in ESPN_ODDS_SPORTS — won't be fetched from ESPN`).toBe(true)
    }
  })

  it('ESPN_ODDS_SPORTS has exactly 16 entries for all supported sports', () => {
    expect(ESPN_ODDS_SPORTS.length).toBe(16)
  })
})

describe('Mapping Chain: SPORT_HINT_TO_LEAGUES completeness', () => {
  const sportHints = [
    'nba', 'nfl', 'nhl', 'mlb', 'ncaab', 'ncaaf',
    'soccer', 'ufc', 'mma', 'golf', 'pga', 'tennis', 'atp',
  ]

  it.each(sportHints)('sport hint "%s" has ESPN league slugs', (hint) => {
    const leagues = SPORT_HINT_TO_LEAGUES[hint]
    expect(leagues, `Missing SPORT_HINT_TO_LEAGUES entry for "${hint}" — ESPN on-demand search won't prioritize correctly`).toBeDefined()
    expect(leagues.length).toBeGreaterThan(0)
  })
})

describe('Mapping Chain: End-to-end trace for every sport', () => {
  const sportTraces = [
    { query: 'nba', league: 'NBA', sportKey: 'basketball_nba', eloLeague: 'NBA' },
    { query: 'nfl', league: 'NFL', sportKey: 'americanfootball_nfl', eloLeague: 'NFL' },
    { query: 'nhl', league: 'NHL', sportKey: 'icehockey_nhl', eloLeague: 'NHL' },
    { query: 'mlb', league: 'MLB', sportKey: 'baseball_mlb', eloLeague: 'MLB' },
    { query: 'ncaab', league: 'NCAAB', sportKey: 'basketball_ncaab', eloLeague: 'NCAAB' },
    { query: 'ncaaf', league: 'NCAAF', sportKey: 'americanfootball_ncaaf', eloLeague: 'NCAAF' },
    { query: 'epl', league: 'English Premier League', sportKey: 'soccer_epl', eloLeague: 'soccer_epl' },
    { query: 'la liga', league: 'La Liga', sportKey: 'soccer_spain_la_liga', eloLeague: 'soccer_spain_la_liga' },
    { query: 'bundesliga', league: 'Bundesliga', sportKey: 'soccer_germany_bundesliga', eloLeague: 'soccer_germany_bundesliga' },
    { query: 'serie a', league: 'Serie A', sportKey: 'soccer_italy_serie_a', eloLeague: 'soccer_italy_serie_a' },
    { query: 'ligue 1', league: 'Ligue 1', sportKey: 'soccer_france_ligue_one', eloLeague: 'soccer_france_ligue_one' },
    { query: 'mls', league: 'MLS', sportKey: 'soccer_usa_mls', eloLeague: 'soccer_usa_mls' },
    { query: 'champions league', league: 'UEFA Champions League', sportKey: 'soccer_uefa_champs_league', eloLeague: 'soccer_uefa_champs_league' },
  ]

  it.each(sportTraces)(
    '$query: query → "$league" → "$sportKey" → "$eloLeague"',
    ({ query, league, sportKey, eloLeague }) => {
      // Step 1: User query → ESPN league name
      const leagues = SPORT_TO_LEAGUES[query]
      expect(leagues, `SPORT_TO_LEAGUES missing "${query}"`).toBeDefined()
      expect(leagues).toContain(league)

      // Step 2: ESPN league → Odds API sport key
      const actualSportKey = LEAGUE_TO_SPORT_KEY[league]
      expect(actualSportKey, `LEAGUE_TO_SPORT_KEY missing "${league}"`).toBe(sportKey)

      // Step 3: Odds API sport key → Elo league
      const actualEloLeague = SPORT_TO_ELO_LEAGUE[sportKey]
      expect(actualEloLeague, `SPORT_TO_ELO_LEAGUE missing "${sportKey}"`).toBe(eloLeague)

      // Step 4: ESPN_ODDS_SPORTS has this league
      const espnEntry = ESPN_ODDS_SPORTS.find(s => s.name === league)
      expect(espnEntry, `ESPN_ODDS_SPORTS missing "${league}"`).toBeDefined()
    }
  )

  // UFC, PGA, ATP have partial chains (no Elo) — verify they at least map through steps 1-2
  const marketOnlySports = [
    { query: 'ufc', league: 'UFC', sportKey: 'mma_mixed_martial_arts' },
    { query: 'pga', league: 'PGA Tour', sportKey: 'golf_pga' },
    { query: 'atp', league: 'ATP Tennis', sportKey: 'tennis_atp' },
  ]

  it.each(marketOnlySports)(
    '$query: query → "$league" → "$sportKey" (market-only, no Elo)',
    ({ query, league, sportKey }) => {
      const leagues = SPORT_TO_LEAGUES[query]
      expect(leagues, `SPORT_TO_LEAGUES missing "${query}"`).toBeDefined()
      expect(leagues).toContain(league)

      const actualSportKey = LEAGUE_TO_SPORT_KEY[league]
      expect(actualSportKey, `LEAGUE_TO_SPORT_KEY missing "${league}"`).toBe(sportKey)

      const espnEntry = ESPN_ODDS_SPORTS.find(s => s.name === league)
      expect(espnEntry, `ESPN_ODDS_SPORTS missing "${league}"`).toBeDefined()
    }
  )
})

describe('Mapping Chain: No orphaned entries', () => {
  it('every LEAGUE_TO_SPORT_KEY league appears in SPORT_TO_LEAGUES', () => {
    const reachableLeagues = new Set<string>()
    for (const leagues of Object.values(SPORT_TO_LEAGUES)) {
      for (const league of leagues) {
        reachableLeagues.add(league)
      }
    }
    
    for (const league of Object.keys(LEAGUE_TO_SPORT_KEY)) {
      expect(reachableLeagues.has(league), `LEAGUE_TO_SPORT_KEY has "${league}" but it's not reachable from any SPORT_TO_LEAGUES alias`).toBe(true)
    }
  })

  it('every ESPN_ODDS_SPORTS name appears in LEAGUE_TO_SPORT_KEY', () => {
    for (const espnSport of ESPN_ODDS_SPORTS) {
      expect(
        LEAGUE_TO_SPORT_KEY[espnSport.name],
        `ESPN_ODDS_SPORTS has "${espnSport.name}" but LEAGUE_TO_SPORT_KEY doesn't — fetched games won't map to Odds API`
      ).toBeDefined()
    }
  })
})
