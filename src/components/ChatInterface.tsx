'use client'

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Send, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatInterfaceProps {
  isSubscribed: boolean
  questionsRemaining: number
}

export interface ChatInterfaceRef {
  sendMessage: (text: string) => void
}

const WELCOME_MESSAGE = `Welcome to Betanalytics.ai! 🎯

I'm your AI sports betting assistant. I analyze games using multiple statistical models and provide data-driven insights with full transparency.

**What I can help you with:**
• Best bets across any sport or platform
• Parlay builders (DraftKings, PrizePicks, Underdog, etc.)
• Player prop analysis
• Line value assessment
• Hedge calculations for live parlays
• Arbitrage opportunities
• Betting education and strategy

**How it works:**
Every recommendation comes with:
• Multi-model consensus (I only suggest bets when 3-4 models agree)
• Clear reasoning and data
• Educational insights so you learn WHY
• Risk assessment and bankroll guidance

Ask me anything! Examples:
"What's the best bet today?"
"Build me a 3-leg parlay on PrizePicks"
"Should I take Lakers -5.5?"
"Help me hedge my 4-leg parlay"`

const ChatInterface = forwardRef<ChatInterfaceRef, ChatInterfaceProps>(function ChatInterface({ 
  isSubscribed, 
  questionsRemaining: initialQuestionsRemaining 
}, ref) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [questionsRemaining, setQuestionsRemaining] = useState(initialQuestionsRemaining)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll within the chat container, not the whole page
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    setMessages([{
      id: '1',
      role: 'assistant',
      content: WELCOME_MESSAGE,
      timestamp: new Date(),
    }])
  }, [])

  const sendMessageInternal = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return

    // -1 means unlimited (subscribed users), so only check if not subscribed
    if (!isSubscribed && questionsRemaining >= 0 && questionsRemaining <= 0) {
      router.push('/pricing')
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Use absolute URL to avoid issues with credentials in document.baseURI
      const apiUrl = new URL('/api/chat', window.location.origin).toString()
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          messages: [...messages, userMessage].slice(1).map(m => ({
            role: m.role,
            content: m.content
          }))
        }),
      })

      if (!response.ok) {
        let errorDetails = ''
        try {
          const errorData = await response.json()
          errorDetails = errorData.details || errorData.error || ''
        } catch {
          errorDetails = await response.text()
        }
        console.error('Chat API error:', response.status, errorDetails)
        throw new Error(errorDetails || `API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.requiresSubscription) {
        router.push('/pricing')
        return
      }

      if (data.questionsRemaining !== undefined) {
        setQuestionsRemaining(data.questionsRemaining)
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message || 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error. Please try again. (${error instanceof Error ? error.message : 'Unknown error'})`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async () => {
    await sendMessageInternal(input)
  }

  // Expose sendMessage method to parent components via ref
  useImperativeHandle(ref, () => ({
    sendMessage: (text: string) => {
      sendMessageInternal(text)
    }
  }))

  const formatMessage = (content: string) => {
    return content.split('\n').map((line, i) => {
      if (line.startsWith('## ')) {
        return <h2 key={i} className="text-xl font-bold text-blue-300 mt-4 mb-2">{line.replace('## ', '')}</h2>
      }
      if (line.startsWith('### ')) {
        return <h3 key={i} className="text-lg font-semibold text-slate-200 mt-3 mb-2">{line.replace('### ', '')}</h3>
      }
      if (line.startsWith('**') && line.endsWith('**')) {
        return <p key={i} className="font-bold text-slate-100 mt-2">{line.replace(/\*\*/g, '')}</p>
      }
      if (line.match(/^\*\*.*\*\*:/)) {
        const parts = line.split('**')
        return <p key={i} className="mt-2"><strong className="text-slate-100">{parts[1]}</strong>{parts[2]}</p>
      }
      if (line.startsWith('• ') || line.startsWith('- ')) {
        return <p key={i} className="ml-4 text-slate-300">{line}</p>
      }
      if (line.match(/^[🎯📊💰🏀⚡✅📈💡⚠️🛡️🎲💎]/)) {
        return <p key={i} className="text-slate-200 mt-1">{line}</p>
      }
      if (line.startsWith('---')) {
        return <hr key={i} className="border-slate-700 my-4" />
      }
      if (line.trim() === '') {
        return <br key={i} />
      }
      return <p key={i} className="text-slate-300">{line}</p>
    })
  }

  return (
    <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl overflow-hidden flex flex-col h-[calc(100vh-180px)]">
      
      {!isSubscribed && (
        <div className="bg-gradient-to-r from-blue-900/30 to-cyan-900/30 border-b border-blue-500/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Free Trial: {questionsRemaining} question{questionsRemaining !== 1 ? 's' : ''} remaining
                </p>
                <p className="text-xs text-slate-300">
                  Upgrade to Premium for unlimited questions
                </p>
              </div>
            </div>
            <button 
              onClick={() => router.push('/pricing')}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg text-sm font-semibold transition-all"
            >
              Upgrade Now
            </button>
          </div>
        </div>
      )}

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] ${
                message.role === 'user'
                  ? 'bg-gradient-to-br from-blue-500 to-cyan-400 text-white rounded-2xl rounded-br-sm'
                  : 'bg-slate-800/50 text-slate-100 rounded-2xl rounded-bl-sm border border-slate-700/50'
              } p-4 shadow-lg`}
            >
              <div className="prose prose-invert max-w-none text-sm">
                {formatMessage(message.content)}
              </div>
              
              {message.role === 'assistant' && message.content.includes('Confidence:') && (
                <div className="text-xs text-slate-400 bg-slate-900/50 rounded-lg p-2 mt-3 border border-slate-700/30">
                  ⚠️ <strong>STATISTICAL ANALYSIS - NOT A GUARANTEE</strong>
                  <br />
                  This suggestion is based on data analysis and may be incorrect. Past performance does not guarantee future results. Bet responsibly.
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800/50 rounded-2xl rounded-bl-sm p-4 border border-slate-700/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-800 p-4 bg-slate-950/30">
        <div className="flex gap-2 sm:gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Ask me anything about sports b..."
            className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700 rounded-xl px-3 sm:px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
            disabled={!isSubscribed && questionsRemaining >= 0 && questionsRemaining <= 0}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || (!isSubscribed && questionsRemaining >= 0 && questionsRemaining <= 0)}
            className="px-3 sm:px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 disabled:from-slate-700 disabled:to-slate-600 disabled:cursor-not-allowed rounded-xl font-semibold transition-all flex items-center gap-1 sm:gap-2 shadow-lg flex-shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        
        <p className="text-xs text-slate-500 mt-3 text-center">
          ⚠️ Statistical analysis only. Not guaranteed. Bet responsibly. Must be 21+.
        </p>
      </div>
    </div>
  )
})

export default ChatInterface
