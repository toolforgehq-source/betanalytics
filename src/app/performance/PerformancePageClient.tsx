'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Trophy, TrendingUp, BarChart3, Clock, Lock, Zap, CheckCircle, XCircle, Minus } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

interface TierStats {
  wins: number
  losses: number
  pushes: number
  total: number
  winRate: number
}

interface PerformanceData {
  overall: TierStats
  lock: TierStats
  strong: TierStats
  recentPicks: RecentPick[]
  startDate: string
}

interface RecentPick {
  team?: string
  betType: string
  line?: number
  bestPrice?: number
  confidenceTier?: string
  sport: string
  status: string
  result?: string
  createdAt: string
  settledAt?: string
  // TrackedRecommendation fields
  selection?: string
  gameName?: string
  odds?: number
  probability?: number
  score?: number
  sportName?: string
  source?: string
  lockedIn?: boolean
  bettingDay?: string  // Computed betting day (ET, 2 AM reset) for display
}

function StatCard({ label, value, subtext, color }: { label: string; value: string; subtext?: string; color: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/50 rounded-xl p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {subtext && <div className="text-xs text-slate-500 mt-0.5">{subtext}</div>}
    </div>
  )
}

function TierRow({ label, icon, stats, color }: { label: string; icon: React.ReactNode; stats: TierStats; color: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-800/30 last:border-b-0">
      <div className="flex items-center gap-2">
        {icon}
        <span className={`font-semibold ${color}`}>{label}</span>
      </div>
      <div className="flex items-center gap-6 text-sm">
        <span className="text-slate-400">{stats.wins}W - {stats.losses}L{stats.pushes > 0 ? ` - ${stats.pushes}P` : ''}</span>
        <span className={`font-bold ${stats.winRate >= 60 ? 'text-green-400' : stats.winRate >= 50 ? 'text-blue-400' : 'text-red-400'}`}>
          {stats.total > 0 ? `${stats.winRate.toFixed(1)}%` : '--'}
        </span>
      </div>
    </div>
  )
}

function ResultIcon({ status }: { status: string }) {
  if (status === 'won') return <CheckCircle className="w-4 h-4 text-green-400" />
  if (status === 'lost') return <XCircle className="w-4 h-4 text-red-400" />
  if (status === 'push') return <Minus className="w-4 h-4 text-yellow-400" />
  return <Clock className="w-4 h-4 text-slate-500" />
}

export default function PerformancePageClient() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPerformance() {
      try {
        const res = await fetch('/api/picks')
        if (!res.ok) return
        const json = await res.json()
        if (!json.success) return

        // Build tier stats from recent recommendations
        const recos = json.recentRecommendations || []
        const settled = recos.filter((r: RecentPick) => r.status === 'won' || r.status === 'lost' || r.status === 'push')

        const buildStats = (picks: RecentPick[]): TierStats => {
          const wins = picks.filter(p => p.status === 'won').length
          const losses = picks.filter(p => p.status === 'lost').length
          const pushes = picks.filter(p => p.status === 'push').length
          const total = wins + losses
          return { wins, losses, pushes, total, winRate: total > 0 ? (wins / total) * 100 : 0 }
        }

        // Only count best_bet picks with Lock/Strong tier in the official record.
        // Props, parlays, sport_bets, and value-tier picks do NOT count.
        // This matches the server-side calculateTrackingStats() logic exactly.
        const allTrackedPicks = settled.filter((r: RecentPick) =>
          (r.confidenceTier === 'lock' || r.confidenceTier === 'strong') &&
          (!r.source || r.source === 'best_bet')  // source may be missing on older records
        )

        // Compute betting day (ET timezone, 2 AM reset) for each pick.
        // This is the SAME day definition used for capping — ensures the display date
        // matches the cap grouping so users see max 4 picks per displayed date.
        const getBettingDay = (createdAt: string): string => {
          const d = new Date(createdAt)
          // Convert to ET by formatting with timezone, then parse back
          const parts = d.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', hour12: false
          }).split(', ')
          // parts[0] = "MM/DD/YYYY", parts[1] = "HH" (24h)
          const hour = parseInt(parts[1], 10)
          const [mm, dd, yyyy] = parts[0].split('/')
          let dayNum = parseInt(dd, 10)
          // Before 2 AM ET = still the previous calendar day for betting purposes
          if (hour < 2) dayNum -= 1
          // Reconstruct a date for display
          const displayDate = new Date(parseInt(yyyy), parseInt(mm) - 1, dayNum)
          return displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        }

        // Tag each pick with its betting day for display
        for (const p of allTrackedPicks) {
          p.bettingDay = getBettingDay(p.createdAt)
        }

        // CRITICAL: Enforce daily caps (max 1 Lock + 3 Strong per betting day).
        // Group by betting day and keep only the best picks per day.
        const enforceDailyCaps = (picks: RecentPick[]): RecentPick[] => {
          const MAX_DAILY_LOCKS = 1
          const MAX_DAILY_STRONG = 3
          const byDay = new Map<string, RecentPick[]>()
          for (const p of picks) {
            const day = p.bettingDay || getBettingDay(p.createdAt)
            if (!byDay.has(day)) byDay.set(day, [])
            byDay.get(day)!.push(p)
          }
          const result: RecentPick[] = []
          for (const dayPicks of Array.from(byDay.values())) {
            // Prioritize locked-in picks (what users actually saw), then by latest createdAt
            // Latest = most recent Lock of the Day, which is what users last saw on the page
            dayPicks.sort((a, b) => {
              const aLocked = a.lockedIn ? 1 : 0
              const bLocked = b.lockedIn ? 1 : 0
              if (bLocked !== aLocked) return bLocked - aLocked
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            })
            // If no stored lock exists for this day, promote the top pick to lock.
            // The cron sometimes stores all picks as 'strong', but the Model Picks
            // page showed a Lock of the Day. This ensures the record matches.
            const hasStoredLock = dayPicks.some(p => p.confidenceTier === 'lock')
            if (!hasStoredLock && dayPicks.length > 0) {
              dayPicks[0].confidenceTier = 'lock'
            }
            let locks = 0, strongs = 0
            for (const pick of dayPicks) {
              if (pick.confidenceTier === 'lock' && locks < MAX_DAILY_LOCKS) { locks++; result.push(pick) }
              else if (pick.confidenceTier === 'strong' && strongs < MAX_DAILY_STRONG) { strongs++; result.push(pick) }
            }
          }
          return result
        }

        const trackedPicks = enforceDailyCaps(allTrackedPicks)
        const lockPicks = trackedPicks.filter((r: RecentPick) => r.confidenceTier === 'lock')
        const strongPicks = trackedPicks.filter((r: RecentPick) => r.confidenceTier === 'strong')

        // Only show daily-capped settled lock + strong picks in recent results
        const settledTrackedRecos = trackedPicks

        setData({
          overall: buildStats(trackedPicks),
          lock: buildStats(lockPicks),
          strong: buildStats(strongPicks),
          recentPicks: settledTrackedRecos,  // Show ALL historical picks, not just 30
          startDate: new Date().toISOString()
        })
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }
    fetchPerformance()
  }, [])

  const hasData = data && data.overall.total > 0

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
              <Link href="/picks" className="text-sm text-slate-300 hover:text-white transition-colors">Model Picks</Link>
              <Link href="/performance" className="text-sm text-cyan-400 font-semibold">Performance</Link>
              <Link href="/odds" className="text-sm text-slate-300 hover:text-white transition-colors">Odds</Link>
              <Link href="/chat" className="text-sm text-slate-300 hover:text-white transition-colors">Chat</Link>
              <Link href="/methodology" className="text-sm text-slate-300 hover:text-white transition-colors">Methodology</Link>
            </div>
            <MobileNav />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Page Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-full px-4 py-1.5 text-sm text-green-400 font-semibold mb-4">
            <BarChart3 className="w-4 h-4" />
            Live Performance Tracking
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Model Performance
          </h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Every pick is tracked and graded automatically. Full transparency — see exactly how each confidence tier performs.
            Fresh tracking started with our upgraded model.
          </p>
        </div>

        {loading && (
          <div className="text-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-slate-400">Loading performance data...</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="text-center py-16 bg-slate-900/30 border border-slate-800/50 rounded-xl mb-10">
            <Trophy className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">Fresh Start</h3>
            <p className="text-slate-400 mb-2 max-w-md mx-auto">
              Our upgraded model with the tiered confidence system just launched.
              Performance tracking starts fresh — no backlogged data.
            </p>
            <p className="text-sm text-slate-500 mb-6">
              Results will appear here as picks are settled after games complete.
            </p>
            <Link
              href="/picks"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-xl font-semibold transition-all"
            >
              View Today&apos;s Picks
            </Link>
          </div>
        )}

        {!loading && hasData && data && (
          <>
            {/* Overall Stats */}
            <div className="grid md:grid-cols-4 gap-4 mb-10">
              <StatCard
                label="Overall Win Rate"
                value={`${data.overall.winRate.toFixed(1)}%`}
                subtext={`${data.overall.wins}W - ${data.overall.losses}L`}
                color={data.overall.winRate >= 55 ? 'text-green-400' : 'text-red-400'}
              />
              <StatCard
                label="Lock Win Rate"
                value={data.lock.total > 0 ? `${data.lock.winRate.toFixed(1)}%` : '--'}
                subtext={data.lock.total > 0 ? `${data.lock.wins}W - ${data.lock.losses}L` : 'No settled locks yet'}
                color="text-yellow-400"
              />
              <StatCard
                label="Strong Win Rate"
                value={data.strong.total > 0 ? `${data.strong.winRate.toFixed(1)}%` : '--'}
                subtext={data.strong.total > 0 ? `${data.strong.wins}W - ${data.strong.losses}L` : 'No settled strong plays yet'}
                color="text-blue-400"
              />
              <StatCard
                label="Total Picks Tracked"
                value={`${data.overall.total + data.overall.pushes}`}
                subtext="Since model upgrade"
                color="text-cyan-400"
              />
            </div>

            {/* Tier Breakdown */}
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-6 mb-10">
              <h3 className="text-lg font-bold mb-4">Performance by Tier</h3>
              <TierRow
                label="Lock of the Day"
                icon={<Lock className="w-4 h-4 text-yellow-400" />}
                stats={data.lock}
                color="text-yellow-400"
              />
              <TierRow
                label="Strong Play"
                icon={<Zap className="w-4 h-4 text-blue-400" />}
                stats={data.strong}
                color="text-blue-400"
              />
            </div>

            {/* Recent Results — only settled W/L/Push, no pending or voided */}
            {data.recentPicks.length > 0 && (
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4">Recent Results</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-800/50">
                        <th className="pb-2 pr-4">Pick</th>
                        <th className="pb-2 pr-4">Tier</th>
                        <th className="pb-2 pr-4">Odds</th>
                        <th className="pb-2 pr-4">Result</th>
                        <th className="pb-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentPicks.map((pick, i) => {
                        // Handle both RankedBet and TrackedRecommendation field names
                        const displayPick = pick.selection || (pick.team ? `${pick.team} ${pick.betType === 'moneyline' ? 'ML' : pick.betType === 'spread' ? `${pick.line !== undefined && pick.line > 0 ? '+' : ''}${pick.line}` : pick.betType}` : pick.betType)
                        const displayOdds = pick.odds ?? pick.bestPrice ?? 0
                        return (
                          <tr key={i} className="border-b border-slate-800/20 last:border-b-0">
                            <td className="py-2.5 pr-4">
                              <span className="font-medium text-white">{displayPick}</span>
                            </td>
                            <td className="py-2.5 pr-4">
                              {pick.confidenceTier === 'lock' && <span className="text-yellow-400 text-xs font-bold">LOCK</span>}
                              {pick.confidenceTier === 'strong' && <span className="text-blue-400 text-xs font-bold">STRONG</span>}
                            </td>
                            <td className="py-2.5 pr-4 text-slate-300">
                              {displayOdds !== 0 ? (displayOdds > 0 ? `+${displayOdds}` : displayOdds) : '--'}
                            </td>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-1.5">
                                <ResultIcon status={pick.status} />
                                <span className={
                                  pick.status === 'won' ? 'text-green-400' :
                                  pick.status === 'lost' ? 'text-red-400' :
                                  pick.status === 'push' ? 'text-yellow-400' :
                                  'text-slate-500'
                                }>
                                  {pick.status === 'pending' ? 'Pending' : pick.status.charAt(0).toUpperCase() + pick.status.slice(1)}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 text-slate-500">
                              {pick.bettingDay || new Date(pick.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Methodology CTA */}
        <div className="mt-12 text-center bg-slate-900/30 border border-slate-800/50 rounded-2xl p-8">
          <h3 className="text-xl font-bold mb-2">How are picks generated?</h3>
          <p className="text-slate-400 mb-6">
            Our model uses Elo ratings, 7 situational factors, and multi-signal confirmation to find edges.
          </p>
          <Link
            href="/methodology"
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 rounded-xl font-semibold transition-colors"
          >
            <TrendingUp className="w-4 h-4" />
            View Full Methodology
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  )
}
