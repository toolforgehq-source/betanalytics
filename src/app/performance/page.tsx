import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'
import PerformanceClient from './PerformanceClient'

export const metadata = {
  title: 'Model Performance | Full Transparency Dashboard - BetAnalytics.ai',
  description: 'Complete transparency into our Elo model\'s betting performance. Win rates, ROI, calibration analysis, and breakdowns by sport, bet type, and confidence level. Every pick tracked and verified.',
  alternates: {
    canonical: 'https://betanalytics.ai/performance',
  },
  openGraph: {
    title: 'Model Performance Dashboard | BetAnalytics.ai',
    description: 'Full transparency: win rates, ROI, calibration, sport breakdowns. Every pick tracked and graded automatically.',
    url: 'https://betanalytics.ai/performance',
    type: 'website' as const,
  },
}

export default function PerformancePage() {
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
              <Link href="/performance" className="text-sm text-cyan-400 font-medium">
                Performance
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
        <div className="container mx-auto max-w-5xl">
          <Link href="/" className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-3">
              Model{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Performance
              </span>
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl">
              Full transparency into how our Elo model performs. Every pick is recorded and graded 
              automatically. See win rates, ROI, calibration analysis, and breakdowns by sport, 
              bet type, and confidence level.
            </p>
          </div>

          <PerformanceClient />

          {/* CTA */}
          <div className="mt-12 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Get These Picks In Real Time</h2>
            <p className="text-slate-300 mb-6 max-w-lg mx-auto">
              Subscribe to get picks the moment our model finds an edge. Ask about any game, 
              any matchup, and get full Elo breakdowns in our AI chat.
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
