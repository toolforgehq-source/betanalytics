import Link from 'next/link'
import Image from 'next/image'
import { Activity, Shield, BarChart3, CheckCircle, Clock, Target, Zap, ChevronDown, TrendingUp } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata = {
  title: 'Sports Betting AI | Elo-Based Edge Detection - BetAnalytics.ai',
  description: 'AI-powered sports betting analytics using Elo ratings. Find edges where our model disagrees with the market. 692 teams tracked across NBA, NFL, NHL, MLB. 3-day free trial.',
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
            <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm relative">
              <div className="container mx-auto px-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Image
                      src="/logo.png"
                      alt="BetAnalytics.ai Logo"
                      width={64}
                      height={64}
                      className="rounded-lg"
                    />
                    <div>
                      <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                        BetAnalytics.ai
                      </span>
                      <p className="text-sm text-slate-400">Elo-Powered Sports Betting Intelligence</p>
                    </div>
                  </div>
            
                  {/* Desktop Navigation */}
                  <div className="hidden md:flex items-center gap-4">
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

      <main>
        {/* Hero Section */}
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-6xl text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              Sports Betting AI:{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Find The Edge The Market Is Missing
              </span>
            </h1>
            <p className="text-xl text-slate-300 mb-4 max-w-3xl mx-auto">
              Our Elo rating system analyzes 3+ months of game data across 692 teams to find bets where the market undervalues teams.
            </p>
            <p className="text-lg text-cyan-400 mb-8 max-w-2xl mx-auto font-medium">
              When our model says 86.7% but the market shows 68.6%, that&apos;s an 18% edge.
            </p>
            
            {/* Edge Example Box - Visual Hook */}
            <div className="max-w-md mx-auto mb-8">
              <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6">
                <div className="text-sm text-slate-400 mb-4 uppercase tracking-wide font-semibold">Example Edge Found</div>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-slate-300">Our Elo Model</span>
                      <span className="text-2xl font-bold text-white">86.7%</span>
                    </div>
                    <div className="w-full bg-slate-700/50 rounded-full h-3">
                      <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-3 rounded-full" style={{ width: '86.7%' }}></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-slate-300">Market Implied</span>
                      <span className="text-2xl font-bold text-slate-400">68.6%</span>
                    </div>
                    <div className="w-full bg-slate-700/50 rounded-full h-3">
                      <div className="bg-slate-500 h-3 rounded-full" style={{ width: '68.6%' }}></div>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-700/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 font-medium">Edge Found</span>
                      <span className="text-3xl font-bold text-green-400">+18.1%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/signup" 
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
              >
                Start 3-Day Free Trial
              </Link>
              <Link 
                href="/pricing" 
                className="px-8 py-4 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-xl font-semibold text-lg transition-colors"
              >
                View Pricing
              </Link>
            </div>
            <p className="text-sm text-slate-400 mt-4">
              No credit card required. $29/month after trial.
            </p>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-4">
              How Our AI Sports Picks Work
            </h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
              We calculate independent probabilities using Elo ratings, then show you where our model disagrees with the market.{' '}
              <Link href="/methodology" className="text-cyan-400 hover:text-cyan-300 underline">Learn more about our methodology</Link>
            </p>
            
            <div className="space-y-12">
              <HowItWorksStep 
                number={1}
                title="We Calculate Team Strength Using Elo Ratings"
                description="Just like chess ratings, we track every team's performance. Win games? Rating goes up. Lose? Goes down. We use 3+ months of historical data to calculate current team strength, then predict matchups."
                bullets={[
                  "692 teams tracked across all major sports",
                  "Recency-weighted: recent games matter more",
                  "Updated daily with latest results"
                ]}
              />
              
              <HowItWorksStep 
                number={2}
                title="We Adjust for Real-Time Context"
                description="Injuries change everything. We don't just mention them - we quantify the impact automatically using real-time ESPN data:"
                bullets={[
                  "NFL/NCAAF starting QB out: -80 Elo points",
                  "NHL starting goalie out: -30 Elo points",
                  "Top 3 scorer out (NBA/NHL): -20 Elo points each",
                  "MLB ace pitcher (ERA < 3.0): +20 Elo points"
                ]}
                note="Status matters too: Out = 100% impact, Doubtful = 70%, Questionable = 15%"
              />
              
              <HowItWorksStep 
                number={3}
                title="We Show You The Edge"
                description="We compare our Elo probability to market implied probability. When they disagree significantly, that's an edge. You see every calculation. Full transparency."
              />
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center mb-4">
              Sports Betting Analytics That Actually Explains The Math
            </h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
              No black box. No vague &quot;AI-powered&quot; claims. See exactly how we calculate every recommendation.
            </p>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard 
                icon={<Target className="w-7 h-7" />}
                title="Independent Elo Rating System"
                description="We calculate our own probabilities - not copying the market. 692 teams tracked across NBA, NFL, NHL, MLB, NCAAB, NCAAF, and major soccer leagues."
              />
              <FeatureCard 
                icon={<Activity className="w-7 h-7" />}
                title="Injury-Adjusted Predictions"
                description="Real-time ESPN data feeds into our model. Starting QB out? We subtract 80 Elo points automatically. Every injury is quantified, not just mentioned."
              />
              <FeatureCard 
                icon={<BarChart3 className="w-7 h-7" />}
                title="Full Methodology Transparency"
                description="See the Elo ratings, the injury adjustments, the edge calculation. No black box. You understand exactly why we recommend each bet."
              />
              <FeatureCard 
                icon={<TrendingUp className="w-7 h-7" />}
                title="All Major Sports Covered"
                description="NBA, NFL, NHL, MLB, College Basketball, College Football, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League."
              />
              <FeatureCard 
                icon={<Clock className="w-7 h-7" />}
                title="Hourly Data Updates"
                description="Odds refresh every hour. More frequently during peak betting windows. Elo ratings update daily with latest game results."
              />
              <FeatureCard 
                icon={<Zap className="w-7 h-7" />}
                title="Recency-Weighted Analysis"
                description="Recent games matter more than games from October. We use sport-specific decay factors (0.95-0.99) so hot teams and cold streaks are reflected in current ratings."
              />
              <FeatureCard 
                icon={<Shield className="w-7 h-7" />}
                title="Responsible Betting Focus"
                description="We show probabilities, not guarantees. Emphasis on bankroll management and understanding the math behind every recommendation."
              />
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-12">
              Frequently Asked Questions About AI Sports Betting
            </h2>
            
            <div className="space-y-6">
              <FAQItem 
                question="What is Elo rating in sports betting?"
                answer="Elo is a rating system originally created for chess. Each team starts at 1500. Win games and your rating goes up; lose and it goes down. We use Elo to calculate the probability of one team beating another, independent of what the market thinks."
              />
              <FAQItem 
                question="How accurate are AI sports picks?"
                answer="We show probabilities, not guarantees. When we say 86%, you should expect to win roughly 86% of similar bets over time. We log every recommendation so you can verify our accuracy."
              />
              <FAQItem 
                question="What makes this different from other betting tools?"
                answer="We don't give opinions. We calculate independent probabilities using Elo ratings, then show you where our model disagrees with the market. Full transparency - you see every calculation, every adjustment, every edge."
              />
              <FAQItem 
                question="How do injury adjustments work?"
                answer="Real-time ESPN data feeds in automatically. Starting QB out? We subtract 80 Elo points. Star player questionable? We reduce impact to 15%. MLB ace pitching? We add 20 points. All automatic, all quantified."
              />
              <FAQItem 
                question="What sports do you cover?"
                answer="NBA, NFL, NHL, MLB, College Basketball (NCAAB), College Football (NCAAF), and major soccer leagues including Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League."
              />
              <FAQItem 
                question="Do you guarantee I'll win money?"
                answer="No. Sports betting always involves risk. We show you where our mathematical model finds edges, but even with an edge, individual bets can lose. We recommend only betting what you can afford to lose and focusing on long-term expected value rather than individual outcomes."
              />
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold mb-4">Simple Pricing for Sports Betting Analytics</h2>
            <p className="text-slate-400 mb-8">Everything included. No hidden fees. Cancel anytime.</p>
            
            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8 max-w-md mx-auto">
              <div className="text-5xl font-bold mb-2">$29<span className="text-xl text-slate-400">/month</span></div>
              <p className="text-slate-300 mb-6">Everything included. Cancel anytime.</p>
              <ul className="text-left space-y-3 mb-8">
                <PricingFeature text="Elo-based edge detection across all sports" />
                <PricingFeature text="Real-time injury-adjusted probabilities" />
                <PricingFeature text="Full methodology transparency" />
                <PricingFeature text="Unlimited queries" />
                <PricingFeature text="All major sports covered" />
                <PricingFeature text="Hourly data updates" />
              </ul>
              <Link 
                href="/signup" 
                className="block w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30 text-center"
              >
                Start 3-Day Free Trial
              </Link>
              <p className="text-sm text-slate-400 mt-4">No credit card required to start.</p>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to Find Edges The Market Is Missing?</h2>
            <p className="text-slate-300 mb-8 text-lg">
              Our Elo rating system has tracked 692 teams across 3+ months of games. We quantify injuries, weight recent performance, and show you exactly where our probability differs from the market.
            </p>
            <Link 
              href="/signup" 
              className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
            >
              Start Your 3-Day Free Trial
            </Link>
            <p className="text-sm text-slate-400 mt-4">
              No credit card required. Full access for 3 days. $29/month after.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
      <div className="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-cyan-400/20 rounded-xl flex items-center justify-center text-blue-400 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-slate-400 text-sm">{description}</p>
    </div>
  )
}

function HowItWorksStep({ number, title, description, bullets, note }: { 
  number: number
  title: string
  description: string
  bullets?: string[]
  note?: string
}) {
  return (
    <div className="flex gap-6 items-start">
      <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
        {number}
      </div>
      <div className="flex-1">
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-slate-400 mb-3">{description}</p>
        {bullets && (
          <ul className="space-y-2 mb-3">
            {bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300">{bullet}</span>
              </li>
            ))}
          </ul>
        )}
        {note && (
          <p className="text-sm text-cyan-400 italic">{note}</p>
        )}
      </div>
    </div>
  )
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-xl p-6">
      <div className="flex items-start gap-3">
        <ChevronDown className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-1" />
        <div>
          <h3 className="font-semibold mb-2">{question}</h3>
          <p className="text-slate-400">{answer}</p>
        </div>
      </div>
    </div>
  )
}

function PricingFeature({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2">
      <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
      <span className="text-slate-300">{text}</span>
    </li>
  )
}
