'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Trophy, Target, TrendingUp, Shield, Zap, Clock, ChevronRight, Lock, ArrowRight } from 'lucide-react'
import Footer from '@/components/Footer'

interface TieredPick {
  team: string
  homeTeam: string
  awayTeam: string
  betType: string
  line?: number
  bestPrice: number
  bestBook?: string
  eloProbability?: number
  edge?: number
  roi?: number
  score?: number
  confidenceTier?: 'lock' | 'strong' | 'value'
  commenceTime: string
  sport: string
  sportName?: string
  homeElo?: number
  awayElo?: number
  eloConfidence?: string
  situationalNotes?: string[]
  // Fields from tracked recommendations
  selection?: string
  odds?: number
  probability?: number
  gameName?: string
}

interface PicksData {
  locks: TieredPick[]
  strong: TieredPick[]
  value: TieredPick[]
  lastUpdated: string
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

function getSportEmoji(sport: string): string {
  const map: Record<string, string> = {
    basketball: '🏀', baseball: '⚾', football: '🏈',
    hockey: '🏒', soccer: '⚽', mma: '🥊',
  }
  return map[sport] || '🎯'
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === 'lock') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-500/40 rounded-full text-xs font-bold text-yellow-400">
        <Lock className="w-3 h-3" />
        LOCK OF THE DAY
      </span>
    )
  }
  if (tier === 'strong') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/40 rounded-full text-xs font-bold text-blue-400">
        <Zap className="w-3 h-3" />
        STRONG PLAY
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-700/40 border border-slate-600/40 rounded-full text-xs font-bold text-slate-400">
      <Target className="w-3 h-3" />
      VALUE SPOT
    </span>
  )
}

function calculateImpliedProbability(odds: number): number {
  if (odds > 0) {
    return (100 / (odds + 100)) * 100
  } else {
    return (Math.abs(odds) / (Math.abs(odds) + 100)) * 100
  }
}

function PickCard({ pick }: { pick: TieredPick }) {
  // Handle both RankedBet shape (team/homeTeam/awayTeam) and TrackedRecommendation shape (selection/gameName)
  const displaySelection = pick.selection || (pick.team ? `${pick.team} ${
    pick.betType === 'moneyline' ? 'ML'
    : pick.betType === 'spread' ? `${pick.line !== undefined && pick.line > 0 ? '+' : ''}${pick.line}`
    : pick.betType === 'total' ? `${pick.line}` 
    : pick.betType
  }` : 'Unknown')

  const displayGame = pick.gameName || (pick.homeTeam && pick.awayTeam ? `${pick.awayTeam} @ ${pick.homeTeam}` : '')
  const displayOdds = pick.odds ?? pick.bestPrice ?? 0
  const displayProb = pick.eloProbability ?? pick.probability
  const displayScore = pick.score

  // Calculate edge from probability and odds if not directly available
  const displayEdge = pick.edge != null ? pick.edge : (
    displayProb != null && displayOdds !== 0
      ? displayProb - calculateImpliedProbability(displayOdds)
      : null
  )
  const displaySport = pick.sportName || pick.sport || ''

  const tierColors = {
    lock: 'border-yellow-500/30 bg-gradient-to-br from-yellow-900/10 to-amber-900/10',
    strong: 'border-blue-500/30 bg-gradient-to-br from-blue-900/10 to-cyan-900/10',
    value: 'border-slate-700/50 bg-slate-900/30',
  }
  const tier = pick.confidenceTier || 'value'

  return (
    <div className={`rounded-xl border p-5 ${tierColors[tier]} transition-all hover:scale-[1.01]`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <TierBadge tier={tier} />
          <div className="mt-2 text-lg font-bold text-white">
            {displaySelection}
          </div>
          <div className="text-sm text-slate-400">
            {getSportEmoji(displaySport)} {displayGame}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">{displayOdds !== 0 ? formatOdds(displayOdds) : '--'}</div>
          <div className="text-xs text-slate-500">{pick.bestBook || ''}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-slate-800/40 rounded-lg p-2.5 text-center">
          <div className="text-xs text-slate-500 mb-0.5">Probability</div>
          <div className="text-sm font-bold text-green-400">
            {displayProb != null ? `${Number(displayProb).toFixed(1)}%` : '--'}
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-2.5 text-center">
          <div className="text-xs text-slate-500 mb-0.5">Edge</div>
          <div className="text-sm font-bold text-cyan-400">{displayEdge != null ? `${Number(displayEdge) >= 0 ? '+' : ''}${Number(displayEdge).toFixed(1)}%` : '--'}</div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-2.5 text-center">
          <div className="text-xs text-slate-500 mb-0.5">Score</div>
          <div className="text-sm font-bold text-white">{displayScore != null ? `${Math.round(Number(displayScore))}/100` : '--'}</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {pick.commenceTime ? formatTime(pick.commenceTime) : '--'} ET
        </div>
        {pick.homeElo && pick.awayElo && (
          <div>Elo: {pick.homeElo} vs {pick.awayElo}</div>
        )}
      </div>
    </div>
  )
}

export default function PicksPage() {
  const [data, setData] = useState<PicksData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchPicks() {
      try {
        const res = await fetch('/api/picks')
        if (!res.ok) throw new Error('Failed to fetch picks')
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Failed to fetch picks')
        
        // Use live picks (from cached best bet, same as chat) as PRIMARY source.
        // Fall back to stored recommendations if live picks aren't available.
        // This ensures the Model Picks page shows the same high-edge picks
        // that the AI chat recommends, not just what the cron stored.
        const livePicks = json.livePicks || []
        const storedRecos = json.todaysRecommendations || []
        const allRecos = livePicks.length > 0 ? livePicks : storedRecos
        
        const locks = allRecos.filter((r: TieredPick) => r.confidenceTier === 'lock')
        const strong = allRecos.filter((r: TieredPick) => r.confidenceTier === 'strong')
        const value = allRecos.filter((r: TieredPick) => r.confidenceTier === 'value' || !r.confidenceTier)
        
        setData({
          locks,
          strong,
          value,
          lastUpdated: json.lastUpdated || new Date().toISOString()
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    }
    fetchPicks()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/logo.png" alt="BetAnalytics.ai" width={32} height={32} />
              <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                BetAnalytics.ai
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-5">
              <Link href="/picks" className="text-sm text-cyan-400 font-semibold">Model Picks</Link>
              <Link href="/performance" className="text-sm text-slate-300 hover:text-white transition-colors">Performance</Link>
              <Link href="/odds" className="text-sm text-slate-300 hover:text-white transition-colors">Odds</Link>
              <Link href="/chat" className="text-sm text-slate-300 hover:text-white transition-colors">Chat</Link>
              <Link href="/methodology" className="text-sm text-slate-300 hover:text-white transition-colors">Methodology</Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Page Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-full px-4 py-1.5 text-sm text-yellow-400 font-semibold mb-4">
            <Trophy className="w-4 h-4" />
            Tiered Confidence System
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Today&apos;s Model Picks
          </h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Every pick is classified by confidence level. Locks and Strong Plays are tracked on our
            {' '}<Link href="/performance" className="text-cyan-400 hover:underline">performance page</Link> with verified results.
            Value spots offer additional volume with moderate confidence.
          </p>
        </div>

        {/* Tier Legend */}
        <div className="grid md:grid-cols-3 gap-4 mb-10">
          <div className="bg-gradient-to-br from-yellow-900/20 to-amber-900/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-5 h-5 text-yellow-400" />
              <span className="font-bold text-yellow-400">Lock of the Day</span>
            </div>
            <p className="text-xs text-slate-400">Highest conviction. All signals aligned. 62%+ probability, 5%+ edge, no sharp money against. Target: 70%+ win rate.</p>
          </div>
          <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/10 border border-blue-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-blue-400" />
              <span className="font-bold text-blue-400">Strong Play</span>
            </div>
            <p className="text-xs text-slate-400">Solid conviction. 57%+ probability, 4%+ edge, medium+ Elo confidence. Target: 60-65% win rate.</p>
          </div>
          <div className="bg-slate-900/30 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-slate-400" />
              <span className="font-bold text-slate-300">Value Spot</span>
            </div>
            <p className="text-xs text-slate-400">Passes all base filters. Higher volume, moderate confidence. Not included in public track record.</p>
          </div>
        </div>

        {loading && (
          <div className="text-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-slate-400">Loading today&apos;s picks...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <p className="text-red-400 mb-2">Failed to load picks</p>
            <p className="text-sm text-slate-500">{error}</p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Locks Section */}
            {data.locks.length > 0 && (
              <section className="mb-10">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Lock className="w-5 h-5 text-yellow-400" />
                  Locks of the Day
                  <span className="text-sm font-normal text-slate-500">({data.locks.length})</span>
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {data.locks.map((pick, i) => <PickCard key={`lock-${i}`} pick={pick} />)}
                </div>
              </section>
            )}

            {/* Strong Plays Section */}
            {data.strong.length > 0 && (
              <section className="mb-10">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-blue-400" />
                  Strong Plays
                  <span className="text-sm font-normal text-slate-500">({data.strong.length})</span>
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {data.strong.map((pick, i) => <PickCard key={`strong-${i}`} pick={pick} />)}
                </div>
              </section>
            )}

            {/* Value Spots Section */}
            {data.value.length > 0 && (
              <section className="mb-10">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-slate-400" />
                  Value Spots
                  <span className="text-sm font-normal text-slate-500">({data.value.length})</span>
                </h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.value.map((pick, i) => <PickCard key={`value-${i}`} pick={pick} />)}
                </div>
              </section>
            )}

            {data.locks.length === 0 && data.strong.length === 0 && data.value.length === 0 && (
              <div className="text-center py-20 bg-slate-900/30 border border-slate-800/50 rounded-xl">
                <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">No Picks Yet Today</h3>
                <p className="text-slate-400 mb-6 max-w-md mx-auto">
                  Picks are generated when games are available and our model finds qualifying edges.
                  Check back closer to game time.
                </p>
                <Link
                  href="/chat"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-xl font-semibold transition-all"
                >
                  Ask the AI Chat
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            )}

            <div className="text-center text-xs text-slate-600 mt-6">
              Last updated: {new Date(data.lastUpdated).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
            </div>
          </>
        )}

        {/* CTA */}
        <div className="mt-12 text-center bg-gradient-to-br from-blue-900/20 to-cyan-900/10 border border-blue-500/20 rounded-2xl p-8">
          <h3 className="text-xl font-bold mb-2">Want the full analysis?</h3>
          <p className="text-slate-400 mb-6">
            Ask our AI about any game and get Elo ratings, injury adjustments, and edge calculations in real time.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/chat"
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
            >
              Open AI Chat
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link
              href="/performance"
              className="px-6 py-3 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <TrendingUp className="w-4 h-4" />
              View Performance
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
