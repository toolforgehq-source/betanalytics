import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateRecommendationId, trackRecommendation } from '@/lib/recommendation-tracking'

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  sorted: new Set<string>(),
  pending: new Set<string>(),
}))

vi.mock('@/lib/pg-kv', () => ({
  isDbConfigured: () => true,
  kvExists: vi.fn(async (key: string) => store.values.has(key)),
  kvGet: vi.fn(async (key: string) => store.values.get(key) ?? null),
  kvSet: vi.fn(async (key: string, value: string) => { store.values.set(key,value) }),
  kvZadd: vi.fn(async (_key: string, _score: number, id: string) => { store.sorted.add(id) }),
  kvSadd: vi.fn(async (_key: string, id: string) => { store.pending.add(id) }),
}))

describe('Immutable model-version identity in the paper-bet recommendation ledger',()=>{
  beforeEach(()=>{
    store.values.clear()
    store.sorted.clear()
    store.pending.clear()
    vi.useRealTimers()
  })
  it('does not let a new Elo model reuse an older one’s recommendation ID',()=>{
    const at='2026-10-14T21:36:15Z'
    const args=['spread','baseball_mlb','401908032','Milwaukee Brewers +1.5',at] as const
    const legacy=generateRecommendationId(...args)
    const v2=generateRecommendationId(...args,'elo-integrity-v2')
    const v3=generateRecommendationId(...args,'elo-evidence-v3')
    expect(new Set([legacy,v2,v3]).size).toBe(3)
    expect(generateRecommendationId(...args,'elo-evidence-v3')).toBe(v3)
    // A change in bookmaker price or displayed line must not double-count a
    // game when its model version and betting day are unchanged.
    expect(generateRecommendationId('spread','baseball_mlb','401908032','Milwaukee Brewers +2.5',at,'elo-evidence-v3')).toBe(v3)
    expect(generateRecommendationId('spread','baseball_mlb','401908032','Milwaukee Brewers +1.5','2026-10-15T00:01:00Z','elo-evidence-v3')).not.toBe(v3)
  })
  it('persists v3 as a new candidate with its own first-seen odds while retaining old records',async()=>{
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T21:36:15Z'))
    const base = {
      sport:'baseball_mlb', sportName:'MLB',
      gameId:'401908032',gameName:'Brewers @ Dodgers',
      homeTeam:'Los Angeles Dodgers',awayTeam:'Milwaukee Brewers',
      commenceTime:'2026-10-15T00:00:00Z',
      betType:'spread' as const,selection:'Milwaukee Brewers +1.5',line:1.5,
      probability:66.6,score:80,source:'best_bet' as const,
      confidenceTier:'lock' as const,
    }
    const older=await trackRecommendation({...base,modelVersion:'elo-integrity-v2',odds:-155})
    const current=await trackRecommendation({...base,modelVersion:'elo-evidence-v3',odds:-143})
    expect(older).not.toBeNull()
    expect(current).not.toBeNull()
    expect(older).not.toBe(current)
    expect(store.values.size).toBe(2)
    const oldRecord=JSON.parse(store.values.get('reco:v1:'+older)!)
    const newRecord=JSON.parse(store.values.get('reco:v1:'+current)!)
    expect(oldRecord.modelVersion).toBe('elo-integrity-v2')
    expect(oldRecord.initialOdds).toBe(-155)
    expect(newRecord.modelVersion).toBe('elo-evidence-v3')
    expect(newRecord.initialOdds).toBe(-143)
    expect(newRecord.lockedIn).toBeUndefined()
    expect(newRecord.status).toBe('pending')
  })
})
