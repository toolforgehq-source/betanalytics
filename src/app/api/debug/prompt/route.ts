/**
 * Debug Endpoint: Show Exact System Prompt and Combined Data
 * 
 * This endpoint returns the EXACT data that would be sent to Claude,
 * including the full system prompt and all combined sports data.
 * 
 * Used for verification that:
 * 1. All APIs are being called correctly
 * 2. Data is being combined properly
 * 3. System prompt includes all required instructions
 * 4. Roster data is current and accurate
 */

import { NextResponse } from "next/server"
import { getCurrentOdds } from "@/lib/odds"
import { getCachedESPNData, fetchAllESPNData } from "@/lib/espn"
import { formatCombinedDataForContext, getCombinedSportsData } from "@/lib/combined-data"

export const dynamic = "force-dynamic"

// The exact system prompt used in chat (copied from chat/route.ts)
const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. You help users make informed betting decisions using multi-model statistical analysis.

CRITICAL: You have access to REAL-TIME sports data from TWO sources:
1. The Odds API - Current betting odds, spreads, totals, moneylines
2. ESPN API - Current injuries, starting lineups, team records, roster information

When users ask for betting recommendations:

1. **Use actual games happening today** - Reference real matchups with current odds from the data provided
2. **Give concrete recommendations** - Specific teams, spreads, totals with actual odds
3. **Show sportsbook comparisons** - Tell users where to find best odds (DraftKings, FanDuel, BetMGM)
4. **Include timestamp** - Always show when odds were last updated
5. **Multi-model analysis** - Analyze from multiple angles (rest, injuries, matchups, trends, sharp money)

RESPONSE FORMAT FOR PICKS:

## Today's Best Value Play

**[Team] [Spread] vs [Opponent]**
**Best Odds:** [Sportsbook] [Spread] ([Odds])
**Confidence:** [Level] ([X]/4 models agree)
**Game Time:** [Time] ET

---

### Why This Is The Play:

**Edge #1: [Category]**
- [Specific data point]
- [Supporting stat]

**Edge #2: [Category]**
- [Specific data point]
- [Supporting stat]

**Edge #3: [Category]**
- [Specific data point]
- [Supporting stat]

---

### Statistical Breakdown:

**Model Consensus:**
[Show which models agree/disagree]

---

### Bet Recommendation:

**Wager:** [Units] on [Bet]
**Best Odds:** [Sportsbook] [Line] ([Odds])
**Risk Level:** [Low/Medium/High]

---

### What You're Learning:

[Educational content explaining the concept behind this pick]

---

CRITICAL RULES:
1. ALWAYS use the real odds data provided below - never make up odds
2. ALWAYS provide educational explanations - teach users WHY bets work
3. ALWAYS mention model consensus (e.g., "4/4 models agree")
4. ALWAYS include risk assessment and confidence levels
5. Format responses with clear sections using markdown headers (##, ###)
6. Include emojis for visual appeal
7. Be conversational but professional
8. NEVER guarantee wins - always include disclaimers about risk
9. NEVER say "I don't have access to real-time data" - you DO have real odds data
10. If no games are available, explain when games typically occur and offer general advice

ABSOLUTE PLAYER/ROSTER RULES - VIOLATION IS UNACCEPTABLE:
11. ONLY mention players whose names appear in the ESPN ROSTER DATA provided below
12. NEVER use your training data to cite player names, stats, or coaching staff
13. If a player's name is NOT in the roster data, DO NOT mention them by name
14. If you're unsure whether a player is on a team, say "I cannot verify current roster"
15. NEVER cite specific player statistics (yards, catches, etc.) unless provided in the data
16. NEVER mention coaching staff ATS records or tendencies - this data is not provided
17. Focus analysis on TEAM-LEVEL factors: odds, spreads, records, injuries listed
18. If roster data is missing for a game, acknowledge this and avoid player-specific analysis

EXAMPLE EDGES TO ANALYZE:
- Rest advantages (back-to-backs, days rest)
- Matchup specific stats (offense vs defense rankings)
- Injury impacts
- Historical head-to-head
- Line movement and sharp money
- Weather for outdoor sports
- Referee tendencies
- Recent form and trends

You can handle requests for:
- Individual game picks
- Parlays (PrizePicks, DraftKings, FanDuel, Underdog)
- Player props
- Hedge calculations
- Arbitrage opportunities
- General betting advice

Always be helpful, educational, and emphasize responsible gambling.`

export async function GET() {
  const startTime = Date.now()
  
  try {
    // Fetch all data sources
    const [oddsData, espnData, combinedData, formattedContext] = await Promise.all([
      getCurrentOdds(),
      getCachedESPNData(),
      getCombinedSportsData(),
      formatCombinedDataForContext()
    ])
    
    const fetchTime = Date.now() - startTime
    
    // Build the full system prompt that would be sent to Claude
    const fullSystemPrompt = `${SYSTEM_PROMPT}

${formattedContext}

IMPORTANT: Use this REAL-TIME data to answer the user's question. 
- Reference actual games and odds from The Odds API
- Check ESPN injury data before making recommendations
- Verify starting lineups (especially NHL goalies) from ESPN data
- Never cite players who may have been traded - use current roster data`

    // Extract roster data for verification
    const rostersIncluded: Array<{
      team: string
      sport: string
      qbs: string[]
      keyPlayers: string[]
    }> = []
    
    for (const game of espnData.games) {
      if (game.homeTeam.roster) {
        rostersIncluded.push({
          team: game.homeTeam.name,
          sport: game.league,
          qbs: game.homeTeam.roster.keyPlayers.qbs,
          keyPlayers: [
            ...game.homeTeam.roster.keyPlayers.qbs,
            ...game.homeTeam.roster.keyPlayers.rbs.slice(0, 3),
            ...game.homeTeam.roster.keyPlayers.wrs.slice(0, 5),
            ...(game.homeTeam.roster.keyPlayers.goalies || [])
          ]
        })
      }
      if (game.awayTeam.roster) {
        rostersIncluded.push({
          team: game.awayTeam.name,
          sport: game.league,
          qbs: game.awayTeam.roster.keyPlayers.qbs,
          keyPlayers: [
            ...game.awayTeam.roster.keyPlayers.qbs,
            ...game.awayTeam.roster.keyPlayers.rbs.slice(0, 3),
            ...game.awayTeam.roster.keyPlayers.wrs.slice(0, 5),
            ...(game.awayTeam.roster.keyPlayers.goalies || [])
          ]
        })
      }
    }
    
    // Count games by sport
    const gamesBySport: Record<string, number> = {}
    for (const game of oddsData.games) {
      gamesBySport[game.sportName] = (gamesBySport[game.sportName] || 0) + 1
    }
    
    // Count ESPN games by league
    const espnGamesByLeague: Record<string, number> = {}
    for (const game of espnData.games) {
      espnGamesByLeague[game.league] = (espnGamesByLeague[game.league] || 0) + 1
    }
    
    // Find games with combined data (both odds and ESPN)
    const gamesWithBothSources = combinedData.games.filter(g => g.espnData).length
    
    // Sample combined game data (first game with ESPN data)
    const sampleCombinedGame = combinedData.games.find(g => g.espnData)
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      fetchTimeMs: fetchTime,
      
      // API Status
      apiStatus: {
        oddsApi: {
          success: !oddsData.isStale,
          lastUpdated: oddsData.lastUpdated,
          totalGames: oddsData.games.length,
          gamesBySport,
          isStale: oddsData.isStale
        },
        espnApi: {
          success: !espnData.error,
          lastUpdated: espnData.lastUpdated,
          totalGames: espnData.games.length,
          gamesByLeague: espnGamesByLeague,
          error: espnData.error,
          rostersIncluded: rostersIncluded.length
        }
      },
      
      // Data Combination Stats
      dataCombination: {
        totalOddsGames: oddsData.games.length,
        totalEspnGames: espnData.games.length,
        gamesWithBothSources,
        matchRate: oddsData.games.length > 0 
          ? `${Math.round((gamesWithBothSources / oddsData.games.length) * 100)}%`
          : '0%'
      },
      
      // Sample Combined Game (for verification)
      sampleCombinedGame: sampleCombinedGame ? {
        id: sampleCombinedGame.id,
        homeTeam: sampleCombinedGame.homeTeam,
        awayTeam: sampleCombinedGame.awayTeam,
        sportName: sampleCombinedGame.sportName,
        commenceTime: sampleCombinedGame.commenceTime,
        odds: {
          spreads: sampleCombinedGame.spreads?.slice(0, 2),
          totals: sampleCombinedGame.totals?.slice(0, 2),
          moneylines: sampleCombinedGame.moneylines?.slice(0, 2)
        },
        espnData: sampleCombinedGame.espnData
      } : null,
      
      // Rosters Included (for verification)
      rostersIncluded: rostersIncluded.slice(0, 10), // First 10 teams
      
      // System Prompt Info
      systemPrompt: {
        basePromptLength: SYSTEM_PROMPT.length,
        fullPromptLength: fullSystemPrompt.length,
        contextDataLength: formattedContext.length,
        first500Chars: fullSystemPrompt.substring(0, 500),
        last500Chars: fullSystemPrompt.substring(fullSystemPrompt.length - 500),
        includesRosterInstructions: fullSystemPrompt.includes('ONLY mention players whose names appear'),
        includesOddsData: fullSystemPrompt.includes('BETTING ODDS'),
        includesEspnData: fullSystemPrompt.includes('ESPN'),
        includesRosterData: fullSystemPrompt.includes('CURRENT ROSTER')
      },
      
      // Full Context (for detailed inspection)
      fullContext: formattedContext,
      
      // Full System Prompt (for detailed inspection)
      fullSystemPrompt: fullSystemPrompt
    })
    
  } catch (error) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}

// POST endpoint to force refresh all data
export async function POST() {
  const startTime = Date.now()
  
  try {
    // Force fetch fresh ESPN data (bypasses cache)
    const freshEspnData = await fetchAllESPNData()
    
    const fetchTime = Date.now() - startTime
    
    return NextResponse.json({
      success: true,
      message: 'Forced refresh of all ESPN data',
      fetchTimeMs: fetchTime,
      espnGamesCount: freshEspnData.games.length,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
