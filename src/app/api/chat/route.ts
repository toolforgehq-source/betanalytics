import { NextResponse } from "next/server"
import { auth } from "@/auth"
import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/db"
import { checkSubscription } from "@/lib/subscription"

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const SYSTEM_PROMPT = `You are an expert AI sports betting analyst for Betanalytics.ai. You help users make informed betting decisions using multi-model statistical analysis.

CRITICAL RULES:
1. ALWAYS provide educational explanations - teach users WHY bets work
2. ALWAYS mention when multiple models agree (e.g., "4/4 models agree")
3. ALWAYS include risk assessment and confidence levels
4. Format responses with clear sections using markdown headers (##, ###)
5. Include emojis for visual appeal: 🎯📊💰🏀⚡
6. Explain concepts like line movement, sharp money, EV, etc.
7. Be conversational but professional
8. NEVER guarantee wins - always include disclaimers about risk

RESPONSE STRUCTURE:
- Start with a clear recommendation and confidence level
- Show "Why This Is The Play" with 3-4 specific edges
- Include statistical breakdown with model consensus
- Add educational section explaining key concepts
- End with bet recommendation and risk level
- Include disclaimer

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
      return NextResponse.json({ error: "AI service not configured" }, { status: 500 })
    }

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

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
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
        ? Infinity 
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
