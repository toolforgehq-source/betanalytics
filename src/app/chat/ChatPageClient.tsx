'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Calculator, BookOpen, User, LogOut, ArrowLeft, Activity, RefreshCw, Menu, X, Search, Layers, Bell, Target, TrendingUp } from 'lucide-react'
import { signOut } from 'next-auth/react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import ChatInterface, { ChatInterfaceRef } from '@/components/ChatInterface'
import HedgeCalculator from '@/components/HedgeCalculator'
import TermsModal from '@/components/TermsModal'
import { getTodaysLesson, getCurrentDayName } from '@/lib/education'

interface ChatPageClientProps {
  isSubscribed: boolean
  questionsRemaining: number
  trialDaysRemaining: number
  termsAccepted: boolean
  checkoutSessionId?: string
}

interface SystemStatusData {
  totalGames: number
  gamesToday: number
  gamesTomorrow: number
  uniqueSports: number
  sportCounts: Record<string, number>
  freshnessStatus: 'fresh' | 'aging' | 'stale'
  timeSinceUpdate: string
  dataSource: string
  isHealthy: boolean
}

export default function ChatPageClient({ 
  isSubscribed: initialIsSubscribed, 
  questionsRemaining,
  trialDaysRemaining,
  termsAccepted: initialTermsAccepted,
  checkoutSessionId
}: ChatPageClientProps) {
  const router = useRouter()
  const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed)
  const [showHedgeCalculator, setShowHedgeCalculator] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(initialTermsAccepted)
  const [showLessonModal, setShowLessonModal] = useState(false)
  const [statusLoading, setStatusLoading] = useState(true)
  const [systemStatus, setSystemStatus] = useState<SystemStatusData | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const chatRef = useRef<ChatInterfaceRef>(null)

  useEffect(() => {
    if (!checkoutSessionId || isSubscribed) return
    const verifyCheckout = async () => {
      try {
        const apiUrl = new URL('/api/stripe/verify-checkout', window.location.origin).toString()
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionId: checkoutSessionId }),
        })
        if (response.ok) {
          const data = await response.json()
          if (data.verified) {
            setIsSubscribed(true)
            window.history.replaceState({}, '', '/chat')
          }
        }
      } catch (error) {
        console.error('Failed to verify checkout:', error)
      }
    }
    verifyCheckout()
  }, [checkoutSessionId, isSubscribed])

  // Get today's lesson
  const todaysLesson = getTodaysLesson()
  const dayName = getCurrentDayName()

  // Fetch system status data on mount and periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const apiUrl = new URL('/api/analytics', window.location.origin).toString()
        const response = await fetch(apiUrl, { credentials: 'include' })
        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            setSystemStatus(result.data)
          }
        }
      } catch (error) {
        console.error('Failed to fetch system status:', error)
      } finally {
        setStatusLoading(false)
      }
    }

    fetchStatus()
    // Refresh status every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const handleQuickAction = (message: string) => {
    // Switch to chat view if hedge calculator is showing
    if (showHedgeCalculator) {
      setShowHedgeCalculator(false)
    }
    // Send the message after a brief delay to allow state to update
    setTimeout(() => {
      chatRef.current?.sendMessage(message)
    }, 100)
  }

  const handleAcceptTerms = async () => {
    try {
      // Use absolute URL to avoid issues with credentials in document.baseURI
      const apiUrl = new URL('/api/terms/accept', window.location.origin).toString()
      await fetch(apiUrl, { method: 'POST', credentials: 'include' })
      setTermsAccepted(true)
    } catch (error) {
      console.error('Failed to accept terms:', error)
    }
  }

  if (!termsAccepted) {
    return <TermsModal onAccept={handleAcceptTerms} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/chat">
              <Logo />
            </Link>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              <Link
                href="/picks"
                className="flex items-center gap-1.5 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <Target className="w-4 h-4" />
                Picks
              </Link>
              <Link
                href="/performance"
                className="flex items-center gap-1.5 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <TrendingUp className="w-4 h-4" />
                Performance
              </Link>
              <Link
                href="/odds"
                className="flex items-center gap-1.5 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <Search className="w-4 h-4" />
                Odds
              </Link>
              <Link
                href="/betslip"
                className="flex items-center gap-1.5 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <Layers className="w-4 h-4" />
                Parlay
              </Link>
              <Link
                href="/alerts"
                className="flex items-center gap-1.5 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <Bell className="w-4 h-4" />
                Alerts
              </Link>
              <div className="w-px h-6 bg-slate-700/50 mx-1" />
              <button
                onClick={() => setShowHedgeCalculator(!showHedgeCalculator)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors text-sm ${
                  showHedgeCalculator 
                    ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300' 
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                {showHedgeCalculator ? (
                  <>
                    <ArrowLeft className="w-4 h-4" />
                    Chat
                  </>
                ) : (
                  <>
                    <Calculator className="w-4 h-4" />
                    Hedge Calc
                  </>
                )}
              </button>
              <button
                onClick={() => router.push('/account')}
                className="flex items-center gap-1.5 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <User className="w-4 h-4" />
                Account
              </button>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors text-sm"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex items-center justify-center w-10 h-10 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Mobile Navigation Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pt-4 border-t border-slate-800/50 space-y-2">
              <Link
                href="/picks"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <Target className="w-4 h-4" />
                Model Picks
              </Link>
              <Link
                href="/performance"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <TrendingUp className="w-4 h-4" />
                Performance
              </Link>
              <Link
                href="/odds"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <Search className="w-4 h-4" />
                Odds Board
              </Link>
              <Link
                href="/betslip"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <Layers className="w-4 h-4" />
                Parlay Builder
              </Link>
              <Link
                href="/alerts"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <Bell className="w-4 h-4" />
                Alerts
              </Link>
              <Link
                href="/methodology"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <BookOpen className="w-4 h-4" />
                Methodology
              </Link>
              <div className="border-t border-slate-700/50 pt-2">
                <button
                  onClick={() => {
                    setShowHedgeCalculator(!showHedgeCalculator)
                    setMobileMenuOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-4 py-3 rounded-lg transition-colors text-sm ${
                    showHedgeCalculator 
                      ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300' 
                      : 'bg-slate-800/50 hover:bg-slate-700/50'
                  }`}
                >
                  {showHedgeCalculator ? (
                    <>
                      <ArrowLeft className="w-4 h-4" />
                      Back to Chat
                    </>
                  ) : (
                    <>
                      <Calculator className="w-4 h-4" />
                      Hedge Calculator
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    router.push('/account')
                    setMobileMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm mt-2"
                >
                  <User className="w-4 h-4" />
                  Account
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm mt-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {showHedgeCalculator ? (
              <HedgeCalculator />
            ) : (
              <ChatInterface 
                ref={chatRef}
                isSubscribed={isSubscribed}
                questionsRemaining={questionsRemaining}
                trialDaysRemaining={trialDaysRemaining}
              />
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-400" />
                System Status
                {systemStatus && (
                  <span className={`ml-auto w-2 h-2 rounded-full ${
                    systemStatus.freshnessStatus === 'fresh' ? 'bg-green-400' :
                    systemStatus.freshnessStatus === 'aging' ? 'bg-yellow-400' : 'bg-red-400'
                  }`} title={`Data ${systemStatus.timeSinceUpdate}`} />
                )}
              </h3>
              {statusLoading ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Loading...</span>
                    <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />
                  </div>
                </div>
              ) : systemStatus ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Games Today</span>
                    <span className="text-blue-400 font-semibold">{systemStatus.gamesToday}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Games Tomorrow</span>
                    <span className="text-cyan-400 font-semibold">{systemStatus.gamesTomorrow}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Sports Tracked</span>
                    <span className="text-green-400 font-semibold">{systemStatus.uniqueSports}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-400 text-xs">Data Source</span>
                      <span className={`text-xs font-medium flex items-center gap-1 ${systemStatus.isHealthy ? 'text-green-400' : 'text-red-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${systemStatus.isHealthy ? 'bg-green-400' : 'bg-red-400'}`} />
                        {systemStatus.dataSource}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Updated {systemStatus.timeSinceUpdate}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-slate-400 text-sm">Unable to load status</p>
                </div>
              )}
            </div>

            <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-3">
                {showHedgeCalculator ? (
                  <QuickAction emoji="💬" text="Back to Chat" onClick={() => setShowHedgeCalculator(false)} />
                ) : (
                  <>
                    <QuickAction emoji="🎯" text="Best Bet Today" onClick={() => handleQuickAction("What's the best bet today?")} />
                    <QuickAction emoji="🎲" text="Build Player Parlay" onClick={() => handleQuickAction("Build me a 3-leg player prop parlay")} />
                    <QuickAction emoji="💰" text="Build Team Parlay" onClick={() => handleQuickAction("Build me a 3-team moneyline parlay")} />
                  </>
                )}
                <QuickAction 
                  emoji={showHedgeCalculator ? "📊" : "🛡️"} 
                  text={showHedgeCalculator ? "Using Calculator" : "Hedge Calculator"} 
                  onClick={() => setShowHedgeCalculator(!showHedgeCalculator)} 
                  active={showHedgeCalculator}
                />
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-400" />
                {dayName}&apos;s Lesson
              </h3>
              <p className="text-sm text-slate-300 mb-4">
                <span className="text-lg mr-2">{todaysLesson.icon}</span>
                <strong className="text-blue-300">{todaysLesson.title}</strong>
                <br />
                <span className="mt-2 block">{todaysLesson.content}</span>
              </p>
              <button 
                onClick={() => setShowLessonModal(true)}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
              >
                Learn More →
              </button>
            </div>
          </div>
        </div>
      </main>

      {showLessonModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <span className="text-2xl">{todaysLesson.icon}</span>
                  {todaysLesson.title}
                </h2>
                <button 
                  onClick={() => setShowLessonModal(false)}
                  className="text-slate-400 hover:text-white text-2xl"
                >
                  &times;
                </button>
              </div>
              
              <div className="space-y-6 text-slate-300">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Overview</h3>
                  <p className="whitespace-pre-line">{todaysLesson.extendedContent}</p>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Common Mistakes to Avoid</h3>
                  <ul className="space-y-2">
                    {todaysLesson.commonMistakes.map((mistake, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-red-400">•</span>
                        {mistake}
                      </li>
                    ))}
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">How to Apply This</h3>
                  <ul className="space-y-2">
                    {todaysLesson.howToApply.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-green-400">•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-slate-700">
                <button
                  onClick={() => setShowLessonModal(false)}
                  className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all"
                >
                  Got It!
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}

function QuickAction({ emoji, text, onClick, active }: { emoji: string; text: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl transition-colors text-sm border ${
        active 
          ? 'bg-blue-500/20 border-blue-500/30 text-blue-300' 
          : 'bg-slate-800/50 hover:bg-slate-700/50 border-slate-700/30'
      }`}
    >
      <span>{emoji} {text}</span>
    </button>
  )
}
