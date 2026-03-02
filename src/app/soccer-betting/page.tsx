import Link from 'next/link'
import Image from 'next/image'
import { Metadata } from 'next'
import { ArrowRight, Eye, Target, Activity, BarChart3, CheckCircle } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata: Metadata = {
  title: 'Soccer Betting Model | Premier League, La Liga & More - BetAnalytics.ai',
  description: 'AI-powered soccer betting analytics using Elo ratings. Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League. 200+ clubs tracked with injury adjustments.',
  alternates: {
    canonical: '/soccer-betting',
  },
  openGraph: {
    title: 'Soccer Betting Model | Elo Ratings Across 7 Leagues',
    description: 'Find edges in soccer betting markets with Elo ratings across Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League.',
    url: 'https://betanalytics.ai/soccer-betting',
    type: 'website',
  },
}

const soccerFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What soccer leagues does BetAnalytics cover?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'We cover Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League. Over 200 clubs are tracked with Elo ratings updated after every match.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do Elo ratings work for soccer betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Each club starts at 1500 Elo. We use K=30 for league play and K=40 for Champions League. Home advantage is +65 Elo for domestic leagues. Draws are handled with a 0.5 result (partial win/loss). The three-outcome nature of soccer (win/draw/loss) is modeled using the Elo gap to estimate probabilities for each outcome.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does the model handle Champions League vs domestic form?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Champions League uses a higher K-factor (40 vs 30) because results carry more weight. Cross-league matchups use each team\'s domestic Elo rating. Home advantage in CL is reduced to +40 Elo since stadiums are often at neutral-like intensity for European nights.',
      },
    },
  ],
}

export default function SoccerBettingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(soccerFaqSchema) }}
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
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-6">
              <span className="text-emerald-400 text-sm font-medium">Soccer Betting Model</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-5 leading-[1.1] tracking-tight">
              Soccer Betting With{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                Elo Ratings
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-300 mb-8 max-w-2xl mx-auto leading-relaxed">
              200+ clubs across 7 leagues. Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League&mdash;all rated, all analyzed.
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
            <h2 className="text-3xl font-bold text-center mb-12">Leagues We Cover</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <LeagueCard name="Premier League" country="England" teams={20} color="text-purple-400" />
              <LeagueCard name="La Liga" country="Spain" teams={20} color="text-orange-400" />
              <LeagueCard name="Bundesliga" country="Germany" teams={18} color="text-red-400" />
              <LeagueCard name="Serie A" country="Italy" teams={20} color="text-blue-400" />
              <LeagueCard name="Ligue 1" country="France" teams={18} color="text-cyan-400" />
              <LeagueCard name="MLS" country="USA/Canada" teams={29} color="text-green-400" />
              <LeagueCard name="Champions League" country="Europe" teams={36} color="text-amber-400" />
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 flex items-center justify-center">
                <span className="text-slate-500 text-sm text-center">200+ clubs total</span>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-12">How Our Soccer Model Works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Three-Outcome Modeling</h3>
                <p className="text-slate-400 text-sm">Soccer has win/draw/loss. We use the Elo gap to estimate probabilities for all three outcomes, critical for 1X2 markets and double chance bets.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Activity className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Cross-League Comparison</h3>
                <p className="text-slate-400 text-sm">Champions League pits clubs from different leagues. Our unified Elo system lets us compare a Serie A side vs a Bundesliga side directly.</p>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
                <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Target className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Draw Probability</h3>
                <p className="text-slate-400 text-sm">Soccer draws happen 25-30% of the time. Our model explicitly calculates draw probability from Elo gaps, a critical edge other models miss.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-4">Soccer-Specific Factors</h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">Soccer has unique dynamics we capture beyond raw Elo ratings.</p>
            <div className="grid md:grid-cols-2 gap-6">
              <FactorCard title="Home Advantage (Domestic)" value="+65 Elo" description="Domestic league home teams get +65 Elo. This varies by league&mdash;Premier League home advantage has declined in recent years." />
              <FactorCard title="Home Advantage (CL)" value="+40 Elo" description="Champions League home advantage is reduced to +40 Elo. European nights level the playing field somewhat." />
              <FactorCard title="Draw Threshold" value="Elo-based" description="When the Elo gap is small (under 50), draw probability increases significantly. We model this with a continuous function, not arbitrary cutoffs." />
              <FactorCard title="Fixture Congestion" value="-2%" description="Teams playing midweek European matches and weekend league games see a -2% adjustment for the second game due to rotation and fatigue." />
              <FactorCard title="Derby Matches" value="+2.5%" description="Local derbies (Manchester, Madrid, Milan, etc.) see elevated competitiveness. Underdog probability gets a 2.5% boost." />
              <FactorCard title="Late Season Motivation" value="Variable" description="Teams with nothing to play for (safe from relegation, no European spots) see reduced motivation. Teams in relegation fights get a +2% boost." />
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-center mb-10">Soccer Betting FAQ</h2>
            <div className="space-y-4">
              <FAQItem question="What soccer leagues does BetAnalytics cover?" answer="Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League. Over 200 clubs tracked with Elo ratings updated after every match." />
              <FAQItem question="How do Elo ratings handle soccer draws?" answer="Draws are treated as a 0.5 result (partial win/loss for both teams). For prediction, we use the Elo gap to calculate win/draw/loss probabilities using a three-outcome model. When teams are closely matched, draw probability is highest." />
              <FAQItem question="How does the model handle Champions League vs domestic form?" answer="Champions League uses K=40 (vs K=30 for domestic). Cross-league matchups use each team's domestic Elo. Home advantage in CL is +40 Elo (vs +65 domestic) since the atmosphere is more balanced in European competition." />
              <FAQItem question="Can I bet on soccer with this model?" answer="Yes. We provide edge detection for 1X2 markets (moneyline), double chance, and totals across all covered leagues. The model identifies value bets where our Elo-derived probability differs significantly from market odds." />
            </div>
          </div>
        </section>

        <section className="py-20 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold mb-4">Find Soccer Edges Across 7 Leagues</h2>
            <p className="text-slate-400 mb-8 text-lg">200+ clubs rated. Every match analyzed. Draw probability modeled.</p>
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

function LeagueCard({ name, country, teams, color }: { name: string; country: string; teams: number; color: string }) {
  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4">
      <div className={`font-semibold text-sm ${color}`}>{name}</div>
      <div className="text-xs text-slate-500 mt-1">{country}</div>
      <div className="text-xs text-slate-400 mt-2">{teams} teams</div>
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
