'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Trash2, Plus, Zap, ExternalLink, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'

// ============================================
// TYPES
// ============================================

interface OddsGame {
  id: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  markets: {
    moneyline: { book: string; home: number; away: number; draw?: number }[]
    spread: { book: string; homeSpread: number; homePrice: number; awaySpread: number; awayPrice: number }[]
    total: { book: string; line: number; overPrice: number; underPrice: number }[]
  }
  bestMoneyline: { home: BookPrice | null; away: BookPrice | null }
  bestSpread: { home: BookPrice | null; away: BookPrice | null }
  bestTotal: { over: BookPrice | null; under: BookPrice | null }
}

interface BookPrice {
  book: string
  price: number
  point?: number
}

interface ParlayLeg {
  id: string
  gameId: string
  game: OddsGame
  betType: 'moneyline' | 'spread' | 'total'
  selection: string      // "home", "away", "over", "under"
  description: string    // Human readable: "Lakers ML -150"
  odds: number
  point?: number
}

interface OddsResponse {
  success: boolean
  sports: Record<string, OddsGame[]>
  totalGames: number
  lastUpdated: string
}

// ============================================
// BOOK LINKS
// ============================================

const SPORTSBOOK_LINKS = [
  { name: 'DraftKings', url: 'https://sportsbook.draftkings.com', color: 'bg-[#53D337] hover:bg-[#47b830] text-black' },
  { name: 'FanDuel', url: 'https://sportsbook.fanduel.com', color: 'bg-[#1493FF] hover:bg-[#1180e0] text-white' },
  { name: 'BetMGM', url: 'https://sports.betmgm.com', color: 'bg-[#BFA05C] hover:bg-[#a88d50] text-black' },
  { name: 'Caesars', url: 'https://www.caesars.com/sportsbook-and-casino', color: 'bg-[#0A3D2C] hover:bg-[#0d4f39] text-white' },
]

// ============================================
// HELPERS
// ============================================

function formatOdds(price: number): string {
  if (price === 0) return '-'
  return price > 0 ? `+${price}` : `${price}`
}

function americanToDecimal(american: number): number {
  if (american > 0) return (american / 100) + 1
  return (100 / Math.abs(american)) + 1
}

function americanToImpliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100)
  return Math.abs(american) / (Math.abs(american) + 100)
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

function formatGameTime(commenceTime: string): string {
  const date = new Date(commenceTime)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = date.toDateString() === tomorrow.toDateString()
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return `Today ${timeStr}`
  if (isTomorrow) return `Tomorrow ${timeStr}`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${timeStr}`
}

function generateLegId(): string {
  return Math.random().toString(36).substring(2, 9)
}

// ============================================
// GAME PICKER COMPONENT
// ============================================

function GamePicker({ 
  games, 
  onAddLeg, 
  existingLegs 
}: { 
  games: Record<string, OddsGame[]>
  onAddLeg: (leg: ParlayLeg) => void
  existingLegs: ParlayLeg[]
}) {
  const [expandedSport, setExpandedSport] = useState<string | null>(null)
  const [expandedGame, setExpandedGame] = useState<string | null>(null)

  const isGameInParlay = useCallback((gameId: string) => {
    return existingLegs.some(l => l.gameId === gameId)
  }, [existingLegs])

  function addMoneylineLeg(game: OddsGame, side: 'home' | 'away') {
    const best = side === 'home' ? game.bestMoneyline.home : game.bestMoneyline.away
    if (!best) return
    const team = side === 'home' ? game.homeTeam : game.awayTeam
    onAddLeg({
      id: generateLegId(),
      gameId: game.id,
      game,
      betType: 'moneyline',
      selection: side,
      description: `${team} ML ${formatOdds(best.price)}`,
      odds: best.price,
    })
  }

  function addSpreadLeg(game: OddsGame, side: 'home' | 'away') {
    const best = side === 'home' ? game.bestSpread.home : game.bestSpread.away
    if (!best) return
    const team = side === 'home' ? game.homeTeam : game.awayTeam
    const point = best.point ?? 0
    onAddLeg({
      id: generateLegId(),
      gameId: game.id,
      game,
      betType: 'spread',
      selection: side,
      description: `${team} ${point > 0 ? '+' : ''}${point} ${formatOdds(best.price)}`,
      odds: best.price,
      point,
    })
  }

  function addTotalLeg(game: OddsGame, side: 'over' | 'under') {
    const best = side === 'over' ? game.bestTotal.over : game.bestTotal.under
    if (!best) return
    onAddLeg({
      id: generateLegId(),
      gameId: game.id,
      game,
      betType: 'total',
      selection: side,
      description: `${side === 'over' ? 'Over' : 'Under'} ${best.point} ${formatOdds(best.price)}`,
      odds: best.price,
      point: best.point,
    })
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Add Legs</h3>
      {Object.entries(games).map(([sport, sportGames]) => (
        <div key={sport} className="bg-slate-900/50 border border-slate-800/50 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpandedSport(expandedSport === sport ? null : sport)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
          >
            <span className="font-semibold text-sm">{sport} <span className="text-slate-500 font-normal">({sportGames.length})</span></span>
            {expandedSport === sport ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expandedSport === sport && (
            <div className="border-t border-slate-800/50">
              {sportGames.map((game) => {
                const inParlay = isGameInParlay(game.id)
                return (
                  <div key={game.id} className="border-b border-slate-800/30 last:border-b-0">
                    <button
                      onClick={() => setExpandedGame(expandedGame === game.id ? null : game.id)}
                      className={`w-full px-4 py-2 flex items-center justify-between hover:bg-slate-800/20 transition-colors text-left ${inParlay ? 'bg-cyan-500/5' : ''}`}
                    >
                      <div>
                        <p className="text-sm">{game.awayTeam} <span className="text-slate-500">@</span> {game.homeTeam}</p>
                        <p className="text-xs text-slate-500">{formatGameTime(game.commenceTime)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {inParlay && <span className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">In Slip</span>}
                        <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${expandedGame === game.id ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    {expandedGame === game.id && (
                      <div className="px-4 pb-3 space-y-3">
                        {/* Moneyline */}
                        {game.bestMoneyline.away && game.bestMoneyline.home && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Moneyline</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => addMoneylineLeg(game, 'away')}
                                className="flex-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg text-xs transition-colors"
                              >
                                <span className="block text-slate-300">{game.awayTeam}</span>
                                <span className="block font-mono font-bold text-cyan-400">{formatOdds(game.bestMoneyline.away.price)}</span>
                              </button>
                              <button
                                onClick={() => addMoneylineLeg(game, 'home')}
                                className="flex-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg text-xs transition-colors"
                              >
                                <span className="block text-slate-300">{game.homeTeam}</span>
                                <span className="block font-mono font-bold text-cyan-400">{formatOdds(game.bestMoneyline.home.price)}</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Spread */}
                        {game.bestSpread.away && game.bestSpread.home && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Spread</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => addSpreadLeg(game, 'away')}
                                className="flex-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg text-xs transition-colors"
                              >
                                <span className="block text-slate-300">{game.awayTeam} {(game.bestSpread.away.point ?? 0) > 0 ? '+' : ''}{game.bestSpread.away.point}</span>
                                <span className="block font-mono font-bold text-cyan-400">{formatOdds(game.bestSpread.away.price)}</span>
                              </button>
                              <button
                                onClick={() => addSpreadLeg(game, 'home')}
                                className="flex-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg text-xs transition-colors"
                              >
                                <span className="block text-slate-300">{game.homeTeam} {(game.bestSpread.home.point ?? 0) > 0 ? '+' : ''}{game.bestSpread.home.point}</span>
                                <span className="block font-mono font-bold text-cyan-400">{formatOdds(game.bestSpread.home.price)}</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Total */}
                        {game.bestTotal.over && game.bestTotal.under && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Total ({game.bestTotal.over.point})</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => addTotalLeg(game, 'over')}
                                className="flex-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg text-xs transition-colors"
                              >
                                <span className="block text-slate-300">Over {game.bestTotal.over.point}</span>
                                <span className="block font-mono font-bold text-cyan-400">{formatOdds(game.bestTotal.over.price)}</span>
                              </button>
                              <button
                                onClick={() => addTotalLeg(game, 'under')}
                                className="flex-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg text-xs transition-colors"
                              >
                                <span className="block text-slate-300">Under {game.bestTotal.under.point}</span>
                                <span className="block font-mono font-bold text-cyan-400">{formatOdds(game.bestTotal.under.price)}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================
// BET SLIP COMPONENT
// ============================================

function BetSlip({ 
  legs, 
  onRemoveLeg, 
  wagerAmount, 
  onWagerChange 
}: { 
  legs: ParlayLeg[]
  onRemoveLeg: (id: string) => void
  wagerAmount: number
  onWagerChange: (amount: number) => void
}) {
  const parlayCalc = useMemo(() => {
    if (legs.length < 2) return null

    const decimalOdds = legs.map(l => americanToDecimal(l.odds))
    const combinedDecimal = decimalOdds.reduce((acc, d) => acc * d, 1)
    const combinedAmerican = decimalToAmerican(combinedDecimal)
    
    const legProbs = legs.map(l => americanToImpliedProb(l.odds))
    const combinedProb = legProbs.reduce((acc, p) => acc * p, 1)
    
    const potentialPayout = wagerAmount * combinedDecimal
    const potentialProfit = potentialPayout - wagerAmount

    return {
      combinedDecimal,
      combinedAmerican,
      combinedProb,
      potentialPayout,
      potentialProfit,
      legProbs,
    }
  }, [legs, wagerAmount])

  if (legs.length === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6 text-center">
        <Plus className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Your bet slip is empty</p>
        <p className="text-slate-500 text-xs mt-1">Click on odds from the games below to add legs to your parlay</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          {legs.length === 1 ? 'Straight Bet' : `${legs.length}-Leg Parlay`}
        </h3>
        <span className="text-xs text-slate-500">{legs.length} selection{legs.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Legs */}
      <div className="divide-y divide-slate-800/30">
        {legs.map((leg, i) => (
          <div key={leg.id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-mono">#{i + 1}</span>
                <span className="text-sm font-medium truncate">{leg.description}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {leg.game.awayTeam} @ {leg.game.homeTeam}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold text-cyan-400">{formatOdds(leg.odds)}</span>
              <button
                onClick={() => onRemoveLeg(leg.id)}
                className="p-1 text-slate-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Parlay Summary */}
      {parlayCalc && (
        <div className="px-4 py-4 border-t border-slate-700/50 bg-slate-800/20 space-y-3">
          {/* Combined Odds */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Combined Odds</span>
            <span className="text-lg font-bold font-mono text-cyan-400">{formatOdds(parlayCalc.combinedAmerican)}</span>
          </div>

          {/* Win Probability */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Win Probability</span>
            <span className="text-sm font-medium">{(parlayCalc.combinedProb * 100).toFixed(1)}%</span>
          </div>

          {/* Wager Input */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Wager Amount</label>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">$</span>
              <input
                type="number"
                value={wagerAmount}
                onChange={(e) => onWagerChange(Math.max(0, Number(e.target.value)))}
                className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-500/50"
                min="0"
                step="5"
              />
            </div>
            <div className="flex gap-2 mt-2">
              {[10, 25, 50, 100].map(amt => (
                <button
                  key={amt}
                  onClick={() => onWagerChange(amt)}
                  className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                    wagerAmount === amt
                      ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                      : 'bg-slate-800/50 border-slate-700/30 text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {/* Payout */}
          <div className="pt-3 border-t border-slate-700/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Potential Payout</span>
              <span className="text-xl font-bold text-green-400">${parlayCalc.potentialPayout.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-slate-500">Profit</span>
              <span className="text-sm text-green-400">${parlayCalc.potentialProfit.toFixed(2)}</span>
            </div>
          </div>

          {/* Warning */}
          {legs.length >= 4 && (
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400/80">
                {legs.length}+ leg parlays have very low win probability ({(parlayCalc.combinedProb * 100).toFixed(1)}%). 
                Consider betting these legs individually for better long-term returns.
              </p>
            </div>
          )}

          {/* Place Bet Links */}
          <div className="pt-2">
            <p className="text-xs text-slate-500 mb-2">Place this parlay:</p>
            <div className="grid grid-cols-2 gap-2">
              {SPORTSBOOK_LINKS.map(book => (
                <a
                  key={book.name}
                  href={book.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${book.color} px-3 py-2 rounded-lg text-xs font-semibold text-center flex items-center justify-center gap-1 transition-colors`}
                >
                  {book.name}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Single bet info */}
      {legs.length === 1 && (
        <div className="px-4 py-4 border-t border-slate-700/50 bg-slate-800/20">
          <p className="text-xs text-slate-400 mb-3">Add at least 2 legs to build a parlay, or place as a straight bet:</p>
          <div className="grid grid-cols-2 gap-2">
            {SPORTSBOOK_LINKS.map(book => (
              <a
                key={book.name}
                href={book.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${book.color} px-3 py-2 rounded-lg text-xs font-semibold text-center flex items-center justify-center gap-1 transition-colors`}
              >
                {book.name}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function BetSlipClient() {
  const [data, setData] = useState<OddsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [legs, setLegs] = useState<ParlayLeg[]>([])
  const [wagerAmount, setWagerAmount] = useState(25)

  useEffect(() => {
    async function fetchGames() {
      try {
        const res = await fetch('/api/odds')
        const json = await res.json()
        if (json.success) setData(json)
      } catch (err) {
        console.error('Failed to fetch odds:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchGames()
  }, [])

  const handleAddLeg = useCallback((leg: ParlayLeg) => {
    setLegs(prev => {
      // Don't add if same game already has a leg with same bet type
      const existing = prev.find(l => l.gameId === leg.gameId && l.betType === leg.betType)
      if (existing) {
        // Replace the existing leg for this game/betType
        return prev.map(l => l.id === existing.id ? leg : l)
      }
      // Max 10 legs
      if (prev.length >= 10) return prev
      return [...prev, leg]
    })
  }, [])

  const handleRemoveLeg = useCallback((id: string) => {
    setLegs(prev => prev.filter(l => l.id !== id))
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6 animate-pulse">
            <div className="h-5 bg-slate-800 rounded w-2/3 mb-3" />
            <div className="h-4 bg-slate-800 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (!data || data.totalGames === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-8 text-center">
        <Zap className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">No Games Available</h2>
        <p className="text-slate-400 max-w-md mx-auto">
          No upcoming games with odds are available right now. Check back soon!
        </p>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      {/* Bet Slip (sticky sidebar on desktop) */}
      <div className="lg:col-span-2 order-1 lg:order-2">
        <div className="lg:sticky lg:top-24">
          <BetSlip
            legs={legs}
            onRemoveLeg={handleRemoveLeg}
            wagerAmount={wagerAmount}
            onWagerChange={setWagerAmount}
          />

          {/* AI Parlay suggestion */}
          {legs.length === 0 && (
            <div className="mt-4 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold">AI Parlay Builder</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Want our Elo model to build the optimal parlay? Ask in chat: &quot;Build me a 3-leg parlay&quot;
              </p>
              <a
                href="/chat"
                className="block w-full px-3 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg text-xs font-semibold text-center text-white transition-all"
              >
                Open AI Chat
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Game Picker */}
      <div className="lg:col-span-3 order-2 lg:order-1">
        <GamePicker
          games={data.sports}
          onAddLeg={handleAddLeg}
          existingLegs={legs}
        />
      </div>
    </div>
  )
}
