'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export default function EVCalculatorPage() {
  const [odds, setOdds] = useState('')
  const [trueProbability, setTrueProbability] = useState('')
  const [stake, setStake] = useState('100')

  function americanToDecimal(american: number): number {
    if (american > 0) return (american / 100) + 1
    return (100 / Math.abs(american)) + 1
  }

  function getImpliedProbability(american: number): number {
    if (american > 0) return 100 / (american + 100) * 100
    return Math.abs(american) / (Math.abs(american) + 100) * 100
  }

  const oddsNum = parseFloat(odds)
  const probNum = parseFloat(trueProbability)
  const stakeNum = parseFloat(stake) || 100

  const isValidOdds = !isNaN(oddsNum) && oddsNum !== 0 && (oddsNum >= 100 || oddsNum <= -100)
  const isValidProb = !isNaN(probNum) && probNum > 0 && probNum < 100
  const hasResult = isValidOdds && isValidProb

  let ev = 0
  let impliedProb = 0
  let edge = 0
  let decimalOdds = 0
  let profit = 0
  let kellyFraction = 0

  if (hasResult) {
    decimalOdds = americanToDecimal(oddsNum)
    impliedProb = getImpliedProbability(oddsNum)
    edge = probNum - impliedProb
    profit = (decimalOdds - 1) * stakeNum
    ev = (probNum / 100) * profit - ((100 - probNum) / 100) * stakeNum
    // Kelly Criterion: f = (bp - q) / b where b = decimal odds - 1, p = true prob, q = 1 - p
    const b = decimalOdds - 1
    const p = probNum / 100
    const q = 1 - p
    kellyFraction = Math.max(0, (b * p - q) / b) * 100
  }

  function reset() {
    setOdds('')
    setTrueProbability('')
    setStake('100')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
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

      <main className="py-16 px-4">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Expected Value (EV) Calculator</h1>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Calculate expected value, edge percentage, and Kelly Criterion stake sizing for any bet.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">EV Calculator</h2>
              <button onClick={reset} className="text-sm text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">American Odds</label>
                <input
                  type="text"
                  value={odds}
                  onChange={(e) => setOdds(e.target.value)}
                  placeholder="e.g. -110, +250"
                  className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">True Probability (%)</label>
                <input
                  type="text"
                  value={trueProbability}
                  onChange={(e) => setTrueProbability(e.target.value)}
                  placeholder="e.g. 58.5"
                  className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Stake ($)</label>
                <input
                  type="text"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  placeholder="e.g. 100"
                  className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            {hasResult && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <ResultCard
                  label="Expected Value"
                  value={`${ev >= 0 ? '+' : ''}$${ev.toFixed(2)}`}
                  color={ev >= 0 ? 'text-green-400' : 'text-red-400'}
                />
                <ResultCard
                  label="Edge"
                  value={`${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`}
                  color={edge >= 0 ? 'text-green-400' : 'text-red-400'}
                />
                <ResultCard
                  label="Implied Prob"
                  value={`${impliedProb.toFixed(1)}%`}
                  color="text-cyan-400"
                />
                <ResultCard
                  label="Kelly Stake"
                  value={`${kellyFraction.toFixed(1)}%`}
                  color={kellyFraction > 0 ? 'text-amber-400' : 'text-slate-500'}
                />
              </div>
            )}

            {hasResult && (
              <div className="mt-6 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
                <p className="text-sm text-slate-300">
                  {ev > 0 ? (
                    <>This is a <span className="text-green-400 font-semibold">+EV bet</span>. At {odds} odds with a {trueProbability}% true probability, you have a {edge.toFixed(1)}% edge. Over many bets, you&apos;d expect to make ${ev.toFixed(2)} per ${stakeNum} wagered. Kelly suggests risking {kellyFraction.toFixed(1)}% of your bankroll.</>
                  ) : (
                    <>This is a <span className="text-red-400 font-semibold">-EV bet</span>. At {odds} odds with a {trueProbability}% true probability, the market has the edge ({Math.abs(edge).toFixed(1)}%). Over many bets, you&apos;d expect to lose ${Math.abs(ev).toFixed(2)} per ${stakeNum} wagered.</>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-8">
            <h2 className="text-lg font-semibold mb-4">What Is Expected Value?</h2>
            <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <p><strong className="text-white">Expected value (EV)</strong> is the average amount you expect to win or lose per bet over the long run. Positive EV (+EV) means you have an edge; negative EV (-EV) means the house has the edge.</p>
              <p><strong className="text-white">Formula:</strong> EV = (True Probability x Profit) - ((1 - True Probability) x Stake)</p>
              <p><strong className="text-white">The key insight:</strong> You need to know the <em>true probability</em> of an outcome, not just the market odds. This is where models like Elo ratings come in&mdash;they give you an independent probability estimate to compare against the market.</p>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-12">
            <h2 className="text-lg font-semibold mb-4">What Is Kelly Criterion?</h2>
            <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <p><strong className="text-white">Kelly Criterion</strong> tells you the optimal percentage of your bankroll to wager on a +EV bet. It maximizes long-term growth while managing risk.</p>
              <p><strong className="text-white">Formula:</strong> Kelly % = (b x p - q) / b, where b = decimal odds - 1, p = true probability, q = 1 - p</p>
              <p><strong className="text-white">In practice:</strong> Most sharp bettors use fractional Kelly (25-50% of the suggested amount) to reduce variance. A 10% Kelly suggestion might translate to a 2.5-5% actual bet size.</p>
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold mb-3">Let AI Calculate Your True Probabilities</h2>
            <p className="text-slate-400 mb-6">Our Elo model calculates true probabilities for every game. You provide the odds; we provide the edge.</p>
            <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
            <p className="text-sm text-slate-500 mt-3">No credit card required</p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}

function ResultCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 text-center">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  )
}
