import Link from 'next/link'
import Image from 'next/image'
import { Metadata } from 'next'
import { ArrowRight, Eye, Target, Activity, BarChart3, CheckCircle } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata: Metadata = {
  title: 'College Basketball Betting Model | NCAAB Elo Ratings - BetAnalytics.ai',
  description: 'AI-powered college basketball betting analytics using Elo ratings. 363 teams tracked with injury adjustments and edge detection. Perfect for March Madness bracket analysis.',
  alternates: {
    canonical: '/ncaab-betting',
  },
  openGraph: {
    title: 'NCAAB Betting Model | March Madness Elo Ratings',
    description: 'Find edges in college basketball betting with Elo ratings across 363 teams. March Madness bracket analysis powered by AI.',
    url: 'https://betanalytics.ai/ncaab-betting',
    type: 'website',
  },
}

const ncaabFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How do Elo ratings work for college basketball betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Each of the 363 Division I teams gets an Elo rating starting at 1500. We use K=32 for college basketball, with recency weighting at 0.92 decay. Home court is worth +100 Elo points (larger than NBA because college home court advantage is stronger). Conference tournament and March Madness games use neutral court settings.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use Elo ratings for March Madness brackets?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Elo ratings are one of the best predictors for March Madness. Higher Elo teams win more often, and the rating gap between two teams directly translates to a win probability. For bracket pools, you can use our probabilities to find the optimal mix of chalk picks and upsets.',
      },
    },
    {
      '@type': 'Question',
      name: 'Why is college basketball home court advantage larger than NBA?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'College basketball home teams win about 60-65% of games (vs 56-58% in NBA). Student sections, smaller arenas, and younger players more affected by crowd noise all contribute. We use +100 Elo for home court (vs +55 in NBA) to reflect this.',
      },
    },
  ],
}

export default function NCAABBettingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ncaabFaqSchema) }}
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
            <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 mb-6">
              <span className="text-blue-400 text-sm font-medium">NCAAB Betting Model</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-5 leading-[1.1] tracking-tight">
              College Basketball Betting With{' '}
              <span className="bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
                Elo Ratings
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-300 mb-8 max-w-2xl mx-auto leading-relaxed">
              363 Division I teams rated. March Madness bracket probabilities. Find where our model disagrees with the market across every college basketball game.
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
            <h2 className="text-3xl font-bold text-center mb-12">How Our NCAAB Model Works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Elo Ratings (K=32)</h3>
                <p className="text-slate-400 text-sm">363 D-I teams rated with K=32. Recency decay at 0.92 captures hot streaks and slumps. Ratings carry over between seasons with regression to the mean.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Activity className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Home Court: +100 Elo</h3>
                <p className="text-slate-400 text-sm">College home court is massive&mdash;worth +100 Elo. Student sections and smaller arenas make this the largest home advantage in major American sports.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Target className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">March Madness Ready</h3>
                <p className="text-slate-400 text-sm">Neutral court adjustments for tournament games. Elo ratings are one of the best bracket predictors, mapping rating gaps directly to upset probabilities.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-4">NCAAB-Specific Factors</h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">College basketball has unique dynamics we capture in the model.</p>
            <div className="grid md:grid-cols-2 gap-6">
              <FactorCard title="Home Court Advantage" value="+100 Elo" description="The largest home advantage in American sports. Student sections and intimate arenas create a massive edge for home teams." />
              <FactorCard title="Conference Play Weight" value="1.2x" description="Conference games are weighted 1.2x more than non-conference games because they better reflect team quality within competitive balance." />
              <FactorCard title="Tournament Neutral Court" value="0 HCA" description="March Madness and conference tournament games use neutral court settings. No home court advantage is applied." />
              <FactorCard title="Strength of Schedule" value="Elo-based" description="Because we rate every D-I team, strength of schedule is built into the Elo ratings. Beating a 1600-rated team is worth more than beating a 1400-rated team." />
              <FactorCard title="Season Regression" value="33% to mean" description="Between seasons, all Elo ratings regress 33% toward 1500. This accounts for roster turnover while preserving program strength." />
              <FactorCard title="Upset Probability" value="Direct from Elo" description="A 12-seed vs 5-seed upset probability comes directly from the Elo gap. Our model quantifies exact upset chances for every matchup." />
            </div>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-center mb-10">College Basketball Betting FAQ</h2>
            <div className="space-y-4">
              <FAQItem question="How do Elo ratings work for college basketball?" answer="Each of the 363 Division I teams starts at 1500. We use K=32, recency decay at 0.92, and +100 home court advantage. The rating gap between two teams maps directly to a win probability. Higher K-factor than NBA because the college season has fewer games." />
              <FAQItem question="Can I use this for March Madness brackets?" answer="Absolutely. Elo ratings are among the best predictors for March Madness outcomes. The rating gap between any two teams gives you an exact upset probability. Use these to find the optimal balance of chalk picks and calculated upsets in your bracket." />
              <FAQItem question="Why is home court bigger in college?" answer="College home teams win 60-65% of games vs 56-58% in the NBA. Younger players are more affected by hostile environments, student sections create intense atmospheres, and smaller arenas amplify noise. We use +100 Elo (vs +55 in NBA) to capture this." />
              <FAQItem question="How does the model handle mid-major vs power conference?" answer="Elo ratings naturally capture this. Power conference teams play tougher schedules, so their ratings are generally higher. But a strong mid-major (like a 27-4 team from the Mountain West) will have a legitimately high Elo if they've beaten quality opponents." />
            </div>
          </div>
        </section>

        <section className="py-20 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold mb-4">Get NCAAB Edges for March Madness</h2>
            <p className="text-slate-400 mb-8 text-lg">363 teams rated. Every game analyzed. Every bracket probability calculated.</p>
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
