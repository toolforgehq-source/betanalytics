import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pg-kv',()=>({isDbConfigured:vi.fn(()=>true)}))
vi.mock('@/lib/elo',()=>({getEloRatings:vi.fn(),updateEloRatings:vi.fn()}))

import { getEloRatings, updateEloRatings } from '@/lib/elo'
import {
  monthKeysForLeague, parseCompletedESPNEvents,
  collectFreeEloHistory, bootstrapEmptyElo
} from '@/lib/free-elo-bootstrap'

const TODAY=new Date('2026-10-13T20:00:00Z')
const mockGet=vi.mocked(getEloRatings)
const mockUpdate=vi.mocked(updateEloRatings)
function event(id:string, month='202509') {
  return {
    id,date:month.slice(0,4)+'-'+month.slice(4,6)+'-10T12:00:00Z',
    season:{type:2},status:{type:{completed:true}},
    competitions:[{neutralSite:false,competitors:[
      {homeAway:'home',team:{id:'home',displayName:'Home'},score:'3'},
      {homeAway:'away',team:{id:'away',displayName:'Away'},score:'1'}
    ]}]
  }
}
function dataFetcher() {
  return vi.fn(async (input:unknown) => {
    const url=String(input), m=url.match(/dates=(\d{6})/)?.[1]
    if(!m) throw Error('Missing month')
    const n=url.includes('/baseball/')?75:45
    return {ok:true,status:200,json:async()=>({
      events:Array.from({length:n},(_,i)=>event('id-'+m+'-'+i,m))
    })} as Response
  })
}
describe('Safe free historical Elo initialization',()=>{
  beforeEach(()=>{vi.clearAllMocks()})
  it('generates chronological bounded UTC month ranges',()=>{
    const nhl=monthKeysForLeague('NHL',TODAY)
    const mlb=monthKeysForLeague('MLB',TODAY)
    expect(nhl).toHaveLength(14)
    expect(nhl[0]).toBe('202509')
    expect(nhl[nhl.length-1]).toBe('202610')
    expect(mlb).toHaveLength(9)
    expect(mlb[mlb.length-1]).toBe('202610')
  })
  it('accepts only completed, valid, regular/postseason ESPN games',()=>{
    const complete=event('good')
    const preseason={...event('preseason'),season:{type:1}}
    const notFinished={...event('pending'),status:{type:{completed:false}}}
    const missing={...event('missing'),competitions:[{competitors:[
      {homeAway:'home',team:{id:'h',displayName:'H'}},
      {homeAway:'away',team:{id:'a',displayName:'A'},score:'2'}
    ]}]}
    const duplicates=event('good')
    const result=parseCompletedESPNEvents([complete,preseason,notFinished,missing,duplicates],'NHL')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({gameId:'good',homeScore:3,awayScore:1})
  })
  it('fails closed on failed ESPN fetch, not silently saving an incomplete history',async()=>{
    await expect(collectFreeEloHistory(TODAY,async()=>({ok:false,status:429}) as Response))
      .rejects.toThrow(/ESPN history HTTP 429/)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
  it('fetches free month history in order and deduplicates IDs by league',async()=>{
    const f=dataFetcher()
    const result=await collectFreeEloHistory(TODAY,f)
    expect(result.byLeague.NHL).toBeGreaterThanOrEqual(200)
    expect(result.byLeague.MLB).toBeGreaterThanOrEqual(500)
    expect(f).toHaveBeenCalled()
    expect(result.games.length).toBe(Object.values(result.byLeague).reduce((a,b)=>a+b,0))
    expect(result.games.every((g,i,arr)=>i===0||Date.parse(g.date)>=Date.parse(arr[i-1].date))).toBe(true)
  })
  it('never overwrites a populated Elo store or initiates ESPN requests',async()=>{
    mockGet.mockResolvedValue({ratings:{'NHL:10':{teamId:'10',teamName:'X',league:'NHL',rating:1600,gamesPlayed:20,lastUpdated:TODAY.toISOString()}},gamesProcessed:20,lastUpdated:TODAY.toISOString()})
    const f=dataFetcher()
    const result=await bootstrapEmptyElo(TODAY,f)
    expect(result.seeded).toBe(false)
    expect(f).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
  it('requires independent proof of persistent storage after attempting initialization',async()=>{
    mockGet.mockResolvedValue(null)
    mockUpdate.mockImplementation(async games=>({ratings:{},lastUpdated:TODAY.toISOString(),gamesProcessed:games.length}))
    await expect(bootstrapEmptyElo(TODAY,dataFetcher())).rejects.toThrow(/persistent storage/)
  })
  it('can initialize an empty store and verify the persisted result',async()=>{
    const persisted={
      ratings:{'NHL:10':{teamId:'10',teamName:'X',league:'NHL',rating:1600,gamesPlayed:20,lastUpdated:TODAY.toISOString()}},
      gamesProcessed:10000,lastUpdated:TODAY.toISOString()
    }
    mockGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(persisted)
    mockUpdate.mockResolvedValue(persisted)
    const result=await bootstrapEmptyElo(TODAY,dataFetcher())
    expect(result.seeded).toBe(true)
    expect(result.teams).toBe(1)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})
