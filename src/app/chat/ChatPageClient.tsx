'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Calculator, BookOpen, User, LogOut } from 'lucide-react'
import { signOut } from 'next-auth/react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import ChatInterface from '@/components/ChatInterface'
import HedgeCalculator from '@/components/HedgeCalculator'
import TermsModal from '@/components/TermsModal'
import { Activity } from 'lucide-react'

interface ChatPageClientProps {
  isSubscribed: boolean
  questionsRemaining: number
  termsAccepted: boolean
}

export default function ChatPageClient({ 
  isSubscribed, 
  questionsRemaining,
  termsAccepted: initialTermsAccepted
}: ChatPageClientProps) {
  const router = useRouter()
  const [showHedgeCalculator, setShowHedgeCalculator] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(initialTermsAccepted)

  const handleAcceptTerms = async () => {
    try {
      // Use absolute URL to avoid issues with credentials in document.baseURI
      const apiUrl = new URL('/api/terms/accept', window.location.origin).toString()
      await fetch(apiUrl, { method: 'POST' })
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
            <Link href="/">
              <Logo />
            </Link>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHedgeCalculator(!showHedgeCalculator)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                  showHedgeCalculator 
                    ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300' 
                    : 'bg-slate-800/50 hover:bg-slate-700/50'
                }`}
              >
                <Calculator className="w-4 h-4" />
                Hedge Calculator
              </button>
              <button
                onClick={() => router.push('/account')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <User className="w-4 h-4" />
                Account
              </button>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors text-sm"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {showHedgeCalculator ? (
              <HedgeCalculator />
            ) : (
              <ChatInterface 
                isSubscribed={isSubscribed}
                questionsRemaining={questionsRemaining}
              />
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-400" />
                Today&apos;s Edge
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Model Consensus</span>
                  <span className="text-green-400 font-semibold">4/4</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">High Confidence Picks</span>
                  <span className="text-blue-400 font-semibold">8 available</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Sharp Money Signals</span>
                  <span className="text-yellow-400 font-semibold">3 detected</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <QuickAction emoji="🎯" text="Best Bet Today" />
                <QuickAction emoji="🎲" text="Build Parlay" />
                <QuickAction emoji="💎" text="Arbitrage Finder" />
                <QuickAction emoji="🛡️" text="Hedge Calculator" onClick={() => setShowHedgeCalculator(true)} />
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-400" />
                Today&apos;s Lesson
              </h3>
              <p className="text-sm text-slate-300 mb-4">
                <strong className="text-blue-300">Reverse Line Movement</strong>
                <br />
                When lines move against public betting percentages, it signals sharp money. This is one of the most reliable edges in sports betting.
              </p>
              <button className="text-xs text-blue-400 hover:text-blue-300 font-semibold">
                Learn More →
              </button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}

function QuickAction({ emoji, text, onClick }: { emoji: string; text: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl transition-colors text-sm border border-slate-700/30"
    >
      {emoji} {text}
    </button>
  )
}
