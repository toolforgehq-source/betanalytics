import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'
import PicksClient from './PicksClient'

export const metadata = {
  title: 'Model Picks & Track Record | BetAnalytics.ai',
  description: 'See our Elo model\'s verified pick history. Every recommendation is tracked and graded automatically. View win rates, ROI, and performance breakdowns by sport and bet type.',
  alternates: {
    canonical: 'https://betanalytics.ai/picks',
  },
  openGraph: {
    title: 'Model Picks & Track Record | BetAnalytics.ai',
    description: 'Verified pick history from our Elo rating model. Win rates, ROI, and performance breakdowns updated daily.',
    url: 'https://betanalytics.ai/picks',
    type: 'website' as const,
  },
}

export default function PicksPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm relative">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <Logo />
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-4">
              <Link href="/picks" className="text-cyan-400 font-medium">
                Model Picks
              </Link>
              <Link href="/methodology" className="text-slate-300 hover:text-white transition-colors">
                Methodology
              </Link>
              <Link href="/login" className="text-slate-300 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link 
                href="/signup" 
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
              >
                Start Free Trial
              </Link>
            </div>

            {/* Mobile Navigation */}
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
              Model Picks &{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Track Record
              </span>
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl">
              Every pick our Elo model makes is recorded and graded automatically after games complete. 
              Full transparency — see exactly how we perform across every sport and bet type.
            </p>
          </div>

          <PicksClient />

          {/* CTA */}
          <div className="mt-12 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Get Model Picks In Real Time</h2>
            <p className="text-slate-300 mb-6 max-w-lg mx-auto">
              Subscribe to get picks the moment our model finds an edge. Ask about any game, 
              any matchup, and get full Elo breakdowns in our AI chat.
            </p>
            <Link
              href="/signup"
              className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
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
