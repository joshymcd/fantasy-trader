import { addDays, endOfYear, format, startOfYear, subDays } from 'date-fns'
import { and, eq, gte, lte, sql } from 'drizzle-orm'

import { db } from '../../db/index'
import { tradingCalendar } from '../../db/schema'
import { UK_BANK_HOLIDAYS } from './uk-holidays'

export type TradingCalendarEntry = {
  date: Date
  isTradingDay: boolean
  prevTradingDay: Date | null
  nextTradingDay: Date | null
}

const LONDON_TIMEZONE = 'Europe/London'

const toDateKey = (value: Date): string => format(value, 'yyyy-MM-dd')

const fromDateKey = (value: string): Date => new Date(`${value}T00:00:00.000Z`)

export function isUkBankHoliday(date: Date): boolean {
  return UK_BANK_HOLIDAYS.has(toDateKey(date))
}

export function isTradingDayDate(date: Date): boolean {
  const day = date.getUTCDay()
  const isWeekend = day === 0 || day === 6

  return !isWeekend && !isUkBankHoliday(date)
}

export function generateTradingCalendarEntries(
  year: number,
): TradingCalendarEntry[] {
  const start = startOfYear(new Date(Date.UTC(year, 0, 1)))
  const end = endOfYear(new Date(Date.UTC(year, 0, 1)))

  const entries: Array<
    TradingCalendarEntry & {
      dateKey: string
    }
  > = []

  for (let current = start; current <= end; current = addDays(current, 1)) {
    entries.push({
      date: current,
      dateKey: toDateKey(current),
      isTradingDay: isTradingDayDate(current),
      prevTradingDay: null,
      nextTradingDay: null,
    })
  }

  let previousTradingDayKey: string | null = null
  for (const entry of entries) {
    entry.prevTradingDay = previousTradingDayKey
      ? fromDateKey(previousTradingDayKey)
      : null

    if (entry.isTradingDay) {
      previousTradingDayKey = entry.dateKey
    }
  }

  let nextTradingDayKey: string | null = null
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    entry.nextTradingDay = nextTradingDayKey
      ? fromDateKey(nextTradingDayKey)
      : null

    if (entry.isTradingDay) {
      nextTradingDayKey = entry.dateKey
    }
  }

  return entries.map(({ dateKey: _dateKey, ...entry }) => entry)
}

export async function populateCalendar(year: number): Promise<{
  year: number
  totalDays: number
  tradingDays: number
}> {
  const entries = generateTradingCalendarEntries(year)

  await db
    .insert(tradingCalendar)
    .values(entries)
    .onConflictDoUpdate({
      target: tradingCalendar.date,
      set: {
        isTradingDay: sql`excluded.is_trading_day`,
        prevTradingDay: sql`excluded.prev_trading_day`,
        nextTradingDay: sql`excluded.next_trading_day`,
      },
    })

  return {
    year,
    totalDays: entries.length,
    tradingDays: entries.filter((entry) => entry.isTradingDay).length,
  }
}

export async function isTradingDay(date: Date): Promise<boolean> {
  const key = toDateKey(date)
  const row = await db.query.tradingCalendar.findFirst({
    where: eq(tradingCalendar.date, fromDateKey(key)),
    columns: {
      isTradingDay: true,
    },
  })

  return row?.isTradingDay ?? isTradingDayDate(date)
}

export async function getNextTradingDay(date: Date): Promise<Date> {
  const key = fromDateKey(toDateKey(date))
  const row = await db.query.tradingCalendar.findFirst({
    where: and(
      gte(tradingCalendar.date, key),
      eq(tradingCalendar.isTradingDay, true),
    ),
    orderBy: (fields, operators) => [operators.asc(fields.date)],
    columns: {
      date: true,
    },
  })

  if (row?.date) {
    return row.date
  }

  for (let i = 0; i < 14; i += 1) {
    const candidate = addDays(key, i)
    if (isTradingDayDate(candidate)) {
      return candidate
    }
  }

  return key
}

export async function getPrevTradingDay(date: Date): Promise<Date> {
  const key = fromDateKey(toDateKey(date))
  const row = await db.query.tradingCalendar.findFirst({
    where: and(
      gte(tradingCalendar.date, subDays(key, 14)),
      lte(tradingCalendar.date, key),
      eq(tradingCalendar.isTradingDay, true),
    ),
    orderBy: (fields, operators) => [operators.desc(fields.date)],
    columns: {
      date: true,
    },
  })

  if (row?.date && row.date < key) {
    return row.date
  }

  for (let i = 1; i <= 14; i += 1) {
    const candidate = subDays(key, i)
    if (isTradingDayDate(candidate)) {
      return candidate
    }
  }

  return subDays(key, 1)
}

export function isMarketOpen(now: Date = new Date()): boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''

  const weekday = part('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false
  }

  const dateKey = `${part('year')}-${part('month')}-${part('day')}`
  if (UK_BANK_HOLIDAYS.has(dateKey)) {
    return false
  }

  const hour = Number.parseInt(part('hour'), 10)
  const minute = Number.parseInt(part('minute'), 10)
  const minutesFromMidnight = hour * 60 + minute

  const marketOpenMinutes = 8 * 60
  const marketCloseMinutes = 16 * 60 + 30

  return (
    minutesFromMidnight >= marketOpenMinutes &&
    minutesFromMidnight < marketCloseMinutes
  )
}
