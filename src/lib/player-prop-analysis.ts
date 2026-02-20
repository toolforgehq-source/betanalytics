/**
 * Player Prop Analysis Engine
 * 
 * This is the "Elo equivalent" for player props - a deterministic analysis pipeline
 * that provides data-driven player prop recommendations.
 * 
 * Unlike the team Elo system (which this does NOT touch), this module:
 * 1. Detects player prop questions from user messages
 * 2. Parses player name, stat type, and line from queries
 * 3. Runs full analysis pipeline (model + matchup + pace + usage + correlations)
 * 4. Returns structured, deterministic analysis for the LLM to present
 * 
 * The team bets/Elo system remains completely separate and untouched.
 */

import { getPlayerPropProbability, getPlayerStatsData, calculateOverProbability } from './player-stats'
import type { EnhancedPropProbability, PlayerStats } from './player-stats'
import { calculateMatchupAdjustment, getMatchupHitRate, formatMatchupAdjustmentForDisplay } from './player-matchup'
import type { MatchupAdjustment } from './player-matchup'
import { getPaceAdjustment, getUsageAdjustment, getCorrelatedProps, storePropCLVRecord, analyzePropParlay, getPropLineMovement, formatPropLineMovement } from './prop-enhancements'
import type { PaceAdjustment, UsageAdjustment, PropCorrelation, PropLineMovement } from './prop-enhancements'
import { getCachedPlayerProps, fetchSportPlayerProps, setCachedPlayerProps } from './odds'
import type { GamePlayerProps, PlayerProp } from './odds'
import { americanToImpliedProbability } from './bet-ranking'
import { getCachedTeamScheduleData, normalizeTeamName as normalizeScheduleTeamName, isBackToBack } from './team-schedule'

// ============================================
// TYPES
// ============================================

export interface PlayerPropQuery {
  playerName: string
  statType: string | null
  line: number | null
  direction: 'over' | 'under' | null
  sport: string | null
  platform: string | null
}

export interface PropAnalysisResult {
  query: PlayerPropQuery
  player: {
    name: string
    sport: string
    position: string
    gamesPlayed: number
    reliabilityScore: number
  } | null

  seasonStats: {
    average: number
    stdDev: number
    recentAverage: number
    last5Average: number
  } | null

  modelProbability: EnhancedPropProbability | null

  matchupAnalysis: MatchupAdjustment | null
  matchupHitRate: { hitRate: number | null; sampleSize: number; notes: string[] } | null

  paceAdjustment: PaceAdjustment | null
  usageAdjustment: UsageAdjustment | null

  marketData: {
    line: number
    bestOverPrice: number
    bestUnderPrice: number
    bestOverBook: string
    bestUnderBook: string
    consensusOverProb: number
    consensusUnderProb: number
    booksCount: number
    allBookPrices: { book: string; overPrice: number; underPrice: number }[]
  } | null

  correlations: PropCorrelation[]

  lineMovement: PropLineMovement[]

  allPlayerProps: PlayerProp[]

  recommendation: {
    pick: 'Over' | 'Under' | null
    confidence: 'high' | 'medium' | 'low'
    modelProbability: number
    marketImpliedProbability: number
    edge: number
    projectedValue: number
    reasons: string[]
    warnings: string[]
  }

  calculatedAt: string
}

export interface BestPropsRequest {
  sport?: string
  count?: number
}

const SPORT_TO_API_KEYS: Record<string, string[]> = {
  'NBA': ['basketball_nba'],
  'NFL': ['americanfootball_nfl'],
  'NHL': ['icehockey_nhl'],
  'MLB': ['baseball_mlb'],
  'NCAAB': ['basketball_ncaab'],
  'NCAAF': ['americanfootball_ncaaf'],
}

const ALL_PROP_SPORT_KEYS = [
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl',
  'basketball_ncaab',
  'americanfootball_ncaaf',
]

async function fetchPropsOnDemand(sport?: string | null): Promise<GamePlayerProps[]> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    console.log('[fetchPropsOnDemand] No ODDS_API_KEY, skipping on-demand fetch')
    return []
  }

  const sportKeys = sport && SPORT_TO_API_KEYS[sport]
    ? SPORT_TO_API_KEYS[sport]
    : ALL_PROP_SPORT_KEYS

  console.log(`[fetchPropsOnDemand] Fetching props on-demand for: ${sportKeys.join(', ')}`)

  const results = await Promise.all(
    sportKeys.map(key =>
      fetchSportPlayerProps(key).catch((e) => {
        console.error(`[fetchPropsOnDemand] ${key} error:`, e.message)
        return [] as GamePlayerProps[]
      })
    )
  )

  const allProps = results.flat()

  if (allProps.length > 0) {
    await setCachedPlayerProps(allProps).catch(err =>
      console.error('[fetchPropsOnDemand] Cache write failed:', err)
    )
    console.log(`[fetchPropsOnDemand] Fetched and cached ${allProps.length} games`)
  } else {
    console.log('[fetchPropsOnDemand] No props returned from API')
  }

  return allProps
}

// ============================================
// STAT TYPE MAPPING
// ============================================

const STAT_ALIASES: Record<string, { statType: string; market: string; display: string }> = {
  'points': { statType: 'points', market: 'player_points', display: 'Points' },
  'pts': { statType: 'points', market: 'player_points', display: 'Points' },
  'point': { statType: 'points', market: 'player_points', display: 'Points' },
  'rebounds': { statType: 'rebounds', market: 'player_rebounds', display: 'Rebounds' },
  'rebs': { statType: 'rebounds', market: 'player_rebounds', display: 'Rebounds' },
  'reb': { statType: 'rebounds', market: 'player_rebounds', display: 'Rebounds' },
  'boards': { statType: 'rebounds', market: 'player_rebounds', display: 'Rebounds' },
  'assists': { statType: 'assists', market: 'player_assists', display: 'Assists' },
  'ast': { statType: 'assists', market: 'player_assists', display: 'Assists' },
  'dimes': { statType: 'assists', market: 'player_assists', display: 'Assists' },
  'threes': { statType: 'threePointersMade', market: 'player_threes', display: '3-Pointers' },
  'three pointers': { statType: 'threePointersMade', market: 'player_threes', display: '3-Pointers' },
  'three-pointers': { statType: 'threePointersMade', market: 'player_threes', display: '3-Pointers' },
  '3pt': { statType: 'threePointersMade', market: 'player_threes', display: '3-Pointers' },
  '3s': { statType: 'threePointersMade', market: 'player_threes', display: '3-Pointers' },
  '3 pointers': { statType: 'threePointersMade', market: 'player_threes', display: '3-Pointers' },
  'steals': { statType: 'steals', market: 'player_steals', display: 'Steals' },
  'stl': { statType: 'steals', market: 'player_steals', display: 'Steals' },
  'blocks': { statType: 'blocks', market: 'player_blocks', display: 'Blocks' },
  'blk': { statType: 'blocks', market: 'player_blocks', display: 'Blocks' },
  'passing yards': { statType: 'passingYards', market: 'player_pass_yds', display: 'Pass Yards' },
  'pass yards': { statType: 'passingYards', market: 'player_pass_yds', display: 'Pass Yards' },
  'pass yds': { statType: 'passingYards', market: 'player_pass_yds', display: 'Pass Yards' },
  'rushing yards': { statType: 'rushingYards', market: 'player_rush_yds', display: 'Rush Yards' },
  'rush yards': { statType: 'rushingYards', market: 'player_rush_yds', display: 'Rush Yards' },
  'rush yds': { statType: 'rushingYards', market: 'player_rush_yds', display: 'Rush Yards' },
  'receiving yards': { statType: 'receivingYards', market: 'player_reception_yds', display: 'Receiving Yards' },
  'rec yards': { statType: 'receivingYards', market: 'player_reception_yds', display: 'Receiving Yards' },
  'rec yds': { statType: 'receivingYards', market: 'player_reception_yds', display: 'Receiving Yards' },
  'receptions': { statType: 'receptions', market: 'player_receptions', display: 'Receptions' },
  'catches': { statType: 'receptions', market: 'player_receptions', display: 'Receptions' },
  'pass tds': { statType: 'passingTouchdowns', market: 'player_pass_tds', display: 'Pass TDs' },
  'passing touchdowns': { statType: 'passingTouchdowns', market: 'player_pass_tds', display: 'Pass TDs' },
  'touchdowns': { statType: 'passingTouchdowns', market: 'player_pass_tds', display: 'Pass TDs' },
  'tds': { statType: 'passingTouchdowns', market: 'player_pass_tds', display: 'Pass TDs' },
  'goals': { statType: 'goals', market: 'player_goals', display: 'Goals' },
  'shots': { statType: 'shots', market: 'player_shots_on_goal', display: 'Shots on Goal' },
  'shots on goal': { statType: 'shots', market: 'player_shots_on_goal', display: 'Shots on Goal' },
  'sog': { statType: 'shots', market: 'player_shots_on_goal', display: 'Shots on Goal' },
  'hits': { statType: 'hits', market: 'player_hits', display: 'Hits' },
  'home runs': { statType: 'homeRuns', market: 'player_home_runs', display: 'Home Runs' },
  'hrs': { statType: 'homeRuns', market: 'player_home_runs', display: 'Home Runs' },
  'rbis': { statType: 'rbis', market: 'player_rbis', display: 'RBIs' },
  'strikeouts': { statType: 'strikeouts', market: 'player_strikeouts', display: 'Strikeouts' },
  'ks': { statType: 'strikeouts', market: 'player_strikeouts', display: 'Strikeouts' },
  'pra': { statType: 'pra', market: 'player_pra', display: 'Pts+Reb+Ast' },
  'points rebounds assists': { statType: 'pra', market: 'player_pra', display: 'Pts+Reb+Ast' },
  'fantasy': { statType: 'fantasy', market: 'player_fantasy', display: 'Fantasy Points' },
  'fantasy points': { statType: 'fantasy', market: 'player_fantasy', display: 'Fantasy Points' },
}

const MARKET_TO_STAT_TYPE: Record<string, string> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threePointersMade',
  'player_steals': 'steals',
  'player_blocks': 'blocks',
  'player_pass_yds': 'passingYards',
  'player_rush_yds': 'rushingYards',
  'player_reception_yds': 'receivingYards',
  'player_receptions': 'receptions',
  'player_pass_tds': 'passingTouchdowns',
  'player_goals': 'goals',
  'player_shots_on_goal': 'shots',
  'player_hits': 'hits',
  'player_home_runs': 'homeRuns',
  'player_rbis': 'rbis',
  'player_strikeouts': 'strikeouts',
}

const SPORT_DETECTION: Record<string, string> = {
  'nba': 'NBA',
  'basketball': 'NBA',
  'nfl': 'NFL',
  'football': 'NFL',
  'nhl': 'NHL',
  'hockey': 'NHL',
  'mlb': 'MLB',
  'baseball': 'MLB',
  'ncaab': 'NCAAB',
  'college basketball': 'NCAAB',
  'ncaaf': 'NCAAF',
  'college football': 'NCAAF',
}

const PLATFORM_DETECTION: Record<string, string> = {
  'prizepicks': 'PrizePicks',
  'prize picks': 'PrizePicks',
  'underdog': 'Underdog Fantasy',
  'underdog fantasy': 'Underdog Fantasy',
  'sleeper': 'Sleeper',
  'sleeper picks': 'Sleeper',
  'draftkings': 'DraftKings',
  'dk': 'DraftKings',
  'fanduel': 'FanDuel',
  'fd': 'FanDuel',
}

// ============================================
// QUERY DETECTION
// ============================================

const PLAYER_PROP_PATTERNS = [
  /\b(?:over|under|o\/u)\s+[\d.]+\s+(?:points?|pts|rebounds?|rebs?|assists?|ast|threes?|3s|3pt|steals?|blocks?|passing\s*yards?|pass\s*yds?|rushing\s*yards?|rush\s*yds?|receiving\s*yards?|rec\s*yds?|receptions?|catches|tds?|touchdowns?|goals?|shots?|sog|hits?|home\s*runs?|hrs?|rbis?|strikeouts?|ks?|pra|fantasy)/i,
  /\b[\d.]+\s+(?:points?|pts|rebounds?|rebs?|assists?|ast|threes?|3s|3pt|steals?|blocks?|passing\s*yards?|pass\s*yds?|rushing\s*yards?|rush\s*yds?|receiving\s*yards?|rec\s*yds?|receptions?|catches|tds?|touchdowns?|goals?|shots?|sog|hits?|home\s*runs?|hrs?|rbis?|strikeouts?|ks?|pra|fantasy)/i,
  /\b(?:player\s+)?prop(?:s)?\b/i,
  /\b(?:points?|pts|rebounds?|rebs?|assists?|ast|threes?|3pt)\s+(?:over|under|prop|line)\b/i,
  /\bshould\s+(?:i|we)\s+(?:take|bet|play)\s+(?:the\s+)?(?:over|under)\b/i,
  /\b(?:prizepicks?|underdog|sleeper|draftkings|fanduel|dk|fd)\s+(?:picks?|lineup|entry|slip)\b/i,
  /\bbest\s+(?:player\s+)?props?\b/i,
  /\b(?:player|prop)\s+(?:bets?|picks?|plays?)\b/i,
  /\b(?:passing|rushing|receiving)\s+(?:yards?|yds?)\s+(?:over|under|prop|line)\b/i,
]

export function detectPlayerPropQuestion(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase()
  return PLAYER_PROP_PATTERNS.some(pattern => pattern.test(normalized))
}

export function parsePlayerPropQuery(userMessage: string): PlayerPropQuery {
  const normalized = userMessage.toLowerCase()

  let playerName = ''
  let statType: string | null = null
  let line: number | null = null
  let direction: 'over' | 'under' | null = null
  let sport: string | null = null
  let platform: string | null = null

  for (const [keyword, platformName] of Object.entries(PLATFORM_DETECTION)) {
    if (normalized.includes(keyword)) {
      platform = platformName
      break
    }
  }

  for (const [keyword, sportName] of Object.entries(SPORT_DETECTION)) {
    if (normalized.includes(keyword)) {
      sport = sportName
      break
    }
  }

  if (normalized.includes('over')) direction = 'over'
  else if (normalized.includes('under')) direction = 'under'

  const linePatterns = [
    /(?:over|under|o\/u)\s+([\d.]+)/i,
    /([\d.]+)\s+(?:points?|pts|rebounds?|rebs?|assists?|ast|threes?|3s|3pt|steals?|blocks?|passing\s*yards?|pass\s*yds?|rushing\s*yards?|rush\s*yds?|receiving\s*yards?|rec\s*yds?|receptions?|catches|tds?|touchdowns?|goals?|shots?|sog|hits?|home\s*runs?|hrs?|rbis?|strikeouts?|ks?|pra|fantasy)/i,
    /line\s*(?:of|at|is)?\s*([\d.]+)/i,
  ]

  for (const pattern of linePatterns) {
    const match = normalized.match(pattern)
    if (match && match[1]) {
      line = parseFloat(match[1])
      break
    }
  }

  for (const [alias, mapping] of Object.entries(STAT_ALIASES)) {
    if (normalized.includes(alias)) {
      statType = mapping.statType
      break
    }
  }

  const namePatterns = [
    /(?:should\s+(?:i|we)\s+(?:take|bet|play)\s+(?:the\s+)?(?:over|under)\s+(?:on|for)\s+)([a-z]+(?:\s+[a-z]+)+)/i,
    /(?:best|top)\s+([a-z]+(?:\s+[a-z]+)+?)\s+(?:prop|props|over|under)/i,
    /([a-z]+(?:\s+[a-z]+)+?)\s+(?:over|under|o\/u|prop|props|points?|pts|rebounds?|rebs?|assists?|ast|threes?|passing|rushing|receiving|goals?|shots?|hits?)/i,
    /(?:over|under)\s+[\d.]+\s+\w+\s+(?:for\s+)?([a-z]+(?:\s+[a-z]+)+)/i,
    /([a-z]+(?:\s+[a-z]+)+?)\s+[\d.]+/i,
  ]

  const skipWordsLower = ['best', 'player', 'over', 'under', 'should', 'the', 'what', 'whats', 'nba', 'nfl', 'nhl', 'mlb', 'prizepicks', 'underdog', 'draftkings', 'fanduel', 'sleeper', 'top', 'good', 'any', 'today', 'tonight', 'give', 'me', 'bet', 'bets', 'pick', 'picks', 'play', 'prop', 'props', 'is', 'are', 'do', 'you', 'think', 'i', 'we', 'my', 'a', 'an', 'for', 'on', 'in', 'of', 'to', 'and', 'or']

  for (const pattern of namePatterns) {
    const match = userMessage.match(pattern)
    if (match && match[1]) {
      const candidate = match[1].trim()
      const words = candidate.toLowerCase().split(/\s+/)
      const meaningfulWords = words.filter(w => !skipWordsLower.includes(w))
      if (meaningfulWords.length >= 2 || (meaningfulWords.length === 1 && meaningfulWords[0].length > 3)) {
        playerName = candidate
        break
      }
    }
  }

  return { playerName, statType, line, direction, sport, platform }
}

// ============================================
// CORE ANALYSIS ENGINE
// ============================================

export async function analyzePlayerProp(query: PlayerPropQuery): Promise<PropAnalysisResult> {
  const now = new Date().toISOString()
  const reasons: string[] = []
  const warnings: string[] = []

  let statsData: Awaited<ReturnType<typeof getPlayerStatsData>> = null
  try {
    statsData = await getPlayerStatsData()
  } catch (err) {
    console.error('[player-prop-analysis] Failed to fetch player stats data:', err)
    warnings.push('Player stats data temporarily unavailable')
  }

  let playerData: PlayerStats | null = null
  let detectedSport = query.sport || null

  if (statsData && query.playerName) {
    const normalizedQuery = query.playerName.toLowerCase()
    const playerKey = Object.keys(statsData.players).find(key => {
      const p = statsData.players[key]
      return p.playerName.toLowerCase().includes(normalizedQuery) ||
             normalizedQuery.includes(p.playerName.toLowerCase())
    })

    if (playerKey) {
      playerData = statsData.players[playerKey]
      detectedSport = detectedSport || playerData.sport
    }
  }

  let propsData: GamePlayerProps[] | null = null
  try {
    propsData = await getCachedPlayerProps()
  } catch (err) {
    console.error('[player-prop-analysis] Failed to fetch cached player props:', err)
    warnings.push('Props market data temporarily unavailable')
  }

  if (!propsData || propsData.length === 0) {
    console.log('[player-prop-analysis] Cache empty, attempting on-demand fetch')
    try {
      propsData = await fetchPropsOnDemand(detectedSport)
    } catch (err) {
      console.error('[player-prop-analysis] On-demand fetch failed:', err)
    }
  }

  let marketData: PropAnalysisResult['marketData'] = null
  let matchingGame: GamePlayerProps | null = null
  let allPlayerProps: PlayerProp[] = []
  let playerFoundInCache = false

  if (propsData && query.playerName) {
    const normalizedName = query.playerName.toLowerCase()

    for (const game of propsData) {
      const playerProps = game.props.filter(p =>
        p.playerName.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(p.playerName.toLowerCase())
      )

      if (playerProps.length > 0) {
        playerFoundInCache = true
        matchingGame = game
        allPlayerProps = playerProps
        const targetMarket = query.statType ? findMarketForStat(query.statType) : null
        const relevantProps = targetMarket
          ? playerProps.filter(p => p.market === targetMarket)
          : playerProps

        if (relevantProps.length > 0) {
          const targetLine = query.line || relevantProps[0].line
          const propsForLine = relevantProps.filter(p => p.line === targetLine)
          const propsToUse = propsForLine.length > 0 ? propsForLine : [relevantProps[0]]

          const overPrices = propsToUse.map(p => p.overOdds)
          const underPrices = propsToUse.map(p => p.underOdds)

          const overImpliedProbs = overPrices.map(p => americanToImpliedProbability(p))
          const underImpliedProbs = underPrices.map(p => americanToImpliedProbability(p))
          const avgOverImplied = overImpliedProbs.reduce((a, b) => a + b, 0) / overImpliedProbs.length
          const avgUnderImplied = underImpliedProbs.reduce((a, b) => a + b, 0) / underImpliedProbs.length
          const totalImplied = avgOverImplied + avgUnderImplied

          const bestOverIdx = overPrices.indexOf(Math.max(...overPrices))
          const bestUnderIdx = underPrices.indexOf(Math.max(...underPrices))

          marketData = {
            line: propsToUse[0].line,
            bestOverPrice: Math.max(...overPrices),
            bestUnderPrice: Math.max(...underPrices),
            bestOverBook: propsToUse[bestOverIdx]?.bookmaker || 'Unknown',
            bestUnderBook: propsToUse[bestUnderIdx]?.bookmaker || 'Unknown',
            consensusOverProb: Math.round((avgOverImplied / totalImplied) * 1000) / 10,
            consensusUnderProb: Math.round((avgUnderImplied / totalImplied) * 1000) / 10,
            booksCount: propsToUse.length,
            allBookPrices: propsToUse.map(p => ({
              book: p.bookmaker,
              overPrice: p.overOdds,
              underPrice: p.underOdds,
            })),
          }

          if (!query.line) query.line = propsToUse[0].line
          if (!query.statType) {
            const statMapping = MARKET_TO_STAT_TYPE[propsToUse[0].market]
            if (statMapping) query.statType = statMapping
          }
        }
        break
      }
    }
  }

  if (!playerFoundInCache && query.playerName && propsData && propsData.length > 0) {
    console.log(`[player-prop-analysis] Player "${query.playerName}" not in cache, fetching fresh props`)
    try {
      const freshProps = await fetchPropsOnDemand(detectedSport)
      if (freshProps.length > 0) {
        const normalizedName = query.playerName.toLowerCase()
        for (const game of freshProps) {
          const playerProps = game.props.filter(p =>
            p.playerName.toLowerCase().includes(normalizedName) ||
            normalizedName.includes(p.playerName.toLowerCase())
          )
          if (playerProps.length > 0) {
            matchingGame = game
            allPlayerProps = playerProps
            const targetMarket = query.statType ? findMarketForStat(query.statType) : null
            const relevantProps = targetMarket
              ? playerProps.filter(p => p.market === targetMarket)
              : playerProps

            if (relevantProps.length > 0) {
              const targetLine = query.line || relevantProps[0].line
              const propsForLine = relevantProps.filter(p => p.line === targetLine)
              const propsToUse = propsForLine.length > 0 ? propsForLine : [relevantProps[0]]

              const overPrices = propsToUse.map(p => p.overOdds)
              const underPrices = propsToUse.map(p => p.underOdds)

              const overImpliedProbs = overPrices.map(p => americanToImpliedProbability(p))
              const underImpliedProbs = underPrices.map(p => americanToImpliedProbability(p))
              const avgOverImplied = overImpliedProbs.reduce((a, b) => a + b, 0) / overImpliedProbs.length
              const avgUnderImplied = underImpliedProbs.reduce((a, b) => a + b, 0) / underImpliedProbs.length
              const totalImplied = avgOverImplied + avgUnderImplied

              const bestOverIdx = overPrices.indexOf(Math.max(...overPrices))
              const bestUnderIdx = underPrices.indexOf(Math.max(...underPrices))

              marketData = {
                line: propsToUse[0].line,
                bestOverPrice: Math.max(...overPrices),
                bestUnderPrice: Math.max(...underPrices),
                bestOverBook: propsToUse[bestOverIdx]?.bookmaker || 'Unknown',
                bestUnderBook: propsToUse[bestUnderIdx]?.bookmaker || 'Unknown',
                consensusOverProb: Math.round((avgOverImplied / totalImplied) * 1000) / 10,
                consensusUnderProb: Math.round((avgUnderImplied / totalImplied) * 1000) / 10,
                booksCount: propsToUse.length,
                allBookPrices: propsToUse.map(p => ({
                  book: p.bookmaker,
                  overPrice: p.overOdds,
                  underPrice: p.underOdds,
                })),
              }

              if (!query.line) query.line = propsToUse[0].line
              if (!query.statType) {
                const statMapping = MARKET_TO_STAT_TYPE[propsToUse[0].market]
                if (statMapping) query.statType = statMapping
              }
            }
            break
          }
        }
      }
    } catch (err) {
      console.error('[player-prop-analysis] On-demand player fetch failed:', err)
    }
  }

  let modelResult: EnhancedPropProbability | null = null
  if (playerData && query.statType && query.line !== null) {
    try {
      let opponentTeamId: string | undefined
      let isHomeGame: boolean | undefined
      let gameContext: { homeTeam?: string; awayTeam?: string; playerTeam?: string } | undefined

      if (matchingGame) {
        const playerTeam = playerData.teamId
        isHomeGame = matchingGame.homeTeam.toLowerCase().includes(playerTeam?.toLowerCase() || '')
        opponentTeamId = isHomeGame ? matchingGame.awayTeam : matchingGame.homeTeam

        gameContext = {
          homeTeam: matchingGame.homeTeam,
          awayTeam: matchingGame.awayTeam,
          playerTeam: isHomeGame ? matchingGame.homeTeam : matchingGame.awayTeam,
        }
      }

      let backToBack: boolean | undefined
      if (gameContext?.playerTeam) {
        try {
          const scheduleData = await getCachedTeamScheduleData()
          if (scheduleData) {
            const teamKey = normalizeScheduleTeamName(gameContext.playerTeam)
            const lastGameDate = scheduleData.teams[teamKey]?.lastGameDate || null
            backToBack = isBackToBack(lastGameDate)
          }
        } catch (err) {
          console.error('[player-prop-analysis] Failed to check back-to-back status:', err)
        }
      }

      modelResult = await getPlayerPropProbability(
        query.playerName,
        detectedSport || 'NBA',
        query.statType,
        query.line,
        opponentTeamId,
        isHomeGame,
        backToBack,
        gameContext
      )
    } catch (err) {
      console.error('[player-prop-analysis] Model probability calculation failed:', err)
      warnings.push('Statistical model unavailable - using market data')
    }
  }

  let matchupAnalysis: MatchupAdjustment | null = null
  let matchupHitRate: { hitRate: number | null; sampleSize: number; notes: string[] } | null = null

  if (playerData && matchingGame && query.statType) {
    try {
      const opponent = matchingGame.homeTeam.toLowerCase().includes(playerData.teamId?.toLowerCase() || '')
        ? matchingGame.awayTeam
        : matchingGame.homeTeam

      const matchupStat = mapStatToMatchupStat(query.statType)
      if (matchupStat) {
        const avg = (playerData.averages as Record<string, number>)[query.statType] || 0
        matchupAnalysis = await calculateMatchupAdjustment(
          playerData.playerId,
          playerData.playerName,
          opponent,
          detectedSport || 'NBA',
          matchupStat,
          avg
        )

        if (query.line !== null) {
          matchupHitRate = await getMatchupHitRate(
            playerData.playerId,
            opponent,
            matchupStat,
            query.line
          )
        }
      }
    } catch (err) {
      console.error('[player-prop-analysis] Matchup analysis failed:', err)
    }
  }

  let paceAdj: PaceAdjustment | null = null
  let usageAdj: UsageAdjustment | null = null

  if (matchingGame) {
    try {
      paceAdj = await getPaceAdjustment(
        matchingGame.homeTeam,
        matchingGame.awayTeam,
        detectedSport || 'NBA'
      )
    } catch (err) {
      console.error('[player-prop-analysis] Pace adjustment failed:', err)
    }

    if (playerData) {
      try {
        const playerTeam = matchingGame.homeTeam.toLowerCase().includes(playerData.teamId?.toLowerCase() || '')
          ? matchingGame.homeTeam
          : matchingGame.awayTeam

        usageAdj = await getUsageAdjustment(
          detectedSport || 'NBA',
          playerTeam,
          playerData.position
        )
      } catch (err) {
        console.error('[player-prop-analysis] Usage adjustment failed:', err)
      }
    }
  }

  let lineMovement: PropLineMovement[] = []
  if (query.playerName) {
    try {
      const targetMarket = query.statType ? findMarketForStat(query.statType) : undefined
      lineMovement = await getPropLineMovement(query.playerName, targetMarket || undefined)
    } catch (err) {
      console.error('[player-prop-analysis] Line movement lookup failed:', err)
    }
  }

  const correlations: PropCorrelation[] = []
  if (query.playerName && query.statType && query.direction && detectedSport) {
    const commonStats = ['points', 'rebounds', 'assists', 'threePointersMade', 'passingYards', 'rushingYards', 'receivingYards']
    for (const otherStat of commonStats) {
      if (otherStat === query.statType) continue
      const corr = getCorrelatedProps(
        detectedSport,
        query.playerName,
        query.statType,
        query.direction,
        query.playerName,
        otherStat,
        true
      )
      if (corr) correlations.push(corr)
    }
  }

  let seasonStats: PropAnalysisResult['seasonStats'] = null
  if (playerData && query.statType) {
    const avg = (playerData.averages as Record<string, number>)[query.statType]
    const stdDev = (playerData.stdDevs as Record<string, number>)[query.statType]

    if (avg !== undefined) {
      const recentLogs = playerData.gameLogs.slice(0, 5)
      const last5Values = recentLogs
        .map(log => (log as unknown as Record<string, number>)[query.statType!])
        .filter((v): v is number => v !== undefined && v !== null)

      const last5Avg = last5Values.length > 0
        ? last5Values.reduce((a, b) => a + b, 0) / last5Values.length
        : avg

      seasonStats = {
        average: Math.round(avg * 10) / 10,
        stdDev: Math.round((stdDev || avg * 0.3) * 10) / 10,
        recentAverage: Math.round(avg * 10) / 10,
        last5Average: Math.round(last5Avg * 10) / 10,
      }
    }
  }

  const recommendation = buildRecommendation(
    query, modelResult, marketData, matchupAnalysis, matchupHitRate,
    paceAdj, usageAdj, seasonStats, reasons, warnings
  )

  if (recommendation.pick && query.line !== null && query.statType && marketData) {
    const pickOdds = recommendation.pick === 'Over' ? marketData.bestOverPrice : marketData.bestUnderPrice
    storePropCLVRecord({
      playerName: query.playerName,
      sport: detectedSport || 'NBA',
      statType: query.statType,
      line: query.line,
      direction: recommendation.pick === 'Over' ? 'over' : 'under',
      pickOdds,
      pickProbability: recommendation.modelProbability,
      pickTimestamp: now,
      gameTimestamp: now,
    }).catch(err => console.error('[player-prop-analysis] CLV store failed:', err))
  }

  return {
    query,
    player: playerData ? {
      name: playerData.playerName,
      sport: playerData.sport,
      position: playerData.position,
      gamesPlayed: playerData.gamesPlayed,
      reliabilityScore: playerData.reliabilityScore || 50,
    } : null,
    seasonStats,
    modelProbability: modelResult,
    matchupAnalysis,
    matchupHitRate,
    paceAdjustment: paceAdj,
    usageAdjustment: usageAdj,
    marketData,
    correlations,
    lineMovement,
    recommendation,
    calculatedAt: now,
    allPlayerProps,
  }
}

// ============================================
// ANALYZE ALL PROPS FOR A SPECIFIC PLAYER
// When user asks about a player without specifying a stat, run ALL their
// available props through the full pipeline (model + matchup + pace + usage)
// and rank them by edge. This is the "best in the world" approach.
// ============================================

export async function analyzeAllPlayerProps(playerName: string, sport?: string): Promise<PropAnalysisResult[]> {
  let propsData: GamePlayerProps[] | null = null
  try {
    propsData = await getCachedPlayerProps()
  } catch (err) {
    console.error('[player-prop-analysis] Failed to fetch props for all-prop analysis:', err)
  }

  if (!propsData || propsData.length === 0) {
    console.log('[analyzeAllPlayerProps] Cache empty, attempting on-demand fetch')
    try {
      propsData = await fetchPropsOnDemand(sport || null)
    } catch (err) {
      console.error('[analyzeAllPlayerProps] On-demand fetch failed:', err)
      return []
    }
    if (!propsData || propsData.length === 0) return []
  }

  const normalizedName = playerName.toLowerCase()
  const uniqueMarkets = new Map<string, { prop: PlayerProp; game: GamePlayerProps }>()

  for (const game of propsData) {
    const playerProps = game.props.filter(p =>
      p.playerName.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(p.playerName.toLowerCase())
    )

    for (const prop of playerProps) {
      const key = `${prop.market}|${prop.line}`
      if (!uniqueMarkets.has(key)) {
        uniqueMarkets.set(key, { prop, game })
      }
    }
  }

  if (uniqueMarkets.size === 0) {
    console.log(`[analyzeAllPlayerProps] Player "${playerName}" not in cache, fetching fresh props`)
    try {
      const freshProps = await fetchPropsOnDemand(sport || null)
      for (const game of freshProps) {
        const freshPlayerProps = game.props.filter(p =>
          p.playerName.toLowerCase().includes(normalizedName) ||
          normalizedName.includes(p.playerName.toLowerCase())
        )
        for (const prop of freshPlayerProps) {
          const key = `${prop.market}|${prop.line}`
          if (!uniqueMarkets.has(key)) {
            uniqueMarkets.set(key, { prop, game })
          }
        }
      }
    } catch (err) {
      console.error('[analyzeAllPlayerProps] On-demand player fetch failed:', err)
    }
    if (uniqueMarkets.size === 0) return []
  }

  const analyses: PropAnalysisResult[] = []

  for (const [, { prop }] of Array.from(uniqueMarkets.entries())) {
    const statType = MARKET_TO_STAT_TYPE[prop.market]
    if (!statType) continue

    try {
      const analysis = await analyzePlayerProp({
        playerName: prop.playerName,
        statType,
        line: prop.line,
        direction: null,
        sport: sport || null,
        platform: null,
      })
      analyses.push(analysis)
    } catch (err) {
      console.error(`[player-prop-analysis] Failed to analyze ${prop.playerName} ${prop.market} ${prop.line}:`, err)
    }
  }

  analyses.sort((a, b) => {
    const edgeA = a.recommendation.edge
    const edgeB = b.recommendation.edge
    const warnA = a.recommendation.warnings.some(w => w.includes('average') && w.includes('above the line')) ? -0.05 : 0
    const warnB = b.recommendation.warnings.some(w => w.includes('average') && w.includes('above the line')) ? -0.05 : 0
    return (edgeB + warnB) - (edgeA + warnA)
  })

  return analyses
}

// ============================================
// BEST PROPS ANALYSIS (for "best prop" / "best player prop" queries)
// ============================================

export async function analyzeBestProps(request: BestPropsRequest = {}): Promise<PropAnalysisResult[]> {
  const count = request.count || 3
  let propsData = await getCachedPlayerProps()

  if (!propsData || propsData.length === 0) {
    console.log('[analyzeBestProps] Cache empty, attempting on-demand fetch')
    try {
      propsData = await fetchPropsOnDemand(request.sport || null)
    } catch (err) {
      console.error('[analyzeBestProps] On-demand fetch failed:', err)
      return []
    }
    if (!propsData || propsData.length === 0) return []
  }

  const statsData = await getPlayerStatsData()
  const hasModelData = !!statsData
  console.log(`[analyzeBestProps] Props data: ${propsData.length} games, model data: ${hasModelData}`)

  type ScoredProp = {
    prop: PlayerProp
    game: GamePlayerProps
    score: number
    modelProb: number
    edge: number
    direction: 'over' | 'under'
  }
  const results: ScoredProp[] = []
  const marketFallbacks: ScoredProp[] = []

  for (const game of propsData) {
    if (request.sport) {
      const sportMap: Record<string, string[]> = {
        'NBA': ['basketball_nba'],
        'NFL': ['americanfootball_nfl'],
        'NHL': ['icehockey_nhl'],
        'MLB': ['baseball_mlb'],
        'NCAAB': ['basketball_ncaab'],
        'NCAAF': ['americanfootball_ncaaf'],
      }
      const validKeys = sportMap[request.sport] || []
      if (validKeys.length > 0 && !validKeys.some(k => game.sport.includes(k))) continue
    }

    const propGroups = new Map<string, PlayerProp[]>()
    for (const prop of game.props) {
      const key = `${prop.playerName}|${prop.market}|${prop.line}`
      const existing = propGroups.get(key) || []
      existing.push(prop)
      propGroups.set(key, existing)
    }

    for (const [, props] of Array.from(propGroups.entries())) {
      if (props.length < 1) continue

      const prop = props[0]
      const statType = MARKET_TO_STAT_TYPE[prop.market]
      if (!statType) continue

      const sportNameMap: Record<string, string> = {
        'basketball_nba': 'NBA', 'basketball_ncaab': 'NCAAB',
        'americanfootball_nfl': 'NFL', 'americanfootball_ncaaf': 'NCAAF',
        'icehockey_nhl': 'NHL', 'baseball_mlb': 'MLB',
      }
      const sportName = sportNameMap[game.sport] || game.sport

      let modelResult: EnhancedPropProbability | null = null
      if (statsData) {
        modelResult = await getPlayerPropProbability(
          prop.playerName,
          sportName,
          statType,
          prop.line,
          undefined,
          undefined,
          undefined,
          { homeTeam: game.homeTeam, awayTeam: game.awayTeam }
        )
      }

      const overPrices = props.map(p => p.overOdds)
      const underPrices = props.map(p => p.underOdds)
      const avgOverImplied = overPrices.map(p => americanToImpliedProbability(p)).reduce((a, b) => a + b, 0) / overPrices.length
      const avgUnderImplied = underPrices.map(p => americanToImpliedProbability(p)).reduce((a, b) => a + b, 0) / underPrices.length
      const total = avgOverImplied + avgUnderImplied
      const overNoVig = avgOverImplied / total
      const underNoVig = avgUnderImplied / total

      const bestOverPrice = Math.max(...overPrices)
      const bestUnderPrice = Math.max(...underPrices)
      const overImplied = americanToImpliedProbability(bestOverPrice)
      const underImplied = americanToImpliedProbability(bestUnderPrice)

      const sides = [
        { dir: 'over' as const, prob: overNoVig, bestPrice: bestOverPrice, implied: overImplied },
        { dir: 'under' as const, prob: underNoVig, bestPrice: bestUnderPrice, implied: underImplied },
      ]

      const playerAvg = modelResult ? modelResult.average : 0

      for (const side of sides) {
        if (playerAvg > 0) {
          if (side.dir === 'under' && playerAvg > prop.line * 1.05) continue
          if (side.dir === 'over' && playerAvg < prop.line * 0.90) continue
        }

        let finalProb = side.prob
        let modelProb = 0

        if (modelResult && modelResult.gamesPlayed >= 5) {
          const rawModel = side.dir === 'over' ? modelResult.probability : (1 - modelResult.probability)
          finalProb = rawModel * MODEL_WEIGHT_VS_MARKET + side.prob * (1 - MODEL_WEIGHT_VS_MARKET)
          modelProb = rawModel
        }

        let edge = finalProb - side.implied
        const confScale = modelResult ? (CONFIDENCE_EDGE_SCALE[modelResult.confidence] || 0.4) : 0.4
        edge = Math.max(-MAX_REALISTIC_EDGE, Math.min(MAX_REALISTIC_EDGE, edge * confScale))

        const candidate: ScoredProp = {
          prop: { ...prop, overOdds: side.dir === 'over' ? side.bestPrice : prop.overOdds, underOdds: side.dir === 'under' ? side.bestPrice : prop.underOdds },
          game,
          score: finalProb * 60 + Math.max(edge, 0) * 40,
          modelProb: modelProb > 0 ? modelProb : finalProb,
          edge,
          direction: side.dir,
        }

        if (edge >= 0.005 && finalProb >= 0.48) {
          let score = finalProb * 60 + edge * 40
          if (modelResult) {
            if (modelResult.reliabilityScore && modelResult.reliabilityScore >= 70) score *= 1.15
            if (modelResult.confidence === 'high') score *= 1.1
          }
          if (playerAvg > 0 && side.dir === 'over' && playerAvg > prop.line) score *= 1.2
          candidate.score = score
          results.push(candidate)
        } else if (finalProb >= 0.48) {
          marketFallbacks.push(candidate)
        }
      }
    }
  }

  console.log(`[analyzeBestProps] Edge-filtered results: ${results.length}, market fallbacks: ${marketFallbacks.length}`)

  let candidatePool = results
  if (results.length === 0 && marketFallbacks.length > 0) {
    console.log('[analyzeBestProps] No props passed edge filter, using market-data fallback')
    candidatePool = marketFallbacks
  }

  candidatePool.sort((a, b) => b.score - a.score)
  const topResults = candidatePool.slice(0, count * 3)

  const analyses: PropAnalysisResult[] = []
  const fallbackAnalyses: PropAnalysisResult[] = []
  for (const r of topResults) {
    const analysis = await analyzePlayerProp({
      playerName: r.prop.playerName,
      statType: MARKET_TO_STAT_TYPE[r.prop.market] || null,
      line: r.prop.line,
      direction: r.direction,
      sport: request.sport || null,
      platform: null,
    })
    const hasDirectionalWarning = analysis.recommendation.warnings.some(w => w.includes('average') && (w.includes('above the line') || w.includes('below the line')))
    if (analysis.recommendation.edge > 0 && !hasDirectionalWarning) {
      analyses.push(analysis)
    } else if (fallbackAnalyses.length < count) {
      fallbackAnalyses.push(analysis)
    }
    if (analyses.length >= count) break
  }

  if (analyses.length > 0) return analyses
  return fallbackAnalyses.slice(0, count)
}

// ============================================
// FORMAT FOR CONTEXT
// ============================================

export function formatPropAnalysisForContext(analysis: PropAnalysisResult): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('PLAYER PROP ANALYSIS (Deterministic - Model-Based)')
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')

  if (analysis.player) {
    lines.push(`PLAYER: ${analysis.player.name}`)
    lines.push(`Sport: ${analysis.player.sport} | Position: ${analysis.player.position}`)
    lines.push(`Games Tracked: ${analysis.player.gamesPlayed} | Reliability: ${analysis.player.reliabilityScore}/100`)
    lines.push('')
  }

  if (analysis.seasonStats && analysis.query.statType) {
    const statDisplay = getStatDisplay(analysis.query.statType)
    lines.push(`SEASON STATS (${statDisplay}):`)
    lines.push(`  Rolling Average: ${analysis.seasonStats.average}`)
    lines.push(`  Last 5 Games Avg: ${analysis.seasonStats.last5Average}`)
    lines.push(`  Std Deviation: ${analysis.seasonStats.stdDev}`)
    if (analysis.query.line !== null) {
      const diff = analysis.seasonStats.average - analysis.query.line
      const direction = diff > 0 ? 'ABOVE' : 'BELOW'
      lines.push(`  Line (${analysis.query.line}) is ${Math.abs(diff).toFixed(1)} ${direction} average`)
    }
    lines.push('')
  }

  if (analysis.modelProbability) {
    const mp = analysis.modelProbability
    lines.push('MODEL PROBABILITY:')
    lines.push(`  Over Probability: ${(mp.probability * 100).toFixed(1)}%`)
    lines.push(`  Under Probability: ${((1 - mp.probability) * 100).toFixed(1)}%`)
    lines.push(`  Adjusted Average: ${mp.adjustedAverage.toFixed(1)}`)
    lines.push(`  Confidence: ${mp.confidence}`)

    const adjustments: string[] = []
    if (mp.opponentAdjustment !== 1.0) {
      const pct = ((mp.opponentAdjustment - 1) * 100).toFixed(1)
      adjustments.push(`Opponent defense: ${mp.opponentAdjustment > 1 ? '+' : ''}${pct}%`)
    }
    if (mp.homeAwayAdjustment !== 1.0) {
      const pct = ((mp.homeAwayAdjustment - 1) * 100).toFixed(1)
      adjustments.push(`Home/Away: ${mp.homeAwayAdjustment > 1 ? '+' : ''}${pct}%`)
    }
    if (mp.paceAdjustment && mp.paceAdjustment !== 1.0) {
      adjustments.push(`Pace: ${mp.paceDescription || `${((mp.paceAdjustment - 1) * 100).toFixed(1)}%`}`)
    }
    if (mp.usageAdjustment && mp.usageAdjustment !== 1.0) {
      adjustments.push(`Usage: ${mp.usageDescription || `${((mp.usageAdjustment - 1) * 100).toFixed(1)}%`}`)
    }
    if (mp.backToBackAdjustment) {
      adjustments.push(`Back-to-back fatigue: ${((mp.backToBackAdjustment - 1) * 100).toFixed(1)}%`)
    }

    if (adjustments.length > 0) {
      lines.push('  Adjustments Applied:')
      for (const adj of adjustments) {
        lines.push(`    - ${adj}`)
      }
    }
    lines.push('')
  }

  if (analysis.matchupAnalysis) {
    lines.push('MATCHUP ANALYSIS:')
    lines.push(formatMatchupAdjustmentForDisplay(analysis.matchupAnalysis))
    lines.push('')
  }

  if (analysis.matchupHitRate && analysis.matchupHitRate.hitRate !== null) {
    for (const note of analysis.matchupHitRate.notes) {
      lines.push(`MATCHUP HIT RATE: ${note}`)
    }
    lines.push('')
  }

  if (analysis.marketData) {
    const md = analysis.marketData
    lines.push('MARKET DATA:')
    lines.push(`  Line: ${md.line}`)
    lines.push(`  Over: ${formatOddsDisplay(md.bestOverPrice)} at ${md.bestOverBook} (${md.consensusOverProb}% implied)`)
    lines.push(`  Under: ${formatOddsDisplay(md.bestUnderPrice)} at ${md.bestUnderBook} (${md.consensusUnderProb}% implied)`)
    lines.push(`  Books with line: ${md.booksCount}`)

    if (md.allBookPrices.length > 1) {
      lines.push('  LINE SHOPPING:')
      for (const bp of md.allBookPrices) {
        lines.push(`    ${bp.book}: Over ${formatOddsDisplay(bp.overPrice)} / Under ${formatOddsDisplay(bp.underPrice)}`)
      }
    }
    lines.push('')
  }

  if (analysis.lineMovement && analysis.lineMovement.length > 0) {
    const movementText = formatPropLineMovement(analysis.lineMovement)
    if (movementText) {
      lines.push(movementText)
      lines.push('')
    }
  }

  if (analysis.paceAdjustment) {
    lines.push(`PACE: ${analysis.paceAdjustment.paceDescription}`)
    lines.push('')
  }

  if (analysis.usageAdjustment) {
    lines.push(`USAGE: ${analysis.usageAdjustment.description}`)
    lines.push('')
  }

  const rec = analysis.recommendation
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('RECOMMENDATION:')
  lines.push('═══════════════════════════════════════════════════════════')

  if (rec.pick) {
    lines.push(`PICK: ${rec.pick} ${analysis.query.line || ''} ${getStatDisplay(analysis.query.statType || '')}`)
    lines.push(`Confidence: ${rec.confidence.toUpperCase()}`)
    lines.push(`Calibrated Probability: ${(rec.modelProbability * 100).toFixed(1)}% (blended model + market)`)
    lines.push(`Market Implied: ${(rec.marketImpliedProbability * 100).toFixed(1)}%`)
    const edgePct = Math.abs(rec.edge * 100)
    const edgeLabel = edgePct >= 8 ? 'STRONG' : edgePct >= 4 ? 'MODERATE' : edgePct >= 2 ? 'SLIGHT' : 'MINIMAL'
    lines.push(`Edge: ${rec.edge > 0 ? '+' : ''}${(rec.edge * 100).toFixed(1)}% (${edgeLabel})`)
    if (rec.projectedValue > 0) {
      lines.push(`Projected Value: $${rec.projectedValue.toFixed(2)} per $100`)
    }
  } else {
    lines.push('No clear recommendation — insufficient data or no edge detected')
  }

  if (rec.reasons.length > 0) {
    lines.push('')
    lines.push('WHY:')
    for (const reason of rec.reasons) {
      lines.push(`  + ${reason}`)
    }
  }

  if (rec.warnings.length > 0) {
    lines.push('')
    lines.push('WARNINGS:')
    for (const warning of rec.warnings) {
      lines.push(`  ! ${warning}`)
    }
  }

  if (analysis.correlations.length > 0) {
    lines.push('')
    lines.push('CORRELATED PROPS:')
    for (const corr of analysis.correlations) {
      lines.push(`  ${corr.prop2.player} ${corr.prop2.direction} ${corr.prop2.stat} (${corr.correlationType} correlation, ${corr.strength}) - ${corr.reason}`)
    }
  }

  if (analysis.allPlayerProps.length > 0 && !analysis.marketData) {
    lines.push('')
    lines.push('ALL AVAILABLE PROPS FOR THIS PLAYER:')
    const propsByMarket = new Map<string, PlayerProp[]>()
    for (const p of analysis.allPlayerProps) {
      const existing = propsByMarket.get(p.market) || []
      existing.push(p)
      propsByMarket.set(p.market, existing)
    }
    for (const [market, props] of Array.from(propsByMarket.entries())) {
      const statType = MARKET_TO_STAT_TYPE[market] || market
      const display = getStatDisplay(statType)
      const prop = props[0]
      lines.push(`  ${display}: Line ${prop.line} | Over ${formatOddsDisplay(prop.overOdds)} / Under ${formatOddsDisplay(prop.underOdds)} (${prop.bookmaker})`)
    }
  }

  return lines.join('\n')
}

export function formatMultiPropAnalysisForContext(analyses: PropAnalysisResult[]): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('BEST PLAYER PROPS (Model-Ranked)')
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i]
    const rec = a.recommendation

    lines.push(`--- #${i + 1} ---`)
    if (a.player) {
      lines.push(`${a.player.name} (${a.player.sport})`)
    }

    if (rec.pick && a.query.line !== null) {
      lines.push(`PICK: ${rec.pick} ${a.query.line} ${getStatDisplay(a.query.statType || '')}`)
      lines.push(`Model: ${(rec.modelProbability * 100).toFixed(1)}% | Edge: ${rec.edge > 0 ? '+' : ''}${(rec.edge * 100).toFixed(1)}% | Confidence: ${rec.confidence}`)
    }

    if (a.seasonStats) {
      lines.push(`Avg: ${a.seasonStats.average} | Last 5: ${a.seasonStats.last5Average}`)
    }

    if (a.marketData) {
      const md = a.marketData
      lines.push(`Best Price: Over ${formatOddsDisplay(md.bestOverPrice)} at ${md.bestOverBook} / Under ${formatOddsDisplay(md.bestUnderPrice)} at ${md.bestUnderBook}`)
    }

    if (rec.reasons.length > 0) {
      lines.push(`Why: ${rec.reasons[0]}`)
    }

    if (rec.warnings.length > 0) {
      lines.push(`Warning: ${rec.warnings[0]}`)
    }

    lines.push('')
  }

  const parlayLegs = analyses
    .filter(a => a.recommendation.pick && a.query.statType && a.player)
    .map(a => ({
      player: a.player!.name,
      stat: a.query.statType!,
      direction: (a.recommendation.pick === 'Over' ? 'over' : 'under') as 'over' | 'under',
      team: '',
    }))

  if (parlayLegs.length >= 2) {
    const parlayResult = analyzePropParlay(parlayLegs)
    if (parlayResult.warnings.length > 0) {
      lines.push('PARLAY CORRELATION WARNINGS:')
      for (const w of parlayResult.warnings) {
        lines.push(`  ! ${w}`)
      }
      lines.push(`  ${parlayResult.recommendation}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ============================================
// HELPERS
// ============================================

const MAX_REALISTIC_EDGE = 0.12
const MODEL_WEIGHT_VS_MARKET = 0.35
const CONFIDENCE_EDGE_SCALE: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 }

function buildRecommendation(
  query: PlayerPropQuery,
  modelResult: EnhancedPropProbability | null,
  marketData: PropAnalysisResult['marketData'],
  matchupAnalysis: MatchupAdjustment | null,
  matchupHitRate: { hitRate: number | null; sampleSize: number; notes: string[] } | null,
  paceAdj: PaceAdjustment | null,
  usageAdj: UsageAdjustment | null,
  seasonStats: PropAnalysisResult['seasonStats'] | null,
  reasons: string[],
  warnings: string[]
): PropAnalysisResult['recommendation'] {
  let pick: 'Over' | 'Under' | null = null
  let modelProbability = 0.5
  let marketImpliedProbability = 0.5
  let edge = 0
  let confidence: 'high' | 'medium' | 'low' = 'low'

  if (modelResult && query.line !== null) {
    const rawOverProb = modelResult.probability
    const rawUnderProb = 1 - rawOverProb

    if (query.direction === 'over') {
      modelProbability = rawOverProb
      pick = 'Over'
    } else if (query.direction === 'under') {
      modelProbability = rawUnderProb
      pick = 'Under'
    } else {
      if (rawOverProb > rawUnderProb) {
        pick = 'Over'
        modelProbability = rawOverProb
      } else {
        pick = 'Under'
        modelProbability = rawUnderProb
      }
    }

    if (marketData) {
      marketImpliedProbability = pick === 'Over'
        ? marketData.consensusOverProb / 100
        : marketData.consensusUnderProb / 100

      modelProbability = (modelProbability * MODEL_WEIGHT_VS_MARKET) +
        (marketImpliedProbability * (1 - MODEL_WEIGHT_VS_MARKET))
    }

    confidence = modelResult.confidence

    let rawEdge = modelProbability - marketImpliedProbability
    const confScale = CONFIDENCE_EDGE_SCALE[confidence] || 0.4
    rawEdge = rawEdge * confScale
    edge = Math.max(-MAX_REALISTIC_EDGE, Math.min(MAX_REALISTIC_EDGE, rawEdge))

    if (seasonStats && query.line !== null) {
      const avgVsLine = seasonStats.average - query.line

      if (pick === 'Over' && avgVsLine < 0) {
        warnings.push(`Caution: Season average (${seasonStats.average}) is below the line (${query.line}) — over pick is risky`)
        edge = Math.min(edge, 0.02)
      } else if (pick === 'Under' && avgVsLine > 0) {
        warnings.push(`Caution: Season average (${seasonStats.average}) is above the line (${query.line}) — under pick is risky`)
        edge = Math.min(edge, 0.02)
      }

      if (pick === 'Over' && avgVsLine > 0) {
        reasons.push(`Season average (${seasonStats.average}) is ${avgVsLine.toFixed(1)} above the line (${query.line})`)
      } else if (pick === 'Under' && avgVsLine < 0) {
        reasons.push(`Season average (${seasonStats.average}) is ${Math.abs(avgVsLine).toFixed(1)} below the line (${query.line})`)
      }

      if (seasonStats.last5Average !== seasonStats.average) {
        const trend = seasonStats.last5Average > seasonStats.average ? 'trending up' : 'trending down'
        reasons.push(`Recent form ${trend} (last 5 avg: ${seasonStats.last5Average} vs season: ${seasonStats.average})`)

        if (pick === 'Over' && seasonStats.last5Average < seasonStats.average) {
          warnings.push(`Recent form trending down — last 5 games average (${seasonStats.last5Average}) is below season average`)
        } else if (pick === 'Under' && seasonStats.last5Average > seasonStats.average) {
          warnings.push(`Recent form trending up — last 5 games average (${seasonStats.last5Average}) is above season average`)
        }
      }
    }

    if (edge > 0.02) {
      reasons.push(`${(edge * 100).toFixed(1)}% estimated edge over market`)
    }

    if (modelResult.reliabilityScore && modelResult.reliabilityScore >= 70) {
      reasons.push(`High consistency player (${modelResult.reliabilityScore}/100 reliability score)`)
    }
  } else if (seasonStats && query.line !== null) {
    const avgVsLine = seasonStats.average - query.line
    if (Math.abs(avgVsLine) > seasonStats.stdDev * 0.5) {
      pick = avgVsLine > 0 ? 'Over' : 'Under'
      const rawProb = pick === 'Over'
        ? calculateOverProbability(seasonStats.average, seasonStats.stdDev, query.line, 1.0)
        : 1 - calculateOverProbability(seasonStats.average, seasonStats.stdDev, query.line, 1.0)

      if (marketData) {
        const mktProb = pick === 'Over'
          ? marketData.consensusOverProb / 100
          : marketData.consensusUnderProb / 100
        marketImpliedProbability = mktProb
        modelProbability = (rawProb * 0.25) + (mktProb * 0.75)
      } else {
        modelProbability = rawProb
      }

      edge = Math.max(-MAX_REALISTIC_EDGE, Math.min(MAX_REALISTIC_EDGE,
        (modelProbability - marketImpliedProbability) * 0.4))
      reasons.push(`Based on season average (${seasonStats.average}) vs line (${query.line})`)
      confidence = 'low'
      warnings.push('Limited model data — using season averages only')
    }
  }

  if (matchupAnalysis && matchupAnalysis.notes.length > 0) {
    for (const note of matchupAnalysis.notes) {
      reasons.push(note)
    }
  }

  if (matchupHitRate && matchupHitRate.hitRate !== null) {
    for (const note of matchupHitRate.notes) {
      reasons.push(note)
    }
  }

  if (paceAdj && paceAdj.paceMultiplier !== 1.0) {
    reasons.push(paceAdj.paceDescription)
  }

  if (usageAdj && usageAdj.usageMultiplier !== 1.0) {
    reasons.push(usageAdj.description)
  }

  if (!modelResult && !seasonStats) {
    warnings.push('No player stats data available — recommendation based on market data only')
  }

  if (modelResult && modelResult.gamesPlayed < 10) {
    warnings.push(`Small sample size (${modelResult.gamesPlayed} games tracked)`)
  }

  const calibratedProb = marketData
    ? marketImpliedProbability + edge
    : modelProbability
  const projectedValue = edge > 0 && marketData
    ? calculateEV(pick === 'Over' ? marketData.bestOverPrice : marketData.bestUnderPrice, calibratedProb)
    : 0

  return {
    pick,
    confidence,
    modelProbability,
    marketImpliedProbability,
    edge,
    projectedValue,
    reasons,
    warnings,
  }
}

function findMarketForStat(statType: string): string | null {
  for (const entry of Object.values(STAT_ALIASES)) {
    if (entry.statType === statType) return entry.market
  }
  for (const [market, stat] of Object.entries(MARKET_TO_STAT_TYPE)) {
    if (stat === statType) return market
  }
  return null
}

function mapStatToMatchupStat(statType: string): 'points' | 'rebounds' | 'assists' | 'threes' | null {
  const mapping: Record<string, 'points' | 'rebounds' | 'assists' | 'threes'> = {
    'points': 'points',
    'rebounds': 'rebounds',
    'assists': 'assists',
    'threePointersMade': 'threes',
  }
  return mapping[statType] || null
}

function getStatDisplay(statType: string): string {
  for (const entry of Object.values(STAT_ALIASES)) {
    if (entry.statType === statType) return entry.display
  }
  return statType
}

function formatOddsDisplay(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

function calculateEV(odds: number, probability: number): number {
  if (odds > 0) {
    const payout = odds / 100
    return (probability * payout) - ((1 - probability) * 1)
  } else {
    const payout = 100 / Math.abs(odds)
    return (probability * payout) - ((1 - probability) * 1)
  }
}
