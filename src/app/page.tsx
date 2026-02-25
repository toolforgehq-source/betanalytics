import Link from 'next/link'
import Image from 'next/image'
import { Activity, BarChart3, CheckCircle, Target, TrendingUp, MessageSquare, ArrowRight, Eye, Lock, ChevronDown } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'
import LiveStats from '@/components/LiveStats'
import ChatDemo from '@/components/ChatDemo'
import ScrollReveal from '@/components/ScrollReveal'

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
        text: 'We show probabilities, not guarantees. When we say 60%, you should expect to win roughly 60% of similar bets over time. We log every recommendation so you can verify our accuracy on our Model Picks page.',
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
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="BetAnalytics.ai Logo"
                width={40}
                height={40}
              />
              <div>
                <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  BetAnalytics.ai
                </span>
              </div>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              <Link href="/picks" className="text-sm text-slate-300 hover:text-white transition-colors">
                Track Record
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

      <main>
        {/* ================================================================
            HERO — The only job is to get one click: "Start Free Trial" or "See Track Record"
            ================================================================ */}
        <section className="pt-16 pb-12 md:pt-24 md:pb-16 px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <div className="mb-6">
              <LiveStats />
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-5 leading-[1.1] tracking-tight">
              The Sports Betting AI{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                That Shows Its Math
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-300 mb-8 max-w-2xl mx-auto leading-relaxed">
              Ask about any game. Get Elo-based probabilities, injury adjustments, and edge calculations.
              Not opinions&mdash;math. And we track every pick publicly so you can verify.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-3">
              <Link
                href="/signup"
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
              >
                Start 3-Day Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/picks"
                className="px-8 py-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2"
              >
                <Eye className="w-5 h-5" />
                See Track Record
              </Link>
            </div>
            <p className="text-sm text-slate-500">
              No credit card required &middot; $39/mo after trial &middot; Cancel anytime
            </p>
          </div>
        </section>

        {/* ================================================================
            THE DIFFERENTIATOR — Chat demo + what makes this different
            This is the ONE section that sells the product
            ================================================================ */}
        <ScrollReveal>
          <section className="py-16 px-4 border-t border-slate-800/30">
            <div className="container mx-auto max-w-6xl">
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div>
                  <p className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-3">
                    Not another picks list
                  </p>
                  <h2 className="text-3xl md:text-4xl font-bold mb-5 leading-tight">
                    Ask Any Question.{' '}
                    <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                      Get The Math.
                    </span>
                  </h2>
                  <p className="text-slate-300 text-lg mb-6 leading-relaxed">
                    Other tools hand you picks and say &ldquo;trust us.&rdquo;
                    We give you an AI that explains its reasoning&mdash;Elo ratings,
                    injury adjustments, and exact edge calculations&mdash;for any game you ask about.
                  </p>

                  <div className="space-y-4 mb-8">
                    <DiffPoint
                      label="Transparent"
                      text="See the Elo gap, injury impact, and edge on every pick"
                    />
                    <DiffPoint
                      label="Verified"
                      text="Every pick tracked and graded publicly after games end"
                    />
                    <DiffPoint
                      label="Interactive"
                      text="Ask about any game, player, or matchup in real time"
                    />
                  </div>

                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/25"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Try the AI Chat Free
                  </Link>
                </div>

                <ChatDemo />
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* ================================================================
            HOW IT WORKS — 3 tight steps, not 4
            ================================================================ */}
        <ScrollReveal>
          <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
            <div className="container mx-auto max-w-4xl">
              <h2 className="text-3xl font-bold text-center mb-3">
                How It Works
              </h2>
              <p className="text-slate-400 text-center mb-12 max-w-xl mx-auto">
                Independent math, blended with market wisdom.{' '}
                <Link href="/methodology" className="text-cyan-400 hover:text-cyan-300 underline">Full methodology</Link>
              </p>

              <div className="grid md:grid-cols-3 gap-8">
                <StepCard
                  number={1}
                  title="Elo Ratings"
                  description="We rate every team like chess. Win = rating up, lose = rating down. 692 teams across all major sports, updated daily."
                  detail="3+ months of game history, recency-weighted"
                />
                <StepCard
                  number={2}
                  title="Context Adjustments"
                  description="Injuries change everything. Starting QB out? &minus;80 Elo points. Star player questionable? 15% impact. All from real-time ESPN data."
                  detail="Automatic, quantified, not guesswork"
                />
                <StepCard
                  number={3}
                  title="Edge Detection"
                  description="We blend our Elo probability with market consensus. When they disagree, that&rsquo;s the edge. You see both numbers and decide."
                  detail="Every pick logged and graded after the game"
                />
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* ================================================================
            WHAT YOU GET — Concise feature list + pricing in same section
            ================================================================ */}
        <ScrollReveal>
          <section className="py-16 px-4 border-t border-slate-800/30">
            <div className="container mx-auto max-w-5xl">
              <div className="grid md:grid-cols-2 gap-12 items-start">
                {/* Left: Features */}
                <div>
                  <h2 className="text-3xl font-bold mb-6">
                    What You Get
                  </h2>
                  <div className="space-y-4">
                    <Feature
                      icon={<MessageSquare className="w-5 h-5 text-cyan-400" />}
                      title="AI Chat"
                      text="Ask about any game, team, player, or matchup. Parlays, props, best bets."
                    />
                    <Feature
                      icon={<Target className="w-5 h-5 text-blue-400" />}
                      title="Elo Edge Detection"
                      text="Independent probabilities for 692 teams. Find where the model disagrees with the market."
                    />
                    <Feature
                      icon={<Activity className="w-5 h-5 text-green-400" />}
                      title="Injury Adjustments"
                      text="Real-time ESPN data. Every injury quantified in Elo points, not just mentioned."
                    />
                    <Feature
                      icon={<BarChart3 className="w-5 h-5 text-purple-400" />}
                      title="Public Track Record"
                      text="Every pick graded after the game. Win rates, ROI, breakdowns by sport and bet type."
                    />
                    <Feature
                      icon={<TrendingUp className="w-5 h-5 text-yellow-400" />}
                      title="13+ Sports"
                      text="NBA, NFL, NHL, MLB, NCAAB, NCAAF, Premier League, La Liga, Bundesliga, Serie A, and more."
                    />
                  </div>
                </div>

                {/* Right: Pricing card */}
                <div className="bg-gradient-to-br from-blue-900/30 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-gradient-to-r from-blue-500 to-cyan-400 text-white text-xs font-bold px-4 py-1.5 rounded-bl-lg">
                    3-DAY FREE TRIAL
                  </div>

                  <div className="mb-6">
                    <div className="text-5xl font-bold">
                      $39<span className="text-xl text-slate-400 font-normal">/month</span>
                    </div>
                    <p className="text-slate-400 mt-1">Everything included. Cancel anytime.</p>
                  </div>

                  <ul className="space-y-3 mb-8">
                    <PricingLine text="Unlimited AI chat" />
                    <PricingLine text="All sports and bet types" />
                    <PricingLine text="Elo edge detection" />
                    <PricingLine text="Real-time injury adjustments" />
                    <PricingLine text="Player props analysis" />
                    <PricingLine text="Parlay builder" />
                    <PricingLine text="Full methodology access" />
                    <PricingLine text="Public verified track record" />
                  </ul>

                  <Link
                    href="/signup"
                    className="block w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25 text-center"
                  >
                    Start Free Trial
                  </Link>
                  <p className="text-xs text-slate-500 mt-3 flex items-center justify-center gap-1">
                    <Lock className="w-3 h-3" />
                    No credit card required
                  </p>
                </div>
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* ================================================================
            FAQ — SEO value + handles objections
            ================================================================ */}
        <ScrollReveal>
          <section className="py-16 px-4 bg-slate-900/20 border-t border-slate-800/30">
            <div className="container mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold text-center mb-10">Frequently Asked Questions</h2>
              <div className="space-y-4">
                <FAQItem
                  question="What is Elo rating in sports betting?"
                  answer="Elo is a rating system originally created for chess. Each team starts at 1500. Win games and your rating goes up; lose and it goes down. We use Elo to calculate the probability of one team beating another, independent of what the market thinks."
                />
                <FAQItem
                  question="Can I see your track record before subscribing?"
                  answer="Yes. Our Model Picks page is 100% public. Every pick is recorded and graded after games complete. You can see win rates, ROI, and performance breakdowns by sport and bet type before you pay anything."
                />
                <FAQItem
                  question="What makes this different from other betting tools?"
                  answer="Most tools hand you picks and say trust us. We give you an AI chat where you ask about any game and get a full Elo breakdown&mdash;ratings, injury adjustments, edge calculation&mdash;in real time. Full transparency, every pick tracked publicly."
                />
                <FAQItem
                  question="How do injury adjustments work?"
                  answer="Real-time ESPN data feeds in automatically. Starting QB out? We subtract 80 Elo points. Star player questionable? We reduce impact to 15%. MLB ace pitching? We add 20 points. All automatic, all quantified."
                />
                <FAQItem
                  question="What sports do you cover?"
                  answer="NBA, NFL, NHL, MLB, College Basketball, College Football, and major soccer leagues including Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, and Champions League."
                />
                <FAQItem
                  question="Do you guarantee I will win money?"
                  answer="No. Sports betting always involves risk. We show you where our model finds edges, but even with an edge, individual bets can lose. We recommend only betting what you can afford to lose and focusing on long-term expected value."
                />
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* ================================================================
            FINAL CTA — Last chance to convert
            ================================================================ */}
        <section className="py-20 px-4 border-t border-slate-800/30">
          <div className="container mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold mb-4">See the math for yourself.</h2>
            <p className="text-slate-400 mb-8 text-lg">
              3-day free trial. No credit card. Full access.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/signup"
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
              >
                Start Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/picks"
                className="px-8 py-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2"
              >
                <Eye className="w-5 h-5" />
                View Track Record
              </Link>
            </div>
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

function DiffPoint({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 w-5 h-5 bg-cyan-500/20 border border-cyan-500/30 rounded-full flex items-center justify-center flex-shrink-0">
        <CheckCircle className="w-3 h-3 text-cyan-400" />
      </span>
      <div>
        <span className="font-semibold text-white">{label}: </span>
        <span className="text-slate-300">{text}</span>
      </div>
    </div>
  )
}

function StepCard({ number, title, description, detail }: {
  number: number
  title: string
  description: string
  detail: string
}) {
  return (
    <div className="relative">
      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center font-bold text-sm mb-4">
        {number}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed mb-2" dangerouslySetInnerHTML={{ __html: description }} />
      <p className="text-xs text-cyan-400/70 italic">{detail}</p>
    </div>
  )
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-10 h-10 bg-slate-800/60 border border-slate-700/40 rounded-xl flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <div className="font-semibold mb-0.5">{title}</div>
        <div className="text-sm text-slate-400">{text}</div>
      </div>
    </div>
  )
}

function PricingLine({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
      <span className="text-slate-300">{text}</span>
    </li>
  )
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group bg-slate-900/30 border border-slate-800/50 rounded-xl overflow-hidden">
      <summary className="flex items-center justify-between cursor-pointer px-6 py-4 hover:bg-slate-800/20 transition-colors">
        <span className="font-semibold pr-4">{question}</span>
        <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180 flex-shrink-0" />
      </summary>
      <div className="px-6 pb-4 text-slate-400" dangerouslySetInnerHTML={{ __html: answer }} />
    </details>
  )
}
