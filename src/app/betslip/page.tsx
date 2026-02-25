import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'
import BetSlipClient from './BetSlipClient'

export const metadata = {
  title: 'Parlay Builder | Build Your Perfect Parlay - BetAnalytics.ai',
  description: 'Build parlays visually with best available odds across DraftKings, FanDuel, BetMGM, and Caesars. See combined odds, win probability, and potential payouts in real time.',
  alternates: {
    canonical: 'https://betanalytics.ai/betslip',
  },
  openGraph: {
    title: 'Parlay Builder | BetAnalytics.ai',
    description: 'Build parlays with best odds across all major sportsbooks. Real-time combined odds and payout calculations.',
    url: 'https://betanalytics.ai/betslip',
    type: 'website' as const,
  },
}

export default function BetSlipPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <Logo />
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              <Link href="/picks" className="text-sm text-slate-300 hover:text-white transition-colors">
                Model Picks
              </Link>
              <Link href="/performance" className="text-sm text-slate-300 hover:text-white transition-colors">
                Performance
              </Link>
              <Link href="/odds" className="text-sm text-slate-300 hover:text-white transition-colors">
                Odds Board
              </Link>
              <Link href="/betslip" className="text-sm text-cyan-400 font-medium">
                Parlay Builder
              </Link>
              <Link href="/methodology" className="text-sm text-slate-300 hover:text-white transition-colors">
                Methodology
              </Link>
              <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg font-semibold text-sm transition-all shadow-lg shadow-blue-500/25"
              >
                Start Free Trial
              </Link>
            </div>

            <MobileNav />
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-4">
        <div className="container mx-auto max-w-6xl">
          <Link href="/" className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-3">
              Parlay{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Builder
              </span>
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl">
              Build your perfect parlay with best available odds across every sportsbook. 
              See combined odds, win probability, and potential payouts updated in real time.
            </p>
          </div>

          <BetSlipClient />

          {/* CTA */}
          <div className="mt-12 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Let AI Build Your Parlay</h2>
            <p className="text-slate-300 mb-6 max-w-lg mx-auto">
              Our Elo model can build optimized parlays using data-driven edge analysis.
              Just ask &quot;build me a parlay&quot; in our AI chat.
            </p>
            <Link
              href="/signup"
              className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25"
            >
              Start 3-Day Free Trial
            </Link>
            <p className="text-sm text-slate-400 mt-3">No credit card required. $39/month after trial.</p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
