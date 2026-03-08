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

import { getPlayerPropProbability, getPlayerStatsData, calculateOverProbability, calculateOverProbabilityPoisson, COUNT_STATS, RECENT_FORM_WINDOW } from './player-stats'
import type { EnhancedPropProbability, PlayerStats, PlayerStatsData } from './player-stats'
import { calculateMatchupAdjustment, getMatchupHitRate, formatMatchupAdjustmentForDisplay } from './player-matchup'
import type { MatchupAdjustment } from './player-matchup'
import { getPaceAdjustment, getUsageAdjustment, getCorrelatedProps, storePropCLVRecord, analyzePropParlay, getPropLineMovement, formatPropLineMovement, getAllLineMovements, lookupLineMovement } from './prop-enhancements'
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
  'baseball_mlb',
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
  
  // Only count games that actually have props (not empty game shells)
  const gamesWithActualProps = allProps.filter(g => g.props && g.props.length > 0)
  const totalPropCount = gamesWithActualProps.reduce((sum, g) => sum + g.props.length, 0)
  
  console.log(`[fetchPropsOnDemand] API returned ${allProps.length} games, ${gamesWithActualProps.length} with props, ${totalPropCount} total props`)

  if (gamesWithActualProps.length > 0) {
    await setCachedPlayerProps(gamesWithActualProps).catch(err =>
      console.error('[fetchPropsOnDemand] Cache write failed:', err)
    )
    console.log(`[fetchPropsOnDemand] Cached ${gamesWithActualProps.length} games with ${totalPropCount} props`)
  } else {
    console.log('[fetchPropsOnDemand] No games with actual prop data returned from API')
  }

  return gamesWithActualProps
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

  // Check if cache has actual prop data (not just empty game shells)
  const hasActualProps = propsData && propsData.length > 0 && propsData.some(g => g.props && g.props.length > 0)
  
  if (!hasActualProps) {
    console.log(`[analyzeBestProps] Cache empty or has no props (games=${propsData?.length || 0}), attempting on-demand fetch`)
    try {
      propsData = await fetchPropsOnDemand(request.sport || null)
    } catch (err) {
      console.error('[analyzeBestProps] On-demand fetch failed:', err)
      return []
    }
    if (!propsData || propsData.length === 0) return []
  }
  
  // When no sport filter is specified, check if the cache is missing any sports.
  // The cron may have run when some sports hadn't posted props yet, leaving the cache
  // with only NBA data. Supplement with on-demand fetches for missing sports.
  if (!request.sport && propsData) {
    const cachedSportKeys = new Set(propsData.map(g => g.sport))
    const missingSportKeys = ALL_PROP_SPORT_KEYS.filter(k => !cachedSportKeys.has(k))
    if (missingSportKeys.length > 0) {
      console.log(`[analyzeBestProps] Cache missing sports: ${missingSportKeys.join(', ')} — fetching on-demand`)
      try {
        const supplementResults = await Promise.all(
          missingSportKeys.map(key =>
            fetchSportPlayerProps(key).catch((e) => {
              console.error(`[analyzeBestProps] On-demand fetch ${key} error:`, e.message)
              return [] as GamePlayerProps[]
            })
          )
        )
        const supplementProps = supplementResults.flat().filter(g => g.props && g.props.length > 0)
        if (supplementProps.length > 0) {
          propsData = [...propsData, ...supplementProps]
          console.log(`[analyzeBestProps] Supplemented cache with ${supplementProps.length} games from ${missingSportKeys.length} sports`)
        }
      } catch (err) {
        console.error('[analyzeBestProps] Supplement fetch failed:', err)
        // Continue with cached data — supplementing is best-effort
      }
    }
  }

  // Fix #1: Filter out games that have already started — can't bet on in-progress players
  const now = new Date()
  const filteredPropsData = propsData!.filter(game => {
    const gameTime = new Date(game.commenceTime)
    return gameTime > now
  })
  
  const startedCount = propsData!.length - filteredPropsData.length
  if (startedCount > 0) {
    // Log per-sport breakdown of what was filtered vs remaining
    const startedBySport = new Map<string, number>()
    const remainingBySport = new Map<string, number>()
    for (const g of propsData!) {
      const gt = new Date(g.commenceTime)
      if (gt <= now) {
        startedBySport.set(g.sport, (startedBySport.get(g.sport) || 0) + 1)
      } else {
        remainingBySport.set(g.sport, (remainingBySport.get(g.sport) || 0) + 1)
      }
    }
    console.log(`[analyzeBestProps] Filtered out ${startedCount} already-started games (${filteredPropsData.length} remaining). Started: ${Array.from(startedBySport.entries()).map(([s, c]) => `${s}:${c}`).join(', ')}. Remaining: ${Array.from(remainingBySport.entries()).map(([s, c]) => `${s}:${c}`).join(', ')}`)
  }
  
  if (filteredPropsData.length === 0) {
    console.log('[analyzeBestProps] All games have already started, no upcoming props available')
    return []
  }

  // At this point propsData is guaranteed non-null and non-empty
  const validPropsData = filteredPropsData
  
  // PERF FIX: Pre-fetch ALL external data in parallel BEFORE the scoring loop.
  // Previously getPlayerPropProbability() was called per prop candidate (~100+ times),
  // and each call redundantly fetched statsData, ESPN odds, and ESPN data from Redis.
  // This caused 300+ sequential Redis HTTP calls, exceeding Vercel's timeout.
  // Now we fetch everything once and use local lookups in the loop.
  const [statsData, allLineMovements] = await Promise.all([
    getPlayerStatsData(),
    getAllLineMovements(),
  ])
  const hasModelData = !!statsData
  
  // Log per-sport breakdown of upcoming games and props for pipeline debugging
  const upcomingSportBreakdown = new Map<string, { games: number; props: number }>()
  for (const g of validPropsData) {
    const existing = upcomingSportBreakdown.get(g.sport) || { games: 0, props: 0 }
    existing.games++
    existing.props += g.props.length
    upcomingSportBreakdown.set(g.sport, existing)
  }
  console.log(`[analyzeBestProps] Props data: ${validPropsData.length} games, model data: ${hasModelData}, line movements: ${allLineMovements.size} entries. Per-sport upcoming: ${Array.from(upcomingSportBreakdown.entries()).map(([s, d]) => `${s}:${d.games}games/${d.props}props`).join(', ')}`)

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

  const sportKeyMap: Record<string, string[]> = {
    'NBA': ['basketball_nba'],
    'NFL': ['americanfootball_nfl'],
    'NHL': ['icehockey_nhl'],
    'MLB': ['baseball_mlb'],
    'NCAAB': ['basketball_ncaab'],
    'NCAAF': ['americanfootball_ncaaf'],
  }

  for (const game of validPropsData) {
    if (request.sport) {
      const validKeys = sportKeyMap[request.sport] || []
      if (validKeys.length > 0 && !validKeys.some((k: string) => game.sport.includes(k))) continue
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

      // PERF FIX: Inline probability calculation using pre-fetched statsData.
      // Previously called getPlayerPropProbability() per candidate which re-fetched
      // statsData from Redis on every call (N+1 pattern).
      // This inline version uses the same math but with zero additional network calls.
      let modelResult: EnhancedPropProbability | null = null
      if (statsData) {
        modelResult = computePropProbabilityInline(
          statsData, prop.playerName, sportName, statType, prop.line
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
          // Fix #7: Scale model weight by sample size — more data = more model trust
          const dynamicWeight = getModelWeight(modelResult.gamesPlayed)
          finalProb = rawModel * dynamicWeight + side.prob * (1 - dynamicWeight)
          modelProb = rawModel
        }

        let edge = finalProb - side.implied
        // Only apply confidence scaling when we have model data. For market-data-only props
        // (NHL, NCAAB without ESPN stats), the edge is purely from vig removal and shouldn't
        // be penalized by a confidence multiplier — there's no model to be unconfident about.
        if (modelResult) {
          const confScale = CONFIDENCE_EDGE_SCALE[modelResult.confidence] || 0.4
          edge = Math.max(-MAX_REALISTIC_EDGE, Math.min(MAX_REALISTIC_EDGE, edge * confScale))
        } else {
          edge = Math.max(-MAX_REALISTIC_EDGE, Math.min(MAX_REALISTIC_EDGE, edge))
        }

        const candidate: ScoredProp = {
          prop: { ...prop, overOdds: side.dir === 'over' ? side.bestPrice : prop.overOdds, underOdds: side.dir === 'under' ? side.bestPrice : prop.underOdds },
          game,
          score: finalProb * 60 + Math.max(edge, 0) * 40,
          modelProb: modelProb > 0 ? modelProb : finalProb,
          edge,
          direction: side.dir,
        }

        // Fix #6: Integrate line movement data into scoring
        // If sharp money is moving the line in our direction, boost confidence
        // Uses pre-fetched allLineMovements map (single Redis call) instead of per-candidate lookups
        try {
          const movements = lookupLineMovement(allLineMovements, prop.playerName, prop.market)
          if (movements.length > 0) {
            const movement = movements[0]
            // Boost score if sharp money agrees with our pick direction
            if (movement.direction === side.dir) {
              if (movement.sharpSignal) {
                candidate.score *= 1.15  // Strong sharp signal in our direction
              } else if (movement.magnitude === 'significant') {
                candidate.score *= 1.08
              } else if (movement.magnitude === 'minor') {
                candidate.score *= 1.03
              }
            }
            // Penalize if sharp money disagrees with our direction
            if (movement.direction !== 'neutral' && movement.direction !== side.dir) {
              if (movement.sharpSignal) {
                candidate.score *= 0.85  // Sharp money against us — significant penalty
              } else if (movement.magnitude === 'significant') {
                candidate.score *= 0.92
              }
            }
          }
        } catch {
          // Line movement data is supplementary — don't fail scoring if unavailable
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
        } else if (finalProb >= 0.45) {
          // Lowered threshold from 0.48 to 0.45 to capture more market-data-only props
          // from sports without model data (NHL, NCAAB). These props have no model edge
          // but are still valid betting opportunities based on market consensus.
          marketFallbacks.push(candidate)
        }
      }
    }
  }

  // Log sport breakdown for debugging multi-sport coverage
  const resultSports = new Map<string, number>()
  for (const r of results) {
    resultSports.set(r.game.sport, (resultSports.get(r.game.sport) || 0) + 1)
  }
  const fallbackSports = new Map<string, number>()
  for (const f of marketFallbacks) {
    fallbackSports.set(f.game.sport, (fallbackSports.get(f.game.sport) || 0) + 1)
  }
  console.log(`[analyzeBestProps] Edge-filtered results: ${results.length} (${Array.from(resultSports.entries()).map(([s, c]) => `${s}:${c}`).join(', ')}), market fallbacks: ${marketFallbacks.length} (${Array.from(fallbackSports.entries()).map(([s, c]) => `${s}:${c}`).join(', ')})`)

  // Fix #5 (improved): Sport-balance across BOTH edge-filtered results AND market fallbacks.
  // Previously, sport-balancing only applied to the edge-filtered pool. This meant sports
  // without model data (NHL, NCAAB) whose props only had market-data-quality edges would
  // never appear — NBA dominated because it had model-backed edges.
  // Now we merge both pools per-sport so every sport with available props gets represented.
  let candidatePool: ScoredProp[]
  
  if (!request.sport) {
    // Combine results + fallbacks, grouping by sport
    const allCandidates = [...results, ...marketFallbacks]
    const sportBuckets = new Map<string, ScoredProp[]>()
    for (const c of allCandidates) {
      const sport = c.game.sport
      const bucket = sportBuckets.get(sport) || []
      bucket.push(c)
      sportBuckets.set(sport, bucket)
    }
    
    // Sort within each sport bucket by score (edge-filtered results already have higher scores)
    Array.from(sportBuckets.values()).forEach(bucket => {
      bucket.sort((a: ScoredProp, b: ScoredProp) => b.score - a.score)
    })
    
    if (sportBuckets.size > 1) {
      // Round-robin across sports to ensure each sport is represented
      const balanced: ScoredProp[] = []
      const maxPerSport = Math.max(2, Math.ceil((count * 3) / sportBuckets.size))
      const sportIterators = Array.from(sportBuckets.entries()).map(([sport, bucket]) => ({ sport, bucket, index: 0 }))
      
      let added = true
      while (balanced.length < count * 3 && added) {
        added = false
        for (const iter of sportIterators) {
          if (iter.index < iter.bucket.length && iter.index < maxPerSport) {
            balanced.push(iter.bucket[iter.index])
            iter.index++
            added = true
          }
        }
      }
      
      candidatePool = balanced.length > 0 ? balanced : allCandidates
      console.log(`[analyzeBestProps] Sport-balanced pool: ${balanced.length} candidates across ${sportBuckets.size} sports (${Array.from(sportBuckets.keys()).join(', ')})`)
    } else {
      // Only one sport available — use all candidates sorted by score
      candidatePool = allCandidates
      candidatePool.sort((a, b) => b.score - a.score)
    }
  } else {
    // Sport-specific query: use edge-filtered results, fall back to market data
    candidatePool = results.length > 0 ? results : marketFallbacks
    candidatePool.sort((a, b) => b.score - a.score)
  }
  
  // If STILL no candidates but we have props data, create candidates from raw market data
  // This ensures we always return something when props exist
  if (candidatePool.length === 0 && validPropsData.length > 0) {
    console.log('[analyzeBestProps] No scored candidates - creating from raw market data')
    for (const game of validPropsData) {
      if (request.sport) {
        const validKeys = sportKeyMap[request.sport] || []
        if (validKeys.length > 0 && !validKeys.some((k: string) => game.sport.includes(k))) continue
      }
      for (const prop of game.props.slice(0, 20)) {
        const statType = MARKET_TO_STAT_TYPE[prop.market]
        if (!statType) continue
        const overImplied = americanToImpliedProbability(prop.overOdds)
        const underImplied = americanToImpliedProbability(prop.underOdds)
        const total = overImplied + underImplied
        const overNoVig = overImplied / total
        const underNoVig = underImplied / total
        const dir = overNoVig >= underNoVig ? 'over' as const : 'under' as const
        candidatePool.push({
          prop,
          game,
          score: Math.max(overNoVig, underNoVig) * 100,
          modelProb: dir === 'over' ? overNoVig : underNoVig,
          edge: 0,
          direction: dir,
        })
      }
    }
    candidatePool.sort((a, b) => b.score - a.score)
    console.log(`[analyzeBestProps] Created ${candidatePool.length} raw market candidates`)
  }

  const topResults = candidatePool.slice(0, count * 3)

  if (topResults.length === 0) {
    console.log('[analyzeBestProps] No candidates at all, returning empty')
    return []
  }

  // PERF FIX: Build PropAnalysisResult objects INLINE instead of calling analyzePlayerProp().
  // analyzePlayerProp() makes 7+ Redis/network calls per invocation (getPlayerStatsData,
  // getCachedPlayerProps, getPlayerPropProbability, calculateMatchupAdjustment,
  // getMatchupHitRate, getPaceAdjustment, getUsageAdjustment).
  // With 9 top candidates × 7 calls = 63+ sequential Redis calls, causing timeout.
  // Instead, we construct results from pre-fetched statsData and scoring loop data.
  const analyses: PropAnalysisResult[] = []
  const fallbackAnalyses: PropAnalysisResult[] = []
  const seenPlayers = new Set<string>()

  for (const r of topResults) {
    if (seenPlayers.has(r.prop.playerName)) continue
    seenPlayers.add(r.prop.playerName)

    const now = new Date().toISOString()
    const statType = MARKET_TO_STAT_TYPE[r.prop.market] || null
    const resultSportNameMap: Record<string, string> = {
      'basketball_nba': 'NBA', 'basketball_ncaab': 'NCAAB',
      'americanfootball_nfl': 'NFL', 'americanfootball_ncaaf': 'NCAAF',
      'icehockey_nhl': 'NHL', 'baseball_mlb': 'MLB',
    }
    const sportDisplay = resultSportNameMap[r.game.sport] || r.game.sport

    // Look up player data from pre-fetched statsData
    let playerInfo: PropAnalysisResult['player'] = null
    let seasonStats: PropAnalysisResult['seasonStats'] = null
    let modelProbResult: EnhancedPropProbability | null = null

    if (statsData) {
      const normalizedName = r.prop.playerName.toLowerCase()
      const playerKey = Object.keys(statsData.players).find(key => {
        const p = statsData.players[key]
        return p.playerName.toLowerCase().includes(normalizedName) ||
               normalizedName.includes(p.playerName.toLowerCase())
      })

      if (playerKey) {
        const pd = statsData.players[playerKey]
        playerInfo = {
          name: pd.playerName,
          sport: pd.sport,
          position: pd.position,
          gamesPlayed: pd.gamesPlayed,
          reliabilityScore: pd.reliabilityScore || 50,
        }

        if (statType) {
          const avg = (pd.averages as Record<string, number>)[statType]
          const stdDev = (pd.stdDevs as Record<string, number>)[statType]
          if (avg !== undefined) {
            const recentLogs = pd.gameLogs.slice(0, 5)
            const last5Values = recentLogs
              .map(log => (log as unknown as Record<string, number>)[statType!])
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

        // Reuse inline probability calculation
        if (statType) {
          modelProbResult = computePropProbabilityInline(
            statsData, r.prop.playerName, sportDisplay, statType, r.prop.line
          )
        }
      }
    }

    if (!playerInfo) {
      playerInfo = {
        name: r.prop.playerName,
        sport: sportDisplay,
        position: '',
        gamesPlayed: 0,
        reliabilityScore: 0,
      }
    }

    // Build market data from the prop's bookmaker prices
    const gameProps = r.game.props.filter(p =>
      p.playerName === r.prop.playerName && p.market === r.prop.market && p.line === r.prop.line
    )
    const propsToUse = gameProps.length > 0 ? gameProps : [r.prop]

    const overPrices = propsToUse.map(p => p.overOdds)
    const underPrices = propsToUse.map(p => p.underOdds)
    const overImpliedProbs = overPrices.map(p => americanToImpliedProbability(p))
    const underImpliedProbs = underPrices.map(p => americanToImpliedProbability(p))
    const avgOverImplied = overImpliedProbs.reduce((a, b) => a + b, 0) / overImpliedProbs.length
    const avgUnderImplied = underImpliedProbs.reduce((a, b) => a + b, 0) / underImpliedProbs.length
    const totalImplied = avgOverImplied + avgUnderImplied
    const bestOverIdx = overPrices.indexOf(Math.max(...overPrices))
    const bestUnderIdx = underPrices.indexOf(Math.max(...underPrices))

    const mktData: PropAnalysisResult['marketData'] = {
      line: r.prop.line,
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

    // Look up line movement from pre-fetched data (zero network calls)
    let lineMovement: PropLineMovement[] = []
    try {
      lineMovement = lookupLineMovement(allLineMovements, r.prop.playerName, r.prop.market)
    } catch {
      // supplementary data
    }

    // Build recommendation using existing buildRecommendation function
    const query: PlayerPropQuery = {
      playerName: r.prop.playerName,
      statType,
      line: r.prop.line,
      direction: r.direction,
      sport: request.sport || null,
      platform: null,
    }

    const recommendation = buildRecommendation(
      query, modelProbResult, mktData, null, null,
      null, null, seasonStats, [], []
    )

    // If buildRecommendation didn't produce a pick, fill from scoring loop data
    if (!recommendation.pick && mktData) {
      const overProb = mktData.consensusOverProb / 100
      const underProb = mktData.consensusUnderProb / 100
      if (r.direction === 'over') {
        recommendation.pick = 'Over'
        recommendation.modelProbability = overProb
        recommendation.marketImpliedProbability = americanToImpliedProbability(mktData.bestOverPrice)
      } else {
        recommendation.pick = 'Under'
        recommendation.modelProbability = underProb
        recommendation.marketImpliedProbability = americanToImpliedProbability(mktData.bestUnderPrice)
      }
      recommendation.edge = Math.max(0, recommendation.modelProbability - recommendation.marketImpliedProbability)
      recommendation.confidence = 'low'
      if (!recommendation.reasons.length) {
        recommendation.reasons.push(`Market consensus: ${(recommendation.modelProbability * 100).toFixed(1)}% probability (${mktData.booksCount} books)`)
      }
    }

    // For market-data-only props (no model, no season stats), preserve the scoring loop's
    // edge if buildRecommendation couldn't calculate a better one. The scoring loop edge
    // is the vig-removal edge: finalProb - bestPriceImplied.
    if (!modelProbResult && !seasonStats && recommendation.edge <= 0 && r.edge > 0) {
      recommendation.edge = r.edge
    }

    const analysis: PropAnalysisResult = {
      query,
      player: playerInfo,
      seasonStats,
      modelProbability: modelProbResult,
      matchupAnalysis: null,  // Skipped in batch mode (requires Redis calls)
      matchupHitRate: null,   // Skipped in batch mode (requires Redis calls)
      paceAdjustment: null,   // Skipped in batch mode (requires Redis calls)
      usageAdjustment: null,  // Skipped in batch mode (requires Redis calls)
      marketData: mktData,
      correlations: [],
      lineMovement,
      recommendation,
      calculatedAt: now,
      allPlayerProps: gameProps,
    }

    const hasDirectionalWarning = analysis.recommendation.warnings.some(w => w.includes('average') && (w.includes('above the line') || w.includes('below the line')))
    if (analysis.recommendation.edge > 0 && !hasDirectionalWarning) {
      analyses.push(analysis)
    } else if (request.sport && analysis.recommendation.pick) {
      // Sport-specific query: user explicitly wants this sport's props.
      // Include even with small/zero edge — these are the best available for the requested sport.
      // Market-data-only props (NHL, NCAAB) may have small vig-removal edges but are still
      // valid recommendations when the user specifically asks for that sport.
      analyses.push(analysis)
    } else if (analysis.recommendation.pick) {
      fallbackAnalyses.push(analysis)
    } else if (analysis.marketData) {
      fallbackAnalyses.push(analysis)
    }
    if (analyses.length >= count) break
  }

  const finalResults = analyses.length > 0 ? analyses.slice(0, count) : fallbackAnalyses.slice(0, count)

  // Fix #4: Record recommended props for outcome tracking (CLV + hit/miss grading)
  // Fire-and-forget: don't await — CLV recording is supplementary and should not block response
  for (const result of finalResults) {
    if (result.recommendation.pick && result.query.statType && result.query.line !== null) {
      storePropCLVRecord({
        playerName: result.query.playerName,
        statType: result.query.statType,
        line: result.query.line,
        direction: result.recommendation.pick.toLowerCase() as 'over' | 'under',
        pickProbability: result.recommendation.modelProbability || 0.5,
        pickOdds: result.recommendation.pick === 'Over'
          ? (result.marketData?.bestOverPrice || -110)
          : (result.marketData?.bestUnderPrice || -110),
        pickTimestamp: new Date().toISOString(),
        sport: result.player?.sport || 'unknown',
        gameTimestamp: result.calculatedAt,
      }).catch(() => { /* supplementary — don't fail the response */ })
    }
  }

  return finalResults
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

  // Collect sport breakdown for diversity reporting
  const sportCounts = new Map<string, number>()
  for (const a of analyses) {
    const sport = a.player?.sport || 'Unknown'
    sportCounts.set(sport, (sportCounts.get(sport) || 0) + 1)
  }
  const sportsPresent = Array.from(sportCounts.keys())

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('BEST PLAYER PROPS (Model-Ranked)')
  if (sportsPresent.length > 1) {
    lines.push(`Sports covered: ${sportsPresent.join(', ')}`)
  }
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')

  // Determine prop-specific tier labels
  const getPropTier = (rec: PropAnalysisResult['recommendation']): string => {
    const prob = rec.modelProbability * 100
    const edgePct = rec.edge * 100
    if ((prob >= 55 && edgePct >= 2) ||
        (prob >= 60 && (rec.confidence === 'medium' || rec.confidence === 'high'))) {
      return 'RECOMMENDED PROP'
    } else if ((prob >= 52 && edgePct > 0) || prob >= 55) {
      return 'SOLID PROP'
    }
    return 'SPECULATIVE (low confidence)'
  }

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i]
    const rec = a.recommendation
    const tier = getPropTier(rec)

    lines.push(`--- #${i + 1} ---`)
    if (a.player) {
      lines.push(`${a.player.name} (${a.player.sport})`)
    } else if (a.query.playerName) {
      lines.push(`${a.query.playerName}`)
    }

    if (rec.pick && a.query.line !== null) {
      lines.push(`PICK: ${rec.pick} ${a.query.line} ${getStatDisplay(a.query.statType || '')} | ${tier}`)
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

  // Build a cross-sport diversified parlay suggestion
  if (analyses.length >= 2 && sportsPresent.length > 1) {
    // Pick best prop from each sport first (round-robin diversity)
    const sportBestProps = new Map<string, PropAnalysisResult>()
    for (const a of analyses) {
      const sport = a.player?.sport || 'Unknown'
      if (!sportBestProps.has(sport) && a.recommendation.pick) {
        sportBestProps.set(sport, a)
      }
    }

    const diverseLegs = Array.from(sportBestProps.values()).slice(0, 3)
    if (diverseLegs.length >= 2) {
      lines.push('CROSS-SPORT PROP PARLAY SUGGESTION:')
      lines.push(`(Diversified across ${diverseLegs.length} sports for reduced correlation)`)
      for (let i = 0; i < diverseLegs.length; i++) {
        const a = diverseLegs[i]
        const rec = a.recommendation
        const sport = a.player?.sport || ''
        const prob = (rec.modelProbability * 100).toFixed(1)
        lines.push(`  Leg ${i + 1}: ${a.player?.name || a.query.playerName} (${sport}) ${rec.pick} ${a.query.line} ${getStatDisplay(a.query.statType || '')} | ${prob}% prob`)
      }
      const combinedProb = diverseLegs.reduce((acc, a) => acc * a.recommendation.modelProbability, 1)
      lines.push(`  Combined probability: ${(combinedProb * 100).toFixed(1)}%`)
      lines.push(`  Note: Cross-sport legs are more independent than same-sport legs`)
      lines.push('')
    }
  }

  const parlayLegs = analyses
    .filter(a => a.recommendation.pick && a.query.statType)
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

/**
 * PERF FIX: Inline probability calculation for batch scoring in analyzeBestProps.
 * 
 * This replicates the core math of getPlayerPropProbability() but uses
 * pre-fetched statsData instead of making its own Redis call.
 * 
 * getPlayerPropProbability() calls getPlayerStatsData() on EVERY invocation,
 * plus getPaceAdjustment() and getUsageAdjustment() which each make their own
 * Redis/ESPN calls. In a loop of 100+ prop candidates, that's 300+ redundant
 * Redis HTTP calls for the same data.
 * 
 * This function does ZERO network calls — pure computation on pre-fetched data.
 */
function computePropProbabilityInline(
  statsData: PlayerStatsData,
  playerName: string,
  sport: string,
  statType: string,
  line: number
): EnhancedPropProbability | null {
  // Find player by name (case-insensitive search) — same logic as getPlayerPropProbability
  const playerKey = Object.keys(statsData.players).find(key => {
    const player = statsData.players[key]
    return player.sport === sport &&
           player.playerName.toLowerCase().includes(playerName.toLowerCase())
  })

  if (!playerKey) return null

  const player = statsData.players[playerKey]
  const avg = (player.averages as Record<string, number>)[statType]
  const stdDev = (player.stdDevs as Record<string, number>)[statType]

  if (avg === undefined) return null

  // Skip pace/usage/opponent adjustments in batch mode — they require
  // additional Redis calls and provide marginal improvement for ranking.
  // The single-player path (analyzePlayerProp) still uses full adjustments.
  const adjustedAverage = avg

  // Recent form blending (same as getPlayerPropProbability)
  const recentLogs = player.gameLogs.slice(0, RECENT_FORM_WINDOW)
  const recentValues = recentLogs
    .map(log => (log as unknown as Record<string, number | undefined>)[statType])
    .filter((v): v is number => v !== undefined && v !== null)
  const recentAvg = recentValues.length >= 3
    ? recentValues.reduce((a, b) => a + b, 0) / recentValues.length
    : null
  const blendedAverage = recentAvg !== null
    ? (adjustedAverage * 0.70 + recentAvg * 0.30)
    : adjustedAverage

  // Statistical probability calculation
  const isCountStat = COUNT_STATS.has(statType)
  const statisticalProb = isCountStat && blendedAverage > 0
    ? calculateOverProbabilityPoisson(blendedAverage, line)
    : calculateOverProbability(blendedAverage, stdDev, line, 1.0)

  // Historical hit rate
  let historicalHitRate = 0.5
  const hitRateData = player.hitRates?.[statType as keyof typeof player.hitRates]
  if (hitRateData && hitRateData.totalGames >= 3) {
    const lineVsAvg = line / adjustedAverage
    if (lineVsAvg < 0.9) {
      historicalHitRate = Math.min(0.95, (hitRateData.hitRate / 100) * 1.2)
    } else if (lineVsAvg > 1.1) {
      historicalHitRate = Math.max(0.05, (hitRateData.hitRate / 100) * 0.8)
    } else {
      historicalHitRate = hitRateData.hitRate / 100
    }
  }

  const reliabilityScore = player.reliabilityScore ?? 50
  const gamesPlayed = player.gamesPlayed

  // Combine probabilities (same weights as getPlayerPropProbability)
  let historicalWeight = 0.3
  if (gamesPlayed >= 10 && reliabilityScore >= 60) {
    historicalWeight = 0.5
  } else if (gamesPlayed >= 20 && reliabilityScore >= 70) {
    historicalWeight = 0.6
  }

  const combinedProbability = (statisticalProb * (1 - historicalWeight)) + (historicalHitRate * historicalWeight)

  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (gamesPlayed >= 15 && reliabilityScore >= 65) {
    confidence = 'high'
  } else if (gamesPlayed >= 8 && reliabilityScore >= 50) {
    confidence = 'medium'
  }

  return {
    probability: Math.max(0.05, Math.min(0.95, combinedProbability)),
    statisticalProb,
    historicalHitRate,
    average: avg,
    stdDev: stdDev || avg * 0.3,
    gamesPlayed,
    reliabilityScore,
    homeAwayAdjustment: 1.0,
    opponentAdjustment: 1.0,
    adjustedAverage,
    confidence,
  }
}

// Fix #7: Dynamic model weight based on sample size instead of static constant
// More games tracked = more trust in model; fewer games = lean on market
function getModelWeight(gamesPlayed: number): number {
  if (gamesPlayed >= 20) return 0.50  // Strong sample — trust model equally with market
  if (gamesPlayed >= 15) return 0.42
  if (gamesPlayed >= 10) return 0.35
  if (gamesPlayed >= 5) return 0.25
  return 0.15  // Very small sample — lean heavily on market
}

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

      // Fix #7: Use dynamic model weight based on sample size
      const dynamicWeight = getModelWeight(modelResult.gamesPlayed)
      modelProbability = (modelProbability * dynamicWeight) +
        (marketImpliedProbability * (1 - dynamicWeight))
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

  if (!modelResult && !seasonStats && marketData && query.line !== null) {
    // Market-data-only props (NHL, NCAAB without ESPN stats).
    // The vig-removed probability IS higher than the best-price implied probability,
    // creating a real edge from vig removal. Calculate and use it.
    const overNoVig = marketData.consensusOverProb / 100
    const underNoVig = marketData.consensusUnderProb / 100
    const bestOverImplied = americanToImpliedProbability(marketData.bestOverPrice)
    const bestUnderImplied = americanToImpliedProbability(marketData.bestUnderPrice)

    if (query.direction === 'over') {
      pick = 'Over'
      modelProbability = overNoVig
      marketImpliedProbability = bestOverImplied
    } else if (query.direction === 'under') {
      pick = 'Under'
      modelProbability = underNoVig
      marketImpliedProbability = bestUnderImplied
    } else {
      if (overNoVig >= underNoVig) {
        pick = 'Over'
        modelProbability = overNoVig
        marketImpliedProbability = bestOverImplied
      } else {
        pick = 'Under'
        modelProbability = underNoVig
        marketImpliedProbability = bestUnderImplied
      }
    }
    edge = Math.max(0, modelProbability - marketImpliedProbability)
    confidence = 'low'
    reasons.push(`Market consensus: ${(modelProbability * 100).toFixed(1)}% probability (${marketData.booksCount} books)`)
    if (edge > 0.005) {
      reasons.push(`${(edge * 100).toFixed(1)}% edge from vig removal across ${marketData.booksCount} sportsbooks`)
    }
  } else if (!modelResult && !seasonStats) {
    // No data at all — genuinely unknown
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
