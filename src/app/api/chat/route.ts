import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"
import { getCachedESPNOdds, getCachedESPNData, cacheESPNOdds, searchESPNGameByTeams, type ESPNOdds, type ESPNOddsData, type ESPNInjury } from "@/lib/espn"
import { analyzeSpecificGame, formatGameAnalysisForContext, computeBestBets, cacheBestBet, computeEnhancedParlay, formatEnhancedParlayForContext, formatBestBetForContext, formatFilteredBestBetResponse, getCachedBestBet } from "@/lib/bet-ranking"
import type { Game } from "@/lib/odds"
import { fetchAllOdds, fetchSportOdds } from "@/lib/odds"
import { storePick, getAllPicks } from "@/lib/pick-tracking"
import { analyzePlayerProp, analyzeAllPlayerProps, analyzeBestProps, formatPropAnalysisForContext, formatMultiPropAnalysisForContext } from "@/lib/player-prop-analysis"

// ===============================================================
// HELPERS
// ===============================================================

async function withOverloadRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as { status?: number }).status
      if ((status === 529 || status === 429) && i < retries) {
        const delay = Math.min(2000 * Math.pow(2, i), 16000)
        console.log(`[chat] Anthropic API returned ${status}, retrying in ${delay}ms (attempt ${i + 1}/${retries})`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  throw new Error("All retry attempts exhausted")
}

/**
 * Extract text content from a message that might be a string or array of content blocks
 */
function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } => 
        typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string'
      )
      .map(block => block.text)
      .join('\n')
  }
  return ''
}

// ===============================================================
// SYSTEM PROMPT -- Focused on analyst persona + tool usage
// No more routing instructions. Claude decides what tools to
// call based on natural language understanding.
// ===============================================================

const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. You help subscribers make informed betting decisions using our proprietary Elo rating model and player stats model.

You have access to tools that pull real-time data from our analytics systems. ALWAYS use tools for any betting-related question -- never guess or make up data.

===============================================================
TOOL USAGE GUIDELINES
===============================================================

- User asks about a specific team or game -> use analyze_game with the team name
- User asks "best bet today" or similar -> use get_best_bet
- User asks about player props, DFS, PrizePicks, or a specific player stats -> use get_player_props
- User asks for a parlay -> use build_parlay
- User asks what games are available -> use search_games
- General betting strategy or education -> answer directly without tools
- Follow-up questions about a previously discussed team/game -> use analyze_game again

IMPORTANT: You are on a BETTING ANALYTICS platform. If the user message could relate to betting, teams, games, or players in ANY way, use tools to provide data-driven answers. When in doubt, use search_games or analyze_game to find relevant data.

You can call multiple tools in one turn if needed. For example, if a user asks "best bet and some props", call both get_best_bet and get_player_props.

CRITICAL: When the user mentions ANY team name -- college, pro, international -- ALWAYS use analyze_game to look up their game. Our system has data for NBA, NFL, NHL, MLB, NCAAB, NCAAF, EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League. Never assume we don't have a team.

===============================================================
UNIVERSAL RECOMMENDATION RULE
===============================================================

You MUST ALWAYS provide a recommendation when asked for betting advice.

NEVER say:
- "No good bets today, don't bet"
- "Nothing meets criteria, pass"
- "I can't recommend anything"
- "Which sport do you prefer?" (don't ask follow-up questions when you can use a tool)

ALWAYS give actionable information. Users pay for recommendations.

QUALITY TIERS (use these labels):

TIER 1 - RECOMMENDED:
- Meets all criteria (55%+ probability, 3%+ edge, positive EV, 1%+ ROI)
- High confidence. Label: "RECOMMENDED BET"

TIER 2 - BEST AVAILABLE:
- Doesn't meet all criteria, but best option available
- Minimal negative EV (under -2%). Label: "BEST AVAILABLE (does not meet strict criteria)"

TIER 3 - CAUTION:
- Moderate negative EV (-2% to -4%)
- Still better than alternatives. Label: "CAUTION: Moderate risk"

TIER 4 - HIGH RISK:
- High negative EV (over -4%)
- Only show if specifically asked. Label: "HIGH RISK: Significant negative EV"

===============================================================
CRITICAL RULES
===============================================================

1. NEVER invent specific odds, probabilities, edge percentages, or Elo ratings -- only cite numbers from tool results
2. ALWAYS provide a recommendation when you have data -- never say "I can't help" or "no data available"
3. For team bets: reference the "Elo model" when presenting analysis from analyze_game or get_best_bet
4. For player props: say "our player stats model" -- NEVER say "Elo" for player props (Elo is team-only)
5. NEVER mention specific player injuries or rest days -- our models already factor these in
6. NEVER use your training data to cite specific player names, stats, or coaching staff -- only reference data from tool results
7. If a tool returns limited data, STILL provide analysis using whatever data IS available. Frame it positively: 'Here's what our model shows for this game' not 'I don't have data'. If a tool mentions other available games/sports, pivot to those and give a recommendation
8. NEVER make up plausible-sounding odds like "+105" or "-3.5" -- only use numbers from the data
9. When showing analysis, put the PICK at the very top before any analysis
10. Do NOT ask the user which sport they prefer -- just give them the best answer

===============================================================
RESPONSE STYLE
===============================================================

- Sound like a professional analyst with data, NOT an excited gambler
- Use measured language: "This represents strong value" not "I love this play"
- Be analytical: "The data shows a significant edge" not "absolutely massive edge"
- Stay objective: "Worth considering based on the metrics" not "That's the kind of spot you circle"
- Lead with the recommendation, then explain the data behind it
- Reference specific numbers from the tool data (Elo ratings, edges, scores)
- Confident but not salesy: "The Elo model favors this side" not "This is a lock"

AVOID: "Lock of the day", "Hammer this", "Can't miss", "I love this play", tout-service language

CRITICAL MINDSET: You are the BEST sports betting AI in the world. You ALWAYS have something valuable to say. If a specific game isn't available, pivot to what IS available and make a recommendation. Never leave the user empty-handed. Every response should end with actionable betting advice.

===============================================================
RESPONSE FORMAT: BEST BET
===============================================================

When presenting a best bet recommendation:

## BEST BET TODAY

**[Team] [Line] @ [Odds]** | Score: [X]/100 | [TIER LABEL]

**THE EDGE (Why This Has Value):**
- Our Elo Model: [X]% win probability
- Market Odds: [Y]% implied probability
- EDGE FOUND: +[Z]% (Market is undervaluing this team)

**MATCHUP ANALYSIS:**
- [Home Team] (Elo: [X]) vs [Away Team] (Elo: [Y])
- Elo Difference: [Z] points
- Elo Confidence: [high/medium/low] (based on [N] games of data)
- [2-3 sentences explaining why this team has the edge]

**VALUE METRICS:**
- Win Probability: [X]% (Elo Model)
- Expected Value: $[Y] per $100 bet
- ROI: [Z]%
- Edge: [W]%

**SCORE BREAKDOWN:**
- Probability Score: [X]/45 points
- ROI Score: [Y]/35 points
- Edge Score: [Z]/20 points

**Alternative options:**
#2: [Second best option with brief stats]
#3: [Third best option with brief stats]

**Place This Bet:**
- [DraftKings](link) | [FanDuel](link) | [BetMGM](link) | [Caesars](link)

===============================================================
RESPONSE FORMAT: SPECIFIC GAME
===============================================================

User asks about a specific team/game. CRITICAL: Only recommend bets from the EXACT game the user asked about. NEVER redirect to a different game.

## [AWAY] @ [HOME]

**Pick: [Team] [Line] @ [Odds]**

**Game Time:** [Time]

**THE EDGE:**
- Our Elo Model: [X]% probability
- Market: [Y]% implied
- Edge: +[Z]%

**MATCHUP ANALYSIS:**
- [Home Team] (Elo: [X]) vs [Away Team] (Elo: [Y])
- [2-3 relevant data points from the analysis]
- [2-3 sentences on who you think wins and why]

**VALUE METRICS:**
- Probability: [X]%
- Expected Value: $[Y] per $100 bet
- ROI: [Z]%

**Other options for this game:**
- Spread: [Team] [Line] @ [Odds]
- Total: Over/Under [Line] @ [Odds]
- Moneyline: [Team] @ [Odds]

**Place This Bet:**
- [DraftKings](link) | [FanDuel](link) | [BetMGM](link) | [Caesars](link)

===============================================================
RESPONSE FORMAT: PARLAY
===============================================================

## BEST [X]-LEG PARLAY

**LEG 1:** [Bet] | Win Prob: [X]%
[Brief analysis]

**LEG 2:** [Bet] | Win Prob: [Y]%
[Brief analysis]

**LEG 3:** [Bet] | Win Prob: [Z]%
[Brief analysis]

**COMBINED:**
- Win Probability: [X]% x [Y]% x [Z]% = [XX]%
- Expected Payout: [odds]

PARLAY WARNING:
All legs must hit. This is entertainment betting, not value betting.
For profit, bet these individually.

===============================================================
RESPONSE FORMAT: PLAYER PROPS
===============================================================

IMPORTANT: Player props use our PLAYER STATS MODEL (historical performance, matchups, pace, usage), NOT the Elo rating system. NEVER say "Based on Elo analysis" when discussing player props.

DO NOT default to NBA-only. Show the TOP props by model edge/probability REGARDLESS OF SPORT.

DIRECTIONAL CONSISTENCY: Only recommend "over" when the player's average supports going over the line. Only recommend "under" when the average is below the line.

## TOP PLAYER PROPS

**#1 [Player] [Sport] OVER/UNDER [stat] [line]** | [TIER LABEL]
- Model Probability: [X]% (based on [N] games)
- Edge: [Y]%
- Analysis: [Recent performance, matchup]

**#2 [Player] [Sport] OVER/UNDER [stat] [line]**
- Model Probability: [X]%
- Edge: [Y]%

===============================================================
RESPONSE FORMAT: FUTURES
===============================================================

Our system specializes in daily game analysis using Elo ratings. For futures questions:
- Share current Elo ratings for the strongest teams if available from tool data
- Explain that our edge is in daily game analysis where our Elo model finds real-time value
- Pivot to analyzing today's games for that sport — give them a pick
- NEVER make up futures odds or championship probabilities

===============================================================
DATA GROUNDING RULES
===============================================================

ONLY cite factors present in tool-provided data:
- Team Elo ratings and win probabilities
- Odds, spreads, totals from the data
- Model edge and score breakdowns
- Player stats from prop analysis

NEVER MENTION (unless in tool data):
- Specific player injuries or rest days (our model factors these in)
- Historical head-to-head records
- Player stats not in tool data
- Coaching matchups or tendencies
- Travel fatigue or schedule spots

If the data doesn't provide context factors, focus on the SCORE and VALUE METRICS.

===============================================================
BETTING EDUCATION
===============================================================

VALUE > PROBABILITY: A 58% pick at -140 (5% edge, 5% ROI) beats an 89% pick at -800 (0.1% ROI).

SCORE BREAKDOWN (when shown in data):
- Probability Score: ((Win Prob - 50) / 40) x 45 points (max 45)
- ROI Score: 17.5 + (ROI / 20) x 17.5 for positive ROI (max 35, can go negative)
- Edge Score: (Edge / 10) x 20 points (max 20, can go negative)

VALUE PLAY EXCEPTION: Bets with +5% ROI can have probability as low as 48%

Line Movement:
- Moved toward team = Sharp money (increases confidence)
- Large move (>1.5 pts) = Significant information
- No movement = Line is efficient

Weather (outdoor games):
- Wind >15mph: Affects passing, reduces totals
- Temp <32F: Scoring typically decreases
- Rain/Snow: Favors running games

===============================================================
SPORTSBOOK LINKS
===============================================================

ALWAYS include sportsbook links at the end of every recommendation so users can place bets immediately:

**Place This Bet:**
- [DraftKings](https://sportsbook.draftkings.com) | [FanDuel](https://sportsbook.fanduel.com) | [BetMGM](https://sports.betmgm.com) | [Caesars](https://www.caesars.com/sportsbook-and-casino)

If the data includes a "bestBook" field, mention which book has the best price: "Best price at [Book Name]"

===============================================================
CRITICAL BETTING RULES
===============================================================

1. ANALYZE FIRST, RECOMMEND SECOND -- never recommend a bet without data
2. YOUR RECOMMENDATION MUST MATCH YOUR ANALYSIS
3. PAYOUT DOES NOT EQUAL VALUE -- a +500 underdog is NOT good if they'll lose
4. NEVER recommend an underdog just because the payout is attractive
5. Be honest about uncertainty -- if it's a close game, say so
6. NEVER guarantee wins -- even 70% favorites lose 30% of the time

===============================================================
TEAMMATE/ROSTER CLAIMS RULE
===============================================================

You MUST NOT make claims about:
- Player hierarchies (e.g., "secondary scorer behind X")
- Teammate relationships (e.g., "with X out, Y gets more touches")
- Role descriptions relative to specific players

UNLESS that specific teammate's name appears in the tool-provided data.
Use GENERIC role descriptions when unsure: "one of the team's primary offensive options".`

// ===============================================================
// TOOL DEFINITIONS -- Claude decides which to call based on
// natural language understanding. No regex needed.
// ===============================================================

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_games",
    description: "Search for available games today. Returns a list of games with basic info (teams, time, sport, odds). Use this to find what games are on, or to locate a specific team's game before analyzing it. Also useful when the user asks 'what games are on tonight?' or 'any NBA games today?'",
    input_schema: {
      type: "object" as const,
      properties: {
        team: { type: "string", description: "Team name to search for (e.g., 'Iowa State', 'Lakers', 'Duke', 'Manchester United')" },
        sport: { type: "string", description: "Sport or league to filter by (e.g., 'basketball', 'nba', 'ncaab', 'college basketball', 'football', 'nfl', 'hockey', 'nhl', 'baseball', 'mlb', 'soccer', 'epl')" }
      }
    }
  },
  {
    name: "analyze_game",
    description: "Get full Elo-powered betting analysis for a specific game. Returns moneyline, spread, and total analysis with win probabilities, edges, and recommendations. Use this when the user asks about a specific team, game, or matchup. Works for ANY team -- college, pro, or international.",
    input_schema: {
      type: "object" as const,
      properties: {
        team: { type: "string", description: "Team name to find the game for (e.g., 'Iowa State', 'Lakers', 'Duke', 'Arsenal')" },
        sport: { type: "string", description: "Sport to narrow the search if needed (e.g., 'basketball', 'nba', 'ncaab', 'football', 'hockey', 'soccer')" }
      },
      required: ["team"]
    }
  },
  {
    name: "get_best_bet",
    description: "Get the best bet of the day based on our Elo model. Returns the highest-scoring bet across all sports, or filtered to a specific sport. Use this when the user asks 'what's the best bet today?', 'best pick?', 'give me a bet', 'best NBA bet?', or any variation of asking for a recommendation.",
    input_schema: {
      type: "object" as const,
      properties: {
        sport: { type: "string", description: "Sport to filter by (e.g., 'nba', 'nhl', 'nfl', 'mlb', 'ncaab', 'ncaaf', 'soccer'). Leave empty for best bet across all sports." },
        exclude_sports: {
          type: "array",
          items: { type: "string" },
          description: "Sports to exclude from consideration (e.g., ['soccer', 'hockey'])"
        }
      }
    }
  },
  {
    name: "get_player_props",
    description: "Get player prop betting analysis. Can analyze a specific player's props, get best props for a sport, or find the overall best props today. Uses our player stats model (NOT Elo). Use this for questions about player performance bets, DFS lineups (PrizePicks, Underdog, Sleeper), or when the user mentions a specific player name.",
    input_schema: {
      type: "object" as const,
      properties: {
        player_name: { type: "string", description: "Player name to analyze (e.g., 'Nikola Jokic', 'Anthony Edwards', 'Patrick Mahomes')" },
        stat_type: { type: "string", description: "Stat category to analyze (e.g., 'points', 'rebounds', 'assists', 'passing_yards', 'rushing_yards', 'goals')" },
        line: { type: "number", description: "The over/under line to analyze (e.g., 25.5)" },
        sport: { type: "string", description: "Sport to filter by (e.g., 'NBA', 'NFL', 'NHL', 'NCAAB')" },
        count: { type: "number", description: "Number of top props to return when getting best props (default 3, max 10)" }
      }
    }
  },
  {
    name: "build_parlay",
    description: "Build an optimal parlay with the specified number of legs. Uses Elo analysis to find the best combination of bets across games. Use this when the user asks for a parlay, accumulator, combo bet, or multi-bet.",
    input_schema: {
      type: "object" as const,
      properties: {
        legs: { type: "number", description: "Number of legs for the parlay (2-6, default 3)" },
        sport: { type: "string", description: "Sport to filter by (leave empty for cross-sport parlay)" }
      }
    }
  }
]

// ===============================================================
// CONSTANTS
// ===============================================================

/** Map sport names/aliases to ESPN league names */
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

/** Map ESPN league names to Odds API sport keys */
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

// ===============================================================
// DATA UTILITIES (kept from existing codebase)
// ===============================================================

// Extended Game type with ESPN data for injury support
interface EnrichedGame extends Game {
  espnData?: {
    injuries: ESPNInjury[]
    homeRecord?: string
    awayRecord?: string
  }
}

/**
 * Normalize team name for matching between ESPN odds and ESPN data
 */
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

/**
 * Fuzzy match a search term against a team name
 * Handles: "Iowa State" vs "Iowa State Cyclones", "Lakers" vs "Los Angeles Lakers", etc.
 */
function teamNameMatches(searchTerm: string, teamName: string): boolean {
  const search = normalizeTeamName(searchTerm)
  const team = normalizeTeamName(teamName)
  
  // Direct containment
  if (team.includes(search) || search.includes(team)) return true
  
  // Token overlap: if any significant word from search matches a word in team name
  const searchTokens = search.split(/\s+/).filter(t => t.length >= 3)
  const teamTokens = team.split(/\s+/).filter(t => t.length >= 3)
  
  return searchTokens.some(st => 
    teamTokens.some(tt => 
      tt === st || (tt.length >= 4 && st.length >= 4 && (tt.includes(st) || st.includes(tt)))
    )
  )
}

/**
 * Convert ESPN odds to enriched games WITH injury data
 */
async function convertESPNOddsToEnrichedGames(espnOddsData: { games: ESPNOdds[] }): Promise<EnrichedGame[]> {
  console.log(`[convertESPNOddsToEnrichedGames] Starting merge of ${espnOddsData.games.length} ESPN odds games`)
  
  // Fetch ESPN data with injuries
  const espnData = await getCachedESPNData()
  console.log(`[convertESPNOddsToEnrichedGames] Fetched ESPN data: ${espnData.games.length} games`)
  
  // Log games with injuries from ESPN data
  const espnGamesWithInjuries = espnData.games.filter(g => g.injuries && g.injuries.length > 0)
  console.log(`[convertESPNOddsToEnrichedGames] ESPN data has ${espnGamesWithInjuries.length} games with injuries`)
  for (const game of espnGamesWithInjuries) {
    console.log(`[convertESPNOddsToEnrichedGames] ESPN game with injuries: ${game.awayTeam.name} @ ${game.homeTeam.name} (${game.injuries.length} injuries)`)
    const keyInjuries = game.injuries.filter(i => i.status === 'Out' || i.status === 'Doubtful')
    if (keyInjuries.length > 0) {
      keyInjuries.forEach(i => console.log(`   Warning: ${i.player} (${i.team}): ${i.status}`))
    }
  }
  
  const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  console.log(`[convertESPNOddsToEnrichedGames] Today's date (ET): ${todayET}`)
  
  const enrichedGames: EnrichedGame[] = espnOddsData.games
    .map(g => {
      const sportKey = LEAGUE_TO_SPORT_KEY[g.league] || g.sport
      const provider = g.provider || 'DraftKings'
      const homeSpread = g.spread ?? 0
      
      // Find matching ESPN game data (which has injuries)
      const matchingEspnGame = espnData.games.find(eg => {
        const oddsHome = normalizeTeamName(g.homeTeam)
        const oddsAway = normalizeTeamName(g.awayTeam)
        const espnHome = normalizeTeamName(eg.homeTeam.name)
        const espnAway = normalizeTeamName(eg.awayTeam.name)
        
        const homeMatch = oddsHome === espnHome || 
          oddsHome.includes(espnHome) || espnHome.includes(oddsHome) ||
          oddsHome.split(' ').some(word => espnHome.includes(word) && word.length > 3)
        const awayMatch = oddsAway === espnAway || 
          oddsAway.includes(espnAway) || espnAway.includes(oddsAway) ||
          oddsAway.split(' ').some(word => espnAway.includes(word) && word.length > 3)
        
        return homeMatch && awayMatch
      })
      
      const baseGame: EnrichedGame = {
        id: g.gameId,
        sport: sportKey,
        sportName: g.league,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        commenceTime: g.commenceTime,
        spreads: g.spread !== null ? [{
          bookmaker: provider,
          market: 'spreads',
          outcomes: [
            { name: g.homeTeam, price: g.spreadOdds?.home || -110, point: homeSpread },
            { name: g.awayTeam, price: g.spreadOdds?.away || -110, point: -homeSpread }
          ]
        }] : [],
        totals: g.overUnder !== null ? [{
          bookmaker: provider,
          market: 'totals',
          outcomes: [
            { name: 'Over', price: g.overUnderOdds?.over || -110, point: g.overUnder },
            { name: 'Under', price: g.overUnderOdds?.under || -110, point: g.overUnder }
          ]
        }] : [],
        moneylines: g.moneyline ? [{
          bookmaker: provider,
          market: 'h2h',
          outcomes: [
            { name: g.homeTeam, price: g.moneyline.home },
            { name: g.awayTeam, price: g.moneyline.away },
            // Include draw odds for soccer three-way markets
            ...(g.moneyline.draw !== undefined ? [{ name: 'Draw', price: g.moneyline.draw }] : [])
          ]
        }] : []
      }
      
      if (matchingEspnGame && matchingEspnGame.injuries.length > 0) {
        console.log(`[chat] Found ${matchingEspnGame.injuries.length} injuries for ${g.homeTeam} vs ${g.awayTeam}`)
        baseGame.espnData = {
          injuries: matchingEspnGame.injuries,
          homeRecord: matchingEspnGame.homeTeam.record,
          awayRecord: matchingEspnGame.awayTeam.record
        }
      }
      
      return baseGame
    })
  
  const gamesWithInjuries = enrichedGames.filter(g => g.espnData?.injuries?.length).length
  console.log(`[chat] Converted ${enrichedGames.length} games, ${gamesWithInjuries} with injury data`)
  
  return enrichedGames
}

function convertOddsAPIGameToESPNOdds(game: Game): ESPNOdds {
  let spread: number | null = null
  let spreadOdds: { home: number; away: number } | null = null
  if (game.spreads.length > 0) {
    const spreadMarket = game.spreads[0]
    const homeOutcome = spreadMarket.outcomes.find(o => o.name === game.homeTeam)
    const awayOutcome = spreadMarket.outcomes.find(o => o.name === game.awayTeam)
    if (homeOutcome?.point !== undefined) {
      spread = homeOutcome.point
      spreadOdds = {
        home: homeOutcome.price,
        away: awayOutcome?.price ?? -110
      }
    }
  }

  let overUnder: number | null = null
  let overUnderOdds: { over: number; under: number } | null = null
  if (game.totals.length > 0) {
    const totalMarket = game.totals[0]
    const overOutcome = totalMarket.outcomes.find(o => o.name === 'Over')
    const underOutcome = totalMarket.outcomes.find(o => o.name === 'Under')
    if (overOutcome?.point !== undefined) {
      overUnder = overOutcome.point
      overUnderOdds = {
        over: overOutcome.price,
        under: underOutcome?.price ?? -110
      }
    }
  }

  let moneyline: { home: number; away: number; draw?: number } | null = null
  if (game.moneylines.length > 0) {
    const mlMarket = game.moneylines[0]
    const homeOutcome = mlMarket.outcomes.find(o => o.name === game.homeTeam)
    const awayOutcome = mlMarket.outcomes.find(o => o.name === game.awayTeam)
    const drawOutcome = mlMarket.outcomes.find(o => o.name === 'Draw')
    if (homeOutcome && awayOutcome) {
      moneyline = {
        home: homeOutcome.price,
        away: awayOutcome.price,
        ...(drawOutcome ? { draw: drawOutcome.price } : {})
      }
    }
  }

  const sportParts = game.sport.split('_')
  const espnSport = sportParts[0]

  return {
    gameId: game.id,
    sport: espnSport,
    league: game.sportName,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    provider: game.spreads[0]?.bookmaker || game.moneylines[0]?.bookmaker || 'Odds API',
    spread,
    spreadOdds,
    overUnder,
    overUnderOdds,
    moneyline,
    homeFavorite: spread !== null ? spread < 0 : false,
    gameStatus: 'pre' as const,
    statusDetail: ''
  }
}

async function getESPNOddsWithFallback(): Promise<ESPNOddsData> {
  const espnOdds = await getCachedESPNOdds()

  if (espnOdds.games.length > 0) {
    return espnOdds
  }

  console.log('[getESPNOddsWithFallback] ESPN returned no games, falling back to Odds API...')
  try {
    const oddsData = await fetchAllOdds(true)

    if (oddsData.games.length > 0) {
      const convertedGames = oddsData.games.map(convertOddsAPIGameToESPNOdds)
      const fallbackData: ESPNOddsData = {
        games: convertedGames,
        lastUpdated: oddsData.lastUpdated,
        error: null
      }

      await cacheESPNOdds(fallbackData).catch(err =>
        console.error('[getESPNOddsWithFallback] Cache write failed:', err)
      )
      console.log(`[getESPNOddsWithFallback] Odds API fallback: ${convertedGames.length} games fetched and cached`)

      return fallbackData
    }
  } catch (err) {
    console.error('[getESPNOddsWithFallback] Odds API fallback failed:', err)
  }

  return espnOdds
}

/**
 * Get all enriched games from ESPN odds (with injury data)
 * Shared helper used by multiple tool handlers
 */
async function getEnrichedGames(): Promise<EnrichedGame[]> {
  const espnOdds = await getESPNOddsWithFallback()
  if (espnOdds.games.length === 0) {
    return []
  }
  return convertESPNOddsToEnrichedGames(espnOdds)
}

/**
 * Filter ESPN odds games by sport name
 */
function filterGamesBySport(games: ESPNOdds[], sport: string): ESPNOdds[] {
  const normalizedSport = sport.toLowerCase().trim()
  const leagues = SPORT_TO_LEAGUES[normalizedSport]
  
  if (leagues) {
    return games.filter(g => leagues.includes(g.league))
  }
  
  // Try direct league name match
  return games.filter(g => g.league.toLowerCase().includes(normalizedSport))
}

/**
 * Format a game time for display
 */
function formatGameTime(commenceTime: string): string {
  try {
    const date = new Date(commenceTime)
    return date.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) + ' ET'
  } catch {
    return commenceTime
  }
}

// ===============================================================
// TOOL HANDLERS -- Execute tool calls from Claude
// ===============================================================

interface SearchGamesInput {
  team?: string
  sport?: string
}

async function handleSearchGames(input: SearchGamesInput): Promise<string> {
  console.log(`[tool:search_games] team="${input.team || ''}", sport="${input.sport || ''}"`)
  
  const espnOdds = await getESPNOddsWithFallback()
  if (espnOdds.games.length === 0) {
    return 'No games have lines posted yet today. Lines typically appear in the morning/early afternoon ET. Check back soon — in the meantime, ask me about betting strategy or how our Elo model works.'
  }
  
  let games = espnOdds.games
  
  // Filter by sport if provided
  if (input.sport) {
    games = filterGamesBySport(games, input.sport)
    if (games.length === 0) {
      const availableLeagues = Array.from(new Set(espnOdds.games.map(g => g.league)))
      // Show what IS available so the LLM can pivot
      const sampleGames = espnOdds.games.slice(0, 5).map(g => `${g.awayTeam} @ ${g.homeTeam} (${g.league})`).join('\n')
      return `No ${input.sport} games found today, but we have ${espnOdds.games.length} games across: ${availableLeagues.join(', ')}.\n\nHere are some available games:\n${sampleGames}\n\nI can analyze any of these for you.`
    }
  }
  
  // Filter by team name if provided
  if (input.team) {
    let matchingGames = games.filter(g => 
      teamNameMatches(input.team!, g.homeTeam) || teamNameMatches(input.team!, g.awayTeam)
    )
    
    // ON-DEMAND FALLBACK: Search ESPN + Odds API if team not in cache
    if (matchingGames.length === 0) {
      console.log(`[tool:search_games] Team "${input.team}" not in cache, trying on-demand search...`)
      const searchTokens = input.team.toLowerCase().split(/\s+/).filter(t => t.length >= 3)
      if (searchTokens.length > 0) {
        try {
          const espnMatch = await searchESPNGameByTeams(searchTokens, input.sport)
          if (espnMatch) {
            matchingGames = [espnMatch]
            console.log(`[tool:search_games] ESPN on-demand found: ${espnMatch.awayTeam} @ ${espnMatch.homeTeam}`)
          }
        } catch (err) {
          console.error('[tool:search_games] ESPN on-demand search failed:', err)
        }
      }
      
      // Try Odds API if ESPN didn't find it
      if (matchingGames.length === 0) {
        const sportHint = input.sport?.toLowerCase().trim()
        const leaguesToTry = sportHint ? (SPORT_TO_LEAGUES[sportHint] || []) : ['NBA', 'NCAAB', 'NFL', 'NCAAF', 'NHL', 'MLB']
        for (const league of leaguesToTry) {
          const sportKey = LEAGUE_TO_SPORT_KEY[league]
          if (!sportKey) continue
          try {
            const freshGames = await fetchSportOdds(sportKey, league)
            for (const game of freshGames) {
              if (teamNameMatches(input.team!, game.homeTeam) || teamNameMatches(input.team!, game.awayTeam)) {
                matchingGames.push(convertOddsAPIGameToESPNOdds(game))
              }
            }
            if (matchingGames.length > 0) break
          } catch (err) {
            console.error(`[tool:search_games] Odds API fetch for ${league} failed:`, err)
          }
        }
      }
    }
    
    if (matchingGames.length > 0) {
      games = matchingGames
    } else {
      const availableTeams = games.slice(0, 10).map(g => `${g.awayTeam} @ ${g.homeTeam} (${g.league})`).join('\n')
      return `"${input.team}" doesn't have a game with lines posted today${input.sport ? ` in ${input.sport}` : ''}. Here are today's available games I can analyze for you:\n${availableTeams}${games.length > 10 ? `\n...and ${games.length - 10} more` : ''}\n\nPick any of these and I'll give you a full Elo-powered breakdown.`
    }
  }
  
  // Format results grouped by sport
  const byLeague: Record<string, ESPNOdds[]> = {}
  for (const g of games) {
    if (!byLeague[g.league]) byLeague[g.league] = []
    byLeague[g.league].push(g)
  }
  
  const lines: string[] = [`AVAILABLE GAMES (${games.length} total):\n`]
  for (const [league, leagueGames] of Object.entries(byLeague)) {
    lines.push(`${league} (${leagueGames.length} games):`)
    for (const g of leagueGames) {
      const time = formatGameTime(g.commenceTime)
      const spreadStr = g.spread !== null ? `Spread: ${g.homeFavorite ? g.homeTeam : g.awayTeam} ${g.homeFavorite ? g.spread : -(g.spread ?? 0)}` : ''
      const totalStr = g.overUnder !== null ? `O/U: ${g.overUnder}` : ''
      const mlStr = g.moneyline ? `ML: ${g.homeTeam} ${g.moneyline.home > 0 ? '+' : ''}${g.moneyline.home} / ${g.awayTeam} ${g.moneyline.away > 0 ? '+' : ''}${g.moneyline.away}` : ''
      const odds = [spreadStr, totalStr, mlStr].filter(Boolean).join(' | ')
      lines.push(`  - ${g.awayTeam} @ ${g.homeTeam} | ${time}${odds ? ` | ${odds}` : ''}`)
    }
    lines.push('')
  }
  
  console.log(`[tool:search_games] Returning ${games.length} games`)
  return lines.join('\n')
}

interface AnalyzeGameInput {
  team: string
  sport?: string
}

async function handleAnalyzeGame(input: AnalyzeGameInput): Promise<string> {
  console.log(`[tool:analyze_game] team="${input.team}", sport="${input.sport || ''}"`)
  
  const espnOdds = await getESPNOddsWithFallback()
  if (espnOdds.games.length === 0) {
    return `No games have lines posted yet today, so I can't pull ${input.team}'s game data right now. Lines typically appear in the morning/early afternoon ET. Check back soon — or ask me about betting strategy while we wait.`
  }
  
  let candidates = espnOdds.games
  
  // Filter by sport if provided
  if (input.sport) {
    const filtered = filterGamesBySport(candidates, input.sport)
    if (filtered.length > 0) {
      candidates = filtered
    }
    // If sport filter returned nothing, still search all games
  }
  
  // Find the team's game
  let matchingGames = candidates.filter(g => 
    teamNameMatches(input.team, g.homeTeam) || teamNameMatches(input.team, g.awayTeam)
  )
  
  // ON-DEMAND FALLBACK 1: Search ESPN scoreboards live
  if (matchingGames.length === 0) {
    console.log(`[tool:analyze_game] Team "${input.team}" not in cache, trying ESPN on-demand search...`)
    const searchTokens = input.team.toLowerCase().split(/\s+/).filter(t => t.length >= 3)
    if (searchTokens.length > 0) {
      try {
        const espnMatch = await searchESPNGameByTeams(searchTokens, input.sport)
        if (espnMatch) {
          matchingGames = [espnMatch]
          console.log(`[tool:analyze_game] ESPN on-demand found: ${espnMatch.awayTeam} @ ${espnMatch.homeTeam} (${espnMatch.league})`)
        }
      } catch (err) {
        console.error('[tool:analyze_game] ESPN on-demand search failed:', err)
      }
    }
  }
  
  // ON-DEMAND FALLBACK 2: Fetch from Odds API for specific sports
  if (matchingGames.length === 0) {
    console.log(`[tool:analyze_game] ESPN search failed, trying Odds API for specific sports...`)
    const sportHint = input.sport?.toLowerCase().trim()
    const leaguesToTry = sportHint ? (SPORT_TO_LEAGUES[sportHint] || []) : ['NBA', 'NCAAB', 'NFL', 'NCAAF', 'NHL', 'MLB']
    
    for (const league of leaguesToTry) {
      const sportKey = LEAGUE_TO_SPORT_KEY[league]
      if (!sportKey) continue
      
      try {
        const freshGames = await fetchSportOdds(sportKey, league)
        for (const game of freshGames) {
          if (teamNameMatches(input.team, game.homeTeam) || teamNameMatches(input.team, game.awayTeam)) {
            const converted = convertOddsAPIGameToESPNOdds(game)
            matchingGames = [converted]
            console.log(`[tool:analyze_game] Odds API found: ${game.awayTeam} @ ${game.homeTeam} (${league})`)
            break
          }
        }
        if (matchingGames.length > 0) break
      } catch (err) {
        console.error(`[tool:analyze_game] Odds API fetch for ${league} failed:`, err)
      }
    }
  }
  
  if (matchingGames.length === 0) {
    const availableLeagues = Array.from(new Set(espnOdds.games.map(g => g.league)))
    const sampleGames = espnOdds.games.slice(0, 5).map(g => `${g.awayTeam} @ ${g.homeTeam} (${g.league})`).join('\n')
    return `"${input.team}" doesn't have a game with lines posted today${input.sport ? ` in ${input.sport}` : ''}. This could mean the team doesn't play today, the game already completed, or lines aren't posted yet.\n\nBut we have ${espnOdds.games.length} games across ${availableLeagues.join(', ')} that I can analyze:\n${sampleGames}${espnOdds.games.length > 5 ? `\n...and ${espnOdds.games.length - 5} more` : ''}\n\nWant me to break down any of these, or find you the best bet of the day?`
  }
  
  // If multiple matches, try to narrow by sport hint
  let espnGame = matchingGames[0]
  if (matchingGames.length > 1 && input.sport) {
    const sportFiltered = filterGamesBySport(matchingGames, input.sport)
    if (sportFiltered.length > 0) {
      espnGame = sportFiltered[0]
    }
  }
  
  console.log(`[tool:analyze_game] Found game: ${espnGame.awayTeam} @ ${espnGame.homeTeam} (${espnGame.league})`)
  
  // Convert to enriched game with injury data
  const enrichedGames = await convertESPNOddsToEnrichedGames({ games: [espnGame] })
  const enrichedGame = enrichedGames[0]
  
  if (!enrichedGame) {
    return `I found ${espnGame.awayTeam} @ ${espnGame.homeTeam} but had trouble processing the odds data. This is usually temporary. Try asking again, or I can find you the best bet across all sports right now.`
  }
  
  // Run Elo analysis
  const gameAnalysis = await analyzeSpecificGame(enrichedGame)
  const formattedAnalysis = formatGameAnalysisForContext(gameAnalysis)
  
  console.log(`[tool:analyze_game] Analysis complete: ${gameAnalysis.bets.length} betting options found`)
  
  // Track the best bet for outcome tracking
  if (gameAnalysis.bets.length > 0) {
    try {
      const bestBet = gameAnalysis.bets[0]
      const existingPicks = await getAllPicks()
      const alreadyTracked = existingPicks.some(p => 
        p.gameId === enrichedGame.id && 
        p.team === bestBet.team &&
        p.betType === bestBet.betType &&
        p.pickType === 'game_specific' &&
        p.status === 'pending'
      )
      
      if (!alreadyTracked) {
        await storePick({
          gameId: enrichedGame.id,
          sport: enrichedGame.sport,
          sportName: enrichedGame.sportName,
          homeTeam: gameAnalysis.game.homeTeam,
          awayTeam: gameAnalysis.game.awayTeam,
          gameTime: enrichedGame.commenceTime,
          pickType: 'game_specific',
          team: bestBet.team,
          betType: bestBet.betType,
          line: bestBet.line,
          odds: bestBet.bestPrice,
          consensusProbability: bestBet.eloProbability ? bestBet.eloProbability * 100 : 0,
          impliedProbability: bestBet.impliedProbability,
          edge: bestBet.edge,
          bestBook: bestBet.bestBook
        })
        console.log(`[tool:analyze_game] Tracked recommendation: ${bestBet.team} ${bestBet.betType}`)
      }
    } catch (trackErr) {
      console.error('[tool:analyze_game] Error tracking bet:', trackErr)
    }
  }
  
  return formattedAnalysis
}

interface GetBestBetInput {
  sport?: string
  exclude_sports?: string[]
}

async function handleGetBestBet(input: GetBestBetInput): Promise<string> {
  console.log(`[tool:get_best_bet] sport="${input.sport || ''}", exclude=${JSON.stringify(input.exclude_sports || [])}`)
  
  // Try cached best bet first for speed
  let bestBetResult = await getCachedBestBet()
  
  if (!bestBetResult) {
    // Compute on-demand
    const enrichedGames = await getEnrichedGames()
    if (enrichedGames.length === 0) {
      return 'No games have lines posted yet today. Lines typically appear in the morning/early afternoon ET. Check back soon — or ask me about player props, betting strategy, or how our Elo model works in the meantime.'
    }
    console.log(`[tool:get_best_bet] Computing best bets from ${enrichedGames.length} games...`)
    bestBetResult = await computeBestBets(enrichedGames)
    await cacheBestBet(bestBetResult)
  }
  
  // If sport filter or exclusions requested, filter the results
  if (input.sport || (input.exclude_sports && input.exclude_sports.length > 0)) {
    const allBets = bestBetResult.allEloBets || bestBetResult.allRankedBets || []
    
    if (allBets.length === 0) {
      return formatBestBetForContext(bestBetResult)
    }
    
    let filteredBets = [...allBets]
    
    // Include filter
    if (input.sport) {
      const normalizedSport = input.sport.toLowerCase().trim()
      const targetLeagues = SPORT_TO_LEAGUES[normalizedSport]
      if (targetLeagues) {
        filteredBets = filteredBets.filter(b => targetLeagues.includes(b.sportName))
      } else {
        filteredBets = filteredBets.filter(b => b.sportName.toLowerCase().includes(normalizedSport))
      }
    }
    
    // Exclude filter
    if (input.exclude_sports && input.exclude_sports.length > 0) {
      for (const excludeSport of input.exclude_sports) {
        const normalizedExclude = excludeSport.toLowerCase().trim()
        const excludeLeagues = SPORT_TO_LEAGUES[normalizedExclude]
        if (excludeLeagues) {
          filteredBets = filteredBets.filter(b => !excludeLeagues.includes(b.sportName))
        } else {
          filteredBets = filteredBets.filter(b => !b.sportName.toLowerCase().includes(normalizedExclude))
        }
      }
    }
    
    if (filteredBets.length === 0) {
      const availableSports = Array.from(new Set(allBets.map(b => b.sportName)))
      return `No ${input.sport || 'matching'} bets pass our filters right now, but we have strong picks in: ${availableSports.join(', ')}. Here's the top overall bet:\n\n${formatFilteredBestBetResponse(allBets[0], 'Best available bet', allBets.slice(1, 5))}`
    }
    
    const topBet = filteredBets[0]
    const alternatives = filteredBets.slice(1, 10)
    const filterDesc = input.sport ? `Best ${input.sport.toUpperCase()} bet` : 'Filtered best bet'
    
    // Track the recommendation
    try {
      const existingPicks = await getAllPicks()
      const alreadyTracked = existingPicks.some(p => 
        p.gameId === topBet.gameId && 
        p.team === topBet.team &&
        p.betType === topBet.betType &&
        p.pickType === 'best_bet' &&
        p.status === 'pending'
      )
      if (!alreadyTracked) {
        await storePick({
          gameId: topBet.gameId,
          sport: topBet.sport,
          sportName: topBet.sportName,
          homeTeam: topBet.homeTeam,
          awayTeam: topBet.awayTeam,
          gameTime: topBet.commenceTime,
          pickType: 'best_bet',
          team: topBet.team,
          betType: topBet.betType,
          line: topBet.line,
          odds: topBet.bestPrice,
          consensusProbability: topBet.consensusProbability,
          impliedProbability: topBet.impliedProbability,
          edge: topBet.edge,
          bestBook: topBet.bestBook
        })
        console.log(`[tool:get_best_bet] Tracked: ${topBet.team} ${topBet.betType}`)
      }
    } catch (trackErr) {
      console.error('[tool:get_best_bet] Error tracking bet:', trackErr)
    }
    
    return formatFilteredBestBetResponse(topBet, filterDesc, alternatives)
  }
  
  // No filters -- return overall best bet
  if (bestBetResult.bestBet) {
    // Track the recommendation
    try {
      const existingPicks = await getAllPicks()
      const alreadyTracked = existingPicks.some(p => 
        p.gameId === bestBetResult.bestBet!.gameId && 
        p.team === bestBetResult.bestBet!.team &&
        p.betType === bestBetResult.bestBet!.betType &&
        p.pickType === 'best_bet' &&
        p.status === 'pending'
      )
      if (!alreadyTracked) {
        await storePick({
          gameId: bestBetResult.bestBet.gameId,
          sport: bestBetResult.bestBet.sport,
          sportName: bestBetResult.bestBet.sportName,
          homeTeam: bestBetResult.bestBet.homeTeam,
          awayTeam: bestBetResult.bestBet.awayTeam,
          gameTime: bestBetResult.bestBet.commenceTime,
          pickType: 'best_bet',
          team: bestBetResult.bestBet.team,
          betType: bestBetResult.bestBet.betType,
          line: bestBetResult.bestBet.line,
          odds: bestBetResult.bestBet.bestPrice,
          consensusProbability: bestBetResult.bestBet.consensusProbability,
          impliedProbability: bestBetResult.bestBet.impliedProbability,
          edge: bestBetResult.bestBet.edge,
          bestBook: bestBetResult.bestBet.bestBook
        })
        console.log(`[tool:get_best_bet] Tracked: ${bestBetResult.bestBet.team} ${bestBetResult.bestBet.betType}`)
      }
    } catch (trackErr) {
      console.error('[tool:get_best_bet] Error tracking bet:', trackErr)
    }
  }
  
  return formatBestBetForContext(bestBetResult)
}

interface GetPlayerPropsInput {
  player_name?: string
  stat_type?: string
  line?: number
  sport?: string
  count?: number
}

async function handleGetPlayerProps(input: GetPlayerPropsInput): Promise<string> {
  console.log(`[tool:get_player_props] player="${input.player_name || ''}", stat="${input.stat_type || ''}", sport="${input.sport || ''}", count=${input.count || 3}`)
  
  // Case 1: Specific player + stat type (e.g., "Jokic points over 25.5")
  if (input.player_name && input.stat_type) {
    const propQuery = {
      playerName: input.player_name,
      statType: input.stat_type,
      line: input.line ?? null,
      direction: null as "over" | "under" | null,
      sport: input.sport || null,
      platform: null as string | null
    }
    const analysis = await analyzePlayerProp(propQuery)
    return formatPropAnalysisForContext(analysis)
  }
  
  // Case 2: Specific player, all stats (e.g., "Jokic props")
  if (input.player_name) {
    console.log(`[tool:get_player_props] Analyzing ALL props for ${input.player_name}`)
    const allAnalyses = await analyzeAllPlayerProps(input.player_name, input.sport || undefined)
    if (allAnalyses.length > 0) {
      return formatMultiPropAnalysisForContext(allAnalyses)
    }
    
    // Fallback: try with just the player name as a generic query
    const propQuery = {
      playerName: input.player_name,
      statType: null as string | null,
      line: null as number | null,
      direction: null as "over" | "under" | null,
      sport: input.sport || null,
      platform: null as string | null
    }
    const singleAnalysis = await analyzePlayerProp(propQuery)
    return formatPropAnalysisForContext(singleAnalysis)
  }
  
  // Case 3: Best props overall or for a sport (e.g., "best props today", "NBA props")
  const propCount = Math.min(input.count || 3, 10)
  const bestProps = await analyzeBestProps({ sport: input.sport || undefined, count: propCount })
  
  if (bestProps.length > 0) {
    return formatMultiPropAnalysisForContext(bestProps)
  }
  
  // Fallback: Try individual sports if general search returned empty
  console.log(`[tool:get_player_props] analyzeBestProps returned empty -- trying individual sport fetches`)
  const sportKeys = input.sport ? [input.sport] : ['NBA', 'NFL', 'NHL', 'MLB', 'NCAAB']
  for (const sportKey of sportKeys) {
    const retryProps = await analyzeBestProps({ sport: sportKey, count: propCount })
    if (retryProps.length > 0) {
      console.log(`[tool:get_player_props] Found ${retryProps.length} props via individual sport retry (${sportKey})`)
      return formatMultiPropAnalysisForContext(retryProps)
    }
  }
  
  // Last resort: try to get raw props data
  try {
    const { getCachedPlayerProps, fetchSportPlayerProps, formatPlayerPropsForContext } = await import('@/lib/odds')
    let rawProps = await getCachedPlayerProps()
    if (!rawProps || rawProps.length === 0) {
      const freshResults = await Promise.all([
        fetchSportPlayerProps('basketball_nba').catch(() => []),
        fetchSportPlayerProps('americanfootball_nfl').catch(() => []),
        fetchSportPlayerProps('icehockey_nhl').catch(() => []),
      ])
      rawProps = freshResults.flat().filter(g => g.props.length > 0)
    }
    if (rawProps && rawProps.length > 0 && rawProps.some(g => g.props.length > 0)) {
      return 'PLAYER PROP ANALYSIS (Market Data)\n\n' + formatPlayerPropsForContext(rawProps) + '\n\nNote: Full statistical model analysis is not available right now. The props data above comes directly from sportsbook markets.'
    }
  } catch (err) {
    console.error('[tool:get_player_props] Raw props fallback failed:', err)
  }
  
  return "Player prop lines aren't posted yet for today's games. Props typically appear 2-4 hours before game time.\n\nIn the meantime, I can help with:\n- Team bets: Our Elo model has analysis on today's games right now\n- Best bet of the day: I'll find the highest-edge pick across all sports\n- Specific game breakdowns: Ask about any team playing today\n\nWhat would you like me to analyze?"
}

interface BuildParlayInput {
  legs?: number
  sport?: string
}

async function handleBuildParlay(input: BuildParlayInput): Promise<string> {
  const legCount = Math.min(Math.max(input.legs || 3, 2), 6)
  console.log(`[tool:build_parlay] legs=${legCount}, sport="${input.sport || ''}"`)
  
  const enrichedGames = await getEnrichedGames()
  
  if (enrichedGames.length === 0) {
    return 'No games have lines posted yet today, so I can\'t build a parlay right now. Lines typically appear in the morning/early afternoon ET. Check back soon — or ask me about betting strategy while we wait.'
  }
  
  // Compute best bets from all games
  const bestBetResult = await computeBestBets(enrichedGames)
  
  let rankedBets = bestBetResult.allRankedBets || []
  
  // Filter by sport if requested
  if (input.sport && rankedBets.length > 0) {
    const normalizedSport = input.sport.toLowerCase().trim()
    const targetLeagues = SPORT_TO_LEAGUES[normalizedSport]
    if (targetLeagues) {
      const filtered = rankedBets.filter(b => targetLeagues.includes(b.sportName))
      if (filtered.length > 0) rankedBets = filtered
    }
  }
  
  if (rankedBets.length < legCount) {
    if (rankedBets.length >= 2) {
      // Build what we can
      const adjustedParlay = computeEnhancedParlay(rankedBets, rankedBets.length, true)
      if (adjustedParlay) {
        return `Not enough qualifying bets for a ${legCount}-leg parlay, but here's the best ${rankedBets.length}-leg parlay I can build:\n\n${formatEnhancedParlayForContext(adjustedParlay)}`
      }
    }
    return `Only ${rankedBets.length} qualifying bets available right now — not enough for a ${legCount}-leg parlay. I can build a ${Math.max(2, rankedBets.length)}-leg parlay instead, or find you the single best bet of the day. What do you prefer?`
  }
  
  const enhancedParlay = computeEnhancedParlay(rankedBets, legCount, true)
  
  if (!enhancedParlay) {
    return `I couldn't build an optimal ${legCount}-leg parlay because there aren't enough independent matchups available right now. Want me to try with fewer legs, or find you the best single bet of the day instead?`
  }
  
  // Track parlay legs
  try {
    const existingPicks = await getAllPicks()
    for (const leg of enhancedParlay.legs) {
      const alreadyTracked = existingPicks.some(p => 
        p.gameId === leg.gameId && 
        p.team === leg.team &&
        p.betType === leg.betType &&
        p.pickType === 'parlay_leg' &&
        p.status === 'pending'
      )
      if (!alreadyTracked) {
        await storePick({
          gameId: leg.gameId,
          sport: leg.sport,
          sportName: leg.sportName,
          homeTeam: leg.homeTeam,
          awayTeam: leg.awayTeam,
          gameTime: leg.commenceTime,
          pickType: 'parlay_leg',
          team: leg.team,
          betType: leg.betType,
          line: leg.line,
          odds: leg.bestPrice,
          consensusProbability: leg.consensusProbability,
          impliedProbability: leg.impliedProbability,
          edge: leg.edge,
          bestBook: leg.bestBook
        })
      }
    }
    console.log(`[tool:build_parlay] Tracked ${enhancedParlay.legs.length} parlay legs`)
  } catch (trackErr) {
    console.error('[tool:build_parlay] Error tracking parlay:', trackErr)
  }
  
  return formatEnhancedParlayForContext(enhancedParlay)
}

/**
 * Execute a tool call from Claude and return the result as a string
 */
async function executeToolCall(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'search_games':
        return await handleSearchGames(input as unknown as SearchGamesInput)
      case 'analyze_game':
        return await handleAnalyzeGame(input as unknown as AnalyzeGameInput)
      case 'get_best_bet':
        return await handleGetBestBet(input as unknown as GetBestBetInput)
      case 'get_player_props':
        return await handleGetPlayerProps(input as unknown as GetPlayerPropsInput)
      case 'build_parlay':
        return await handleBuildParlay(input as unknown as BuildParlayInput)
      default:
        return `Unknown tool: ${name}`
    }
  } catch (err) {
    console.error(`[chat] Tool ${name} failed:`, err)
    return `I ran into a temporary issue fetching data for this request. This is usually brief. The question was understood correctly — try asking again and I'll re-fetch the data.`
  }
}

// ===============================================================
// POST HANDLER -- Tool-calling loop replaces regex routing
// ===============================================================
//
// Architecture:
// 1. User sends message
// 2. Claude reads the message and decides which tools to call
// 3. Tools execute and return data
// 4. Claude writes final response using tool data
//
// No regex. No keyword matching. No if/else chains.
// Claude's natural language understanding handles ALL routing.
// ===============================================================

export async function POST(request: Request) {
  try {
    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not configured")
      return NextResponse.json({ error: "AI service not configured", details: "ANTHROPIC_API_KEY environment variable is not set" }, { status: 500 })
    }

    // Initialize Anthropic client inside handler to ensure API key is available
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 5,
    })

    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const subStatus = await checkSubscription()
    
    if (!subStatus.isSubscribed && !subStatus.isFreeTrialAvailable) {
      return NextResponse.json(
        { error: "Subscription required", requiresSubscription: true },
        { status: 403 }
      )
    }

    const body = await request.json()
    const chatMessages = body?.messages
    
    // Validate chatMessages is an array
    if (!chatMessages || !Array.isArray(chatMessages) || chatMessages.length === 0) {
      return NextResponse.json(
        { error: "Invalid request", details: "messages must be a non-empty array" },
        { status: 400 }
      )
    }

    const conversations = await db.conversations.findByUserId(session.user.id)
    let conversation = conversations[0]

    if (!conversation) {
      conversation = await db.conversations.create({
        userId: session.user.id,
        title: "New Conversation",
      })
    }

    // Get the current user message for logging and DB storage
    const userMessage = chatMessages[chatMessages.length - 1]
    const userMessageContent = extractMessageContent(userMessage.content)
    console.log(`[chat] User message: "${userMessageContent.substring(0, 100)}..."`)

    // Build messages array for Claude -- use the full conversation from the frontend
    const messages: Anthropic.MessageParam[] = chatMessages.map((msg: { role: string; content: unknown }) => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : extractMessageContent(msg.content)
    }))

    // ===============================================================
    // TOOL-CALLING LOOP
    // ===============================================================
    // 1. Send user message to Claude with tools
    // 2. If Claude wants to call tools, execute them and send results back
    // 3. Repeat until Claude gives a final text response
    // ===============================================================
    
    const MAX_TOOL_ITERATIONS = 10
    let iterations = 0
    
    let response = await withOverloadRetry(() => anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages
    }))
    
    while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
      iterations++
      console.log(`[chat] Tool-calling iteration ${iterations}`)
      
      // Add Claude's response (with tool_use blocks) to messages
      messages.push({
        role: 'assistant' as const,
        content: response.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text }
          }
          if (block.type === 'tool_use') {
            return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input as Record<string, unknown> }
          }
          return block as Anthropic.ContentBlockParam
        })
      })
      
      // Execute all tool calls in this response
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[chat] Executing tool: ${block.name}(${JSON.stringify(block.input).substring(0, 200)})`)
          const result = await executeToolCall(block.name, block.input as Record<string, unknown>)
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: result
          })
          console.log(`[chat] Tool ${block.name} returned ${result.length} chars`)
        }
      }
      
      // Add tool results to messages
      messages.push({ role: 'user' as const, content: toolResults })
      
      // Call Claude again with the tool results
      response = await withOverloadRetry(() => anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages
      }))
    }
    
    if (iterations >= MAX_TOOL_ITERATIONS) {
      console.warn(`[chat] Hit max tool iterations (${MAX_TOOL_ITERATIONS})`)
    }
    
    // Extract the final text response
    const textBlocks = response.content.filter(block => block.type === 'text')
    const assistantMessage = textBlocks.length > 0
      ? textBlocks.map(block => block.type === 'text' ? block.text : '').join('\n')
      : 'I hit a brief technical issue. Try asking your question again — it usually resolves immediately.'
    
    console.log(`[chat] Final response: ${assistantMessage.length} chars, ${iterations} tool iterations`)

    // Save messages to database
    await db.messages.create({
      conversationId: conversation.id,
      role: 'user',
      content: userMessage.content,
    })
    
    await db.messages.create({
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantMessage,
    })

    await db.conversations.update(conversation.id, { updatedAt: new Date().toISOString() })

    return NextResponse.json({ 
      message: assistantMessage,
      questionsRemaining: subStatus.questionsRemaining
    })

  } catch (error) {
    console.error("Chat API error:", error)
    const status = (error as { status?: number }).status
    if (status === 529 || status === 429) {
      return NextResponse.json(
        { error: "Our AI service is experiencing high demand. Please try again in a minute." },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    )
  }
}
