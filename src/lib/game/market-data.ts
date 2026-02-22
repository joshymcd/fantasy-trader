import { addDays, subDays } from 'date-fns'
import { desc, eq, sql } from 'drizzle-orm'
import yahooFinance from 'yahoo-finance2'

import { db } from '../../db/index'
import { instruments, priceDaily } from '../../db/schema'

const DEFAULT_LOOKBACK_DAYS = 90
const FETCH_DELAY_MS = 150
const MAX_RETRIES = 3

export type PriceBar = {
  symbol: string
  date: Date
  adjClose: number
}

export type PriceSyncReport = {
  attemptedSymbols: number
  fetchedSymbols: number
  skippedSymbols: number
  failedSymbols: string[]
}

type YahooHistoricalBar = {
  date?: Date
  adjClose?: number
}

/** Normalizes a date to UTC midnight. */
const toUtcDate = (value: Date): Date =>
  new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  )

/** Sleeps for the requested number of milliseconds. */
const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retries an async operation using linear backoff. */
async function withRetries<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let attempt = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      attempt += 1
      if (attempt > maxRetries) {
        throw error
      }

      await sleep(250 * attempt)
    }
  }
}

/** Fetches daily adjusted close bars for a symbol. */
export async function fetchEodPrices(
  symbol: string,
  startDate: Date,
  endDate: Date,
): Promise<PriceBar[]> {
  const historicalRaw = await withRetries<unknown>(() =>
    yahooFinance.historical(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    }),
  )

  const historical = Array.isArray(historicalRaw)
    ? (historicalRaw as YahooHistoricalBar[])
    : []

  return historical
    .filter(
      (entry): entry is { date: Date; adjClose: number } =>
        entry.date instanceof Date && typeof entry.adjClose === 'number',
    )
    .map((entry) => ({
      symbol,
      date: toUtcDate(entry.date),
      adjClose: entry.adjClose,
    }))
    .sort((a: PriceBar, b: PriceBar) => a.date.getTime() - b.date.getTime())
}

/** Returns all unique symbols from the current instrument universe. */
export async function getAllInstrumentSymbols(): Promise<string[]> {
  const rows = await db.select({ symbol: instruments.symbol }).from(instruments)
  const unique = new Set(rows.map((row) => row.symbol))
  return [...unique]
}

/** Ensures prices exist up to target date for provided symbols. */
export async function ensurePricesUpTo(
  symbols: string[],
  targetDate: Date = subDays(new Date(), 1),
): Promise<void> {
  await ensurePricesUpToWithReport(symbols, targetDate)
}

/** Ensures prices up to target date and returns fetch diagnostics. */
export async function ensurePricesUpToWithReport(
  symbols: string[],
  targetDate: Date = subDays(new Date(), 1),
): Promise<PriceSyncReport> {
  const cleanTargetDate = toUtcDate(targetDate)
  const uniqueSymbols = [...new Set(symbols)].filter(Boolean)

  const report: PriceSyncReport = {
    attemptedSymbols: uniqueSymbols.length,
    fetchedSymbols: 0,
    skippedSymbols: 0,
    failedSymbols: [],
  }

  for (const symbol of uniqueSymbols) {
    const lastPrice = await db
      .select({ date: priceDaily.date })
      .from(priceDaily)
      .where(eq(priceDaily.symbol, symbol))
      .orderBy(desc(priceDaily.date))
      .limit(1)

    const startDate = lastPrice[0]?.date
      ? addDays(lastPrice[0].date, 1)
      : subDays(cleanTargetDate, DEFAULT_LOOKBACK_DAYS)

    if (startDate > cleanTargetDate) {
      report.skippedSymbols += 1
      continue
    }

    let bars: PriceBar[] = []
    try {
      bars = await fetchEodPrices(symbol, startDate, cleanTargetDate)
    } catch {
      report.failedSymbols.push(symbol)
      await sleep(FETCH_DELAY_MS)
      continue
    }

    if (bars.length > 0) {
      report.fetchedSymbols += 1
      await db
        .insert(priceDaily)
        .values(
          bars.map((bar) => ({
            symbol: bar.symbol,
            date: bar.date,
            adjClose: String(bar.adjClose),
            fetchedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [priceDaily.symbol, priceDaily.date],
          set: {
            adjClose: sql`excluded.adj_close`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        })
    }

    if (bars.length === 0) {
      report.skippedSymbols += 1
    }

    await sleep(FETCH_DELAY_MS)
  }

  return report
}

/** Ensures prices for every instrument in the universe. */
export async function ensurePricesForInstrumentUniverse(
  targetDate: Date = subDays(new Date(), 1),
): Promise<void> {
  await ensurePricesForInstrumentUniverseWithReport(targetDate)
}

/** Ensures universe prices and returns fetch diagnostics. */
export async function ensurePricesForInstrumentUniverseWithReport(
  targetDate: Date = subDays(new Date(), 1),
): Promise<PriceSyncReport> {
  const symbols = await getAllInstrumentSymbols()
  if (symbols.length === 0) {
    return {
      attemptedSymbols: 0,
      fetchedSymbols: 0,
      skippedSymbols: 0,
      failedSymbols: [],
    }
  }

  return ensurePricesUpToWithReport(symbols, targetDate)
}
