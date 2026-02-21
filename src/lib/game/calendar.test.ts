import { describe, expect, it } from 'vitest'

import {
  generateTradingCalendarEntries,
  isMarketOpen,
  isTradingDayDate,
  isUkBankHoliday,
} from './calendar'

describe('calendar helpers', () => {
  it('flags UK bank holidays', () => {
    expect(isUkBankHoliday(new Date('2026-12-25T00:00:00.000Z'))).toBe(true)
    expect(isUkBankHoliday(new Date('2026-12-24T00:00:00.000Z'))).toBe(false)
  })

  it('flags trading vs non-trading dates', () => {
    expect(isTradingDayDate(new Date('2026-05-12T00:00:00.000Z'))).toBe(true)
    expect(isTradingDayDate(new Date('2026-05-10T00:00:00.000Z'))).toBe(false)
    expect(isTradingDayDate(new Date('2026-12-25T00:00:00.000Z'))).toBe(false)
  })

  it('generates a year with both trading and non-trading days', () => {
    const entries = generateTradingCalendarEntries(2026)
    const tradingDays = entries.filter((entry) => entry.isTradingDay).length

    expect(entries.length).toBe(365)
    expect(tradingDays).toBeGreaterThan(240)
    expect(tradingDays).toBeLessThan(260)
  })

  it('determines market open state using London timezone', () => {
    // Monday 10:00 London time (winter = UTC)
    expect(isMarketOpen(new Date('2026-01-12T10:00:00.000Z'))).toBe(true)

    // Monday 07:00 London time
    expect(isMarketOpen(new Date('2026-01-12T07:00:00.000Z'))).toBe(false)

    // Saturday 10:00 London time
    expect(isMarketOpen(new Date('2026-01-10T10:00:00.000Z'))).toBe(false)
  })
})
