import Link from 'next/link'
import Image from 'next/image'
import { Activity, Shield, BarChart3, CheckCircle, Clock, Target, Zap, ChevronDown, TrendingUp, User, MessageSquare, ArrowRight, Eye, Lock } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'
import LiveStats from '@/components/LiveStats'
import ChatDemo from '@/components/ChatDemo'

export const metadata = {
  title: 'Sports Betting AI | Elo-Based Edge Detection - BetAnalytics.ai',
  description: 'AI-powered sports betting analytics using Elo ratings. Find edges where our model disagrees with the market. 692 teams tracked across NBA, NFL, NHL, MLB. Every pick tracked and verified. 3-day free trial.',
  alternates: {
    canonical: 'https://betanalytics.ai',
  },
  openGraph: {
    title: 'Sports Betting AI | Elo-Based Edge Detection - BetAnalytics.ai',
    description: 'Find edges where our Elo model disagrees with the market. Every pick tracked and verified. 692 teams, real-time injury adjustments. 3-day free trial.',
    url: 'https://betanalytics.ai',
    type: 'website' as const,
  },
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Elo rating in sports betting?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Elo is a rating system originally created for chess. Each team starts at 1500. Win games and your rating goes up; lose and it goes down. We use Elo to calculate the probability of one team beating another, independent of what the market thinks.',
      },
    },
    {
      '@type': 'Question',
      name: 'How accurate are AI sports picks?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'We show probabilities, not guarantees. When we say 86%, you should expect to win roughly 86% of similar bets over time. We log every recommendation so you can verify our accuracy on our Model Picks page.',
      },
    },
    {
      '@type': 'Question',
      name: 'What makes this different from other betting tools?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "Most tools give you a list of picks and say trust us. We give you an AI chat interface where you can ask about any game, any matchup, and get a full Elo breakdown in real time. Every pick is tracked and graded publicly so you can verify our performance.",
      },
    },
    {
      '@type': 'Question',
      name: 'How do injury adjustments work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Real-time ESPN data feeds in automatically. Starting QB out? We subtract 80 Elo points. Star player questionable? We reduce impact to 15%. MLB ace pitching? We add 20 points. All automatic, all quantified.',
      },
    },
    {
      '@type': 'Question',
      name: 'What sports do you cover?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'NBA, NFL, NHL, MLB, College Basketball (NCAAB), College Football (NCAAF), and major soccer leagues including Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do you guarantee I will win money?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. Sports betting always involves risk. We show you where our mathematical model finds edges, but even with an edge, individual bets can lose. We recommend only betting what you can afford to lose and focusing on long-term expected value rather than individual outcomes.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I see your track record before subscribing?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "Yes. Our Model Picks page is completely public. Every pick our model makes is recorded and automatically graded after games complete. You can see win rates, ROI, and performance breakdowns by sport and bet type.",
      },
    },
  ],
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm relative">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="BetAnalytics.ai Logo"
                width={48}
                height={48}
              />
              <div>
                <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  BetAnalytics.ai
                </span>
                <p className="text-xs text-slate-400">Elo-Powered Sports Betting Intelligence</p>
              </div>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-4">
              <Link href="/picks" className="text-slate-300 hover:text-white transition-colors">
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

      <main>
        {/* Hero Section */}
        <section className="py-16 md:py-24 px-4">
          <div className="container mx-auto max-w-6xl text-center">
            {/* Social Proof - Live Stats Banner */}
            <div className="mb-8">
              <LiveStats />
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              Stop Guessing.{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Start Betting With Math.
              </span>
            </h1>
            <p className="text-xl text-slate-300 mb-4 max-w-3xl mx-auto">
              Our Elo rating model calculates independent probabilities for every game. When our number disagrees with the market, that&apos;s your edge. Every pick tracked and verified publicly.
            </p>
            <p className="text-lg text-cyan-400 mb-8 max-w-2xl mx-auto font-medium">
              Ask about any game. Get the math. Make informed decisions.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
              <Link
                href="/signup"
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
              >
                Start 3-Day Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/picks"
                className="px-8 py-4 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2"
              >
                <Eye className="w-5 h-5" />
                See Our Track Record
              </Link>
            </div>
            <p className="text-sm text-slate-400">
              No credit card required. $39/month after trial. Cancel anytime.
            </p>
          </div>
        </section>

        {/* Why Different - Comparison Strip */}
        <section className="py-12 px-4 border-y border-slate-800/50 bg-slate-900/20">
          <div className="container mx-auto max-w-5xl">
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <ComparisonItem
                them="Tipsters give you picks and say trust me"
                us="We show you the Elo ratings, the math, and the edge"
                label="Transparency"
              />
              <ComparisonItem
                them="No verifiable track record"
                us="Every pick tracked and graded publicly"
                label="Accountability"
              />
              <ComparisonItem
                them="Static pick lists you check once a day"
                us="AI chat &mdash; ask about ANY game, player, or matchup"
                label="Flexibility"
              />
            </div>
          </div>
        </section>

        {/* Live Chat Demo Section */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-6xl">
            <div className="grid md:grid-cols-2 gap-10 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1.5 mb-6">
                  <MessageSquare className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm text-cyan-400 font-medium">AI Chat Interface</span>
                </div>
                <h2 className="text-3xl font-bold mb-4">
                  They Give You Picks.{' '}
                  <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                    We Give You a Conversation With The Math.
                  </span>
                </h2>
                <p className="text-slate-300 text-lg mb-6">
                  Ask about any game, any team, any matchup. Our AI walks you through the Elo ratings, injury adjustments, and edge calculations in real time.
                </p>
                <ul className="space-y-3 mb-8">
                  <ChatExampleBullet text="&ldquo;What&apos;s the best bet tonight?&rdquo; &mdash; full breakdown with score, edge, and value metrics" />
                  <ChatExampleBullet text="&ldquo;Should I take Lakers -5.5?&rdquo; &mdash; see the exact Elo edge for or against" />
                  <ChatExampleBullet text="&ldquo;Build me a 3-leg parlay&rdquo; &mdash; combined probability and edge for every leg" />
                  <ChatExampleBullet text="&ldquo;Best player props today&rdquo; &mdash; top props ranked by model probability" />
                </ul>
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
                >
                  <MessageSquare className="w-5 h-5" />
                  Try the AI Chat Free
                </Link>
              </div>

              {/* Animated Chat Demo */}
              <ChatDemo />
            </div>
          </div>
        </section>

        {/* Track Record Section - Social Proof */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-4 py-1.5 mb-6">
              <Target className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400 font-medium">Verified Track Record</span>
            </div>
            <h2 className="text-3xl font-bold mb-4">
              Every Pick Tracked.{' '}
              <span className="bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
                Every Result Verified.
              </span>
            </h2>
            <p className="text-slate-300 text-lg mb-8 max-w-2xl mx-auto">
              Unlike tipsters who hide their losses, every pick our model makes is recorded and automatically graded after games complete. See our full track record before you subscribe.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <TrackRecordCard title="Win Rate" description="Tracked across all sports and bet types" color="text-green-400" />
              <TrackRecordCard title="ROI Tracked" description="Units profit/loss on every pick" color="text-blue-400" />
              <TrackRecordCard title="By Sport" description="Performance breakdown per league" color="text-cyan-400" />
              <TrackRecordCard title="100% Public" description="No hidden picks or cherry-picked stats" color="text-purple-400" />
            </div>

            <Link
              href="/picks"
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-xl font-semibold text-green-400 transition-all"
            >
              View Full Track Record
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-16 px-4">
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
                description="Just like chess ratings, we track every team&apos;s performance. Win games? Rating goes up. Lose? Goes down. We use 3+ months of historical data to calculate current team strength, then predict matchups."
                bullets={["692 teams tracked across all major sports", "Recency-weighted: recent games matter more", "Updated daily with latest results"]}
              />
              <HowItWorksStep
                number={2}
                title="We Adjust for Real-Time Context"
                description="Injuries change everything. We quantify the impact automatically using real-time ESPN data:"
                bullets={["NFL/NCAAF starting QB out: -80 Elo points", "NHL starting goalie out: -30 Elo points", "Top 3 scorer out (NBA/NHL): -20 Elo points each", "MLB ace pitcher (ERA < 3.0): +20 Elo points"]}
                note="Status matters too: Out = 100% impact, Doubtful = 70%, Questionable = 15%"
              />
              <HowItWorksStep
                number={3}
                title="We Blend With Market Consensus"
                description="Our model blends Elo probabilities with market consensus for calibrated predictions. The edge is the gap between our blended probability and the market line."
                bullets={["Elo model provides independent probability", "Market consensus provides wisdom of the crowd", "Blend produces calibrated, realistic edges", "Only surface bets where the edge is meaningful"]}
              />
              <HowItWorksStep
                number={4}
                title="Every Pick Is Tracked and Graded"
                description="Every pick the model makes is stored with full metadata &mdash; odds, probability, edge, game time. After the game completes, it is automatically graded. Win, lose, or push &mdash; you see everything."
              />
            </div>
          </div>
        </section>

        {/* Features Grid Section */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center mb-4">
              Everything You Need to Bet Smarter
            </h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
              No black box. No vague &quot;AI-powered&quot; claims. Full transparency on every calculation.
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard icon={<MessageSquare className="w-7 h-7" />} title="AI Chat Interface" description="Ask about any game, team, player, or matchup. Get instant Elo-based analysis with edge calculations. Build parlays, analyze props, get best bets &mdash; all through conversation." highlight />
              <FeatureCard icon={<Target className="w-7 h-7" />} title="Independent Elo Rating System" description="We calculate our own probabilities &mdash; not copying the market. 692 teams tracked across NBA, NFL, NHL, MLB, NCAAB, NCAAF, and major soccer leagues." />
              <FeatureCard icon={<Activity className="w-7 h-7" />} title="Injury-Adjusted Predictions" description="Real-time ESPN data feeds into our model. Starting QB out? We subtract 80 Elo points automatically. Every injury is quantified, not just mentioned." />
              <FeatureCard icon={<BarChart3 className="w-7 h-7" />} title="Verified Track Record" description="Every pick tracked and graded automatically. See win rates, ROI, and performance breakdowns by sport and bet type. 100% public &mdash; no cherry-picking." highlight />
              <FeatureCard icon={<TrendingUp className="w-7 h-7" />} title="All Major Sports Covered" description="NBA, NFL, NHL, MLB, College Basketball, College Football, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League." />
              <FeatureCard icon={<User className="w-7 h-7" />} title="Player Props Analysis" description="Individual player prop predictions using historical performance data, pace adjustments, and opponent matchups. Points, rebounds, assists, goals, shots, and more." />
              <FeatureCard icon={<Clock className="w-7 h-7" />} title="Hourly Data Updates" description="Odds refresh every hour. Elo ratings update daily with latest game results. Best bets recalculated as lines move." />
              <FeatureCard icon={<Zap className="w-7 h-7" />} title="Recency-Weighted Analysis" description="Recent games matter more. Sport-specific decay factors (0.95-0.99) so hot teams and cold streaks are reflected in ratings." />
              <FeatureCard icon={<Shield className="w-7 h-7" />} title="Full Methodology Transparency" description="See the Elo ratings, the injury adjustments, the edge calculation. No black box. Every formula documented on our methodology page." />
            </div>
          </div>
        </section>

        {/* What You Can Ask Section */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-4">
              What You Can Ask Our AI
            </h2>
            <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
              This isn&apos;t a static dashboard. It&apos;s a conversation with the most transparent sports betting model on the market.
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              <QuestionExample question="What&apos;s the best bet today?" answer="Full Elo analysis of the highest-edge bet across all sports. Score breakdown, value metrics, alternatives." />
              <QuestionExample question="Analyze the Lakers game tonight" answer="Moneyline, spread, and total analysis with Elo-based probabilities, market comparison, and edge calculation." />
              <QuestionExample question="Build me a 3-leg parlay" answer="Three highest-value legs with combined probability, individual edge breakdowns, and risk assessment." />
              <QuestionExample question="Best player props today" answer="Top props ranked by model probability. Historical performance data, matchup context, edge vs market." />
              <QuestionExample question="Should I take Celtics -6.5?" answer="Exact Elo edge for or against. Market implied vs model probability. Clear recommendation with reasoning." />
              <QuestionExample question="Any good college basketball bets?" answer="Best NCAAB picks with Elo ratings, injury adjustments, and value metrics for upcoming games." />
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <FAQItem question="What is Elo rating in sports betting?" answer="Elo is a rating system originally created for chess. Each team starts at 1500. Win games and your rating goes up; lose and it goes down. We use Elo to calculate the probability of one team beating another, independent of what the market thinks." />
              <FAQItem question="Can I see your track record before subscribing?" answer="Yes &mdash; our Model Picks page is 100% public. Every pick our model makes is recorded and automatically graded after games complete. You can see win rates, ROI, and performance breakdowns by sport and bet type before you subscribe." />
              <FAQItem question="What makes this different from other betting tools?" answer="Most tools give you a list of picks and say trust us. We give you an AI chat interface where you can ask about any game, any matchup, and get a full Elo breakdown in real time. We calculate independent probabilities, blend with market consensus, then show you where our model disagrees. Full transparency &mdash; every pick tracked publicly." />
              <FAQItem question="How do injury adjustments work?" answer="Real-time ESPN data feeds in automatically. Starting QB out? We subtract 80 Elo points. Star player questionable? We reduce impact to 15%. MLB ace pitching? We add 20 points. All automatic, all quantified." />
              <FAQItem question="What sports do you cover?" answer="NBA, NFL, NHL, MLB, College Basketball (NCAAB), College Football (NCAAF), and major soccer leagues including Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League." />
              <FAQItem question="Do you guarantee I will win money?" answer="No. Sports betting always involves risk. We show you where our mathematical model finds edges, but even with an edge, individual bets can lose. We recommend only betting what you can afford to lose and focusing on long-term expected value rather than individual outcomes." />
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-slate-400 mb-8">Everything included. No hidden fees. No upsells. Cancel anytime.</p>

            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8 max-w-md mx-auto relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-gradient-to-r from-blue-500 to-cyan-400 text-white text-xs font-bold px-4 py-1 rounded-bl-lg">
                3-DAY FREE TRIAL
              </div>
              <div className="text-5xl font-bold mb-2">$39<span className="text-xl text-slate-400">/month</span></div>
              <p className="text-slate-300 mb-6">Everything included. Cancel anytime.</p>
              <ul className="text-left space-y-3 mb-8">
                <PricingFeature text="Unlimited AI chat &mdash; ask about any game" />
                <PricingFeature text="Elo-based edge detection across all sports" />
                <PricingFeature text="Real-time injury-adjusted probabilities" />
                <PricingFeature text="Player props analysis" />
                <PricingFeature text="Parlay builder with combined probabilities" />
                <PricingFeature text="Full methodology transparency" />
                <PricingFeature text="Verified model track record" />
                <PricingFeature text="Hourly odds updates" />
                <PricingFeature text="Hedge calculator" />
              </ul>
              <Link
                href="/signup"
                className="block w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30 text-center"
              >
                Start 3-Day Free Trial
              </Link>
              <p className="text-sm text-slate-400 mt-4 flex items-center justify-center gap-1">
                <Lock className="w-3 h-3" />
                No credit card required to start.
              </p>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-16 px-4 bg-slate-900/30">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to Bet With an Edge?</h2>
            <p className="text-slate-300 mb-4 text-lg">
              Our Elo model tracks 692 teams across every major sport. Every pick is tracked and verified publicly. No trust required &mdash; just math.
            </p>
            <p className="text-cyan-400 mb-8 font-medium">
              See our track record. Try the AI chat. Judge for yourself.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/signup"
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
              >
                Start Your 3-Day Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/picks"
                className="px-8 py-4 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2"
              >
                <Eye className="w-5 h-5" />
                View Track Record
              </Link>
            </div>
            <p className="text-sm text-slate-400 mt-4">
              No credit card required. Full access for 3 days. $39/month after.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function ComparisonItem({ them, us, label }: { them: string; us: string; label: string }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2 text-sm text-red-300/70">
        <span className="text-red-400/60 mr-1">Others:</span> {them}
      </div>
      <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2 text-sm text-green-300">
        <span className="text-green-400 mr-1 font-semibold">Us:</span> {us}
      </div>
    </div>
  )
}

function TrackRecordCard({ title, description, color }: { title: string; description: string; color: string }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-5 text-center">
      <div className={`font-semibold mb-1 ${color}`}>{title}</div>
      <div className="text-xs text-slate-400">{description}</div>
    </div>
  )
}

function FeatureCard({ icon, title, description, highlight }: { icon: React.ReactNode; title: string; description: string; highlight?: boolean }) {
  return (
    <div className={`backdrop-blur-sm rounded-2xl p-6 ${
      highlight
        ? 'bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30'
        : 'bg-slate-900/30 border border-slate-800/50'
    }`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
        highlight
          ? 'bg-gradient-to-br from-blue-500/30 to-cyan-400/30 text-cyan-400'
          : 'bg-gradient-to-br from-blue-500/20 to-cyan-400/20 text-blue-400'
      }`}>
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

function ChatExampleBullet({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
      <span className="text-slate-300" dangerouslySetInnerHTML={{ __html: text }} />
    </li>
  )
}

function QuestionExample({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-5">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
        <p className="font-semibold text-white">&ldquo;{question}&rdquo;</p>
      </div>
      <p className="text-slate-400 text-sm ml-11">{answer}</p>
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
