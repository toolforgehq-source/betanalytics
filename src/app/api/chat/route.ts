import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"
import { getCurrentOdds, formatOddsForContext } from "@/lib/odds"

const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. You help users make informed betting decisions using multi-model statistical analysis.

CRITICAL: You have access to REAL sports betting data from The Odds API. When users ask for betting recommendations:

1. **Use actual games happening today** - Reference real matchups with current odds from the data provided
2. **Give concrete recommendations** - Specific teams, spreads, totals with actual odds
3. **Show sportsbook comparisons** - Tell users where to find best odds (DraftKings, FanDuel, BetMGM)
4. **Include timestamp** - Always show when odds were last updated
5. **Multi-model analysis** - Analyze from multiple angles (rest, injuries, matchups, trends, sharp money)

RESPONSE FORMAT FOR PICKS:

## 🎯 Today's Best Value Play

**[Team] [Spread] vs [Opponent]**
**Best Odds:** [Sportsbook] [Spread] ([Odds])
**Confidence:** [Level] ([X]/4 models agree)
**Game Time:** [Time] ET

---

### 🎯 Why This Is The Play:

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

### 📈 Statistical Breakdown:

**Model Consensus:**
[Show which models agree/disagree]

---

### 💰 Bet Recommendation:

**Wager:** [Units] on [Bet]
**Best Odds:** [Sportsbook] [Line] ([Odds])
**Risk Level:** [Low/Medium/High]

---

### 💡 What You're Learning:

[Educational content explaining the concept behind this pick]

---

CRITICAL RULES:
1. ALWAYS use the real odds data provided below - never make up odds
2. ALWAYS provide educational explanations - teach users WHY bets work
3. ALWAYS mention model consensus (e.g., "4/4 models agree")
4. ALWAYS include risk assessment and confidence levels
5. Format responses with clear sections using markdown headers (##, ###)
6. Include emojis for visual appeal: 🎯📊💰🏀⚡
7. Be conversational but professional
8. NEVER guarantee wins - always include disclaimers about risk
9. NEVER say "I don't have access to real-time data" - you DO have real odds data
10. If no games are available, explain when games typically occur and offer general advice

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

    // Fetch current odds data and inject into system prompt
    const oddsData = await getCurrentOdds()
    const oddsContext = formatOddsForContext(oddsData)
    const systemPromptWithOdds = `${SYSTEM_PROMPT}

${oddsContext}

Use this real data to answer the user's question. Always reference the actual games and odds shown above.`

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPromptWithOdds,
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
