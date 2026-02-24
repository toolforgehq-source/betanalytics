/**
 * MATH FUNCTIONS VALIDATION
 * 
 * Tests the core mathematical functions that power all betting analysis:
 * - americanToImpliedProbability: Converts American odds to probability
 * - calculateExpectedValue: Computes EV per $100 bet
 * - calculateROI: Computes return on investment percentage
 * 
 * These functions are the foundation of every bet recommendation.
 * If they're wrong, every pick is wrong.
 */
import { describe, it, expect } from 'vitest'
import {
  americanToImpliedProbability,
  calculateExpectedValue,
  calculateROI,
} from '@/lib/bet-ranking'

// ============================================================
// americanToImpliedProbability
// ============================================================

describe('americanToImpliedProbability', () => {
  describe('favorite odds (negative)', () => {
    it('-110 (standard juice) → ~52.4%', () => {
      const prob = americanToImpliedProbability(-110)
      expect(prob).toBeCloseTo(0.524, 2)
    })

    it('-150 → 60%', () => {
      const prob = americanToImpliedProbability(-150)
      expect(prob).toBeCloseTo(0.6, 2)
    })

    it('-200 → ~66.7%', () => {
      const prob = americanToImpliedProbability(-200)
      expect(prob).toBeCloseTo(0.667, 2)
    })

    it('-300 → 75%', () => {
      const prob = americanToImpliedProbability(-300)
      expect(prob).toBeCloseTo(0.75, 2)
    })

    it('-500 → ~83.3%', () => {
      const prob = americanToImpliedProbability(-500)
      expect(prob).toBeCloseTo(0.833, 2)
    })

    it('-1000 → ~90.9%', () => {
      const prob = americanToImpliedProbability(-1000)
      expect(prob).toBeCloseTo(0.909, 2)
    })
  })

  describe('underdog odds (positive)', () => {
    it('+100 (even money) → 50%', () => {
      const prob = americanToImpliedProbability(100)
      expect(prob).toBeCloseTo(0.5, 2)
    })

    it('+150 → 40%', () => {
      const prob = americanToImpliedProbability(150)
      expect(prob).toBeCloseTo(0.4, 2)
    })

    it('+200 → ~33.3%', () => {
      const prob = americanToImpliedProbability(200)
      expect(prob).toBeCloseTo(0.333, 2)
    })

    it('+300 → 25%', () => {
      const prob = americanToImpliedProbability(300)
      expect(prob).toBeCloseTo(0.25, 2)
    })

    it('+500 → ~16.7%', () => {
      const prob = americanToImpliedProbability(500)
      expect(prob).toBeCloseTo(0.167, 2)
    })

    it('+1000 → ~9.1%', () => {
      const prob = americanToImpliedProbability(1000)
      expect(prob).toBeCloseTo(0.091, 2)
    })
  })

  describe('edge cases', () => {
    it('always returns between 0 and 1', () => {
      const testOdds = [-10000, -500, -110, 100, 150, 500, 10000]
      for (const odds of testOdds) {
        const prob = americanToImpliedProbability(odds)
        expect(prob).toBeGreaterThan(0)
        expect(prob).toBeLessThan(1)
      }
    })

    it('favorite always has higher implied probability than underdog', () => {
      const favoriteProb = americanToImpliedProbability(-150)
      const underdogProb = americanToImpliedProbability(150)
      expect(favoriteProb).toBeGreaterThan(underdogProb)
    })

    it('more negative odds → higher probability', () => {
      const p1 = americanToImpliedProbability(-110)
      const p2 = americanToImpliedProbability(-200)
      const p3 = americanToImpliedProbability(-500)
      expect(p3).toBeGreaterThan(p2)
      expect(p2).toBeGreaterThan(p1)
    })

    it('higher positive odds → lower probability', () => {
      const p1 = americanToImpliedProbability(100)
      const p2 = americanToImpliedProbability(200)
      const p3 = americanToImpliedProbability(500)
      expect(p1).toBeGreaterThan(p2)
      expect(p2).toBeGreaterThan(p3)
    })
  })
})

// ============================================================
// calculateExpectedValue
// ============================================================

describe('calculateExpectedValue', () => {
  describe('positive EV scenarios (model edge)', () => {
    it('+100 odds with 55% win prob → positive EV', () => {
      // Win: 55% * $100 = $55. Lose: 45% * $100 = $45. Net EV = $10
      const ev = calculateExpectedValue(100, 0.55)
      expect(ev).toBeGreaterThan(0)
      expect(ev).toBeCloseTo(10, 0)
    })

    it('-110 odds with 60% win prob → positive EV', () => {
      // Win: 60% * $90.91 = $54.55. Lose: 40% * $100 = $40. Net EV = $14.55
      const ev = calculateExpectedValue(-110, 0.60)
      expect(ev).toBeGreaterThan(0)
    })
  })

  describe('negative EV scenarios (no edge)', () => {
    it('-110 odds with 50% win prob → negative EV (standard juice)', () => {
      const ev = calculateExpectedValue(-110, 0.50)
      expect(ev).toBeLessThan(0)
    })

    it('+100 odds with 45% win prob → negative EV', () => {
      const ev = calculateExpectedValue(100, 0.45)
      expect(ev).toBeLessThan(0)
    })
  })

  describe('break-even scenarios', () => {
    it('-110 odds at ~52.4% win prob → ~0 EV (break even)', () => {
      const breakEvenProb = americanToImpliedProbability(-110)
      const ev = calculateExpectedValue(-110, breakEvenProb)
      expect(Math.abs(ev)).toBeLessThan(1) // Within $1 of break-even
    })

    it('+150 odds at 40% win prob → ~0 EV', () => {
      const breakEvenProb = americanToImpliedProbability(150)
      const ev = calculateExpectedValue(150, breakEvenProb)
      expect(Math.abs(ev)).toBeLessThan(1)
    })
  })

  describe('edge cases', () => {
    it('100% win probability → always positive EV', () => {
      const ev = calculateExpectedValue(-500, 1.0)
      expect(ev).toBeGreaterThan(0)
    })

    it('0% win probability → always negative EV', () => {
      const ev = calculateExpectedValue(500, 0.0)
      expect(ev).toBeLessThanOrEqual(0)
    })
  })
})

// ============================================================
// calculateROI
// ============================================================

describe('calculateROI', () => {
  it('positive EV → positive ROI', () => {
    const roi = calculateROI(10) // $10 profit per $100
    expect(roi).toBeGreaterThan(0)
  })

  it('negative EV → negative ROI', () => {
    const roi = calculateROI(-5) // $5 loss per $100
    expect(roi).toBeLessThan(0)
  })

  it('zero EV → zero ROI', () => {
    const roi = calculateROI(0)
    expect(roi).toBe(0)
  })
})

// ============================================================
// Elo Confidence Blending Weights
// ============================================================

describe('Elo Confidence Blending', () => {
  // These weights are defined in bet-ranking.ts as ELO_CONFIDENCE_WEIGHTS
  // We validate the expected behavior here
  const ELO_CONFIDENCE_WEIGHTS: Record<string, number> = {
    'high': 0.75,
    'medium': 0.60,
    'low': 0.40,
    'very_low': 0.25,
  }

  function blendWithMarket(eloProbability: number, marketProbability: number, confidence: string): number {
    const eloWeight = ELO_CONFIDENCE_WEIGHTS[confidence] ?? 0.50
    return eloWeight * eloProbability + (1 - eloWeight) * marketProbability
  }

  it('high confidence: 75% Elo, 25% market', () => {
    const result = blendWithMarket(0.70, 0.50, 'high')
    expect(result).toBeCloseTo(0.70 * 0.75 + 0.50 * 0.25, 4)
    expect(result).toBeCloseTo(0.65, 2)
  })

  it('medium confidence: 60% Elo, 40% market', () => {
    const result = blendWithMarket(0.70, 0.50, 'medium')
    expect(result).toBeCloseTo(0.70 * 0.60 + 0.50 * 0.40, 4)
    expect(result).toBeCloseTo(0.62, 2)
  })

  it('low confidence: 40% Elo, 60% market', () => {
    const result = blendWithMarket(0.70, 0.50, 'low')
    expect(result).toBeCloseTo(0.70 * 0.40 + 0.50 * 0.60, 4)
    expect(result).toBeCloseTo(0.58, 2)
  })

  it('very_low confidence: 25% Elo, 75% market', () => {
    const result = blendWithMarket(0.70, 0.50, 'very_low')
    expect(result).toBeCloseTo(0.70 * 0.25 + 0.50 * 0.75, 4)
    expect(result).toBeCloseTo(0.55, 2)
  })

  it('unknown confidence defaults to 50/50', () => {
    const result = blendWithMarket(0.70, 0.50, 'unknown')
    expect(result).toBeCloseTo(0.70 * 0.50 + 0.50 * 0.50, 4)
    expect(result).toBeCloseTo(0.60, 2)
  })

  it('when Elo and market agree, blending changes nothing', () => {
    const prob = 0.65
    for (const conf of ['high', 'medium', 'low', 'very_low']) {
      const result = blendWithMarket(prob, prob, conf)
      expect(result).toBeCloseTo(prob, 4)
    }
  })

  it('higher confidence pulls result closer to Elo', () => {
    const elo = 0.80
    const market = 0.50
    const high = blendWithMarket(elo, market, 'high')
    const low = blendWithMarket(elo, market, 'low')
    expect(high).toBeGreaterThan(low)
    // high confidence (0.75 * 0.80 + 0.25 * 0.50 = 0.725) is closer to Elo (0.80)
    // low confidence (0.40 * 0.80 + 0.60 * 0.50 = 0.62) is closer to market (0.50)
    expect(Math.abs(high - elo)).toBeLessThan(Math.abs(low - elo)) // high is closer to Elo
    expect(Math.abs(low - market)).toBeLessThan(Math.abs(high - market)) // low is closer to market
  })
})
