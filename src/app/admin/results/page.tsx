'use client'

import { useState, useEffect } from 'react'

interface TrackingStats {
  totalBets: number
  settledBets: number
  pendingBets: number
  wins: number
  losses: number
  pushes: number
  winRate: number
  roi: number
  totalProfit: number
  byConfidence: {
    level: string
    count: number
    wins: number
    losses: number
    winRate: number
    roi: number
  }[]
  calibration: {
    bucket: string
    count: number
    expectedWinRate: number
    actualWinRate: number
    difference: number
  }[]
  byBetType: {
    type: string
    count: number
    wins: number
    losses: number
    winRate: number
    roi: number
  }[]
  bySport: {
    sport: string
    count: number
    wins: number
    losses: number
    winRate: number
    roi: number
  }[]
  lastUpdated: string
}

interface TrackedRecommendation {
  id: string
  createdAt: string
  sport: string
  sportName: string
  gameId: string
  gameName: string
  commenceTime: string
  betType: string
  selection: string
  line?: number
  odds: number
  probability: number
  score: number
  source: string
  status: string
  settledAt?: string
  actualResult?: string
  profit?: number
  playerName?: string
  market?: string
  actualStat?: number
}

export default function AdminResultsPage() {
  const [stats, setStats] = useState<TrackingStats | null>(null)
  const [recommendations, setRecommendations] = useState<TrackedRecommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'calibration' | 'recent'>('overview')

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)
        
        // Fetch stats
        const statsRes = await fetch('/api/admin/results?action=stats')
        const statsData = await statsRes.json()
        if (statsData.success) {
          setStats(statsData.stats)
        }
        
        // Fetch recent recommendations
        const recentRes = await fetch('/api/admin/results?action=recent&limit=50')
        const recentData = await recentRes.json()
        if (recentData.success) {
          setRecommendations(recentData.recommendations)
        }
        
        setError(null)
      } catch (err) {
        setError('Failed to fetch data')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Recommendation Tracking</h1>
          <div className="text-gray-400">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Recommendation Tracking</h1>
          <div className="text-red-400">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Recommendation Tracking</h1>
        <p className="text-gray-400 mb-8">
          Last updated: {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleString() : 'Never'}
        </p>
        
        {/* Tab Navigation */}
        <div className="flex gap-4 mb-8 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2 px-4 ${activeTab === 'overview' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('calibration')}
            className={`pb-2 px-4 ${activeTab === 'calibration' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
          >
            Calibration
          </button>
          <button
            onClick={() => setActiveTab('recent')}
            className={`pb-2 px-4 ${activeTab === 'recent' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
          >
            Recent Bets
          </button>
        </div>
        
        {activeTab === 'overview' && stats && (
          <div className="space-y-8">
            {/* Overall Record */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard 
                title="Overall Record" 
                value={`${stats.wins}-${stats.losses}${stats.pushes > 0 ? `-${stats.pushes}` : ''}`}
                subtitle={`${stats.settledBets} settled, ${stats.pendingBets} pending`}
              />
              <StatCard 
                title="Win Rate" 
                value={`${stats.winRate.toFixed(1)}%`}
                subtitle={`${stats.wins} wins / ${stats.wins + stats.losses} decided`}
                highlight={stats.winRate >= 52}
              />
              <StatCard 
                title="ROI" 
                value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`}
                subtitle={`${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(2)} units`}
                highlight={stats.roi > 0}
              />
              <StatCard 
                title="Total Bets" 
                value={stats.totalBets.toString()}
                subtitle="All time"
              />
            </div>
            
            {/* By Confidence Level */}
            {stats.byConfidence.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">By Confidence Level</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-700">
                        <th className="pb-2">Level</th>
                        <th className="pb-2">Record</th>
                        <th className="pb-2">Win Rate</th>
                        <th className="pb-2">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byConfidence.map((conf) => (
                        <tr key={conf.level} className="border-b border-gray-700">
                          <td className="py-3">{conf.level}</td>
                          <td className="py-3">{conf.wins}-{conf.losses}</td>
                          <td className="py-3">
                            <span className={conf.winRate >= 52 ? 'text-green-400' : conf.winRate < 48 ? 'text-red-400' : ''}>
                              {conf.winRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3">
                            <span className={conf.roi > 0 ? 'text-green-400' : conf.roi < 0 ? 'text-red-400' : ''}>
                              {conf.roi >= 0 ? '+' : ''}{conf.roi.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* By Bet Type */}
            {stats.byBetType.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">By Bet Type</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-700">
                        <th className="pb-2">Type</th>
                        <th className="pb-2">Record</th>
                        <th className="pb-2">Win Rate</th>
                        <th className="pb-2">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byBetType.map((bt) => (
                        <tr key={bt.type} className="border-b border-gray-700">
                          <td className="py-3 capitalize">{bt.type}</td>
                          <td className="py-3">{bt.wins}-{bt.losses}</td>
                          <td className="py-3">
                            <span className={bt.winRate >= 52 ? 'text-green-400' : bt.winRate < 48 ? 'text-red-400' : ''}>
                              {bt.winRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3">
                            <span className={bt.roi > 0 ? 'text-green-400' : bt.roi < 0 ? 'text-red-400' : ''}>
                              {bt.roi >= 0 ? '+' : ''}{bt.roi.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* By Sport */}
            {stats.bySport.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">By Sport</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-700">
                        <th className="pb-2">Sport</th>
                        <th className="pb-2">Record</th>
                        <th className="pb-2">Win Rate</th>
                        <th className="pb-2">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.bySport.map((sp) => (
                        <tr key={sp.sport} className="border-b border-gray-700">
                          <td className="py-3">{sp.sport}</td>
                          <td className="py-3">{sp.wins}-{sp.losses}</td>
                          <td className="py-3">
                            <span className={sp.winRate >= 52 ? 'text-green-400' : sp.winRate < 48 ? 'text-red-400' : ''}>
                              {sp.winRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3">
                            <span className={sp.roi > 0 ? 'text-green-400' : sp.roi < 0 ? 'text-red-400' : ''}>
                              {sp.roi >= 0 ? '+' : ''}{sp.roi.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'calibration' && stats && (
          <div className="space-y-8">
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Calibration Analysis</h2>
              <p className="text-gray-400 mb-4">
                When we say X%, do we actually win X% of the time? Good calibration means the difference is close to 0.
              </p>
              
              {stats.calibration.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-700">
                        <th className="pb-2">Probability Bucket</th>
                        <th className="pb-2">Count</th>
                        <th className="pb-2">Expected Win %</th>
                        <th className="pb-2">Actual Win %</th>
                        <th className="pb-2">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.calibration.map((cal) => (
                        <tr key={cal.bucket} className="border-b border-gray-700">
                          <td className="py-3">{cal.bucket}</td>
                          <td className="py-3">{cal.count}</td>
                          <td className="py-3">{cal.expectedWinRate.toFixed(1)}%</td>
                          <td className="py-3">{cal.actualWinRate.toFixed(1)}%</td>
                          <td className="py-3">
                            <span className={
                              Math.abs(cal.difference) <= 5 ? 'text-green-400' : 
                              Math.abs(cal.difference) <= 10 ? 'text-yellow-400' : 'text-red-400'
                            }>
                              {cal.difference >= 0 ? '+' : ''}{cal.difference.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500">No calibration data yet. Need more settled bets.</p>
              )}
            </div>
            
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">How to Read This</h2>
              <ul className="text-gray-400 space-y-2">
                <li><span className="text-green-400">Green</span>: Difference within 5% - well calibrated</li>
                <li><span className="text-yellow-400">Yellow</span>: Difference 5-10% - slightly off</li>
                <li><span className="text-red-400">Red</span>: Difference over 10% - needs adjustment</li>
              </ul>
              <p className="text-gray-400 mt-4">
                Positive difference means we&apos;re winning more than expected (underconfident).
                Negative difference means we&apos;re winning less than expected (overconfident).
              </p>
            </div>
          </div>
        )}
        
        {activeTab === 'recent' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Recent Recommendations</h2>
            
            {recommendations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Sport</th>
                      <th className="pb-2">Selection</th>
                      <th className="pb-2">Odds</th>
                      <th className="pb-2">Prob</th>
                      <th className="pb-2">Score</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.map((reco) => (
                      <tr key={reco.id} className="border-b border-gray-700">
                        <td className="py-3 whitespace-nowrap">
                          {new Date(reco.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3">{reco.sportName}</td>
                        <td className="py-3 max-w-xs truncate" title={reco.selection}>
                          {reco.selection}
                        </td>
                        <td className="py-3">
                          {reco.odds > 0 ? '+' : ''}{reco.odds}
                        </td>
                        <td className="py-3">{reco.probability.toFixed(0)}%</td>
                        <td className="py-3">{reco.score.toFixed(0)}</td>
                        <td className="py-3">
                          <StatusBadge status={reco.status} />
                        </td>
                        <td className="py-3">
                          {reco.profit !== undefined ? (
                            <span className={reco.profit > 0 ? 'text-green-400' : reco.profit < 0 ? 'text-red-400' : ''}>
                              {reco.profit >= 0 ? '+' : ''}{reco.profit.toFixed(2)}u
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500">No recommendations tracked yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ title, value, subtitle, highlight }: { 
  title: string
  value: string
  subtitle: string
  highlight?: boolean 
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-gray-400 text-sm mb-1">{title}</div>
      <div className={`text-2xl font-bold ${highlight ? 'text-green-400' : ''}`}>{value}</div>
      <div className="text-gray-500 text-sm">{subtitle}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    won: 'bg-green-500/20 text-green-400',
    lost: 'bg-red-500/20 text-red-400',
    push: 'bg-gray-500/20 text-gray-400',
    void: 'bg-gray-500/20 text-gray-400'
  }
  
  return (
    <span className={`px-2 py-1 rounded text-xs ${colors[status] || colors.pending}`}>
      {status.toUpperCase()}
    </span>
  )
}
