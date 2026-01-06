'use client'

import { useState } from 'react'
import { Calculator } from 'lucide-react'

interface HedgeResults {
  hedgeBet: string
  hedgeWin: string
  ifOriginalWins: string
  ifHedgeWins: string
  guaranteedProfit: string
  originalBet: string
  potentialPayout: string
}

export default function HedgeCalculator() {
  const [originalBet, setOriginalBet] = useState('')
  const [potentialPayout, setPotentialPayout] = useState('')
  const [hedgeOdds, setHedgeOdds] = useState('')
  const [results, setResults] = useState<HedgeResults | null>(null)

  const calculateHedge = () => {
    const bet = parseFloat(originalBet)
    const payout = parseFloat(potentialPayout)
    const odds = parseFloat(hedgeOdds)

    if (!bet || !payout || !odds) return

    const decimalOdds = odds > 0 
      ? (odds / 100) + 1 
      : (100 / Math.abs(odds)) + 1

    const hedgeBet = payout / decimalOdds
    const hedgeWin = hedgeBet * (decimalOdds - 1)

    const ifOriginalWins = payout - hedgeBet
    const ifHedgeWins = hedgeWin - bet

    const guaranteedProfit = Math.min(ifOriginalWins, ifHedgeWins)

    setResults({
      hedgeBet: hedgeBet.toFixed(2),
      hedgeWin: hedgeWin.toFixed(2),
      ifOriginalWins: ifOriginalWins.toFixed(2),
      ifHedgeWins: ifHedgeWins.toFixed(2),
      guaranteedProfit: guaranteedProfit.toFixed(2),
      originalBet: bet.toFixed(2),
      potentialPayout: payout.toFixed(2),
    })
  }

  return (
    <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Calculator className="w-6 h-6 text-blue-400" />
        <h2 className="text-2xl font-bold">Hedge Calculator</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            Original Bet Amount ($)
          </label>
          <input
            type="number"
            value={originalBet}
            onChange={(e) => setOriginalBet(e.target.value)}
            placeholder="100"
            className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">
            Potential Payout ($)
          </label>
          <input
            type="number"
            value={potentialPayout}
            onChange={(e) => setPotentialPayout(e.target.value)}
            placeholder="1200"
            className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">
            Hedge Bet Odds (American)
          </label>
          <input
            type="number"
            value={hedgeOdds}
            onChange={(e) => setHedgeOdds(e.target.value)}
            placeholder="-110"
            className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={calculateHedge}
          className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold transition-all shadow-lg"
        >
          Calculate Hedge
        </button>
      </div>

      {results && (
        <div className="mt-6 space-y-4">
          <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4">
            <h3 className="text-lg font-bold text-green-400 mb-3">
              💰 Guaranteed Profit Strategy
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Hedge Bet Amount:</span>
                <span className="font-bold text-white">${results.hedgeBet}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">If Original Wins:</span>
                <span className="font-bold text-green-400">+${results.ifOriginalWins}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">If Hedge Wins:</span>
                <span className="font-bold text-green-400">+${results.ifHedgeWins}</span>
              </div>
              <div className="pt-3 mt-3 border-t border-green-500/30">
                <div className="flex justify-between">
                  <span className="text-slate-300 font-semibold">Guaranteed Profit:</span>
                  <span className="font-bold text-green-300 text-lg">
                    ${results.guaranteedProfit}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-4">
            <h4 className="font-semibold text-blue-400 mb-2">📚 What You&apos;re Learning:</h4>
            <p className="text-sm text-slate-300">
              Hedging locks in guaranteed profit by betting the opposite side. You sacrifice maximum payout for risk-free gains. This is most useful when:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-400 mt-2 space-y-1">
              <li>You have a large parlay with one leg remaining</li>
              <li>Your original bet has significant value</li>
              <li>You want to guarantee profit regardless of outcome</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
