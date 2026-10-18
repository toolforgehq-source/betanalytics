import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SOURCE = 'https://raw.githubusercontent.com/toolforgehq-source/betanalytics/paper-football-data/latest.json'
type PaperPick = {
  team: string
  side: 'home' | 'away'
  price: number
  probability: number
  edgePct: number
  expectedReturn: number
  selectedAt: string
}
type RecordRow = {
  gameId: string
  league: string
  gameDate: string
  kickoff: string
  home: string
  away: string
  effectiveGames: number
  capturedAt: string
  quoteCapturedAt: string | null
  bookmaker: string | null
  paperSelection: PaperPick | null
  result: null | { homeScore: number; awayScore: number; paperUnits: number | null }
}
type Snapshot = {
  mode: string
  model: string
  generatedAt: string
  records: RecordRow[]
}

function dateET(date: Date): string {
  // Intl 'en-CA' is inconsistent across Node runtimes; format parts explicitly.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? ''
  return get('year') + '-' + get('month') + '-' + get('day')
}

export async function GET() {
  try {
    const res = await fetch(SOURCE, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error('Football source HTTP ' + res.status)
    const snapshot: Snapshot = await res.json()
    if (snapshot.mode !== 'PAPER_ONLY' || !Array.isArray(snapshot.records) ||
        !Number.isFinite(Date.parse(snapshot.generatedAt))) throw new Error('Bad source schema')
    const now = new Date()
    const age = now.getTime() - Date.parse(snapshot.generatedAt)
    if (age < -600000 || age > 8 * 3600000) {
      return NextResponse.json({ success: false, reason: 'STALE',
        message: 'The prediction feed has not refreshed. No current picks are available.',
        lastUpdated: snapshot.generatedAt, picks: [] }, {status:503,headers:{'Cache-Control':'no-store'}})
    }
    const today = dateET(now)
    const rows = snapshot.records.filter(row =>
      row.gameDate === today && row.paperSelection !== null &&
      typeof row.paperSelection.team === 'string' &&
      Number.isFinite(row.paperSelection.price) &&
      Number.isFinite(row.paperSelection.probability) &&
      Number.isFinite(Date.parse(row.paperSelection.selectedAt)) &&
      Number.isFinite(Date.parse(row.kickoff)) &&
      Date.parse(row.paperSelection.selectedAt) < Date.parse(row.kickoff) &&
      row.quoteCapturedAt !== null &&
      Date.parse(row.quoteCapturedAt) < Date.parse(row.kickoff)
    )
    const ranked = rows.sort((a, b) =>
      (b.paperSelection?.expectedReturn ?? 0) - (a.paperSelection?.expectedReturn ?? 0) ||
      a.kickoff.localeCompare(b.kickoff))
      .slice(0,3).map((row, index) => ({
        rank:index+1,
        gameId: row.gameId,
        league: row.league,
        game: row.away + ' @ ' + row.home,
        kickoff:row.kickoff,
        selection:row.paperSelection!.team,
        market:'moneyline',
        odds:row.paperSelection!.price,
        modelProbability:row.paperSelection!.probability,
        estimatedEdgePct:row.paperSelection!.edgePct,
        estimatedReturn:row.paperSelection!.expectedReturn,
        effectiveGames:row.effectiveGames,
        modelTime:row.capturedAt,
        recordedOddsAt:row.quoteCapturedAt,
        bookmaker:row.bookmaker,
        status:row.result
          ? 'settled'
          : Date.parse(row.kickoff) <= now.getTime() ? 'in_progress' : 'upcoming',
        result:row.result,
      }))
    return NextResponse.json({
      success:true,dateET:today,
      model:'football-multiseason-v1',coverage:'NFL and college football only',
      testingStatus:'EXPERIMENTAL_NOT_VALIDATED',recommendedForRealMoney:false,
      message: ranked.length
        ? 'Three or fewer independently recorded football model candidates. These are experimental, not proven positive-EV wagers.'
        : 'No qualified, pregame-recorded football model candidates for this date.',
      updatedAt:snapshot.generatedAt,
      numberOfPicks:ranked.length,
      picks:ranked,
    }, {headers:{'Cache-Control':'no-store'}})
  } catch (e) {
    console.error('[daily-top3] football feed unavailable',e)
    return NextResponse.json({
      success:false,reason:'UNAVAILABLE',
      message:'Daily model data is unavailable. No picks are being invented.', picks:[],
    },{status:503,headers:{'Cache-Control':'no-store'}})
  }
}
