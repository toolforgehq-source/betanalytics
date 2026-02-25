'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Clock, Trophy, Target, BarChart3, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

// Sportsbook deep links configuration
const BOOK_URLS: Record<string, Record<string, string>> = {
  draftkings: {
    default: 'https://sportsbook.draftkings.com',
    basketball_nba: 'https://sportsbook.draftkings.com/leagues/basketball/nba',
    basketball_ncaab: 'https://sportsbook.draftkings.com/leagues/basketball/college-basketball',
    americanfootball_nfl: 'https://sportsbook.draftkings.com/leagues/football/nfl',
    americanfootball_ncaaf: 'https://sportsbook.draftkings.com/leagues/football/college-football',
    icehockey_nhl: 'https://sportsbook.draftkings.com/leagues/hockey/nhl',
    baseball_mlb: 'https://sportsbook.draftkings.com/leagues/baseball/mlb',
  },
  fanduel: {
    default: 'https://sportsbook.fanduel.com',
    basketball_nba: 'https://sportsbook.fanduel.com/navigation/basketball/nba',
    basketball_ncaab: 'https://sportsbook.fanduel.com/navigation/basketball/college-basketball',
    americanfootball_nfl: 'https://sportsbook.fanduel.com/navigation/football/nfl',
    americanfootball_ncaaf: 'https://sportsbook.fanduel.com/navigation/football/college-football',
    icehockey_nhl: 'https://sportsbook.fanduel.com/navigation/hockey/nhl',
    baseball_mlb: 'https://sportsbook.fanduel.com/navigation/baseball/mlb',
  },
  betmgm: {
    default: 'https://sports.betmgm.com',
    basketball_nba: 'https://sports.betmgm.com/en/sports/basketball/nba',
    basketball_ncaab: 'https://sports.betmgm.com/en/sports/basketball/college-basketball',
    americanfootball_nfl: 'https://sports.betmgm.com/en/sports/football/nfl',
    icehockey_nhl: 'https://sports.betmgm.com/en/sports/hockey/nhl',
    baseball_mlb: 'https://sports.betmgm.com/en/sports/baseball/mlb',
  },
  caesars: {
    default: 'https://www.caesars.com/sportsbook-and-casino',
    basketball_nba: 'https://www.caesars.com/sportsbook-and-casino/basketball/nba',
    basketball_ncaab: 'https://www.caesars.com/sportsbook-and-casino/basketball/ncaa',
    americanfootball_nfl: 'https://www.caesars.com/sportsbook-and-casino/football/nfl',
    icehockey_nhl: 'https://www.caesars.com/sportsbook-and-casino/hockey/nhl',
    baseball_mlb: 'https://www.caesars.com/sportsbook-and-casino/baseball/mlb',
  },
}

function getBookLink(bookName: string, sport: string): string {
  const normalized = bookName.toLowerCase().replace(/\s+/g, '')
  for (const [key, urls] of Object.entries(BOOK_URLS)) {
    if (normalized.includes(key)) {
      return urls[sport] || urls.default
    }
  }
  return '#'
}

const SPORTSBOOKS = [
  { name: 'DraftKings', color: 'bg-[#53D337] hover:bg-[#47b830] text-black', getUrl: (sport: string) => BOOK_URLS.draftkings[sport] || BOOK_URLS.draftkings.default },
  { name: 'FanDuel', color: 'bg-[#1493FF] hover:bg-[#1180e0] text-white', getUrl: (sport: string) => BOOK_URLS.fanduel[sport] || BOOK_URLS.fanduel.default },
  { name: 'BetMGM', color: 'bg-[#BFA05C] hover:bg-[#a88d50] text-black', getUrl: (sport: string) => BOOK_URLS.betmgm[sport] || BOOK_URLS.betmgm.default },
  { name: 'Caesars', color: 'bg-[#0A3D2C] hover:bg-[#0d4f39] text-white', getUrl: (sport: string) => BOOK_URLS.caesars[sport] || BOOK_URLS.caesars.default },
]

interface StoredPick {
  id: string
  createdAt: string
  gameId: string
  sport: string
  sportName: string
  homeTeam: string
  awayTeam: string
  gameTime: string
  pickType: string
  team: string
  betType: string
  line?: number
  odds: number
  consensusProbability: number
  impliedProbability: number
  edge: number
  bestBook: string
  status: 'pending' | 'won' | 'lost' | 'push' | 'cancelled'
  gradedAt?: string
  actualResult?: string
  units: number
  unitsWon?: number
}

interface TrackRecord {
  period: string
  wins: number
  losses: number
  pushes: number
  total: number
  winRate: number
  units: number
  roi: number
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
}

interface PicksData {
  success: boolean
  todaysPicks: StoredPick[]
  recentSettled: StoredPick[]
  recentRecommendations: TrackedRecommendation[]
  trackRecord: {
    '7d': TrackRecord
    '30d': TrackRecord
    '90d': TrackRecord
    'all': TrackRecord
  } | null
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
}

type PeriodKey = '7d' | '30d' | '90d' | 'all'

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

function formatBetType(betType: string, team: string, line?: number): string {
  if (betType === 'moneyline') return `${team} ML`
  if (betType === 'spread' && line !== undefined) return `${team} ${line > 0 ? '+' : ''}${line}`
  if (betType === 'total' && line !== undefined) return `${team} ${line}`
  return `${team} ${betType}`
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    won: 'bg-green-500/20 text-green-400 border-green-500/30',
    lost: 'bg-red-500/20 text-red-400 border-red-500/30',
    push: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pending: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    cancelled: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    void: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  }

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[status] || colors.pending}`}>
      {status.toUpperCase()}
    </span>
  )
}

function StatCard({ label, value, subtext, trend }: { label: string; value: string; subtext?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold">{value}</span>
        {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-400" />}
        {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-400" />}
      </div>
      {subtext && <div className="text-xs text-slate-500 mt-1">{subtext}</div>}
    </div>
  )
}

export default function PicksClient() {
  const [data, setData] = useState<PicksData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('30d')
  const [showAllHistory, setShowAllHistory] = useState(false)

  useEffect(() => {
    async function fetchPicks() {
      try {
        const res = await fetch('/api/picks')
        if (!res.ok) throw new Error('Failed to fetch picks')
        const json = await res.json()
        setData(json)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load picks')
      } finally {
        setLoading(false)
      }
    }
    fetchPicks()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
      </div>
    )
  }

  if (error || !data?.success) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">Unable to load picks data. Please try again later.</p>
      </div>
    )
  }

  const record = data.trackRecord?.[selectedPeriod]
  const hasTrackRecord = data.trackRecord && record && record.total > 0
  const hasRecos = data.recentRecommendations.length > 0
  const hasPicks = data.todaysPicks.length > 0 || data.recentSettled.length > 0

  // Combine and deduplicate recent history from both systems
  const recentHistory = data.recentRecommendations.length > 0
    ? data.recentRecommendations
    : data.recentSettled.map(p => ({
        id: p.id,
        createdAt: p.createdAt,
        sport: p.sport,
        sportName: p.sportName,
        gameId: p.gameId,
        gameName: `${p.awayTeam} @ ${p.homeTeam}`,
        commenceTime: p.gameTime,
        betType: p.betType,
        selection: formatBetType(p.betType, p.team, p.line),
        line: p.line,
        odds: p.odds,
        probability: p.consensusProbability,
        score: 0,
        source: p.pickType as string,
        status: p.status,
        settledAt: p.gradedAt,
        actualResult: p.actualResult,
        profit: p.unitsWon,
      }))

  const displayHistory = showAllHistory ? recentHistory : recentHistory.slice(0, 15)

  return (
    <div className="space-y-8">
      {/* Track Record Summary */}
      {hasTrackRecord && record ? (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="w-6 h-6 text-yellow-400" />
              Track Record
            </h2>
            <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1">
              {(['7d', '30d', '90d', 'all'] as PeriodKey[]).map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    selectedPeriod === period
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {period === 'all' ? 'All Time' : period === '7d' ? '7 Days' : period === '30d' ? '30 Days' : '90 Days'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Record"
              value={`${record.wins}-${record.losses}${record.pushes > 0 ? `-${record.pushes}` : ''}`}
              subtext={`${record.total} total picks`}
            />
            <StatCard
              label="Win Rate"
              value={`${record.winRate.toFixed(1)}%`}
              trend={record.winRate >= 55 ? 'up' : record.winRate < 50 ? 'down' : 'neutral'}
            />
            <StatCard
              label="Units"
              value={`${record.units >= 0 ? '+' : ''}${record.units.toFixed(1)}`}
              trend={record.units > 0 ? 'up' : record.units < 0 ? 'down' : 'neutral'}
            />
            <StatCard
              label="ROI"
              value={`${record.roi >= 0 ? '+' : ''}${record.roi.toFixed(1)}%`}
              trend={record.roi > 0 ? 'up' : record.roi < 0 ? 'down' : 'neutral'}
            />
          </div>
        </section>
      ) : (
        <section>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-8 text-center">
            <Trophy className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h2 className="text-xl font-bold mb-2">Track Record Building</h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Our model is actively making picks and tracking results. As games complete and picks are graded, 
              our verified track record will appear here with win rates, ROI, and unit profit.
            </p>
          </div>
        </section>
      )}

      {/* Today's Picks */}
      <section>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Target className="w-6 h-6 text-cyan-400" />
          Today&apos;s Model Picks
        </h2>
        {hasPicks && data.todaysPicks.length > 0 ? (
          <div className="space-y-3">
            {data.todaysPicks.map((pick) => (
              <div key={pick.id} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full font-medium">
                        {pick.pickType === 'best_bet' ? 'BEST BET' : pick.pickType.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-500">{pick.sportName}</span>
                    </div>
                    <div className="font-semibold text-lg">
                      {formatBetType(pick.betType, pick.team, pick.line)}
                    </div>
                    <div className="text-sm text-slate-400">
                      {pick.awayTeam} @ {pick.homeTeam}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(pick.gameTime).toLocaleString('en-US', { 
                        timeZone: 'America/New_York',
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                      })} ET
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">{formatOdds(pick.odds)}</div>
                    <a
                      href={getBookLink(pick.bestBook, pick.sport)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
                    >
                      {pick.bestBook} <ExternalLink className="w-3 h-3" />
                    </a>
                    <StatusBadge status={pick.status} />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-800/50 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xs text-slate-500">Our Probability</div>
                    <div className="font-semibold text-blue-400">{pick.consensusProbability.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Market Implied</div>
                    <div className="font-semibold text-slate-400">{pick.impliedProbability.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Edge</div>
                    <div className="font-semibold text-green-400">+{pick.edge.toFixed(1)}%</div>
                  </div>
                </div>
                {pick.status === 'pending' && (
                  <div className="mt-3 pt-3 border-t border-slate-800/50">
                    <p className="text-xs text-slate-500 mb-2">Place this bet:</p>
                    <div className="flex flex-wrap gap-2">
                      {SPORTSBOOKS.map((book) => (
                        <a
                          key={book.name}
                          href={book.getUrl(pick.sport)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${book.color}`}
                        >
                          {book.name}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6 text-center">
            <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400">
              No model picks yet today. Picks are generated when our model finds edges with 52%+ probability 
              and positive expected value. Check back closer to game time.
            </p>
          </div>
        )}
      </section>

      {/* Performance by Category */}
      {data.stats.byBetType.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-400" />
            Performance Breakdown
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {/* By Bet Type */}
            <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
              <h3 className="font-semibold mb-3 text-slate-300">By Bet Type</h3>
              <div className="space-y-2">
                {data.stats.byBetType.map((bt) => (
                  <div key={bt.type} className="flex items-center justify-between py-1 border-b border-slate-800/30 last:border-0">
                    <span className="text-sm capitalize">{bt.type}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-400">{bt.wins}-{bt.losses}</span>
                      <span className={bt.winRate >= 55 ? 'text-green-400' : bt.winRate < 50 ? 'text-red-400' : 'text-slate-300'}>
                        {bt.winRate.toFixed(1)}%
                      </span>
                      <span className={bt.roi >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {bt.roi >= 0 ? '+' : ''}{bt.roi.toFixed(1)}% ROI
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* By Sport */}
            <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
              <h3 className="font-semibold mb-3 text-slate-300">By Sport</h3>
              <div className="space-y-2">
                {data.stats.bySport.map((sp) => (
                  <div key={sp.sport} className="flex items-center justify-between py-1 border-b border-slate-800/30 last:border-0">
                    <span className="text-sm">{sp.sport}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-400">{sp.wins}-{sp.losses}</span>
                      <span className={sp.winRate >= 55 ? 'text-green-400' : sp.winRate < 50 ? 'text-red-400' : 'text-slate-300'}>
                        {sp.winRate.toFixed(1)}%
                      </span>
                      <span className={sp.roi >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {sp.roi >= 0 ? '+' : ''}{sp.roi.toFixed(1)}% ROI
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Recent Pick History */}
      {recentHistory.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Recent Picks</h2>
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/50">
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
                  {displayHistory.map((reco) => (
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
            {recentHistory.length > 15 && (
              <div className="px-4 py-3 border-t border-slate-800/50 text-center">
                <button
                  onClick={() => setShowAllHistory(!showAllHistory)}
                  className="text-cyan-400 hover:text-cyan-300 text-sm font-medium flex items-center gap-1 mx-auto"
                >
                  {showAllHistory ? (
                    <>Show Less <ChevronUp className="w-4 h-4" /></>
                  ) : (
                    <>Show All {recentHistory.length} Picks <ChevronDown className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Empty State */}
      {!hasTrackRecord && !hasPicks && !hasRecos && (
        <section className="text-center py-12">
          <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Building Our Track Record</h2>
          <p className="text-slate-400 max-w-lg mx-auto mb-6">
            Every pick our model makes is recorded and graded automatically after games complete. 
            Our full track record with win rates, ROI, and performance breakdowns by sport and bet type 
            will be displayed here as data accumulates.
          </p>
          <p className="text-sm text-slate-500">
            Picks are generated every hour when our Elo model finds edges with 52%+ probability.
          </p>
        </section>
      )}
    </div>
  )
}
