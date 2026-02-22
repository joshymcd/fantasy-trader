import { describe, expect, it } from 'vitest'

import { UK_BANK_HOLIDAYS } from './uk-holidays'
import { UK_LSE_DEFAULT_SYMBOLS } from './uk-universe'

describe('uk market data constants', () => {
  it('contains expected holiday keys', () => {
    expect(UK_BANK_HOLIDAYS.has('2026-12-25')).toBe(true)
    expect(UK_BANK_HOLIDAYS.has('2026-12-24')).toBe(false)
  })

  it('contains a non-empty default symbol universe', () => {
    expect(UK_LSE_DEFAULT_SYMBOLS.length).toBeGreaterThan(10)
    expect(
      UK_LSE_DEFAULT_SYMBOLS.every((symbol) => symbol.endsWith('.L')),
    ).toBe(true)
  })
})
