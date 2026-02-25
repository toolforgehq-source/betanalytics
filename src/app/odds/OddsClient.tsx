'use client'

import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, ExternalLink, TrendingUp, Search, Filter } from 'lucide-react'

// ============================================
// TYPES
// ============================================

interface BookPrice {
  book: string
  price: number
  point?: number
}

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

interface OddsResponse {
  success: boolean
  sports: Record<string, OddsGame[]>
  totalGames: number
  lastUpdated: string
  isStale?: boolean
}

type MarketTab = 'moneyline' | 'spread' | 'total'

// ============================================
// BOOK COLORS & LINKS
// ============================================

const BOOK_META: Record<string, { color: string; url: string }> = {
  'DraftKings': { color: 'text-[#53D337]', url: 'https://sportsbook.draftkings.com' },
  'FanDuel': { color: 'text-[#1493FF]', url: 'https://sportsbook.fanduel.com' },
  'BetMGM': { color: 'text-[#BFA05C]', url: 'https://sports.betmgm.com' },
  'Caesars': { color: 'text-white', url: 'https://www.caesars.com/sportsbook-and-casino' },
  'PointsBet': { color: 'text-red-400', url: 'https://pointsbet.com' },
  'BetRivers': { color: 'text-yellow-400', url: 'https://betrivers.com' },
  'Bovada': { color: 'text-red-500', url: 'https://www.bovada.lv' },
  'BetOnline.ag': { color: 'text-orange-400', url: 'https://www.betonline.ag' },
  'MyBookie.ag': { color: 'text-green-400', url: 'https://mybookie.ag' },
  'LowVig.ag': { color: 'text-purple-400', url: 'https://lowvig.ag' },
}

function getBookColor(book: string): string {
  return BOOK_META[book]?.color || 'text-slate-300'
}

// ============================================
// HELPERS
// ============================================

function formatOdds(price: number): string {
  if (price === 0) return '-'
  return price > 0 ? `+${price}` : `${price}`
}

function formatSpread(point: number): string {
  return point > 0 ? `+${point}` : `${point}`
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

function isBestPrice(price: number, bestPrice: BookPrice | null): boolean {
  if (!bestPrice) return false
  return price === bestPrice.price
}

// ============================================
// SUB-COMPONENTS
// ============================================

function GameMoneylineRow({ game }: { game: OddsGame }) {
  if (game.markets.moneyline.length === 0) {
    return <p className="text-sm text-slate-500 py-2">No moneyline odds available</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left py-2 pl-2 text-slate-400 font-medium w-28">Book</th>
            <th className="text-center py-2 text-slate-400 font-medium">{game.awayTeam}</th>
            <th className="text-center py-2 text-slate-400 font-medium">{game.homeTeam}</th>
            {game.markets.moneyline.some(m => m.draw !== undefined) && (
              <th className="text-center py-2 text-slate-400 font-medium">Draw</th>
            )}
          </tr>
        </thead>
        <tbody>
          {game.markets.moneyline.map((ml) => (
            <tr key={ml.book} className="border-b border-slate-800/30 hover:bg-slate-800/20">
              <td className={`py-2 pl-2 font-medium text-xs ${getBookColor(ml.book)}`}>{ml.book}</td>
              <td className={`py-2 text-center font-mono ${isBestPrice(ml.away, game.bestMoneyline.away) ? 'text-green-400 font-bold' : ''}`}>
                {formatOdds(ml.away)}
              </td>
              <td className={`py-2 text-center font-mono ${isBestPrice(ml.home, game.bestMoneyline.home) ? 'text-green-400 font-bold' : ''}`}>
                {formatOdds(ml.home)}
              </td>
              {ml.draw !== undefined && (
                <td className="py-2 text-center font-mono">{formatOdds(ml.draw)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GameSpreadRow({ game }: { game: OddsGame }) {
  if (game.markets.spread.length === 0) {
    return <p className="text-sm text-slate-500 py-2">No spread odds available</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left py-2 pl-2 text-slate-400 font-medium w-28">Book</th>
            <th className="text-center py-2 text-slate-400 font-medium">{game.awayTeam}</th>
            <th className="text-center py-2 text-slate-400 font-medium">{game.homeTeam}</th>
          </tr>
        </thead>
        <tbody>
          {game.markets.spread.map((sp) => (
            <tr key={sp.book} className="border-b border-slate-800/30 hover:bg-slate-800/20">
              <td className={`py-2 pl-2 font-medium text-xs ${getBookColor(sp.book)}`}>{sp.book}</td>
              <td className={`py-2 text-center font-mono ${isBestPrice(sp.awayPrice, game.bestSpread.away) ? 'text-green-400 font-bold' : ''}`}>
                <span className="text-slate-400 mr-1">{formatSpread(sp.awaySpread)}</span>
                {formatOdds(sp.awayPrice)}
              </td>
              <td className={`py-2 text-center font-mono ${isBestPrice(sp.homePrice, game.bestSpread.home) ? 'text-green-400 font-bold' : ''}`}>
                <span className="text-slate-400 mr-1">{formatSpread(sp.homeSpread)}</span>
                {formatOdds(sp.homePrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GameTotalRow({ game }: { game: OddsGame }) {
  if (game.markets.total.length === 0) {
    return <p className="text-sm text-slate-500 py-2">No total odds available</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left py-2 pl-2 text-slate-400 font-medium w-28">Book</th>
            <th className="text-center py-2 text-slate-400 font-medium">Line</th>
            <th className="text-center py-2 text-slate-400 font-medium">Over</th>
            <th className="text-center py-2 text-slate-400 font-medium">Under</th>
          </tr>
        </thead>
        <tbody>
          {game.markets.total.map((t) => (
            <tr key={t.book} className="border-b border-slate-800/30 hover:bg-slate-800/20">
              <td className={`py-2 pl-2 font-medium text-xs ${getBookColor(t.book)}`}>{t.book}</td>
              <td className="py-2 text-center text-slate-300">{t.line}</td>
              <td className={`py-2 text-center font-mono ${isBestPrice(t.overPrice, game.bestTotal.over) ? 'text-green-400 font-bold' : ''}`}>
                {formatOdds(t.overPrice)}
              </td>
              <td className={`py-2 text-center font-mono ${isBestPrice(t.underPrice, game.bestTotal.under) ? 'text-green-400 font-bold' : ''}`}>
                {formatOdds(t.underPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GameCard({ game, marketTab }: { game: OddsGame; marketTab: MarketTab }) {
  const [expanded, setExpanded] = useState(false)

  // Summary row for collapsed view
  const summaryData = useMemo(() => {
    const bestML = game.bestMoneyline
    const bestSp = game.bestSpread
    const bestTot = game.bestTotal
    return { bestML, bestSp, bestTot }
  }, [game])

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl overflow-hidden">
      {/* Game Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="text-left">
              <p className="font-semibold text-sm">{game.awayTeam} <span className="text-slate-500">@</span> {game.homeTeam}</p>
              <p className="text-xs text-slate-400">{formatGameTime(game.commenceTime)}</p>
            </div>
          </div>
        </div>

        {/* Quick summary */}
        <div className="hidden md:flex items-center gap-6 mr-4 text-xs">
          {marketTab === 'moneyline' && summaryData.bestML.away && summaryData.bestML.home && (
            <>
              <span className="text-green-400">Best Away: {formatOdds(summaryData.bestML.away.price)} <span className="text-slate-500">({summaryData.bestML.away.book})</span></span>
              <span className="text-green-400">Best Home: {formatOdds(summaryData.bestML.home.price)} <span className="text-slate-500">({summaryData.bestML.home.book})</span></span>
            </>
          )}
          {marketTab === 'spread' && summaryData.bestSp.away && summaryData.bestSp.home && (
            <>
              <span className="text-green-400">Best Away: {formatSpread(summaryData.bestSp.away.point ?? 0)} {formatOdds(summaryData.bestSp.away.price)} <span className="text-slate-500">({summaryData.bestSp.away.book})</span></span>
              <span className="text-green-400">Best Home: {formatSpread(summaryData.bestSp.home.point ?? 0)} {formatOdds(summaryData.bestSp.home.price)} <span className="text-slate-500">({summaryData.bestSp.home.book})</span></span>
            </>
          )}
          {marketTab === 'total' && summaryData.bestTot.over && summaryData.bestTot.under && (
            <>
              <span className="text-green-400">Best Over: {formatOdds(summaryData.bestTot.over.price)} <span className="text-slate-500">({summaryData.bestTot.over.book})</span></span>
              <span className="text-green-400">Best Under: {formatOdds(summaryData.bestTot.under.price)} <span className="text-slate-500">({summaryData.bestTot.under.book})</span></span>
            </>
          )}
        </div>

        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded odds table */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-800/50">
          {marketTab === 'moneyline' && <GameMoneylineRow game={game} />}
          {marketTab === 'spread' && <GameSpreadRow game={game} />}
          {marketTab === 'total' && <GameTotalRow game={game} />}
        </div>
      )}
    </div>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function OddsClient() {
  const [data, setData] = useState<OddsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marketTab, setMarketTab] = useState<MarketTab>('moneyline')
  const [sportFilter, setSportFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  async function fetchOdds() {
    try {
      setError(null)
      const res = await fetch('/api/odds')
      const json = await res.json()
      if (!json.success) {
        setError(json.error || 'Failed to fetch odds')
        return
      }
      setData(json)
    } catch (err) {
      setError('Failed to fetch odds data. Please try again.')
      console.error('Odds fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchOdds()
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchOdds()
  }

  // Filter and search
  const filteredSports = useMemo(() => {
    if (!data) return {}
    const result: Record<string, OddsGame[]> = {}

    for (const [sport, games] of Object.entries(data.sports)) {
      if (sportFilter !== 'all' && sport !== sportFilter) continue

      const filtered = games.filter(g => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return g.homeTeam.toLowerCase().includes(q) || g.awayTeam.toLowerCase().includes(q)
      })

      if (filtered.length > 0) {
        result[sport] = filtered
      }
    }

    return result
  }, [data, sportFilter, searchQuery])

  const sportNames = data ? Object.keys(data.sports).sort() : []
  const totalFiltered = Object.values(filteredSports).reduce((sum, games) => sum + games.length, 0)

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-6 animate-pulse">
            <div className="h-5 bg-slate-800 rounded w-2/3 mb-3" />
            <div className="h-4 bg-slate-800 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-8 text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 text-sm transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (!data || data.totalGames === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-8 text-center">
        <TrendingUp className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">No Games Available</h2>
        <p className="text-slate-400 max-w-md mx-auto">
          No upcoming games with odds data are currently available. Check back soon — odds are updated continuously.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        {/* Market Type Tabs */}
        <div className="flex items-center gap-2">
          {(['moneyline', 'spread', 'total'] as MarketTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setMarketTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                marketTab === tab
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700/30'
              }`}
            >
              {tab === 'total' ? 'Over/Under' : tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Search */}
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search teams..."
              className="w-full pl-9 pr-4 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {/* Sport Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white appearance-none focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">All Sports</option>
              {sportNames.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh odds"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Meta info */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{totalFiltered} games across {Object.keys(filteredSports).length} sports</span>
        <span>
          Updated {data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'recently'}
          {data.isStale && <span className="ml-2 text-yellow-400">(cached)</span>}
        </span>
      </div>

      {/* Best price hint */}
      <p className="text-xs text-slate-500 flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
        Green = best available price across all books
      </p>

      {/* Games by Sport */}
      {Object.entries(filteredSports).map(([sport, games]) => (
        <section key={sport}>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">{sport}</span>
            <span className="text-sm text-slate-500 font-normal">({games.length} {games.length === 1 ? 'game' : 'games'})</span>
          </h2>
          <div className="space-y-2">
            {games.map(game => (
              <GameCard key={game.id} game={game} marketTab={marketTab} />
            ))}
          </div>
        </section>
      ))}

      {totalFiltered === 0 && searchQuery && (
        <div className="text-center py-8">
          <p className="text-slate-400">No games found matching &quot;{searchQuery}&quot;</p>
        </div>
      )}
    </div>
  )
}
