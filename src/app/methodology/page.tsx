import { auth } from "@/auth"
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export const metadata = {
  title: 'Elo Rating Methodology | How Our Sports Betting AI Works - BetAnalytics.ai',
  description: 'Learn how our Elo rating system calculates sports betting probabilities. Understand injury adjustments, recency weighting, and edge detection methodology.',
}

export const dynamic = "force-dynamic"

export default async function MethodologyPage() {
  const session = await auth()
  const isLoggedIn = !!session?.user

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href={isLoggedIn ? "/chat" : "/"} className="flex items-center gap-3">
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
            </Link>
            
            {isLoggedIn ? (
              <div className="flex items-center gap-2 md:gap-4">
                <Link href="/chat" className="text-slate-300 hover:text-white transition-colors text-sm md:text-base">
                  Back to Chat
                </Link>
                <Link 
                  href="/account" 
                  className="hidden md:block px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30"
                >
                  My Account
                </Link>
              </div>
            ) : (
              <>
                <div className="hidden md:flex items-center gap-4">
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
                <MobileNav />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="py-12 px-4">
        <div className="container mx-auto max-w-4xl">
          <Link href={isLoggedIn ? "/chat" : "/"} className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8">
            <ArrowLeft className="w-4 h-4" />
            {isLoggedIn ? "Back to Chat" : "Back to Home"}
          </Link>
          
          <h1 className="text-4xl font-bold mb-6">
            Our Elo Rating{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              Methodology
            </span>
          </h1>
          
          <p className="text-xl text-slate-300 mb-12">
            Full transparency into how we calculate probabilities and find edges. No black box - you understand exactly how every recommendation is made.
          </p>

          {/* What is Elo */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">What is Elo Rating?</h2>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-6 mb-6">
              <p className="text-slate-300 mb-4">
                Elo is a rating system originally developed by Arpad Elo for chess. It&apos;s now used across many competitive domains, including sports analytics. The core principle is simple:
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">Every team starts with a base rating of <strong className="text-white">1500</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">Win a game? Your rating <strong className="text-green-400">increases</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">Lose a game? Your rating <strong className="text-red-400">decreases</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">Beat a strong team? You gain <strong className="text-white">more points</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">Lose to a weak team? You lose <strong className="text-white">more points</strong></span>
                </li>
              </ul>
            </div>
            <p className="text-slate-400">
              Over time, Elo ratings converge to reflect true team strength. A team with a 1600 rating is genuinely stronger than a team with a 1400 rating, and we can calculate the exact probability of either team winning.
            </p>
          </section>

          {/* Our Implementation */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Our Implementation</h2>
            <p className="text-slate-300 mb-6">
              We track <strong className="text-white">692 teams</strong> across all major sports leagues using <strong className="text-white">3+ months</strong> of historical game data. Our system processes results daily to keep ratings current.
            </p>
            
            <h3 className="text-xl font-semibold mb-3">Sports Covered</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2 text-cyan-400">US Sports</h4>
                <ul className="text-slate-300 space-y-1 text-sm">
                  <li>NBA (Basketball)</li>
                  <li>NFL (Football)</li>
                  <li>NHL (Hockey)</li>
                  <li>MLB (Baseball)</li>
                  <li>NCAAB (College Basketball)</li>
                  <li>NCAAF (College Football)</li>
                </ul>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2 text-cyan-400">Soccer Leagues</h4>
                <ul className="text-slate-300 space-y-1 text-sm">
                  <li>Premier League (England)</li>
                  <li>La Liga (Spain)</li>
                  <li>Bundesliga (Germany)</li>
                  <li>Serie A (Italy)</li>
                  <li>Ligue 1 (France)</li>
                  <li>MLS (USA)</li>
                  <li>Champions League (UEFA)</li>
                </ul>
              </div>
            </div>

            <h3 className="text-xl font-semibold mb-3">K-Factors by Sport</h3>
            <p className="text-slate-400 mb-4">
              The K-factor determines how much ratings change after each game. Sports with fewer games need higher K-factors to react quickly:
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4 mb-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="pb-2">Sport</th>
                    <th className="pb-2">K-Factor</th>
                    <th className="pb-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  <tr className="border-b border-slate-800">
                    <td className="py-2">NFL</td>
                    <td className="py-2">32</td>
                    <td className="py-2">17 games - needs quick reaction</td>
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2">NCAAF</td>
                    <td className="py-2">40</td>
                    <td className="py-2">12 games - highest reactivity</td>
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2">NBA/NHL</td>
                    <td className="py-2">20</td>
                    <td className="py-2">82 games - moderate reactivity</td>
                  </tr>
                  <tr>
                    <td className="py-2">MLB</td>
                    <td className="py-2">8</td>
                    <td className="py-2">162 games - very stable</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Recency Weighting */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Recency Weighting</h2>
            <p className="text-slate-300 mb-4">
              Recent games matter more than games from months ago. We apply sport-specific decay factors before each rating update. Lower decay values ensure bad teams stay appropriately rated instead of being pulled toward the baseline:
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4 mb-4">
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">NBA/NHL:</strong> 0.95 decay (~21% weight at 30 games ago)</li>
                <li><strong className="text-white">NFL:</strong> 0.93 decay (~11% weight at 30 games ago)</li>
                <li><strong className="text-white">MLB:</strong> 0.97 decay (~40% weight at 30 games ago)</li>
                <li><strong className="text-white">NCAAB:</strong> 0.94 decay (~16% weight at 30 games ago)</li>
                <li><strong className="text-white">NCAAF:</strong> 0.92 decay (~8% weight at 30 games ago)</li>
              </ul>
            </div>
            <p className="text-slate-400">
              This ensures teams with losing records maintain appropriately low ratings, while hot streaks and cold streaks are still reflected in current ratings.
            </p>
          </section>

          {/* Injury Adjustments */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Injury Adjustments</h2>
            <p className="text-slate-300 mb-4">
              We don&apos;t just mention injuries - we quantify their impact using real-time ESPN data. These adjustments are applied at prediction time (the stored Elo rating is not modified):
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Injury Impact Values</h4>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">NFL/NCAAF Starting QB Out:</strong> <span className="text-red-400">-80 Elo points</span></li>
                <li><strong className="text-white">NHL Starting Goalie Out:</strong> <span className="text-red-400">-30 Elo points</span></li>
                <li><strong className="text-white">Top 3 Scorer Out (NBA/NHL):</strong> <span className="text-red-400">-20 Elo points each</span></li>
                <li><strong className="text-white">MLB Ace Pitcher (ERA &lt; 3.0):</strong> <span className="text-green-400">+20 Elo points</span></li>
                <li><strong className="text-white">MLB Good Pitcher (ERA &lt; 3.8):</strong> <span className="text-green-400">+10 Elo points</span></li>
              </ul>
            </div>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Status Multipliers</h4>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">Out / Injured Reserve:</strong> 100% of adjustment applied</li>
                <li><strong className="text-white">Doubtful:</strong> 70% of adjustment applied</li>
                <li><strong className="text-white">Questionable:</strong> 15% of adjustment applied (they usually play)</li>
                <li><strong className="text-white">Probable / Day-to-Day:</strong> No adjustment</li>
              </ul>
            </div>
          </section>

          {/* Edge Calculation */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Edge Calculation</h2>
            <p className="text-slate-300 mb-4">
              The &quot;edge&quot; is the difference between our calculated probability and the market&apos;s implied probability:
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-6 mb-4">
              <div className="text-center">
                <p className="text-slate-400 mb-2">Edge Formula</p>
                <p className="text-2xl font-mono text-white">
                  Edge = Our Probability - Market Implied Probability
                </p>
              </div>
            </div>
            <p className="text-slate-300 mb-4">
              For example, if our Elo model calculates an 86.7% win probability, but the Vegas odds imply only 68.6%, that&apos;s an <strong className="text-green-400">18.1% edge</strong>.
            </p>
            <p className="text-slate-400">
              We only recommend bets when we find a significant edge - where our independent calculation meaningfully disagrees with the market price.
            </p>
          </section>

          {/* Spread Betting Improvements */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Spread Betting Intelligence</h2>
            <p className="text-slate-300 mb-4">
              Spread betting requires additional filters beyond simple edge calculation. We apply sport-specific thresholds to ensure high-quality spread recommendations:
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Minimum Margin Edge (Points)</h4>
              <p className="text-slate-400 text-sm mb-3">
                We only recommend spreads when our expected margin differs from the market spread by at least:
              </p>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">NBA:</strong> 3 points</li>
                <li><strong className="text-white">NFL:</strong> 2.5 points</li>
                <li><strong className="text-white">NCAAB:</strong> 4 points (higher variance)</li>
                <li><strong className="text-white">NCAAF:</strong> 3 points</li>
                <li><strong className="text-white">MLB:</strong> 1 run</li>
                <li><strong className="text-white">NHL:</strong> Moneylines only (puck lines too unpredictable)</li>
              </ul>
            </div>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Variance Filtering</h4>
              <p className="text-slate-400 text-sm mb-3">
                We skip games involving teams with high margin variance (unpredictable scoring patterns):
              </p>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">NBA:</strong> Skip if team variance &gt; 16 points</li>
                <li><strong className="text-white">NFL:</strong> Skip if team variance &gt; 18 points</li>
                <li><strong className="text-white">NCAAB:</strong> Skip if team variance &gt; 18 points</li>
                <li><strong className="text-white">NCAAF:</strong> Skip if team variance &gt; 22 points</li>
              </ul>
            </div>
            <p className="text-slate-400 mt-4">
              These filters ensure we only recommend spreads where we have genuine predictive confidence, not just mathematical edge.
            </p>
          </section>

          {/* Situational Factors */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">7 Situational Factors</h2>
            <p className="text-slate-300 mb-6">
              Beyond Elo ratings, we analyze 7 situational factors that Vegas often underweights. These adjustments are applied at prediction time to capture real-world context.
            </p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-3 text-cyan-400">Schedule & Rest</h4>
                <ul className="text-slate-300 space-y-2 text-sm">
                  <li><strong className="text-white">Rest Days:</strong> Back-to-back games (-4%), extra rest (+2%)</li>
                  <li><strong className="text-white">Travel Fatigue:</strong> Cross-country flights, timezone changes</li>
                  <li><strong className="text-white">Recent Form:</strong> Hot/cold streaks from last 5 games</li>
                </ul>
              </div>
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
                <h4 className="font-semibold mb-3 text-cyan-400">External Factors</h4>
                <ul className="text-slate-300 space-y-2 text-sm">
                  <li><strong className="text-white">Weather:</strong> Wind, cold, rain for outdoor games (NFL, MLB, MLS)</li>
                  <li><strong className="text-white">Sharp Money:</strong> Line movement indicating professional bettors</li>
                  <li><strong className="text-white">Injuries:</strong> Real-time ESPN data with quantified impact</li>
                </ul>
              </div>
            </div>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Motivation Factors</h4>
              <ul className="text-slate-300 space-y-2 text-sm">
                <li><strong className="text-white">Rivalry Games:</strong> +2% boost (Lakers vs Celtics, Yankees vs Red Sox)</li>
                <li><strong className="text-white">Revenge Games:</strong> +1.5% boost (lost to this team recently)</li>
                <li><strong className="text-white">Eliminated Teams:</strong> -3% penalty (out of playoff contention)</li>
                <li><strong className="text-white">Look-ahead Spots:</strong> -2% penalty (big game coming up next - trap game detection)</li>
                <li><strong className="text-white">Letdown Spots:</strong> -2% penalty (just beat a great team - emotional hangover)</li>
              </ul>
            </div>
          </section>

          {/* CLV Tracking */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Closing Line Value (CLV) Tracking</h2>
            <p className="text-slate-300 mb-4">
              CLV is the gold standard for measuring betting edge. We track every recommendation against the closing line to verify our system actually works.
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-6 mb-4">
              <h4 className="font-semibold mb-3 text-cyan-400">How It Works</h4>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">At Pick Time:</strong> We record the line when we make the recommendation</li>
                <li><strong className="text-white">At Game Time:</strong> We record the closing line (after sharp money has moved it)</li>
                <li><strong className="text-white">CLV Calculation:</strong> If you got Lakers -3.5 and it closed at -5.0, you beat the closing line by 1.5 points</li>
              </ul>
            </div>
            <p className="text-slate-400">
              Consistently beating the closing line means you&apos;re getting better prices than the sharpest bettors in the world. This is the ultimate validation that a betting system has real edge.
            </p>
          </section>

          {/* Player Props */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Player Props Analysis</h2>
            <p className="text-slate-300 mb-4">
              Beyond team-based bets, we analyze individual player performance to find edges on player props. Our system tracks 1,300+ players across NBA and NHL.
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-3 text-cyan-400">How Player Props Work</h4>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">Historical Performance:</strong> We track rolling averages with recency weighting (recent games matter more)</li>
                <li><strong className="text-white">Statistical Modeling:</strong> Normal distribution model calculates probability of hitting over/under lines</li>
                <li><strong className="text-white">Opponent Adjustments:</strong> Factor in how the opposing team defends against specific stats</li>
                <li><strong className="text-white">Pace Adjustments:</strong> High-scoring games boost projections, low-scoring games reduce them</li>
                <li><strong className="text-white">Usage Adjustments:</strong> When key teammates are injured, remaining players often see increased usage</li>
              </ul>
            </div>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Stats Covered</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-white font-medium mb-2">NBA/NCAAB</p>
                  <ul className="text-slate-300 text-sm space-y-1">
                    <li>Points, Rebounds, Assists</li>
                    <li>Three Pointers Made</li>
                  </ul>
                </div>
                <div>
                  <p className="text-white font-medium mb-2">NHL</p>
                  <ul className="text-slate-300 text-sm space-y-1">
                    <li>Goals, Assists, Shots</li>
                    <li>Saves (goalies)</li>
                  </ul>
                </div>
              </div>
            </div>
            <p className="text-slate-400 mt-4">
              We only recommend props when our model shows significant edge (8%+) and the probability is between 55-85% to avoid extreme predictions.
            </p>
          </section>

          {/* Calibration System */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Self-Correcting Calibration</h2>
            <p className="text-slate-300 mb-4">
              Our system learns from its mistakes. We track predicted probabilities vs actual outcomes and automatically adjust future predictions.
            </p>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-6 mb-4">
              <h4 className="font-semibold mb-3 text-cyan-400">Calibration Process</h4>
              <ul className="space-y-2 text-slate-300">
                <li><strong className="text-white">Track Predictions:</strong> Every bet records its predicted probability</li>
                <li><strong className="text-white">Compare to Outcomes:</strong> Did 65% predictions actually win 65% of the time?</li>
                <li><strong className="text-white">Auto-Adjust:</strong> If we&apos;re overconfident, future predictions are adjusted down</li>
                <li><strong className="text-white">Brier Score:</strong> Industry-standard metric for probability accuracy (lower = better)</li>
              </ul>
            </div>
            <p className="text-slate-400">
              After 50+ completed picks, the calibration system kicks in and starts applying corrections. The more games that complete, the more accurate the model becomes.
            </p>
          </section>

          {/* Limitations */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Limitations & Honest Disclaimers</h2>
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-lg p-6">
              <ul className="space-y-4 text-slate-300">
                <li>
                  <strong className="text-white">Probabilities, not guarantees:</strong> When we say 86%, you should expect to win roughly 86% of similar bets over many trials. Individual bets can and will lose.
                </li>
                <li>
                  <strong className="text-white">Model limitations:</strong> While we now capture motivation, travel fatigue, and many situational factors, some things like coaching changes and locker room dynamics may not be fully reflected.
                </li>
                <li>
                  <strong className="text-white">Injury data lag:</strong> While we use real-time ESPN data, last-minute scratches may not be captured before game time.
                </li>
                <li>
                  <strong className="text-white">Historical data depth:</strong> We use 3+ months of data. Early-season ratings may be less reliable until more games are played.
                </li>
              </ul>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center">
            <h2 className="text-2xl font-bold mb-4">Ready to Find Edges?</h2>
            <p className="text-slate-300 mb-6">
              Now that you understand our methodology, try it yourself with a free trial.
            </p>
            <Link 
              href="/signup" 
              className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/30"
            >
              Start 3-Day Free Trial
            </Link>
            <p className="text-sm text-slate-400 mt-4">
              No credit card required.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}
