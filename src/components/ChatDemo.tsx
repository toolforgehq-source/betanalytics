'use client'

import { useState, useEffect } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  delay: number
}

const DEMO_CONVERSATION: ChatMessage[] = [
  {
    role: 'user',
    content: "What's the best bet tonight?",
    delay: 0,
  },
  {
    role: 'assistant',
    content: `## BEST BET TODAY

**Celtics -6.5 @ -110** | Score: 82/100 | RECOMMENDED BET

**THE EDGE:**
- Our Elo Model: 78.3% win probability
- Market Implied: 64.1%
- **Edge Found: +14.2%**

**MATCHUP:**
- Celtics (Elo: 1847) vs Knicks (Elo: 1692)
- 155-point Elo gap = strong favorite
- Injury adj: Knicks missing starter (-20 Elo)

**VALUE:** ROI +11.2% | EV: $11.20 per $100`,
    delay: 1500,
  },
  {
    role: 'user',
    content: 'Any good player props?',
    delay: 3000,
  },
  {
    role: 'assistant',
    content: `## TOP PLAYER PROPS

**#1 Jayson Tatum OVER 27.5 pts** | RECOMMENDED
- Model Probability: 62.4%
- Edge: +8.1%
- Avg: 29.3 pts (last 10 games)

**#2 Jalen Brunson OVER 24.5 pts** | BEST AVAILABLE
- Model Probability: 58.7%
- Edge: +5.2%
- Avg: 26.1 pts (last 10 games)`,
    delay: 4500,
  },
]

export default function ChatDemo() {
  const [visibleMessages, setVisibleMessages] = useState<number>(0)
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    if (visibleMessages >= DEMO_CONVERSATION.length) {
      // Reset after showing all messages
      const resetTimer = setTimeout(() => {
        setVisibleMessages(0)
      }, 8000)
      return () => clearTimeout(resetTimer)
    }

    const nextMessage = DEMO_CONVERSATION[visibleMessages]
    const delay = visibleMessages === 0 ? 800 : nextMessage.delay

    const showTimer = setTimeout(() => {
      if (nextMessage.role === 'assistant') {
        setTyping(true)
        const typeTimer = setTimeout(() => {
          setTyping(false)
          setVisibleMessages(v => v + 1)
        }, 1200)
        return () => clearTimeout(typeTimer)
      } else {
        setVisibleMessages(v => v + 1)
      }
    }, delay)

    return () => clearTimeout(showTimer)
  }, [visibleMessages])

  return (
    <div className="bg-slate-950/60 backdrop-blur-sm border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
      {/* Window Chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="w-3 h-3 rounded-full bg-red-500/60"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500/60"></div>
        <div className="w-3 h-3 rounded-full bg-green-500/60"></div>
        <span className="text-xs text-slate-500 ml-2">BetAnalytics AI Chat</span>
        <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
          Live
        </span>
      </div>

      {/* Messages */}
      <div className="p-4 space-y-3 min-h-[340px] max-h-[400px] overflow-hidden">
        {DEMO_CONVERSATION.slice(0, visibleMessages).map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
            {msg.role === 'user' ? (
              <div className="bg-gradient-to-br from-blue-500 to-cyan-400 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] text-sm">
                {msg.content}
              </div>
            ) : (
              <div className="bg-slate-800/70 text-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 max-w-[90%] text-xs leading-relaxed whitespace-pre-line font-mono">
                {msg.content}
              </div>
            )}
          </div>
        ))}

        {typing && (
          <div className="flex justify-start animate-fadeIn">
            <div className="bg-slate-800/70 text-slate-400 rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
              <span className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-slate-800 px-4 py-3 bg-slate-900/30">
        <div className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-4 py-2.5">
          <span className="text-slate-500 text-sm flex-1">Ask about any game, team, or player...</span>
          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
