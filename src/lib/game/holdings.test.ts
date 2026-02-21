import { describe, expect, it } from 'vitest'

import { isFirstScoringDay, validateRoster } from './holdings'

describe('validateRoster', () => {
  it('validates a legal 8-stock roster', () => {
    const holdings = [
      { symbol: 'A', addedDate: new Date('2026-01-01'), tier: 1, tierCost: 20 },
      { symbol: 'B', addedDate: new Date('2026-01-01'), tier: 2, tierCost: 16 },
      { symbol: 'C', addedDate: new Date('2026-01-01'), tier: 3, tierCost: 12 },
      { symbol: 'D', addedDate: new Date('2026-01-01'), tier: 4, tierCost: 8 },
      { symbol: 'E', addedDate: new Date('2026-01-01'), tier: 5, tierCost: 4 },
      { symbol: 'F', addedDate: new Date('2026-01-01'), tier: 4, tierCost: 8 },
      { symbol: 'G', addedDate: new Date('2026-01-01'), tier: 5, tierCost: 4 },
      { symbol: 'H', addedDate: new Date('2026-01-01'), tier: 3, tierCost: 12 },
    ]

    const result = validateRoster(holdings, 100)
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.totalCost).toBe(84)
  })

  it('fails when roster misses a tier or size requirement', () => {
    const holdings = [
      { symbol: 'A', addedDate: new Date('2026-01-01'), tier: 1, tierCost: 20 },
      { symbol: 'B', addedDate: new Date('2026-01-01'), tier: 1, tierCost: 20 },
      { symbol: 'C', addedDate: new Date('2026-01-01'), tier: 2, tierCost: 16 },
      { symbol: 'D', addedDate: new Date('2026-01-01'), tier: 2, tierCost: 16 },
      { symbol: 'E', addedDate: new Date('2026-01-01'), tier: 3, tierCost: 12 },
      { symbol: 'F', addedDate: new Date('2026-01-01'), tier: 3, tierCost: 12 },
      { symbol: 'G', addedDate: new Date('2026-01-01'), tier: 4, tierCost: 8 },
    ]

    const result = validateRoster(holdings, 100)
    expect(result.isValid).toBe(false)
    expect(result.errors.some((error) => error.includes('exactly 8'))).toBe(
      true,
    )
    expect(result.errors.some((error) => error.includes('Tier 5'))).toBe(true)
  })
})

describe('isFirstScoringDay', () => {
  it('matches on date regardless of time', () => {
    expect(
      isFirstScoringDay(
        new Date('2026-01-10T00:00:00.000Z'),
        new Date('2026-01-10T23:59:59.999Z'),
      ),
    ).toBe(true)

    expect(
      isFirstScoringDay(
        new Date('2026-01-10T00:00:00.000Z'),
        new Date('2026-01-11T00:00:00.000Z'),
      ),
    ).toBe(false)
  })
})
