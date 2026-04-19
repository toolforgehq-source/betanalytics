/**
 * ESPN spread-odds enrichment
 *
 * Pickcenter (site.api) omits spreadOdds for MLB, so without enrichment every
 * MLB runline silently defaulted to -110/-110 downstream — quietly corrupting
 * every Kelly/edge score. These tests lock in two things:
 *
 *   1. The american-odds string parser correctly distinguishes juice
 *      (e.g. "+129", "-156", "EVEN") from point-spread display strings
 *      (e.g. "-1.5", "+6.5") and from garbage values.
 *   2. The core-endpoint fetcher prefers current → open → close prices and
 *      prefers the DraftKings provider when multiple are returned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __testing__ } from '@/lib/espn'

const { parseAmericanOddsString, fetchESPNCoreSpreadOdds } = __testing__

describe('parseAmericanOddsString', () => {
  it('parses standard juice strings', () => {
    expect(parseAmericanOddsString('+129')).toBe(129)
    expect(parseAmericanOddsString('-156')).toBe(-156)
    expect(parseAmericanOddsString('-110')).toBe(-110)
    expect(parseAmericanOddsString('+100')).toBe(100)
  })

  it('accepts numeric input', () => {
    expect(parseAmericanOddsString(135)).toBe(135)
    expect(parseAmericanOddsString(-200)).toBe(-200)
  })

  it('maps pick-em synonyms to +100', () => {
    expect(parseAmericanOddsString('EVEN')).toBe(100)
    expect(parseAmericanOddsString('even')).toBe(100)
    expect(parseAmericanOddsString('EV')).toBe(100)
    expect(parseAmericanOddsString('PK')).toBe(100)
    expect(parseAmericanOddsString('PICK')).toBe(100)
  })

  it('rejects point-spread display strings (which share the "american" key)', () => {
    // ESPN's pointSpread.american is the POINT line (e.g. "-1.5"), not juice.
    // We must never treat it as juice or we'll wipe out Kelly for MLB.
    expect(parseAmericanOddsString('-1.5')).toBeNull()
    expect(parseAmericanOddsString('+6.5')).toBeNull()
    expect(parseAmericanOddsString('-10.5')).toBeNull()
  })

  it('rejects malformed / absent values', () => {
    expect(parseAmericanOddsString(null)).toBeNull()
    expect(parseAmericanOddsString(undefined)).toBeNull()
    expect(parseAmericanOddsString('')).toBeNull()
    expect(parseAmericanOddsString('   ')).toBeNull()
    expect(parseAmericanOddsString('abc')).toBeNull()
    expect(parseAmericanOddsString({})).toBeNull()
    expect(parseAmericanOddsString(NaN)).toBeNull()
  })

  it('rejects magnitudes below 100 (not valid juice)', () => {
    expect(parseAmericanOddsString('50')).toBeNull()
    expect(parseAmericanOddsString('-99')).toBeNull()
    expect(parseAmericanOddsString(99)).toBeNull()
  })
})

describe('fetchESPNCoreSpreadOdds', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const mockFetch = (payload: unknown, ok = true) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      json: async () => payload,
    }) as unknown as typeof fetch
  }

  it('returns the current price when present', async () => {
    mockFetch({
      items: [
        {
          provider: { name: 'DraftKings' },
          homeTeamOdds: {
            current: { spread: { american: '+129' } },
            open: { spread: { american: '+123' } },
          },
          awayTeamOdds: {
            current: { spread: { american: '-156' } },
            open: { spread: { american: '-149' } },
          },
        },
      ],
    })
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '401814989')
    expect(result).toEqual({ home: 129, away: -156, source: 'current', provider: 'DraftKings' })
  })

  it('falls back to open when current is missing', async () => {
    mockFetch({
      items: [
        {
          provider: { name: 'DraftKings' },
          homeTeamOdds: { open: { spread: { american: '+123' } } },
          awayTeamOdds: { open: { spread: { american: '-149' } } },
        },
      ],
    })
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '1')
    expect(result).toEqual({ home: 123, away: -149, source: 'open', provider: 'DraftKings' })
  })

  it('prefers DraftKings when multiple providers are returned', async () => {
    mockFetch({
      items: [
        {
          provider: { name: 'Caesars' },
          homeTeamOdds: { current: { spread: { american: '+150' } } },
          awayTeamOdds: { current: { spread: { american: '-175' } } },
        },
        {
          provider: { name: 'DraftKings' },
          homeTeamOdds: { current: { spread: { american: '+129' } } },
          awayTeamOdds: { current: { spread: { american: '-156' } } },
        },
      ],
    })
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '1')
    expect(result?.provider).toBe('DraftKings')
    expect(result?.home).toBe(129)
    expect(result?.away).toBe(-156)
  })

  it('ignores point-spread display strings', async () => {
    // Defense in depth: if ESPN ever returns the point line under spread.american
    // (instead of juice), we must NOT silently use -1.5 as a price.
    mockFetch({
      items: [
        {
          provider: { name: 'DraftKings' },
          homeTeamOdds: { current: { spread: { american: '-1.5' } } },
          awayTeamOdds: { current: { spread: { american: '+1.5' } } },
        },
      ],
    })
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '1')
    expect(result).toBeNull()
  })

  it('returns null on non-200 response', async () => {
    mockFetch({ items: [] }, false)
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '1')
    expect(result).toBeNull()
  })

  it('returns null when items array is empty', async () => {
    mockFetch({ items: [] })
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '1')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const result = await fetchESPNCoreSpreadOdds('baseball', 'mlb', '1')
    expect(result).toBeNull()
  })
})
