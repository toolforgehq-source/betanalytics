'use client'

import { useState, useEffect, useRef } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  delay: number
}

// Generic examples — no specific teams or dates, realistic numbers
const DEMO_CONVERSATION: ChatMessage[] = [
  {
    role: 'user',
    content: "What's the best bet today?",
    delay: 0,
  },
  {
    role: 'assistant',
    content: `🏀 BEST BET — NBA

Home Team -4.5 @ -110
Score: 74/100

Elo: 1712 vs 1634 (+78 gap)
Our prob: 61.8% | Market: 55.2%
Edge: +6.6%

Injury: Away missing starting PG
(-20 Elo, status: Out)

EV: +$5.40 per $100 risked`,
    delay: 1500,
  },
  {
    role: 'user',
    content: 'Should I take the over 218.5?',
    delay: 3500,
  },
  {
    role: 'assistant',
    content: `📊 TOTAL ANALYSIS

Over 218.5 @ -110

Elo-projected total: 221.3
Our prob: 57.4% | Market: 52.4%
Edge: +5.0%

Pace factor: both top-10 pace
Last 10 avg combined: 223.1

Verdict: Lean OVER ✓`,
    delay: 5000,
  },
]

export default function ChatDemo() {
  const [visibleMessages, setVisibleMessages] = useState<number>(0)
  const [typing, setTyping] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Clean up any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (visibleMessages >= DEMO_CONVERSATION.length) {
      timeoutRef.current = setTimeout(() => {
        setVisibleMessages(0)
        setTyping(false)
      }, 6000)
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
      }
    }

    const nextMessage = DEMO_CONVERSATION[visibleMessages]
    const delay = visibleMessages === 0 ? 1000 : nextMessage.delay

    if (nextMessage.role === 'assistant') {
      // Show typing indicator first, then reveal message
      timeoutRef.current = setTimeout(() => {
        setTyping(true)
        timeoutRef.current = setTimeout(() => {
          setTyping(false)
          setVisibleMessages(v => v + 1)
        }, 1400)
      }, delay)
    } else {
      timeoutRef.current = setTimeout(() => {
        setVisibleMessages(v => v + 1)
      }, delay)
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
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
          <div key={`${visibleMessages}-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
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
