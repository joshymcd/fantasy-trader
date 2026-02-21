import { and, eq } from 'drizzle-orm'
import yahooFinance from 'yahoo-finance2'

import { db } from '../../db/index'
import { instruments, seasons } from '../../db/schema'
import { TIER_COSTS } from '../../types/game'
import { UK_LSE_DEFAULT_SYMBOLS } from './uk-universe'

type CreateSeasonInput = {
  name: string
  market: string
  startDate: Date
  endDate: Date
  tradeDeadlineDate: Date
  budget?: number
  scoringMultiplier?: number
  firstDayPenalty?: string
  maxSwapsPerDay?: number
  maxSwapsPerWeek?: number
}

type CandidateInstrument = {
  symbol: string
  name: string
  marketCap: number
}

type YahooQuote = {
  marketCap?: number
  longName?: string
  shortName?: string
}

const DEFAULT_SYMBOL_LIMIT = 200

async function withRetries<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (error) {
      attempt += 1
      if (attempt > retries) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
}

function parseSymbols(csvSymbols: string) {
  return csvSymbols
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
}

function getTierForIndex(index: number, totalCount: number) {
  const quintileSize = Math.max(1, Math.ceil(totalCount / 5))
  const tier = Math.floor(index / quintileSize) + 1
  return Math.min(5, tier)
}

async function fetchCandidateInstrument(
  symbol: string,
): Promise<CandidateInstrument | null> {
  try {
    const quote = (await withRetries(() =>
      yahooFinance.quote(symbol),
    )) as YahooQuote
    const marketCap = quote.marketCap
    if (typeof marketCap !== 'number' || marketCap <= 0) {
      return null
    }

    return {
      symbol,
      name: quote.longName ?? quote.shortName ?? symbol,
      marketCap,
    }
  } catch {
    return null
  }
}

export async function createSeason(input: CreateSeasonInput) {
  const [season] = await db
    .insert(seasons)
    .values({
      name: input.name,
      market: input.market,
      startDate: input.startDate,
      endDate: input.endDate,
      tradeDeadlineDate: input.tradeDeadlineDate,
      budget: input.budget,
      scoringMultiplier: input.scoringMultiplier,
      firstDayPenalty: input.firstDayPenalty,
      maxSwapsPerDay: input.maxSwapsPerDay,
      maxSwapsPerWeek: input.maxSwapsPerWeek,
      status: 'SETUP',
    })
    .returning({
      id: seasons.id,
      name: seasons.name,
      market: seasons.market,
      status: seasons.status,
    })

  return season
}

export async function listSeasons() {
  return db
    .select({
      id: seasons.id,
      name: seasons.name,
      market: seasons.market,
      status: seasons.status,
      startDate: seasons.startDate,
      endDate: seasons.endDate,
      tradeDeadlineDate: seasons.tradeDeadlineDate,
      budget: seasons.budget,
      createdAt: seasons.createdAt,
    })
    .from(seasons)
    .orderBy(seasons.createdAt)
}

export async function getSeasonInstruments(seasonId: string) {
  return db
    .select({
      symbol: instruments.symbol,
      name: instruments.name,
      tier: instruments.tier,
      tierCost: instruments.tierCost,
      marketCap: instruments.marketCap,
    })
    .from(instruments)
    .where(eq(instruments.seasonId, seasonId))
}

export async function populateSeasonInstruments(input: {
  seasonId: string
  symbolsCsv?: string
  symbolLimit?: number
}) {
  const symbolLimit = Math.max(
    5,
    Math.min(input.symbolLimit ?? DEFAULT_SYMBOL_LIMIT, 500),
  )
  const symbols = input.symbolsCsv
    ? parseSymbols(input.symbolsCsv)
    : [...UK_LSE_DEFAULT_SYMBOLS]

  const candidates: CandidateInstrument[] = []
  for (const symbol of symbols.slice(0, symbolLimit)) {
    const candidate = await fetchCandidateInstrument(symbol)
    if (candidate) {
      candidates.push(candidate)
    }
  }

  const sorted = candidates.sort((a, b) => b.marketCap - a.marketCap)
  const prepared = sorted.map((candidate, index) => {
    const tier = getTierForIndex(index, sorted.length)
    return {
      seasonId: input.seasonId,
      symbol: candidate.symbol,
      name: candidate.name,
      tier,
      tierCost: TIER_COSTS[tier] ?? 0,
      marketCap: String(candidate.marketCap),
      exchange: 'LSE',
      createdAt: new Date(),
    }
  })

  await db.delete(instruments).where(eq(instruments.seasonId, input.seasonId))

  if (prepared.length > 0) {
    await db.insert(instruments).values(prepared)
  }

  return {
    seasonId: input.seasonId,
    requestedSymbols: symbols.length,
    insertedInstruments: prepared.length,
    tiers: {
      tier1: prepared.filter((row) => row.tier === 1).length,
      tier2: prepared.filter((row) => row.tier === 2).length,
      tier3: prepared.filter((row) => row.tier === 3).length,
      tier4: prepared.filter((row) => row.tier === 4).length,
      tier5: prepared.filter((row) => row.tier === 5).length,
    },
  }
}

export async function activateSeason(seasonId: string) {
  const seasonInstruments = await db
    .select({ id: instruments.id })
    .from(instruments)
    .where(eq(instruments.seasonId, seasonId))
    .limit(1)

  if (seasonInstruments.length === 0) {
    throw new Error('Cannot activate season with no instruments')
  }

  const [updated] = await db
    .update(seasons)
    .set({ status: 'ACTIVE' })
    .where(and(eq(seasons.id, seasonId), eq(seasons.status, 'SETUP')))
    .returning({ id: seasons.id, status: seasons.status })

  if (!updated) {
    throw new Error('Season not found or not in setup state')
  }

  return updated
}
