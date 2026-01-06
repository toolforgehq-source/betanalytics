import Link from 'next/link'
import { TrendingUp, Brain, Calculator, Zap, Shield, BarChart3, CheckCircle } from 'lucide-react'
import Footer from '@/components/Footer'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  Betanalytics.ai
                </h1>
                <p className="text-xs text-slate-400">AI Sports Betting Intelligence</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
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
          </div>
        </div>
      </header>

      <main>
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-6xl text-center">
            <h1 className="text-5xl md:text-6xl font-bold mb-6">
              Win More Bets With{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                AI-Powered Intelligence
              </span>
            </h1>
            <p className="text-xl text-slate-300 mb-8 max-w-3xl mx-auto">
              Multi-model analysis. Educational insights. Data-driven recommendations.
              Learn WHY bets work while getting winning picks.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/signup" 
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
              >
                Start Free Trial - 3 Questions Free
              </Link>
              <Link 
                href="/pricing" 
                className="px-8 py-4 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-xl font-semibold text-lg transition-colors"
              >
                View Pricing
              </Link>
            </div>
            <p className="text-sm text-slate-400 mt-4">
              $69/month after trial. Cancel anytime.
            </p>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center mb-12">
              Why Betanalytics.ai?
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard 
                icon={<Brain className="w-8 h-8" />}
                title="Multi-Model Consensus"
                description="We only recommend bets when 3-4 statistical models agree. No guessing, just data."
              />
              <FeatureCard 
                icon={<Zap className="w-8 h-8" />}
                title="Educational Approach"
                description="Learn WHY bets work. Understand line movement, sharp money, and value betting."
              />
              <FeatureCard 
                icon={<Calculator className="w-8 h-8" />}
                title="Hedge Calculator"
                description="Calculate optimal hedge amounts for your parlays. Lock in guaranteed profits."
              />
              <FeatureCard 
                icon={<BarChart3 className="w-8 h-8" />}
                title="All Sports & Platforms"
                description="DraftKings, FanDuel, PrizePicks, Underdog - we cover every sport and platform."
              />
              <FeatureCard 
                icon={<Shield className="w-8 h-8" />}
                title="Responsible Gambling"
                description="We emphasize bankroll management and responsible betting practices."
              />
              <FeatureCard 
                icon={<TrendingUp className="w-8 h-8" />}
                title="Real-Time Analysis"
                description="Get up-to-date analysis on line movements, injuries, and sharp money signals."
              />
            </div>
          </div>
        </section>

        <section className="py-16 px-4">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-12">
              How It Works
            </h2>
            <div className="space-y-8">
              <Step number={1} title="Ask Any Question" description="Ask about any sport, any bet type, any platform. Our AI understands it all." />
              <Step number={2} title="Get Data-Driven Analysis" description="Receive detailed breakdowns with model consensus, edges, and statistical backing." />
              <Step number={3} title="Learn Why It Works" description="Every recommendation comes with educational insights so you become a better bettor." />
              <Step number={4} title="Bet Smarter" description="Make informed decisions with confidence. Track your progress and improve over time." />
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold mb-8">Simple Pricing</h2>
            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8 max-w-md mx-auto">
              <div className="text-5xl font-bold mb-2">$69<span className="text-xl text-slate-400">/month</span></div>
              <p className="text-slate-300 mb-6">Everything included. Cancel anytime.</p>
              <ul className="text-left space-y-3 mb-8">
                <PricingFeature text="Unlimited questions" />
                <PricingFeature text="All sports covered" />
                <PricingFeature text="Multi-model analysis" />
                <PricingFeature text="Educational insights" />
                <PricingFeature text="Hedge calculator" />
                <PricingFeature text="Bet tracking (coming soon)" />
              </ul>
              <Link 
                href="/signup" 
                className="block w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30 text-center"
              >
                Start Free Trial
              </Link>
              <p className="text-sm text-slate-400 mt-4">3 questions free. No credit card required.</p>
            </div>
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
      <div className="w-14 h-14 bg-gradient-to-br from-blue-500/20 to-cyan-400/20 rounded-xl flex items-center justify-center text-blue-400 mb-4">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-slate-400">{description}</p>
    </div>
  )
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex gap-6 items-start">
      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold mb-1">{title}</h3>
        <p className="text-slate-400">{description}</p>
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
