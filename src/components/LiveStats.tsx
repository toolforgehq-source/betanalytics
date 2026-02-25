'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, Trophy, Target, BarChart3 } from 'lucide-react'

interface StatsData {
  winRate: number
  totalBets: number
  settledBets: number
  roi: number
  wins: number
  losses: number
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
        if (data.success && data.stats) {
          setStats({
            winRate: data.stats.winRate || 0,
            totalBets: data.stats.totalBets || 0,
            settledBets: data.stats.settledBets || 0,
            roi: data.stats.roi || 0,
            wins: data.stats.wins || 0,
            losses: data.stats.losses || 0,
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

  if (loading || !stats || stats.settledBets < 5) return null

  return (
    <div className="flex flex-wrap justify-center gap-6 md:gap-10">
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

function StatPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/50 rounded-full px-4 py-2">
      <span className={color}>{icon}</span>
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  )
}
