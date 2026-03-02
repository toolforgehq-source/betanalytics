'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import Footer from '@/components/Footer'
import MobileNav from '@/components/MobileNav'

const ELO_DATA: Record<string, { sport: string; conference?: string; elo: number; record: string }> = {
  // NBA
  'Boston Celtics': { sport: 'NBA', conference: 'Eastern', elo: 1680, record: '48-14' },
  'Oklahoma City Thunder': { sport: 'NBA', conference: 'Western', elo: 1670, record: '47-15' },
  'Cleveland Cavaliers': { sport: 'NBA', conference: 'Eastern', elo: 1650, record: '46-16' },
  'Denver Nuggets': { sport: 'NBA', conference: 'Western', elo: 1620, record: '42-20' },
  'New York Knicks': { sport: 'NBA', conference: 'Eastern', elo: 1610, record: '41-21' },
  'Milwaukee Bucks': { sport: 'NBA', conference: 'Eastern', elo: 1600, record: '39-23' },
  'Minnesota Timberwolves': { sport: 'NBA', conference: 'Western', elo: 1595, record: '38-24' },
  'Dallas Mavericks': { sport: 'NBA', conference: 'Western', elo: 1585, record: '37-25' },
  'Phoenix Suns': { sport: 'NBA', conference: 'Western', elo: 1580, record: '37-25' },
  'Indiana Pacers': { sport: 'NBA', conference: 'Eastern', elo: 1575, record: '36-26' },
  'Philadelphia 76ers': { sport: 'NBA', conference: 'Eastern', elo: 1560, record: '34-28' },
  'Miami Heat': { sport: 'NBA', conference: 'Eastern', elo: 1555, record: '33-29' },
  'Sacramento Kings': { sport: 'NBA', conference: 'Western', elo: 1550, record: '33-29' },
  'Los Angeles Lakers': { sport: 'NBA', conference: 'Western', elo: 1545, record: '32-30' },
  'Golden State Warriors': { sport: 'NBA', conference: 'Western', elo: 1535, record: '31-31' },
  // NFL
  'Kansas City Chiefs': { sport: 'NFL', conference: 'AFC', elo: 1700, record: '15-2' },
  'Detroit Lions': { sport: 'NFL', conference: 'NFC', elo: 1660, record: '14-3' },
  'Baltimore Ravens': { sport: 'NFL', conference: 'AFC', elo: 1650, record: '13-4' },
  'San Francisco 49ers': { sport: 'NFL', conference: 'NFC', elo: 1640, record: '12-5' },
  'Buffalo Bills': { sport: 'NFL', conference: 'AFC', elo: 1630, record: '11-6' },
  'Philadelphia Eagles': { sport: 'NFL', conference: 'NFC', elo: 1620, record: '11-6' },
  'Dallas Cowboys': { sport: 'NFL', conference: 'NFC', elo: 1580, record: '10-7' },
  'Green Bay Packers': { sport: 'NFL', conference: 'NFC', elo: 1575, record: '9-8' },
  // Premier League
  'Manchester City': { sport: 'Premier League', elo: 1720, record: '22W-4D-2L' },
  'Arsenal': { sport: 'Premier League', elo: 1700, record: '21W-5D-2L' },
  'Liverpool': { sport: 'Premier League', elo: 1690, record: '20W-5D-3L' },
  'Aston Villa': { sport: 'Premier League', elo: 1600, record: '16W-4D-8L' },
  'Tottenham': { sport: 'Premier League', elo: 1580, record: '15W-3D-10L' },
  'Manchester United': { sport: 'Premier League', elo: 1550, record: '13W-2D-13L' },
  'Newcastle United': { sport: 'Premier League', elo: 1570, record: '14W-4D-10L' },
  'Chelsea': { sport: 'Premier League', elo: 1560, record: '13W-5D-10L' },
}

const ALL_TEAMS = Object.keys(ELO_DATA)

export default function EloLookupPage() {
  const [query, setQuery] = useState('')
  const [sportFilter, setSportFilter] = useState<string>('all')

  const filteredTeams = ALL_TEAMS.filter((team) => {
    const matchesSearch = team.toLowerCase().includes(query.toLowerCase())
    const matchesSport = sportFilter === 'all' || ELO_DATA[team].sport === sportFilter
    return matchesSearch && matchesSport
  }).sort((a, b) => ELO_DATA[b].elo - ELO_DATA[a].elo)

  const sports = Array.from(new Set(ALL_TEAMS.map((t) => ELO_DATA[t].sport)))

  function getEloColor(elo: number): string {
    if (elo >= 1700) return 'text-amber-400'
    if (elo >= 1600) return 'text-green-400'
    if (elo >= 1550) return 'text-cyan-400'
    return 'text-slate-400'
  }

  function getEloTier(elo: number): string {
    if (elo >= 1700) return 'Elite'
    if (elo >= 1650) return 'Championship'
    if (elo >= 1600) return 'Contender'
    if (elo >= 1550) return 'Playoff'
    return 'Average'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <header className="border-b border-slate-800/50 bg-slate-950/30 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/logo.png" alt="BetAnalytics.ai Logo" width={40} height={40} />
              <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                BetAnalytics.ai
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-5">
              <Link href="/picks" className="text-sm text-slate-300 hover:text-white transition-colors">Model Picks</Link>
              <Link href="/methodology" className="text-sm text-slate-300 hover:text-white transition-colors">Methodology</Link>
              <Link href="/blog" className="text-sm text-slate-300 hover:text-white transition-colors">Blog</Link>
              <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors">Sign In</Link>
              <Link href="/signup" className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-lg font-semibold text-sm transition-all shadow-lg shadow-blue-500/25">
                Start Free Trial
              </Link>
            </div>
            <MobileNav />
          </div>
        </div>
      </header>

      <main className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Elo Rating Lookup</h1>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Search Elo ratings for 800+ teams across NBA, NFL, NHL, MLB, college sports, and soccer. See where every team ranks.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-8">
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search teams... e.g. Lakers, Chiefs, Arsenal"
                  className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl pl-11 pr-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
              <select
                value={sportFilter}
                onChange={(e) => setSportFilter(e.target.value)}
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
              >
                <option value="all">All Sports</option>
                {sports.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="text-xs text-slate-500 mb-4">{filteredTeams.length} teams shown (sample data &mdash; subscribe for live ratings across all 800+ teams)</div>

            <div className="space-y-2">
              {filteredTeams.map((team) => {
                const data = ELO_DATA[team]
                return (
                  <div key={team} className="flex items-center justify-between bg-slate-800/30 border border-slate-700/20 rounded-xl px-4 py-3 hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-semibold text-sm">{team}</div>
                        <div className="text-xs text-slate-500">{data.sport}{data.conference ? ` - ${data.conference}` : ''} &middot; {data.record}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-bold ${getEloColor(data.elo)}`}>{data.elo}</div>
                      <div className="text-xs text-slate-500">{getEloTier(data.elo)}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {filteredTeams.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                No teams found matching &quot;{query}&quot;. Try a different search term.
              </div>
            )}
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-8">
            <h2 className="text-lg font-semibold mb-4">Understanding Elo Ratings</h2>
            <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <p><strong className="text-white">What is an Elo rating?</strong> Originally created for chess, Elo ratings quantify relative team strength. Every team starts at 1500. Winning increases your rating; losing decreases it. The amount of change depends on the expected outcome&mdash;upsets cause bigger rating swings.</p>
              <p><strong className="text-white">How to read it:</strong> An Elo gap of 100 means the higher-rated team has about a 64% chance of winning. A gap of 200 means about 76%. A gap of 400 means about 91%. These probabilities are the foundation of our edge detection.</p>
              <p><strong className="text-white">Elo tiers:</strong></p>
              <ul className="space-y-1 ml-4">
                <li><span className="text-amber-400 font-mono">1700+</span> &mdash; Elite (championship favorites)</li>
                <li><span className="text-green-400 font-mono">1650-1699</span> &mdash; Championship caliber</li>
                <li><span className="text-cyan-400 font-mono">1600-1649</span> &mdash; Contender</li>
                <li><span className="text-slate-300 font-mono">1550-1599</span> &mdash; Playoff team</li>
                <li><span className="text-slate-500 font-mono">1500-1549</span> &mdash; Average</li>
                <li><span className="text-slate-600 font-mono">&lt;1500</span> &mdash; Below average</li>
              </ul>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-6 md:p-8 mb-12">
            <h2 className="text-lg font-semibold mb-4">Elo Win Probability Examples</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800/50">
                    <th className="text-left py-2 pr-4">Elo Gap</th>
                    <th className="text-left py-2 pr-4">Favorite Win %</th>
                    <th className="text-left py-2 pr-4">Underdog Win %</th>
                    <th className="text-left py-2">Example</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4 font-mono">50</td><td className="py-2 pr-4">57.1%</td><td className="py-2 pr-4">42.9%</td><td className="py-2 text-slate-500">Close matchup</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4 font-mono">100</td><td className="py-2 pr-4">64.0%</td><td className="py-2 pr-4">36.0%</td><td className="py-2 text-slate-500">Clear favorite</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4 font-mono">150</td><td className="py-2 pr-4">70.4%</td><td className="py-2 pr-4">29.6%</td><td className="py-2 text-slate-500">Strong favorite</td>
                  </tr>
                  <tr className="border-b border-slate-800/30">
                    <td className="py-2 pr-4 font-mono">200</td><td className="py-2 pr-4">75.9%</td><td className="py-2 pr-4">24.1%</td><td className="py-2 text-slate-500">Big favorite</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono">400</td><td className="py-2 pr-4">90.9%</td><td className="py-2 pr-4">9.1%</td><td className="py-2 text-slate-500">Massive mismatch</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold mb-3">Get Live Elo Ratings for All 800+ Teams</h2>
            <p className="text-slate-400 mb-6">This is a sample. Subscribe to get real-time Elo ratings updated after every game, with injury adjustments and edge detection.</p>
            <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-500/25">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
            <p className="text-sm text-slate-500 mt-3">No credit card required</p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
