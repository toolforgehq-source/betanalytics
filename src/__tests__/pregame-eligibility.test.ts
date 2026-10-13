import { beforeEach,describe,it,expect,vi } from 'vitest'
vi.mock('@/lib/pg-kv',()=>({kvGet:vi.fn(),isDbConfigured:vi.fn(()=>true)}))
import { kvGet } from '@/lib/pg-kv'
import { getBlockedPregameGameIds } from '@/lib/pregame-eligibility'

const mockKV=vi.mocked(kvGet)
const start='2026-10-14T02:00:00Z'
const game=(id:string)=>({gameId:id,sport:'basketball_nba',commenceTime:start})
beforeEach(()=>mockKV.mockReset())
describe('Preseason recommendation quarantine',()=>{
  it('blocks cached NBA exhibitions with explicit ESPN season type 1',async()=>{
    mockKV.mockResolvedValue(JSON.stringify({games:[{gameId:'nba_pre_1',seasonType:1}]}))
    const fetcher=vi.fn()
    const blocked=await getBlockedPregameGameIds([game('nba_pre_1')],fetcher as unknown as typeof fetch)
    expect(blocked.has('nba_pre_1')).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('allows only verified regular/postseason games when ESPN cache metadata is missing',async()=>{
    mockKV.mockResolvedValue(JSON.stringify({games:[{gameId:'nba_regular_2'}]}))
    const fetcher=vi.fn(async()=>({ok:true,json:async()=>({events:[{id:'nba_regular_2',season:{type:2}}]})}))
    const blocked=await getBlockedPregameGameIds([game('nba_regular_2')],fetcher as unknown as typeof fetch)
    expect(blocked.has('nba_regular_2')).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects old cached exhibition picks using live ESPN scoreboard metadata',async()=>{
    mockKV.mockResolvedValue(JSON.stringify({games:[{gameId:'nba_pre_3'}]}))
    const fetcher=vi.fn(async()=>({ok:true,json:async()=>({events:[{id:'nba_pre_3',season:{type:1}}]})}))
    const blocked=await getBlockedPregameGameIds([game('nba_pre_3')],fetcher as unknown as typeof fetch)
    expect(blocked.has('nba_pre_3')).toBe(true)
  })
  it('fails closed for unknown game when ESPN data is unavailable',async()=>{
    mockKV.mockResolvedValue(null)
    const fetcher=vi.fn(async()=>{throw new Error('ESPN offline')})
    const blocked=await getBlockedPregameGameIds([game('nba_missing_4')],fetcher as unknown as typeof fetch)
    expect(blocked.has('nba_missing_4')).toBe(true)
  })
})
