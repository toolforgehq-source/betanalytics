import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/lib/pg-kv', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  isDbConfigured: vi.fn(() => true)
}))
vi.mock('@/lib/espn', () => ({
  fetchAllESPNOdds: vi.fn()
}))
import { kvGet } from '@/lib/pg-kv'
import { fetchAllESPNOdds } from '@/lib/espn'

const kv = vi.mocked(kvGet)
const fetchESPN = vi.mocked(fetchAllESPNOdds)
const game = {
  gameId:'e1',sport:'hockey',league:'NHL',
  homeTeam:'Detroit Red Wings',awayTeam:'New Jersey Devils',
  commenceTime:'2099-10-13T22:00:00Z',provider:'Draft Kings',
  spread:null,spreadOdds:null,overUnder:null,overUnderOdds:null,
  moneyline:{home:-115,away:-105},homeFavorite:true,gameStatus:'pre' as const,statusDetail:''
}
const saved = (ageMinutes:number) => JSON.stringify({
  lastUpdated:new Date(Date.now()-ageMinutes*60000).toISOString(),
  error:null,games:[game]
})

describe('ESPN odds persisted cache reliability',()=>{
  beforeEach(()=>{
    vi.resetModules()
    kv.mockReset()
    fetchESPN.mockReset()
    vi.stubEnv('ODDS_API_KEY','')
    vi.stubEnv('USE_PAID_ODDS_FALLBACK','')
    vi.stubEnv('DATABASE_URL','postgresql://test-only')
  })
  afterEach(()=>vi.unstubAllEnvs())
  it('reads actual odds already saved by cron without another ESPN request',async()=>{
    kv.mockImplementation(async(key)=>key==='espn_odds_cache'?saved(5):null)
    const {getCurrentOdds}=await import('@/lib/odds')
    const r=await getCurrentOdds()
    expect(r.source).toBe('ESPN')
    expect(r.isStale).toBe(false)
    expect(r.games[0].moneylines[0].outcomes[0].price).toBe(-115)
    expect(fetchESPN).not.toHaveBeenCalled()
  })
  it('flags saved odds stale when ESPN is temporarily unavailable',async()=>{
    kv.mockImplementation(async(key)=>key==='espn_odds_cache'?saved(35):null)
    fetchESPN.mockResolvedValue({games:[],lastUpdated:new Date().toISOString(),error:null})
    const {getCurrentOdds}=await import('@/lib/odds')
    const r=await getCurrentOdds()
    expect(r.source).toBe('ESPN')
    expect(r.isStale).toBe(true)
    expect(r.games).toHaveLength(1)
    expect(fetchESPN).toHaveBeenCalled()
  })
})
