import { describe, expect, it } from 'vitest'
import {
  calculateWinProbability,
  calculateInjuryAdjustment,
  updateRatingsAfterGame,
} from '@/lib/elo'

describe('Elo correctness: neutral-site games', () => {
  it('removes home advantage for neutral-site predictions', () => {
    expect(calculateWinProbability(1500, 1500, 'NCAAB', true)).toBeCloseTo(0.5, 8)
    expect(calculateWinProbability(1500, 1500, 'NCAAB', false)).toBeGreaterThan(0.5)
  })

  it('updates ratings using the actual neutral-site advantage', () => {
    const neutral = updateRatingsAfterGame(1500, 1500, 80, 70, 'NCAAB', 1, true)
    const atHome = updateRatingsAfterGame(1500, 1500, 80, 70, 'NCAAB', 1, false)
    // Same result is more surprising without a home-court advantage.
    expect(neutral.newHomeRating).toBeGreaterThan(atHome.newHomeRating)
    expect(neutral.newAwayRating).toBeLessThan(atHome.newAwayRating)
  })

  it('preserves existing home-game behavior for current callers', () => {
    expect(updateRatingsAfterGame(1500, 1500, 80, 70, 'NCAAB'))
      .toEqual(updateRatingsAfterGame(1500, 1500, 80, 70, 'NCAAB', 1, false))
  })
})

describe('Elo correctness: NHL injuries', () => {
  it('does not mistake Right Wing for goalie', () => {
    const result = calculateInjuryAdjustment('NHL', 'Toronto Maple Leafs', [
      { team: 'Toronto Maple Leafs', player: 'Example Winger', position: 'Right Wing', status: 'out' },
    ])
    expect(result.adjustment).toBe(-10)
    expect(result.details.some(x => x.includes('(Goalie,'))).toBe(false)
  })

  it('recognizes the explicit G position code', () => {
    const result = calculateInjuryAdjustment('NHL', 'Toronto Maple Leafs', [
      { team: 'Toronto Maple Leafs', player: 'Example Goalie', position: 'G', status: 'out' },
    ])
    expect(result.adjustment).toBe(-30)
    expect(result.details.some(x => x.includes('(Goalie,'))).toBe(true)
  })

  it('recognizes the word Goaltender', () => {
    const result = calculateInjuryAdjustment('NHL', 'Toronto Maple Leafs', [
      { team: 'Toronto Maple Leafs', player: 'Example Goalie', position: 'Goaltender', status: 'out' },
    ])
    expect(result.adjustment).toBe(-30)
  })
})
