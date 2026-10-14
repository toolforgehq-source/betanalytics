import { describe, expect, it } from 'vitest'
import { dedupeAndEnforceCaps, dedupeAndSort, isEligibleForTopPicks } from '@/lib/enforce-picks'
import { getEloSeasonYear, calculateWinProbability } from '@/lib/elo'
import { twoWayNoVigProbability } from '@/lib/bet-ranking'
import { isCompetitiveEloMatch } from '@/lib/elo-event-filter'

function candidate(gameId: string, score: number, extra: Record<string, unknown> = {}) {
  return {
    gameId, team: 'Team ' + gameId, betType: 'moneyline', probability: 60,
    odds: -110, score, commenceTime: '2027-01-01T19:00:00Z', ...extra
  }
}

describe('Authoritative positive-EV Elo pick eligibility', () => {
  it('requires positive EV and a meaningful model edge, not a high score alone', () => {
    expect(isEligibleForTopPicks(candidate('a', 55))).toBe(true)
    expect(isEligibleForTopPicks(candidate('b', 100, { probability: 52, odds: -130 }))).toBe(false)
    expect(isEligibleForTopPicks(candidate('c', 100, { probability: 65, odds: -180 }))).toBe(false)
    expect(isEligibleForTopPicks(candidate('d', 100, { betType: 'total' }))).toBe(false)
    expect(isEligibleForTopPicks(candidate('e', 100, { probability: 80, odds: -110 }))).toBe(false) // anomalous unvalidated edge
  })

  it('caps to three different qualifying games and does not promote weak fallbacks', () => {
    const picks = [
      candidate('one', 90),
      candidate('one', 85, {team: 'Other team', betType: 'spread'}),
      candidate('two', 80),
      candidate('three', 70),
      candidate('four', 200, {probability: 52, odds: -130}),
      candidate('five', 65)
    ]
    const result = dedupeAndEnforceCaps(picks)
    expect(result).toHaveLength(3)
    expect(new Set(result.map(p => p.gameId)).size).toBe(3)
    expect(result[0].gameId).toBe('one')
    expect(result.every(p => isEligibleForTopPicks(p))).toBe(true)
    expect(dedupeAndSort(picks).every(p => isEligibleForTopPicks(p))).toBe(true)
  })

  it('permits zero picks when all candidate odds are unfavorable', () => {
    const result = dedupeAndEnforceCaps([candidate('one', 99, {probability: 50, odds: -110})])
    expect(result).toHaveLength(0)
  })
})

describe('Chronological Elo season boundaries', () => {
  it('does not treat the prior NFL postseason as a new season', () => {
    expect(getEloSeasonYear('NFL', new Date('2026-02-08T20:00:00Z'))).toBe(2025)
    expect(getEloSeasonYear('NFL', new Date('2026-09-10T20:00:00Z'))).toBe(2026)
    expect(getEloSeasonYear('MLB', new Date('2026-10-14T20:00:00Z'))).toBe(2026)
    expect(getEloSeasonYear('MLB', new Date('2027-03-27T20:00:00Z'))).toBe(2027)
  })

  it('keeps home and neutral-site forecasts different', () => {
    const neutral = calculateWinProbability(1500, 1500, 'NFL', true)
    const home = calculateWinProbability(1500, 1500, 'NFL', false)
    expect(neutral).toBeCloseTo(0.5)
    expect(home).toBeGreaterThan(neutral)
  })
})

describe('Pregame market and training-data integrity', () => {
  it('removes the sportsbook margin when both sides are known', () => {
    expect(twoWayNoVigProbability(-110, -110)).toBeCloseTo(0.5, 8)
    expect(twoWayNoVigProbability(-150, +130)).toBeGreaterThan(0.5)
  })
  it('blocks all-star games but keeps ordinary professional matchups', () => {
    expect(isCompetitiveEloMatch('NFL', 'AFC', 'NFC')).toBe(false)
    expect(isCompetitiveEloMatch('MLB', 'National All-Stars', 'American All-Stars')).toBe(false)
    expect(isCompetitiveEloMatch('NBA', 'Team Stars', 'World')).toBe(false)
    expect(isCompetitiveEloMatch('NFL', 'Dallas Cowboys', 'New York Giants')).toBe(true)
  })
})
