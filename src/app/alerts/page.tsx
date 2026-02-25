import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Logo from '@/components/Logo'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'
import AlertsClient from './AlertsClient'

export const metadata = {
  title: 'Alerts & Notifications | Never Miss an Edge - BetAnalytics.ai',
  description: 'Set up personalized alerts for high-edge picks, best bets of the day, player props, and line movements. Get notified via email or push notifications.',
  alternates: {
    canonical: 'https://betanalytics.ai/alerts',
  },
  openGraph: {
    title: 'Alerts & Notifications | BetAnalytics.ai',
    description: 'Personalized betting alerts: best bets, high-edge picks, player props, line movements. Email and push notifications.',
    url: 'https://betanalytics.ai/alerts',
    type: 'website' as const,
  },
}

export default function AlertsPage() {
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
              <Link href="/alerts" className="text-sm text-cyan-400 font-medium">
                Alerts
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
              Alerts &{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Notifications
              </span>
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl">
              Never miss an edge. Configure personalized alerts for high-value picks, 
              line movements, and player props. Get notified the moment our model finds value.
            </p>
          </div>

          <AlertsClient />
        </div>
      </main>

      <Footer />
    </div>
  )
}
