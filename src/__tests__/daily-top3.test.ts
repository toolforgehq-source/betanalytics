import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/daily-top3/route'

const fixedTime = '2026-10-17T22:00:00Z'
const game = (id:string, options:Record<string,unknown> = {}) => ({
  gameId:id,
  league:'NCAAF',
  gameDate:'2026-10-17',
  kickoff:'2026-10-18T00:00:00Z',
  home:'Home',away:'Away',
  effectiveGames:20,capturedAt:'2026-10-17T13:00:00Z',
  quoteCapturedAt:'2026-10-17T14:00:00Z',
  bookmaker:'DraftKings',
  paperSelection:{
    team:'Home',side:'home',price:120,probability:.52,
    edgePct:6.55,expectedReturn:.14,selectedAt:'2026-10-17T14:01:00Z'
  },result:null,...options,
})

describe('Daily top-three uses only prior recorded prospective selections',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(fixedTime))})
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
  it('shows exactly three different games ranked by expected return',async()=>{
    const records=[
      game('g1',{paperSelection:{team:'Home',price:120,probability:.52,edgePct:6,expectedReturn:.14,selectedAt:'2026-10-17T14:01:00Z'}}),
      game('g2',{paperSelection:{team:'Away',price:150,probability:.5,edgePct:9,expectedReturn:.25,selectedAt:'2026-10-17T14:01:00Z'}}),
      game('g3',{paperSelection:{team:'Home',price:100,probability:.55,edgePct:5,expectedReturn:.10,selectedAt:'2026-10-17T14:01:00Z'}}),
      game('g4',{paperSelection:{team:'Home',price:125,probability:.55,edgePct:7,expectedReturn:.09,selectedAt:'2026-10-17T14:01:00Z'}}),
      game('future',{gameDate:'2026-10-18'}),
    ]
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
      mode:'PAPER_ONLY',generatedAt:fixedTime,records
    }),{status:200})))
    const response=await GET()
    const parsed=await response.json()
    expect(response.status).toBe(200)
    expect(parsed.dateET).toBe('2026-10-17')
    expect(parsed.numberOfPicks).toBe(3)
    expect(parsed.picks.map((p:{gameId:string})=>p.gameId)).toEqual(['g2','g1','g3'])
    expect(parsed.recommendedForRealMoney).toBe(false)
  })
  it('never recommends a prediction or price first recorded after kickoff',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
      mode:'PAPER_ONLY',generatedAt:fixedTime,records:[
        game('invalid',{quoteCapturedAt:'2026-10-18T02:00:00Z'}),
        game('valid')
      ]
    }),{status:200})))
    const response=await GET()
    const parsed=await response.json()
    expect(parsed.picks.map((p:{gameId:string})=>p.gameId)).toEqual(['valid'])
  })
  it('returns no picks rather than stale results',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
      mode:'PAPER_ONLY',generatedAt:'2026-10-17T01:00:00Z',records:[game('expired')]
    }),{status:200})))
    const response=await GET()
    expect(response.status).toBe(503)
    const parsed=await response.json()
    expect(parsed.picks).toEqual([])
  })
})
