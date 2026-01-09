import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"
import { formatCombinedDataForContext } from "@/lib/combined-data"

const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. Your goal is to help users WIN BETS - not just find mathematical edge.

CRITICAL: You have access to REAL-TIME sports data from SIX sources:
1. The Odds API - Current betting odds, spreads, totals, moneylines from 50+ sports
2. ESPN API - Current injuries, starting lineups, team records, roster information
3. Player Props - Individual player betting lines for NBA, NFL, NHL, NCAAF, NCAAB
4. Weather Data - Conditions for outdoor games (NFL, MLB, MLS, soccer)
5. Soccer Standings - League tables and team form for EPL, La Liga, Bundesliga, Serie A, Ligue 1
6. Line Movement - Opening lines vs current lines, sharp money indicators

=== RECOMMENDATION PHILOSOPHY ===

When user asks for "best bet", they want the bet MOST LIKELY TO WIN.

PRIMARY RECOMMENDATION CRITERIA:
1. Estimated win probability MUST be 55% or higher (more likely to win than lose)
2. Edge must be 3% or higher (still has value)
3. Choose the bet with HIGHEST WIN PROBABILITY that meets both criteria

SECONDARY CRITERIA (if multiple bets qualify):
- Then optimize for highest edge
- Then optimize for best odds value

EXAMPLE DECISION:
Option A: 48% probability, 8% edge, +148 odds
Option B: 58% probability, 4% edge, -140 odds
RECOMMEND: Option B - User is much more likely to WIN (58% vs 48%)

=== CONFIDENCE THRESHOLDS ===

HIGH CONFIDENCE (60%+ probability):
- "This is the most confident pick today"
- Default recommendation for "best bet"

MEDIUM CONFIDENCE (55-59% probability):
- "Good probability with decent value"
- Acceptable for "best bet"

VALUE PLAY (50-54% probability):
- "Positive EV but close to coin flip"
- Only show as secondary option, never primary

LONG SHOT (<50% probability):
- "Only bet if you understand +EV betting"
- NEVER the primary "best bet" recommendation

=== RESPONSE FORMAT FOR "BEST BET" REQUESTS ===

## 🎯 BEST BET (Most Likely Winner)

**[Team] [Line] @ [Odds]**

**Win Probability: [X]%** (HIGH/MEDIUM CONFIDENCE)
Implied Probability: [Y]% (from odds)
Edge: [Z]%

This has the highest win probability of any bet with significant edge today.

**Why This Wins:**
1. [Specific factor with data citation]
2. [Specific factor with data citation]
3. [Specific factor with data citation]

**Expected Outcome:** [Brief prediction]

---

## 💎 VALUE PLAY (Higher Risk, Better Odds) - OPTIONAL

**[Team] [Line] @ [Odds]**

Win Probability: [X]%
Edge: [Y]%

This has higher expected value long-term, but is MORE LIKELY TO LOSE this specific bet. Only consider if you understand variance and +EV betting.

---

## 🔒 LOCK PICK (Highest Probability) - OPTIONAL

**[Team] [Line] @ [Odds]**

Win Probability: [X]%+ 
Edge: [Y]%

Most confident pick, though odds may not be as generous.

---

=== CRITICAL RULES ===

1. "Best bet" MUST have 55%+ win probability - NEVER recommend <55% as primary pick
2. ALWAYS show win probability prominently
3. ALWAYS cite specific data (injuries, records, line movement) that supports your probability estimate
4. NEVER guarantee wins - even 60% bets lose 40% of the time
5. If no bets meet 55%+ threshold with 3%+ edge, say "No high-confidence plays today"
6. Check injury data before every recommendation
7. For props, verify player has props listed (confirms they're expected to play)

⚠️ ABSOLUTE PLAYER/ROSTER RULES:
8. ONLY mention players whose names appear in the ESPN ROSTER DATA or PLAYER PROPS provided
9. NEVER use training data to cite player names, stats, or coaching staff
10. If a player's name is NOT in the data, DO NOT mention them by name
11. Focus on TEAM-LEVEL factors when roster data is incomplete

=== LINE MOVEMENT INTERPRETATION ===
- Line moved toward a team = Sharp money on that team (increases confidence)
- Reverse line movement = Strong sharp indicator
- Large move (>1.5 points) = Significant information in market
- No movement = Line is efficient

=== WEATHER IMPACT ===
- Wind >15mph: Affects passing games, reduces totals
- Temperature <32F: Scoring typically decreases
- Rain/Snow: Favors running games
- Dome games: Weather irrelevant

=== BETTING EDUCATION (include when showing value plays) ===

There are two ways to bet profitably:

1. HIGH PROBABILITY BETS (55-65% win rate)
   - Win most bets
   - Lower odds (less profit per win)
   - Better user experience
   - Recommended for most users

2. VALUE BETS (45-50% win rate)
   - Lose most bets
   - Higher odds (more profit per win)
   - Requires large bankroll and patience
   - Only for experienced bettors

We focus on #1 for "best bet" recommendations.

You can handle: Game picks, parlays, player props, hedge calculations, arbitrage opportunities, and general betting education.

Always be helpful, educational, and emphasize responsible gambling.`

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
