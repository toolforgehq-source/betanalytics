import { MODEL_VERSION } from '@/lib/model-policy'
import { describe, expect, it } from 'vitest'
import { simulateRecordedTopThree } from '@/lib/recorded-bankroll'
import type { TrackedRecommendation } from '@/lib/recommendation-tracking'

function rec(gameId: string, status: TrackedRecommendation['status'], extra: Partial<TrackedRecommendation> = {}): TrackedRecommendation {
  return {
    id: gameId, createdAt: '2026-10-14T12:00:00Z', sport: 'baseball_mlb', sportName: 'MLB',
    gameId, gameName: 'A @ B', commenceTime: '2026-10-15T00:00:00Z',
    betType: 'moneyline', selection: 'A ML', odds: -200, initialOdds: -110,
    probability: 60, score: 80, source: 'best_bet', modelVersion: MODEL_VERSION,
    confidenceTier: 'strong', lockedIn: true, status,
    ...extra
  }
}
describe('Locked-pick $60 paper bankroll (no hindsight)', () => {
  it('uses the original quoted odds, not an updated or closing price', () => {
    const result = simulateRecordedTopThree([rec('1','won',{confidenceTier:'lock'})])
    expect(result.picks).toBe(1)
    expect(result.amountStaked).toBeCloseTo(1.8)
    expect(result.endingBankroll).toBeCloseTo(61.64,2)
    expect(result.insufficientSample).toBe(true)
  })

  it('limits to one selection per game and three individual bets per day', () => {
    const r = [
      rec('1','won',{confidenceTier:'lock',score:95}),
      rec('1','lost',{selection:'B +1.5',betType:'spread',score:90}),
      rec('2','lost',{score:80}),
      rec('3','push',{score:70}),
      rec('4','won',{score:60}),
    ]
    const result = simulateRecordedTopThree(r)
    expect(result.picks).toBe(3)
    expect(result.wins).toBe(1)
    expect(result.losses).toBe(1)
    expect(result.pushes).toBe(1)
  })

  it('does not selectively settle a day while a published pick is pending', () => {
    const result = simulateRecordedTopThree([rec('1','won',{confidenceTier:'lock'}),rec('2','pending')])
    expect(result.picks).toBe(0)
    expect(result.incompleteDays).toBe(1)
    expect(result.endingBankroll).toBe(60)
  })

  it('keeps old model versions out of the current model result', () => {
    const result = simulateRecordedTopThree([rec('1','won',{modelVersion:'old'}),rec('2','void')])
    expect(result.daysTested).toBe(0)
    expect(result.profit).toBe(0)
  })
})
