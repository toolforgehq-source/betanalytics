import Link from 'next/link'
import Image from 'next/image'
import { Metadata } from 'next'
import { ArrowRight, Eye, Target, Activity, BarChart3, CheckCircle } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata: Metadata = {
  title: 'NBA Betting Model | Elo Ratings & AI Picks - BetAnalytics.ai',
  description: 'AI-powered NBA betting analytics using Elo ratings. Get injury-adjusted probabilities, edge detection, and transparent picks for every NBA game. 30 teams tracked daily.',
  alternates: {
    canonical: '/nba-betting',
  },
  openGraph: {
    title: 'NBA Betting Model | Elo-Based Edge Detection',
    description: 'Find edges in NBA betting markets with Elo ratings, real-time injury adjustments, and transparent AI analysis. Every pick tracked and verified.',
    url: 'https://betanalytics.ai/nba-betting',
    type: 'website',
  },
}

const nbaFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How do Elo ratings work for NBA betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Each NBA team starts with a 1500 Elo rating. Wins increase the rating, losses decrease it. We use a K-factor of 20 (suited for the 82-game season), recency weighting with 0.95 decay, and a +55 home court advantage. The rating difference between two teams directly translates to a win probability.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do NBA injuries affect Elo ratings?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'We quantify NBA injuries using real-time ESPN data. A top-3 scorer being out costs -20 Elo points per player. Status multipliers apply: Out = 100% impact, Doubtful = 70%, Questionable = 15%. This means if a star is questionable, we only apply 15% of the adjustment since questionable players play about 85% of the time.',
      },
    },
    {
      '@type': 'Question',
      name: 'What NBA situational factors does the model consider?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Beyond Elo, we factor in back-to-back games (-4% adjustment), rest advantage (+1.5% per day, capped at 4.5%), travel fatigue (-0.5% to -2.5% depending on distance), recent form, rivalry boosts, playoff implications, and more.',
      },
    },
    {
      '@type': 'Question',
      name: 'How accurate is the NBA betting model?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Every NBA pick is tracked and graded publicly. We show probabilities, not guarantees. Our model finds edges by comparing Elo-derived probabilities with market-implied odds. When the gap is significant (3%+ edge), that represents a potential value bet.',
      },
    },
  ],
}

export default function NBABettingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(nbaFaqSchema) }}
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
            <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-4 py-1.5 mb-6">
              <span className="text-orange-400 text-sm font-medium">NBA Betting Model</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-5 leading-[1.1] tracking-tight">
              NBA Betting With{' '}
              <span className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
                Elo Ratings
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-300 mb-8 max-w-2xl mx-auto leading-relaxed">
              Every NBA team rated. Every injury quantified. See where our model disagrees with the market and find edges in tonight&apos;s games.
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
            <h2 className="text-3xl font-bold text-center mb-12">How Our NBA Model Works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-orange-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Elo Ratings (K=20)</h3>
                <p className="text-slate-400 text-sm">All 30 NBA teams rated with a K-factor of 20, optimized for the 82-game season. Recency-weighted so recent performance matters more.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Activity className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Injury Adjustments</h3>
                <p className="text-slate-400 text-sm">Top-3 scorer out = -20 Elo points each. Real-time ESPN data with status multipliers (Out: 100%, Doubtful: 70%, Questionable: 15%).</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Target className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Edge Detection</h3>
                <p className="text-slate-400 text-sm">We compare our Elo probability to market odds. When the gap is 3%+, that&apos;s a potential value bet. Minimum 3-point margin for spread picks.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-4">NBA-Specific Factors</h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">Beyond Elo ratings, we capture NBA-specific context that affects game outcomes.</p>
            <div className="grid md:grid-cols-2 gap-6">
              <FactorCard title="Back-to-Back Games" value="-4%" description="Teams playing their second game in two nights see a measurable performance drop. We adjust probability accordingly." />
              <FactorCard title="Home Court Advantage" value="+55 Elo" description="NBA home teams win ~56-58% of games. We add 55 Elo points at prediction time to account for this." />
              <FactorCard title="Rest Advantage" value="+1.5%/day" description="Each extra rest day adds 1.5% to win probability, capped at +4.5%. Rest matters in the NBA grind." />
              <FactorCard title="Travel Fatigue" value="Up to -2.5%" description="Cross-country trips carry a -2.5% adjustment. Shorter trips see -0.5% to -1.5% depending on distance." />
              <FactorCard title="Rivalry Boost" value="+2.5%" description="Lakers vs Celtics, Knicks vs Nets, and other intense rivalries get a boost for elevated intensity." />
              <FactorCard title="Playoff Implications" value="+2%" description="Must-win games for playoff positioning get a +2% boost. Eliminated teams see a -3% penalty." />
            </div>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-center mb-10">NBA Betting FAQ</h2>
            <div className="space-y-4">
              <FAQItem question="How do Elo ratings work for NBA betting?" answer="Each NBA team starts with a 1500 Elo rating. Wins increase the rating, losses decrease it. We use a K-factor of 20, recency weighting with 0.95 decay, and +55 home court advantage. The rating difference between two teams translates directly to a win probability using the Elo expected score formula." />
              <FAQItem question="How do NBA injuries affect Elo ratings?" answer="We quantify NBA injuries using real-time ESPN data. A top-3 scorer being out costs -20 Elo points per player. Status multipliers apply: Out = 100%, Doubtful = 70%, Questionable = 15%. These adjustments are applied at prediction time, not stored in the actual Elo rating." />
              <FAQItem question="What NBA situational factors does the model consider?" answer="Back-to-back games (-4%), rest advantage (+1.5% per extra day), travel fatigue (up to -2.5%), recent form, rivalry boosts (+2.5% for intense matchups), playoff implications (+2% for must-win games), and eliminated team penalties (-3%)." />
              <FAQItem question="Do you cover NBA player props?" answer="Yes. We analyze individual player performance using rolling averages with recency weighting, opponent adjustments, and pace factors. We cover points, rebounds, assists, and three pointers made." />
            </div>
          </div>
        </section>

        <section className="py-20 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold mb-4">Find NBA Edges Tonight</h2>
            <p className="text-slate-400 mb-8 text-lg">Every NBA game analyzed. Every injury quantified. Full math shown.</p>
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
