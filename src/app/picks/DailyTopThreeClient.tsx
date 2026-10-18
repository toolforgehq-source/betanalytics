'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

type Candidate = {
  rank: number
  gameId: string
  league: string
  game: string
  kickoff: string
  selection: string
  market: string
  odds: number
  modelProbability: number
  estimatedEdgePct: number
  estimatedReturn: number
  effectiveGames: number
  modelTime: string
  recordedOddsAt: string
  bookmaker: string | null
  status: 'settled' | 'in_progress' | 'upcoming'
  result: { homeScore: number; awayScore: number; paperUnits: number | null } | null
}
type DailyResult = {
  success: boolean
  dateET?: string
  coverage?: string
  testingStatus?: string
  numberOfPicks?: number
  message: string
  updatedAt?: string
  picks: Candidate[]
}
function displayDate(value:string) {
  const [year,month,day] = value.split('-').map(Number)
  return new Date(Date.UTC(year,month-1,day,15,0)).toLocaleDateString('en-US',{
    timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric',
  })
}
const formattedOdds=(n:number)=>n>0?`+${n}`:String(n)
const formatCT=(input:string)=>new Date(input).toLocaleTimeString('en-US',{
  hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'
})
const fmtStamp=(input:string)=>new Date(input).toLocaleString('en-US',{
  timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'
})

export default function DailyTopThreeClient(){
  const [data,setData]=useState<DailyResult|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState<string|null>(null)
  useEffect(()=>{
    let alive=true
    async function load(){
      try{
        const res=await fetch('/api/daily-top3',{cache:'no-store'})
        const json=await res.json() as DailyResult
        if(!res.ok||!json.success)throw new Error(json.message||'Daily picks unavailable')
        if(alive)setData(json)
      }catch(e){if(alive)setError(e instanceof Error?e.message:'Daily picks unavailable')}
      finally{if(alive)setLoading(false)}
    }
    load()
    return()=>{alive=false}
  },[])
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/80">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex gap-2 items-center font-semibold tracking-tight">
            <Image src="/logo.png" width={28} height={28} alt="BetAnalytics" />
            BetAnalytics
          </Link>
          <Link href="/football-lab" className="text-xs text-slate-400 hover:text-white">
            Full model record →
          </Link>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-10 md:py-14">
        <h1 className="text-4xl font-bold tracking-tight">Today&apos;s Top 3</h1>
        <p className="mt-3 text-slate-300">
          {data?.dateET ? displayDate(data.dateET):'NFL + college football'} · Elo-ranked moneyline candidates
        </p>
        <p className="mt-2 text-sm text-amber-300">
          Experimental predictions. Real sportsbook prices were recorded before kickoff;
          an independently profitable betting edge has not been verified.
        </p>

        {loading && <p className="text-slate-400 mt-10">Loading latest verified model selections…</p>}
        {error && <div className="mt-10 border border-amber-500/40 rounded-xl p-5 text-amber-100">
          <p className="font-semibold">No reliable picks can be shown right now.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>}
        {data&&!loading&&(
          <>
            <div className="mt-8 space-y-4">
              {data.picks.map(p=>(
                <article key={p.gameId} className="border border-slate-700 rounded-xl p-5 md:p-6 bg-slate-900/80">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sky-300 text-xs font-semibold uppercase tracking-wider">
                        #{p.rank} · {p.league} · {p.market.toUpperCase()}
                      </p>
                      <h2 className="text-xl md:text-2xl font-bold mt-2">{p.selection}</h2>
                      <p className="text-sm text-slate-400 mt-1">{p.game}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-bold">{formattedOdds(p.odds)}</p>
                      <p className="text-xs text-slate-400 mt-1">Recorded odds</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-5 border-t border-slate-700/60 pt-4">
                    <div><p className="text-xs text-slate-400">Model win %</p>
                      <p className="font-semibold">{(p.modelProbability*100).toFixed(1)}%</p></div>
                    <div><p className="text-xs text-slate-400">Est. edge</p>
                      <p className="font-semibold">{p.estimatedEdgePct.toFixed(1)} pp</p></div>
                    <div><p className="text-xs text-slate-400">Kickoff (CT)</p>
                      <p className="font-semibold">{formatCT(p.kickoff)}</p></div>
                  </div>
                  <p className="text-xs text-slate-500 mt-4">
                    {p.status==='settled'
                      ? `Final: ${p.result?.awayScore}–${p.result?.homeScore}; paper return ${p.result?.paperUnits!=null?p.result.paperUnits.toFixed(2)+' units':'N/A'}`
                      : p.status==='in_progress'?'Game underway · selection frozen before kickoff':'Upcoming · selection frozen before kickoff'}
                    {' · '}
                    {p.bookmaker||'ESPN'} recorded {fmtStamp(p.recordedOddsAt)} CT
                  </p>
                </article>
              ))}
              {data.picks.length===0&&(
                <div className="border border-slate-700 bg-slate-900/50 rounded-xl p-7 text-center">
                  <h2 className="text-lg font-semibold">No verified football selections for today</h2>
                  <p className="text-slate-400 text-sm mt-2">
                    We won&apos;t invent three bets when the data or model criteria do not support them.
                  </p>
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-6">
              Last model update: {data.updatedAt?fmtStamp(data.updatedAt)+' CT':'Unknown'}
              {' · '}
              {data.picks.length}/3 recorded selections
              {' · '}
              Football only; other sports currently require database recovery.
            </div>
            <div className="mt-7 text-sm text-slate-400">
              Historical win accuracy does not guarantee profitable wagering.
              Recorded prices may have moved. Verify the latest odds independently.
            </div>
          </>
        )}
      </div>
    </main>
  )
}
