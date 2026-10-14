import { describe, expect, it } from 'vitest'
import { replayEloRatings, type GameResult } from '@/lib/elo'
function game(id: string, date: string, league = 'NFL'): GameResult {
  return { gameId:id, date, league, homeTeamId:'1', homeTeamName:'A Team',
    awayTeamId:'2', awayTeamName:'B Team', homeScore:24, awayScore:14 }
}
describe('Pure Elo historical replay without production database writes', () => {
  it('sorts chronology, ignores duplicate events and produces independent copies', () => {
    const initial = replayEloRatings([game('two','2026-09-20T18:00:00Z'),game('one','2026-09-13T18:00:00Z'),game('one','2026-09-13T18:00:00Z')])
    expect(initial.newGamesProcessed).toBe(2)
    expect(initial.ratings.gamesProcessed).toBe(2)
    expect(initial.ratings.ratings['NFL:1'].gamesPlayed).toBe(2)
    const again = replayEloRatings([game('three','2026-09-27T18:00:00Z')],initial.ratings,initial.processedIds)
    expect(again.ratings.gamesProcessed).toBe(3)
    expect(initial.ratings.gamesProcessed).toBe(2) // independent, no in-place mutation
  })
  it('does not train Elo on future results before an earlier pick', () => {
    const before = replayEloRatings([game('one','2026-09-13T18:00:00Z')])
    const after = replayEloRatings([game('two','2026-09-20T18:00:00Z')],before.ratings,before.processedIds)
    expect(after.ratings.ratings['NFL:1'].rating).not.toEqual(before.ratings.ratings['NFL:1'].rating)
    expect(before.ratings.gamesProcessed).toBe(1)
  })
  it('resets current season exposure when chronological games cross an offseason', () => {
    const results = replayEloRatings([game('old','2026-01-25T18:00:00Z'),game('new','2026-09-13T18:00:00Z')])
    expect(results.ratings.gamesProcessed).toBe(2)
    expect(results.ratings.ratings['NFL:1'].gamesPlayed).toBe(1)
  })
})