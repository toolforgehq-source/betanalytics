import Link from 'next/link'
import Image from 'next/image'
import { Metadata } from 'next'
import { ArrowRight, Eye, Target, Activity, BarChart3, CheckCircle } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata: Metadata = {
  title: 'NFL Betting Model | Elo Ratings & AI Picks - BetAnalytics.ai',
  description: 'AI-powered NFL betting analytics using Elo ratings. Injury-adjusted probabilities for every game, QB impact quantified, and transparent edge detection across all 32 teams.',
  alternates: {
    canonical: '/nfl-betting',
  },
  openGraph: {
    title: 'NFL Betting Model | Elo-Based Edge Detection',
    description: 'Find edges in NFL betting markets with Elo ratings, real-time injury adjustments, and transparent AI analysis.',
    url: 'https://betanalytics.ai/nfl-betting',
    type: 'website',
  },
}

const nflFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How do Elo ratings work for NFL betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Each NFL team starts with a 1500 Elo rating. We use a K-factor of 40 (suited for the 17-game season where each game carries more weight), recency weighting with 0.90 decay, and a +48 home field advantage. The rating gap directly maps to a win probability.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does the model handle NFL QB injuries?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'NFL QB injuries are the most impactful in sports. A starting QB being out costs -80 Elo points. Backup QBs and positional players carry different weights. We pull real-time ESPN injury data and apply status multipliers (Out: 100%, Doubtful: 70%, Questionable: 15%).',
      },
    },
    {
      '@type': 'Question',
      name: 'What NFL-specific factors does the model consider?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Short rest (Thursday games: -3%), bye week advantage (+2%), divisional rivalry intensity (+2.5%), weather impacts, travel fatigue for cross-country games, and playoff implications.',
      },
    },
  ],
}

export default function NFLBettingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(nflFaqSchema) }}
      />

      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/logo.png" alt="BetAnalytics.ai Logo" width={40} height={40} />
              <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                BetAnalytics.ai
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-5">
              <Link href="/picks" className="text-sm text-slate-300 hover:text-white transition-colors">Model Picks</Link>
              <Link href="/methodology" className="text-sm text-slate-300 hover:text-white transition-colors">Methodology</Link>
              <Link href="/blog" className="text-sm text-slate-300 hover:text-white transition-colors">Blog</Link>
              <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors">Sign In</Link>
              <Link href="/signup" className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg font-semibold text-sm transition-all shadow-lg shadow-blue-500/25">
                Start Free Trial
              </Link>
            </div>
            <MobileNav />
          </div>
        </div>
      </header>

      <main>
        <section className="pt-16 pb-12 md:pt-24 md:pb-16 px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-4 py-1.5 mb-6">
              <span className="text-green-400 text-sm font-medium">NFL Betting Model</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-5 leading-[1.1] tracking-tight">
              NFL Betting With{' '}
              <span className="bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
                Elo Ratings
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-300 mb-8 max-w-2xl mx-auto leading-relaxed">
              All 32 NFL teams rated. QB injuries quantified at -80 Elo. Every game analyzed with full transparency on how we calculate edges.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-3">
              <Link href="/signup" className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2">
                Start 3-Day Free Trial <ArrowRight className="w-5 h-5" />
              </Link>
              <Link href="/methodology" className="px-8 py-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2">
                <Eye className="w-5 h-5" /> See Full Methodology
              </Link>
            </div>
            <p className="text-sm text-slate-500">No credit card required</p>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-12">How Our NFL Model Works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Elo Ratings (K=40)</h3>
                <p className="text-slate-400 text-sm">32 NFL teams rated with K-factor of 40. Each game in the 17-game season carries significant weight. Recency decay at 0.90 captures momentum shifts.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Activity className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">QB Impact: -80 Elo</h3>
                <p className="text-slate-400 text-sm">Starting QB out costs -80 Elo points&mdash;the largest single-player impact in any sport. Real-time ESPN injury reports processed automatically.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Target className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Edge Detection</h3>
                <p className="text-slate-400 text-sm">We compare our Elo-derived probability to market odds. When the gap is 3%+, that&apos;s a value bet. Every pick tracked and verified publicly.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-4">NFL-Specific Factors</h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">Football-specific adjustments that go beyond raw Elo ratings.</p>
            <div className="grid md:grid-cols-2 gap-6">
              <FactorCard title="Thursday Night Games" value="-3%" description="Short rest on Thursday is brutal. Teams on short rest see a measurable performance drop compared to normal rest." />
              <FactorCard title="Home Field Advantage" value="+48 Elo" description="NFL home teams win about 55-57% of games. We add 48 Elo points at prediction time to reflect this edge." />
              <FactorCard title="Bye Week Advantage" value="+2%" description="Teams coming off a bye are rested, prepared, and historically perform above baseline. We add 2% win probability." />
              <FactorCard title="Divisional Rivalry" value="+2.5%" description="Divisional games are more competitive regardless of talent gap. We boost underdog probability by 2.5%." />
              <FactorCard title="Weather Impact" value="Variable" description="Extreme cold, wind, and precipitation can neutralize passing advantages. We adjust based on conditions when data is available." />
              <FactorCard title="Playoff Implications" value="+2%" description="Must-win games for playoff contenders get a +2% boost. Teams eliminated from contention see a -3% penalty." />
            </div>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-center mb-10">NFL Betting FAQ</h2>
            <div className="space-y-4">
              <FAQItem question="How do Elo ratings work for NFL betting?" answer="Each NFL team starts at 1500 Elo. We use K=40 because the 17-game season means each game carries more weight. Recency decay at 0.90 captures momentum. Home field is +48 Elo. The rating gap maps to a win probability using the Elo expected score formula." />
              <FAQItem question="How does the model handle QB injuries?" answer="NFL QB injuries are the single most impactful in all of sports. A starting QB being out costs -80 Elo points. This is roughly equivalent to turning a 7-point favorite into a pick'em. We process real-time ESPN data with status multipliers." />
              <FAQItem question="What about NFL player props?" answer="We analyze individual player performance using rolling averages with opponent adjustments and game script factors. We cover passing yards, rushing yards, receiving yards, touchdowns, and other popular markets." />
              <FAQItem question="How does the model handle the NFL playoffs?" answer="Playoff games have no home field advantage adjustment for neutral-site games (Super Bowl). We increase the weight of recent performance and account for the higher intensity and preparation level in postseason games." />
            </div>
          </div>
        </section>

        <section className="py-20 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold mb-4">Find NFL Edges Every Week</h2>
            <p className="text-slate-400 mb-8 text-lg">Every NFL game analyzed. QB impact quantified. Full math shown.</p>
            <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
            <p className="text-sm text-slate-500 mt-3">No credit card required</p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

function FactorCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-cyan-400 font-mono text-sm font-bold">{value}</span>
      </div>
      <p className="text-slate-400 text-sm">{description}</p>
    </div>
  )
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group bg-slate-900/30 border border-slate-800/50 rounded-xl overflow-hidden">
      <summary className="flex items-center justify-between cursor-pointer px-6 py-4 hover:bg-slate-800/20 transition-colors">
        <span className="font-semibold pr-4">{question}</span>
        <CheckCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
      </summary>
      <div className="px-6 pb-4 text-slate-400">{answer}</div>
    </details>
  )
}
