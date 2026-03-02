'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, Trophy, Target, BarChart3, Activity, Lock } from 'lucide-react'

interface StatsData {
  winRate: number
  totalBets: number
  settledBets: number
  roi: number
  wins: number
  losses: number
}

interface RecoData {
  status: string
  confidenceTier?: string
  odds?: number
  profit?: number
}

export default function LiveStats() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/picks')
        if (!res.ok) return
        const data = await res.json()
        if (data.success && data.recentRecommendations) {
          // Filter to Lock + Strong only to match performance page
          const recos: RecoData[] = data.recentRecommendations || []
          const tracked = recos.filter((r) => 
            (r.status === 'won' || r.status === 'lost') &&
            (r.confidenceTier === 'lock' || r.confidenceTier === 'strong')
          )
          const wins = tracked.filter(r => r.status === 'won').length
          const losses = tracked.filter(r => r.status === 'lost').length
          const total = wins + losses
          const winRate = total > 0 ? (wins / total) * 100 : 0

          // Calculate ROI from profit data
          let totalProfit = 0
          for (const r of tracked) {
            if (r.profit != null) {
              totalProfit += r.profit
            } else if (r.odds) {
              // Estimate profit: won = payout based on odds, lost = -1 unit
              if (r.status === 'won') {
                totalProfit += r.odds > 0 ? r.odds / 100 : 100 / Math.abs(r.odds)
              } else {
                totalProfit -= 1
              }
            }
          }
          const roi = total > 0 ? (totalProfit / total) * 100 : 0

          setStats({
            winRate,
            totalBets: total,
            settledBets: total,
            roi,
            wins,
            losses,
          })
        }
      } catch {
        // Silently fail - stats are optional social proof
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (loading) return null

  // If we have enough settled bets, show real stats
  if (stats && stats.settledBets >= 5) {
    return (
      <div className="flex flex-wrap justify-center gap-4 md:gap-8">
        <StatPill
          icon={<Trophy className="w-4 h-4" />}
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          color="text-green-400"
        />
        <StatPill
          icon={<Target className="w-4 h-4" />}
          label="Record"
          value={`${stats.wins}-${stats.losses}`}
          color="text-blue-400"
        />
        <StatPill
          icon={<TrendingUp className="w-4 h-4" />}
          label="ROI"
          value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`}
          color={stats.roi >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatPill
          icon={<BarChart3 className="w-4 h-4" />}
          label="Tracked Picks"
          value={`${stats.settledBets}`}
          color="text-cyan-400"
        />
      </div>
    )
  }

  // Show tiered system credibility signals
  return (
    <div className="flex flex-wrap justify-center gap-4 md:gap-8">
      <StatPill
        icon={<Lock className="w-4 h-4" />}
        label="Lock & Strong Plays"
        value="Tracked"
        color="text-yellow-400"
      />
      <StatPill
        icon={<Activity className="w-4 h-4" />}
        label="Teams Tracked"
        value="800+"
        color="text-cyan-400"
      />
      <StatPill
        icon={<Target className="w-4 h-4" />}
        label="Sports Covered"
        value="13+"
        color="text-blue-400"
      />
      <StatPill
        icon={<Trophy className="w-4 h-4" />}
        label="Every Pick"
        value="Verified"
        color="text-green-400"
      />
    </div>
  )
}

function StatPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/50 rounded-full px-4 py-2">
      <span className={color}>{icon}</span>
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  )
}
