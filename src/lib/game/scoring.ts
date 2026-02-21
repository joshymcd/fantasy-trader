import { addDays } from 'date-fns'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'

import { db } from '../../db/index'
import { priceDaily, teamDayScores } from '../../db/schema'
import {
  DEFAULT_FIRST_DAY_PENALTY,
  DEFAULT_SCORING_MULTIPLIER,
  type ScoringConfig,
} from '../../types/game'
import { getHoldingsAtDate, isFirstScoringDay } from './holdings'
import { getPrevTradingDay, isTradingDay } from './calendar'

const toDateKey = (value: Date) => value.toISOString().slice(0, 10)

const round4 = (value: number) => Math.round(value * 10000) / 10000

export type DayScore = {
  teamId: string
  date: Date
  points: number
  breakdown: Record<string, number>
  missingSymbols: string[]
  isTradingDay: boolean
}

const defaultScoringConfig: ScoringConfig = {
  multiplier: DEFAULT_SCORING_MULTIPLIER,
  firstDayPenalty: DEFAULT_FIRST_DAY_PENALTY,
}

async function getPriceMap(symbols: string[], date: Date) {
  if (symbols.length === 0) {
    return new Map<string, number>()
  }

  const rows = await db
    .select({ symbol: priceDaily.symbol, adjClose: priceDaily.adjClose })
    .from(priceDaily)
    .where(and(eq(priceDaily.date, date), inArray(priceDaily.symbol, symbols)))

  return new Map(rows.map((row) => [row.symbol, Number(row.adjClose)]))
}

export async function calculateTeamDay(
  teamId: string,
  date: Date,
  config: Partial<ScoringConfig> = {},
) {
  const scoringConfig = {
    ...defaultScoringConfig,
    ...config,
  }

  const tradingDay = await isTradingDay(date)
  if (!tradingDay) {
    return {
      teamId,
      date,
      points: 0,
      breakdown: {},
      missingSymbols: [],
      isTradingDay: false,
    } satisfies DayScore
  }

  const holdings = await getHoldingsAtDate(teamId, date)
  if (holdings.length === 0) {
    return {
      teamId,
      date,
      points: 0,
      breakdown: {},
      missingSymbols: [],
      isTradingDay: true,
    } satisfies DayScore
  }

  const previousTradingDate = await getPrevTradingDay(date)
  const symbols = holdings.map((holding) => holding.symbol)

  const [todayPrices, previousPrices] = await Promise.all([
    getPriceMap(symbols, date),
    getPriceMap(symbols, previousTradingDate),
  ])

  let points = 0
  const breakdown: Record<string, number> = {}
  const missingSymbols: string[] = []

  for (const holding of holdings) {
    const today = todayPrices.get(holding.symbol)
    const previous = previousPrices.get(holding.symbol)

    if (today === undefined || previous === undefined || previous === 0) {
      breakdown[holding.symbol] = 0
      missingSymbols.push(holding.symbol)
      continue
    }

    const dailyReturn = (today - previous) / previous
    let symbolPoints = dailyReturn * 100 * scoringConfig.multiplier

    if (isFirstScoringDay(holding.addedDate, date)) {
      symbolPoints *= scoringConfig.firstDayPenalty
    }

    const rounded = round4(symbolPoints)
    breakdown[holding.symbol] = rounded
    points += rounded
  }

  return {
    teamId,
    date,
    points: round4(points),
    breakdown,
    missingSymbols,
    isTradingDay: true,
  } satisfies DayScore
}

export async function getCachedTeamDayScore(teamId: string, date: Date) {
  const row = await db.query.teamDayScores.findFirst({
    where: and(eq(teamDayScores.teamId, teamId), eq(teamDayScores.date, date)),
  })

  if (!row) {
    return null
  }

  return {
    teamId,
    date,
    points: Number(row.points),
    breakdown: row.breakdown,
    missingSymbols: [],
    isTradingDay: true,
  } satisfies DayScore
}

export async function cacheTeamDayScore(dayScore: DayScore) {
  await db
    .insert(teamDayScores)
    .values({
      teamId: dayScore.teamId,
      date: dayScore.date,
      points: String(dayScore.points),
      breakdown: dayScore.breakdown,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [teamDayScores.teamId, teamDayScores.date],
      set: {
        points: String(dayScore.points),
        breakdown: dayScore.breakdown,
        computedAt: new Date(),
      },
    })

  return dayScore
}

export async function getOrCalculateScore(
  teamId: string,
  date: Date,
  options: {
    forceRecalculate?: boolean
    config?: Partial<ScoringConfig>
  } = {},
) {
  if (!options.forceRecalculate) {
    const cached = await getCachedTeamDayScore(teamId, date)
    if (cached) {
      return cached
    }
  }

  const dayScore = await calculateTeamDay(teamId, date, options.config)
  return cacheTeamDayScore(dayScore)
}

export async function calculateTeamRange(
  teamId: string,
  startDate: Date,
  endDate: Date,
  options: {
    forceRecalculate?: boolean
    config?: Partial<ScoringConfig>
  } = {},
) {
  const tradingDays = await db
    .select({ date: priceDaily.date })
    .from(priceDaily)
    .where(and(gte(priceDaily.date, startDate), lte(priceDaily.date, endDate)))
    .groupBy(priceDaily.date)
    .orderBy(priceDaily.date)

  const results: DayScore[] = []
  for (const row of tradingDays) {
    results.push(
      await getOrCalculateScore(teamId, row.date, {
        forceRecalculate: options.forceRecalculate,
        config: options.config,
      }),
    )
  }

  return results
}

export async function invalidateScores(
  options: {
    teamId?: string
    fromDate?: Date
    toDate?: Date
  } = {},
) {
  const conditions = []

  if (options.teamId) {
    conditions.push(eq(teamDayScores.teamId, options.teamId))
  }

  if (options.fromDate) {
    conditions.push(gte(teamDayScores.date, options.fromDate))
  }

  if (options.toDate) {
    conditions.push(lte(teamDayScores.date, options.toDate))
  }

  if (conditions.length === 0) {
    return db.delete(teamDayScores)
  }

  return db.delete(teamDayScores).where(and(...conditions))
}

export async function calculateYesterdayScore(teamId: string) {
  const yesterday = addDays(new Date(), -1)
  return getOrCalculateScore(teamId, new Date(toDateKey(yesterday)))
}
