'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, BarChart3, Target, Trophy, Activity, ChevronDown } from 'lucide-react'

// ============================================
// TYPES
// ============================================

interface PerformanceData {
  success: boolean
  stats: {
    totalBets: number
    settledBets: number
    pendingBets: number
    wins: number
    losses: number
    pushes: number
    winRate: number
    roi: number
    totalProfit: number
    byBetType: { type: string; count: number; wins: number; losses: number; winRate: number; roi: number }[]
    bySport: { sport: string; count: number; wins: number; losses: number; winRate: number; roi: number }[]
    byConfidence: { level: string; count: number; wins: number; losses: number; winRate: number; roi: number }[]
    calibration: { bucket: string; count: number; expectedWinRate: number; actualWinRate: number; difference: number }[]
  }
  trackRecord: {
    '7d': PeriodRecord
    '30d': PeriodRecord
    '90d': PeriodRecord
    'all': PeriodRecord
  } | null
  recentRecommendations: RecommendationRecord[]
}

interface PeriodRecord {
  period: string
  wins: number
  losses: number
  pushes: number
  total: number
  winRate: number
  units: number
  roi: number
}

interface RecommendationRecord {
  id: string
  createdAt: string
  sport: string
  sportName: string
  gameName: string
  betType: string
  selection: string
  odds: number
  probability: number
  score: number
  source: string
  status: string
  profit?: number
}

type PeriodKey = '7d' | '30d' | '90d' | 'all'

// ============================================
// HELPER COMPONENTS
// ============================================

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

function MetricCard({ label, value, subtext, trend }: { label: string; value: string; subtext?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-5">
      <p className="text-sm text-slate-400 mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold">{value}</span>
        {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-400 mb-1" />}
        {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-400 mb-1" />}
      </div>
      {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
    </div>
  )
}

function BarChart({ data, labelKey, valueKey, colorFn }: {
  data: Record<string, unknown>[]
  labelKey: string
  valueKey: string
  colorFn: (val: number) => string
}) {
  const maxVal = Math.max(...data.map(d => Math.abs(d[valueKey] as number)), 1)
  return (
    <div className="space-y-2">
      {data.map((item, i) => {
        const val = item[valueKey] as number
        const pct = Math.abs(val) / maxVal * 100
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-sm text-slate-400 w-24 truncate">{String(item[labelKey])}</span>
            <div className="flex-1 h-6 bg-slate-800/50 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full ${colorFn(val)}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                {val >= 0 ? '+' : ''}{val.toFixed(1)}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CalibrationChart({ data }: { data: { bucket: string; count: number; expectedWinRate: number; actualWinRate: number; difference: number }[] }) {
  if (data.length === 0) return <p className="text-slate-500 text-sm">Not enough data yet for calibration analysis.</p>
  
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="text-left py-2 text-slate-400">Probability Bucket</th>
            <th className="text-right py-2 text-slate-400">Picks</th>
            <th className="text-right py-2 text-slate-400">Expected</th>
            <th className="text-right py-2 text-slate-400">Actual</th>
            <th className="text-right py-2 text-slate-400">Difference</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.bucket} className="border-b border-slate-800/30">
              <td className="py-2 font-medium">{row.bucket}</td>
              <td className="py-2 text-right text-slate-400">{row.count}</td>
              <td className="py-2 text-right text-blue-400">{row.expectedWinRate.toFixed(1)}%</td>
              <td className="py-2 text-right text-white">{row.actualWinRate.toFixed(1)}%</td>
              <td className={`py-2 text-right font-medium ${
                row.difference > 2 ? 'text-green-400' : row.difference < -2 ? 'text-red-400' : 'text-slate-400'
              }`}>
                {row.difference >= 0 ? '+' : ''}{row.difference.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    won: 'bg-green-500/20 text-green-400 border-green-500/30',
    lost: 'bg-red-500/20 text-red-400 border-red-500/30',
    push: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pending: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    void: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colors[status] || colors.pending}`}>
      {status.toUpperCase()}
    </span>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function PerformanceClient() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [showAllRecos, setShowAllRecos] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/picks')
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to fetch performance data:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6 animate-pulse">
            <div className="h-6 bg-slate-800 rounded w-1/3 mb-4" />
            <div className="h-4 bg-slate-800 rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (!data || !data.success) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-8 text-center">
        <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Performance Data Loading</h2>
        <p className="text-slate-400">Unable to load performance data. Please try again later.</p>
      </div>
    )
  }

  const { stats } = data
  const record = data.trackRecord?.[period]
  const hasData = stats.settledBets > 0 || (record && record.total > 0)
  const recos = data.recentRecommendations || []
  const settledRecos = recos.filter(r => r.status !== 'pending')
  const displayRecos = showAllRecos ? settledRecos : settledRecos.slice(0, 20)

  return (
    <div className="space-y-8">
      {/* Period Selector */}
      <div className="flex items-center gap-2">
        {(['7d', '30d', '90d', 'all'] as PeriodKey[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700/30'
            }`}
          >
            {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : p === '90d' ? '90 Days' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Top-Level Metrics */}
      {hasData ? (
        <section>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Win Rate"
              value={`${(record?.winRate ?? stats.winRate).toFixed(1)}%`}
              subtext={`${record?.wins ?? stats.wins}W - ${record?.losses ?? stats.losses}L`}
              trend={(record?.winRate ?? stats.winRate) >= 52 ? 'up' : 'down'}
            />
            <MetricCard
              label="ROI"
              value={`${(record?.roi ?? stats.roi) >= 0 ? '+' : ''}${(record?.roi ?? stats.roi).toFixed(1)}%`}
              subtext="Return on investment"
              trend={(record?.roi ?? stats.roi) > 0 ? 'up' : (record?.roi ?? stats.roi) < 0 ? 'down' : 'neutral'}
            />
            <MetricCard
              label="Units Profit"
              value={`${(record?.units ?? stats.totalProfit) >= 0 ? '+' : ''}${(record?.units ?? stats.totalProfit).toFixed(2)}u`}
              subtext="1 unit = flat bet"
              trend={(record?.units ?? stats.totalProfit) > 0 ? 'up' : (record?.units ?? stats.totalProfit) < 0 ? 'down' : 'neutral'}
            />
            <MetricCard
              label="Total Picks"
              value={`${record?.total ?? stats.settledBets}`}
              subtext={`${stats.pendingBets} pending`}
            />
          </div>
        </section>
      ) : (
        <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-8 text-center">
          <Trophy className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold mb-2">Building Performance History</h2>
          <p className="text-slate-400 max-w-md mx-auto">
            As our model makes picks and games complete, performance data will accumulate here
            with full breakdowns by sport, bet type, and confidence level.
          </p>
        </section>
      )}

      {/* Performance by Sport */}
      {stats.bySport.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            ROI by Sport
          </h2>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-5">
            <BarChart
              data={stats.bySport.map(s => ({ label: s.sport, roi: s.roi, count: s.count, record: `${s.wins}-${s.losses}` }))}
              labelKey="label"
              valueKey="roi"
              colorFn={(v) => v >= 0 ? 'bg-gradient-to-r from-green-500/80 to-green-400/60' : 'bg-gradient-to-r from-red-500/80 to-red-400/60'}
            />
            <div className="mt-4 pt-4 border-t border-slate-800/50">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stats.bySport.map(s => (
                  <div key={s.sport} className="text-center">
                    <p className="text-xs text-slate-500">{s.sport}</p>
                    <p className="text-sm font-semibold">{s.wins}-{s.losses}</p>
                    <p className={`text-xs ${s.winRate >= 55 ? 'text-green-400' : s.winRate < 50 ? 'text-red-400' : 'text-slate-400'}`}>
                      {s.winRate.toFixed(1)}% win
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Performance by Bet Type */}
      {stats.byBetType.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-400" />
            ROI by Bet Type
          </h2>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-5">
            <BarChart
              data={stats.byBetType.map(b => ({ label: b.type, roi: b.roi, count: b.count, record: `${b.wins}-${b.losses}` }))}
              labelKey="label"
              valueKey="roi"
              colorFn={(v) => v >= 0 ? 'bg-gradient-to-r from-cyan-500/80 to-cyan-400/60' : 'bg-gradient-to-r from-red-500/80 to-red-400/60'}
            />
            <div className="mt-4 pt-4 border-t border-slate-800/50">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stats.byBetType.map(b => (
                  <div key={b.type} className="text-center">
                    <p className="text-xs text-slate-500 capitalize">{b.type}</p>
                    <p className="text-sm font-semibold">{b.wins}-{b.losses}</p>
                    <p className={`text-xs ${b.winRate >= 55 ? 'text-green-400' : b.winRate < 50 ? 'text-red-400' : 'text-slate-400'}`}>
                      {b.winRate.toFixed(1)}% win
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Performance by Confidence Level */}
      {stats.byConfidence.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            Performance by Confidence Level
          </h2>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-5">
            <div className="grid md:grid-cols-3 gap-4">
              {stats.byConfidence.map((c) => (
                <div key={c.level} className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <p className="text-sm text-slate-400 mb-1">{c.level}</p>
                  <p className="text-2xl font-bold mb-1">{c.winRate.toFixed(1)}%</p>
                  <p className="text-sm text-slate-400">{c.wins}-{c.losses} ({c.count} picks)</p>
                  <p className={`text-sm font-medium mt-1 ${c.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {c.roi >= 0 ? '+' : ''}{c.roi.toFixed(1)}% ROI
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Calibration Analysis */}
      {stats.calibration.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-2">Model Calibration</h2>
          <p className="text-sm text-slate-400 mb-4">
            How well do our predicted probabilities match actual outcomes? A well-calibrated model should have actual win rates close to predicted probabilities.
          </p>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-5">
            <CalibrationChart data={stats.calibration} />
            <div className="mt-4 pt-4 border-t border-slate-800/50">
              <p className="text-xs text-slate-500">
                Green = model is conservative (actual &gt; predicted). Red = model is overconfident (actual &lt; predicted). 
                Within &plusmn;2% is considered well-calibrated.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Recent Settled Picks */}
      {settledRecos.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Recent Settled Picks</h2>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase">Pick</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase">Game</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-500 uppercase">Odds</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-500 uppercase">Prob</th>
                    <th className="text-center px-4 py-3 text-xs text-slate-500 uppercase">Result</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-500 uppercase">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRecos.map((reco) => (
                    <tr key={reco.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {new Date(reco.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{reco.selection}</td>
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{reco.gameName}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatOdds(reco.odds)}</td>
                      <td className="px-4 py-2 text-right text-blue-400 whitespace-nowrap">{reco.probability.toFixed(1)}%</td>
                      <td className="px-4 py-2 text-center">
                        <StatusBadge status={reco.status} />
                      </td>
                      <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${
                        (reco.profit ?? 0) > 0 ? 'text-green-400' : (reco.profit ?? 0) < 0 ? 'text-red-400' : 'text-slate-400'
                      }`}>
                        {reco.profit !== undefined && reco.profit !== null
                          ? `${reco.profit >= 0 ? '+' : ''}${reco.profit.toFixed(2)}u`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {settledRecos.length > 20 && (
              <div className="px-4 py-3 border-t border-slate-800/50 text-center">
                <button
                  onClick={() => setShowAllRecos(!showAllRecos)}
                  className="text-cyan-400 hover:text-cyan-300 text-sm font-medium inline-flex items-center gap-1"
                >
                  {showAllRecos ? 'Show Less' : `Show All ${settledRecos.length} Picks`}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAllRecos ? 'rotate-180' : ''}`} />
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Empty State */}
      {!hasData && settledRecos.length === 0 && (
        <section className="text-center py-12">
          <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Building Performance History</h2>
          <p className="text-slate-400 max-w-lg mx-auto mb-6">
            Every pick our model makes is recorded and graded automatically after games complete. 
            Full performance data with calibration analysis, sport breakdowns, and ROI tracking 
            will appear here as our track record grows.
          </p>
          <p className="text-sm text-slate-500">
            Picks are generated when our Elo model finds edges with 52%+ probability.
          </p>
        </section>
      )}
    </div>
  )
}
