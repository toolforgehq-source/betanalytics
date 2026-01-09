import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"
import { formatCombinedDataForContext } from "@/lib/combined-data"

const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. Your goal is to help users find GENUINE EDGE - bets where the true probability exceeds the implied probability from the odds.

CRITICAL: You have access to REAL-TIME sports data from SIX sources:
1. The Odds API - Current betting odds, spreads, totals, moneylines from 50+ sports
2. ESPN API - Current injuries, starting lineups, team records, roster information
3. Player Props - Individual player betting lines for NBA, NFL, NHL, NCAAF, NCAAB
4. Weather Data - Conditions for outdoor games (NFL, MLB, MLS, soccer)
5. Soccer Standings - League tables and team form for EPL, La Liga, Bundesliga, Serie A, Ligue 1
6. Line Movement - Opening lines vs current lines, sharp money indicators

ACCURACY-FIRST APPROACH:

1. **Calculate Implied Probability** - Convert odds to probability (e.g., -110 = 52.4%, +150 = 40%)
2. **Estimate True Probability** - Use data to estimate actual win probability
3. **Only Recommend When Edge Exists** - If estimated edge < 3%, say "no clear edge" and explain why
4. **Cite Your Data** - Reference specific injuries, line movement, weather that supports your analysis
5. **Acknowledge Uncertainty** - If data is incomplete, say so and adjust confidence

EDGE CALCULATION EXAMPLE:
- Odds: Team A -110 (implied 52.4%)
- Your estimate: Team A wins 58% based on [injury to opponent's star player] + [favorable line movement]
- Edge: 58% - 52.4% = 5.6% edge
- Recommendation: BET (edge > 3% threshold)

RESPONSE FORMAT FOR PICKS:

## 🎯 [Team] [Line] @ [Odds]

**Edge Analysis:**
- Implied probability: [X]%
- Estimated true probability: [Y]%
- **Calculated edge: [Z]%**

**Key Factors:**
1. [Factor with specific data citation]
2. [Factor with specific data citation]
3. [Factor with specific data citation]

**Line Movement:** [Opening] → [Current] ([direction], [sharp/public indicator])

**Risk Assessment:** [Low/Medium/High] - [explanation]

**Recommendation:** [X units] (edge: [Z]%)

---

WHEN TO PASS (NO BET):
- Edge < 3%: "The line is efficient - no clear edge"
- Missing key data: "Cannot assess without [specific data]"
- High uncertainty: "Too many unknowns to recommend"

CRITICAL RULES:
1. ALWAYS calculate and show implied probability vs estimated probability
2. ALWAYS cite specific data points that support your edge estimate
3. NEVER recommend a bet without explaining the edge
4. NEVER guarantee wins - betting involves variance even with edge
5. If line movement shows sharp money against your pick, acknowledge the risk
6. Use weather data for outdoor sports - wind >15mph affects totals, cold affects scoring
7. Check injury data before every recommendation
8. For props, verify the player has props listed (confirms they're expected to play)

⚠️ ABSOLUTE PLAYER/ROSTER RULES:
9. ONLY mention players whose names appear in the ESPN ROSTER DATA or PLAYER PROPS provided
10. NEVER use training data to cite player names, stats, or coaching staff
11. If a player's name is NOT in the data, DO NOT mention them by name
12. Focus on TEAM-LEVEL factors when roster data is incomplete

LINE MOVEMENT INTERPRETATION:
- Line moved toward a team = Sharp money on that team (follow sharps)
- Line moved but ML got worse = Reverse line movement (strong sharp indicator)
- Large move (>1.5 points) = Significant information in the market
- No movement = Line is efficient, harder to find edge

WEATHER IMPACT GUIDELINES:
- Wind >15mph: Reduce total estimates by 3-5 points (NFL), affects passing games
- Temperature <32°F: Scoring typically decreases
- Rain/Snow: Favors running games, reduces passing efficiency
- Dome games: Weather irrelevant

You can handle: Game picks, parlays, player props, hedge calculations, arbitrage opportunities, and general betting education.

Always be helpful, educational, and emphasize responsible gambling. The goal is LONG-TERM PROFITABILITY through disciplined, edge-based betting.`

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
    })

    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const subStatus = await checkSubscription()
    
    if (!subStatus.isSubscribed && subStatus.questionsRemaining <= 0) {
      return NextResponse.json(
        { error: "Subscription required", requiresSubscription: true },
        { status: 403 }
      )
    }

    const { messages: chatMessages } = await request.json()

    const conversations = await db.conversations.findByUserId(session.user.id)
    let conversation = conversations[0]

    if (!conversation) {
      conversation = await db.conversations.create({
        userId: session.user.id,
        title: "New Conversation",
      })
    }

    // Fetch combined data from Odds API + ESPN API
    const combinedContext = await formatCombinedDataForContext()
    const systemPromptWithData = `${SYSTEM_PROMPT}

${combinedContext}

IMPORTANT: Use this REAL-TIME data to answer the user's question. 
- Reference actual games and odds from The Odds API
- Check ESPN injury data before making recommendations
- Verify starting lineups (especially NHL goalies) from ESPN data
- Never cite players who may have been traded - use current roster data`

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPromptWithData,
      messages: chatMessages,
    })

    const assistantMessage = response.content[0].type === 'text' 
      ? response.content[0].text 
      : ''

    const userMessage = chatMessages[chatMessages.length - 1]
    
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

    if (!subStatus.isSubscribed) {
      const user = await db.users.findById(session.user.id)
      if (user) {
        await db.users.update(session.user.id, { 
          questionCount: (user.questionCount || 0) + 1
        })
      }
    }

    return NextResponse.json({ 
      message: assistantMessage,
      questionsRemaining: subStatus.isSubscribed 
        ? -1 // -1 means unlimited (Infinity is not JSON-serializable)
        : Math.max(0, subStatus.questionsRemaining - 1)
    })

  } catch (error) {
    console.error("Chat API error:", error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: "Failed to process message", details: errorMessage },
      { status: 500 }
    )
  }
}
