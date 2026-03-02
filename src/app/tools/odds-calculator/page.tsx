'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

export default function OddsCalculatorPage() {
  const [american, setAmerican] = useState('')
  const [decimal, setDecimal] = useState('')
  const [fractional, setFractional] = useState('')
  const [impliedProb, setImpliedProb] = useState('')
  const [lastEdited, setLastEdited] = useState<string>('')

  function americanToDecimal(odds: number): number {
    if (odds > 0) return (odds / 100) + 1
    return (100 / Math.abs(odds)) + 1
  }

  function decimalToAmerican(dec: number): number {
    if (dec >= 2) return Math.round((dec - 1) * 100)
    return Math.round(-100 / (dec - 1))
  }

  function decimalToFractional(dec: number): string {
    const num = dec - 1
    // Find a clean fraction
    for (let denom = 1; denom <= 100; denom++) {
      const numer = num * denom
      if (Math.abs(numer - Math.round(numer)) < 0.01) {
        return `${Math.round(numer)}/${denom}`
      }
    }
    return `${num.toFixed(2)}/1`
  }

  function fractionalToDecimal(frac: string): number | null {
    const parts = frac.split('/')
    if (parts.length !== 2) return null
    const num = parseFloat(parts[0])
    const den = parseFloat(parts[1])
    if (isNaN(num) || isNaN(den) || den === 0) return null
    return (num / den) + 1
  }

  function decimalToImplied(dec: number): number {
    return (1 / dec) * 100
  }

  function impliedToDecimal(prob: number): number {
    if (prob <= 0 || prob >= 100) return 2
    return 100 / prob
  }

  function handleAmerican(value: string) {
    setAmerican(value)
    setLastEdited('american')
    const odds = parseFloat(value)
    if (isNaN(odds) || odds === 0 || (odds > -100 && odds < 100)) return
    const dec = americanToDecimal(odds)
    setDecimal(dec.toFixed(2))
    setFractional(decimalToFractional(dec))
    setImpliedProb(decimalToImplied(dec).toFixed(1))
  }

  function handleDecimal(value: string) {
    setDecimal(value)
    setLastEdited('decimal')
    const dec = parseFloat(value)
    if (isNaN(dec) || dec <= 1) return
    setAmerican(decimalToAmerican(dec).toString())
    setFractional(decimalToFractional(dec))
    setImpliedProb(decimalToImplied(dec).toFixed(1))
  }

  function handleFractional(value: string) {
    setFractional(value)
    setLastEdited('fractional')
    const dec = fractionalToDecimal(value)
    if (!dec || dec <= 1) return
    setDecimal(dec.toFixed(2))
    setAmerican(decimalToAmerican(dec).toString())
    setImpliedProb(decimalToImplied(dec).toFixed(1))
  }

  function handleImplied(value: string) {
    setImpliedProb(value)
    setLastEdited('implied')
    const prob = parseFloat(value)
    if (isNaN(prob) || prob <= 0 || prob >= 100) return
    const dec = impliedToDecimal(prob)
    setDecimal(dec.toFixed(2))
    setAmerican(decimalToAmerican(dec).toString())
    setFractional(decimalToFractional(dec))
  }

  function reset() {
    setAmerican('')
    setDecimal('')
    setFractional('')
    setImpliedProb('')
    setLastEdited('')
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
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Betting Odds Converter</h1>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Convert between American, decimal, and fractional odds instantly. See the implied probability for any odds format.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Odds Converter</h2>
              <button onClick={reset} className="text-sm text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">American Odds</label>
                <input
                  type="text"
                  value={american}
                  onChange={(e) => handleAmerican(e.target.value)}
                  placeholder="e.g. -110, +250"
                  className={`w-full bg-slate-800/60 border rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors ${lastEdited === 'american' ? 'border-cyan-500/30' : 'border-slate-700/50'}`}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Decimal Odds</label>
                <input
                  type="text"
                  value={decimal}
                  onChange={(e) => handleDecimal(e.target.value)}
                  placeholder="e.g. 1.91, 3.50"
                  className={`w-full bg-slate-800/60 border rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors ${lastEdited === 'decimal' ? 'border-cyan-500/30' : 'border-slate-700/50'}`}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Fractional Odds</label>
                <input
                  type="text"
                  value={fractional}
                  onChange={(e) => handleFractional(e.target.value)}
                  placeholder="e.g. 10/11, 5/2"
                  className={`w-full bg-slate-800/60 border rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors ${lastEdited === 'fractional' ? 'border-cyan-500/30' : 'border-slate-700/50'}`}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Implied Probability (%)</label>
                <input
                  type="text"
                  value={impliedProb}
                  onChange={(e) => handleImplied(e.target.value)}
                  placeholder="e.g. 52.4"
                  className={`w-full bg-slate-800/60 border rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors ${lastEdited === 'implied' ? 'border-cyan-500/30' : 'border-slate-700/50'}`}
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-8">
            <h2 className="text-lg font-semibold mb-4">Common Odds Reference</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800/50">
                    <th className="text-left py-2 pr-4">American</th>
                    <th className="text-left py-2 pr-4">Decimal</th>
                    <th className="text-left py-2 pr-4">Fractional</th>
                    <th className="text-left py-2">Implied Prob</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4">-500</td><td className="py-2 pr-4">1.20</td><td className="py-2 pr-4">1/5</td><td className="py-2">83.3%</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4">-200</td><td className="py-2 pr-4">1.50</td><td className="py-2 pr-4">1/2</td><td className="py-2">66.7%</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4">-110</td><td className="py-2 pr-4">1.91</td><td className="py-2 pr-4">10/11</td><td className="py-2">52.4%</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4">+100</td><td className="py-2 pr-4">2.00</td><td className="py-2 pr-4">1/1</td><td className="py-2">50.0%</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4">+150</td><td className="py-2 pr-4">2.50</td><td className="py-2 pr-4">3/2</td><td className="py-2">40.0%</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4">+200</td><td className="py-2 pr-4">3.00</td><td className="py-2 pr-4">2/1</td><td className="py-2">33.3%</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">+500</td><td className="py-2 pr-4">6.00</td><td className="py-2 pr-4">5/1</td><td className="py-2">16.7%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-12">
            <h2 className="text-lg font-semibold mb-4">How to Use Odds Conversion</h2>
            <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <p><strong className="text-white">American odds</strong> are the most common format in the US. Negative numbers (like -110) tell you how much to bet to win $100. Positive numbers (like +250) tell you how much you win on a $100 bet.</p>
              <p><strong className="text-white">Decimal odds</strong> are popular in Europe and Australia. They represent the total payout (including your stake) per $1 wagered. Decimal 2.50 means a $1 bet returns $2.50 total ($1.50 profit).</p>
              <p><strong className="text-white">Fractional odds</strong> are traditional in the UK. 5/2 means you win $5 for every $2 staked. The implied probability is the denominator divided by the sum of both numbers.</p>
              <p><strong className="text-white">Implied probability</strong> tells you what percentage of the time an outcome needs to happen for the bet to break even. If implied probability is 52.4% but your model says the true probability is 58%, you have a positive expected value bet.</p>
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold mb-3">Want to Find Real Edges?</h2>
            <p className="text-slate-400 mb-6">Our AI compares Elo-derived probabilities to market odds and finds value bets automatically.</p>
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
