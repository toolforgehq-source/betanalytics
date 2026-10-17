import type { Metadata } from 'next'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Football Paper Lab | BetAnalytics',
  description: 'Prospective, timestamped NFL and college football predictions recorded before kickoff. Research only.',
  robots: { index: false, follow: false },
}

type PaperSelection = {
  team: string
  side: 'home' | 'away'
  price: number
  probability: number
  edgePct: number
  expectedReturn: number
  selectedAt: string
  stakeUnits: number
}
type PaperRecord = {
  gameId: string
  league: 'NCAAF' | 'NFL'
  gameDate: string
  kickoff: string
  home: string
  away: string
  homeWin: number
  homeRating: number
  awayRating: number
  effectiveGames: number
  capturedAt: string
  quoteCapturedAt: string | null
  homePrice: number | null
  awayPrice: number | null
  bookmaker: string | null
  paperSelection: PaperSelection | null
  result: null | {
    homeScore: number
    awayScore: number
    correctWinner: boolean | null
    paperUnits: number | null
  }
}
type Ledger = {
  success?: boolean
  generatedAt: string
  mode: 'PAPER_ONLY'
  records: PaperRecord[]
  count: {
    allForecasts: number
    upcoming: number
    upcomingWithOdds: number
    selected: number
    settledPaper: number
    paperWins: number
    paperUnits: number
  }
}
const odds = (o: number) => o > 0 ? `+${o}` : String(o)
const pct = (p: number) => (p * 100).toFixed(1) + '%'
const time = (d: string) => new Date(d).toLocaleString('en-US',{
  timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
})
const fmt = (x: number) => (x>=0?'+':'')+x.toFixed(2)

export default async function FootballLab() {
  let data: Ledger | null = null
  let message = 'Paper snapshots are still initializing.'
  try {
    const origin = 'https://raw.githubusercontent.com/toolforgehq-source/betanalytics/paper-football-data/latest.json'
    const response = await fetch(origin,{cache:'no-store',signal:AbortSignal.timeout(10000)})
    if(response.ok){
      const item = await response.json() as Ledger
      const lag=Date.now()-Date.parse(item.generatedAt)
      if(item.mode==='PAPER_ONLY' && Array.isArray(item.records) && lag>=-600000 && lag<=8*3600000){
        data=item
      } else message='Research feed is stale or invalid. No current paper results are being shown.'
    }
  }catch{message='Paper snapshots are temporarily unavailable.'}
  const now=Date.now()
  const upcoming=(data?.records||[]).filter(r=>Date.parse(r.kickoff)>now&&!r.result).sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff))
  const settled=(data?.records||[]).filter(r=>r.result).sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff))
  const settledBets=settled.filter(r=>r.paperSelection)
  const selectedUpcoming=upcoming.filter(r=>r.paperSelection)
  const paperRecord=data?.count

  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-8">
          <Link className="text-sm text-sky-300 hover:text-sky-200" href="/picks">← Official picks</Link>
          <span className="text-xs font-semibold border border-amber-400/50 rounded-lg px-3 py-1.5 text-amber-300">PAPER TEST ONLY</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold">Football Elo Research Lab</h1>
        <p className="mt-3 text-slate-300 max-w-3xl">
          The independent multi-season football model is making forecasts before kickoff, and freezing
          its first recorded predictions and sportsbook-price snapshots for later verification.
          These are not official BetAnalytics bets or claims of a proven betting advantage.
        </p>
        {!data ? (
          <div className="border border-amber-500/40 bg-amber-500/10 text-amber-100 rounded-xl p-6 mt-8">
            {message}
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs text-slate-400">
              Last captured {time(data.generatedAt)} CT · Independent paper ledger ·
              ESPN/DraftKings quotes are recorded when available, not guaranteed executable.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
              {[
                ['Pregame forecasts',String(data.count.allForecasts)],
                ['Current upcoming',String(upcoming.length)],
                ['Paper picks settled',String(settledBets.length)],
                ['Paper units settled',settledBets.length?fmt(data.count.paperUnits):'—'],
              ].map(([label,value])=>(
                <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 border border-slate-700 rounded-lg text-sm text-slate-300">
              Paper returns measure hypothetical one-unit moneyline wagers at recorded ESPN prices.
              Actual execution, line movement, limits, and betting fees may differ.
              {settledBets.length<30&&' Sample too small to infer profitability.'}
            </div>
            <h2 className="mt-10 text-xl font-semibold">Today's frozen paper selections</h2>
            <p className="text-sm text-slate-400 mt-1">Maximum three prospective selections per betting date. No retroactive replacements.</p>
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              {selectedUpcoming.length ? selectedUpcoming.map(r=>(
                <article key={r.league+r.gameId} className="rounded-xl border border-sky-600/40 bg-slate-900 p-5">
                  <p className="text-xs text-sky-300 font-semibold">{r.league} · {time(r.kickoff)} CT</p>
                  <h3 className="text-lg font-semibold mt-2">{r.paperSelection!.team}</h3>
                  <p className="text-sm text-slate-400">{r.away} @ {r.home}</p>
                  <p className="text-sm mt-3">Paper moneyline: <b>{odds(r.paperSelection!.price)}</b> · Model: <b>{pct(r.paperSelection!.probability)}</b> · Estimated edge: <b>{r.paperSelection!.edgePct.toFixed(1)}pp</b></p>
                  <p className="text-xs text-slate-500 mt-2">Frozen {time(r.paperSelection!.selectedAt)} · {r.bookmaker}</p>
                </article>
              )) : <p className="text-slate-400 mt-2">No prospective selections have passed the paper criteria for the remaining games.</p>}
            </div>
            <h2 className="mt-10 text-xl font-semibold">Upcoming model forecasts</h2>
            <p className="text-sm text-slate-400 mt-1">Forecasts do not necessarily represent profitable wagers.</p>
            <div className="overflow-x-auto mt-4 border border-slate-700 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>{['Game','Kickoff (CT)','Home win','Elo evidence','Price captured','Status'].map(h=><th key={h} className="text-left p-3 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>{upcoming.slice(0,80).map(r=>(
                  <tr key={r.league+r.gameId} className="border-t border-slate-800">
                    <td className="p-3 min-w-48"><span className="text-xs text-sky-300">{r.league}</span><div>{r.away} @ {r.home}</div></td>
                    <td className="p-3 whitespace-nowrap">{time(r.kickoff)}</td>
                    <td className="p-3 font-semibold">{pct(r.homeWin)}</td>
                    <td className="p-3">{r.effectiveGames.toFixed(1)} weighted games</td>
                    <td className="p-3">{r.quoteCapturedAt?'Yes':'Unavailable'}</td>
                    <td className="p-3">{r.paperSelection?'Paper selection':'Forecast only'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <h2 className="mt-10 text-xl font-semibold">Settled performance (first predictions only)</h2>
            <p className="text-sm text-slate-400 mt-1">
              Results are matched to pre-kickoff records. Winner accuracy is different from betting returns.
            </p>
            <div className="mt-4 overflow-x-auto border border-slate-700 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>{['Game','Prediction','Final','Winner correct?','Paper stake return'].map(h=><th key={h} className="text-left p-3 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>{settled.slice(0,40).map(r=>(
                  <tr className="border-t border-slate-800" key={r.league+r.gameId}>
                    <td className="p-3 whitespace-nowrap">{r.league}: {r.away} @ {r.home}</td>
                    <td className="p-3 whitespace-nowrap">{pct(r.homeWin)} home</td>
                    <td className="p-3">{r.result!.awayScore}–{r.result!.homeScore}</td>
                    <td className="p-3">{r.result!.correctWinner==null?'Push/tie':r.result!.correctWinner?'Yes':'No'}</td>
                    <td className="p-3">{r.result!.paperUnits==null?'No bet':fmt(r.result!.paperUnits)+' units'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {settled.length===0&&<p className="p-5 text-slate-400">No paper forecasts have settled yet.</p>}
            </div>
            <p className="text-xs text-slate-500 mt-8">
              Method: season-specific regression; prior-season evidence decays with age; moneyline-only paper selections.
              Parameters were selected on 2024 games. Additional bookmaker baseline and spread validations are required before production promotion.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
