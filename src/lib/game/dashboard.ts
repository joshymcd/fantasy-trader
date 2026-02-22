import { subDays } from 'date-fns'
import { and, asc, eq, inArray, lte, max, sql } from 'drizzle-orm'

import { db } from '../../db/index'
import {
  leagues,
  priceDaily,
  seasons,
  teamDayScores,
  teams,
} from '../../db/schema'
import { calculateTeamRange } from './scoring'
import { getPrevTradingDay } from './calendar'
import { getHoldingsAtDate } from './holdings'
import { ensurePricesForInstrumentUniverseWithReport } from './market-data'

export type LeagueStanding = {
  teamId: string
  teamName: string
  userId: string
  faabBudget: number
  totalPoints: number
  todayPoints: number
  rank: number
}

export type HoldingWithPrice = {
  symbol: string
  tier: number
  tierCost: number
  addedDate: Date
  currentPrice: number | null
  previousPrice: number | null
  dailyReturnPct: number | null
}

const round2 = (value: number) => Math.round(value * 100) / 100

const round4 = (value: number) => Math.round(value * 10000) / 10000

export async function syncPricesAndGetLatestDate(
  targetDate = subDays(new Date(), 1),
) {
  const report = await ensurePricesForInstrumentUniverseWithReport(targetDate)

  const [row] = await db
    .select({ latestDate: max(priceDaily.date) })
    .from(priceDaily)
    .where(lte(priceDaily.date, targetDate))

  return {
    latestDate: row?.latestDate ?? null,
    staleDataWarning:
      report.failedSymbols.length > 0
        ? `Price fetch failed for ${report.failedSymbols.length} symbol(s): ${report.failedSymbols.slice(0, 5).join(', ')}${report.failedSymbols.length > 5 ? '...' : ''}`
        : null,
  }
}

export async function hydrateLeagueScores(leagueId: string, upToDate: Date) {
  const [league] = await db
    .select({ startDate: seasons.startDate })
    .from(leagues)
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(leagues.id, leagueId))
    .limit(1)

  if (!league) {
    throw new Error('League not found')
  }

  const leagueTeams = await db
    .select({ teamId: teams.id })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))

  await Promise.all(
    leagueTeams.map((team) =>
      calculateTeamRange(team.teamId, league.startDate, upToDate),
    ),
  )
}

export async function getLeagueStandings(leagueId: string, upToDate: Date) {
  const rows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      userId: teams.userId,
      faabBudget: teams.faabBudget,
      totalPoints: sql<number>`coalesce(sum(case when ${teamDayScores.date} <= ${upToDate} then ${teamDayScores.points}::numeric else 0 end), 0)::float8`,
      todayPoints: sql<number>`coalesce(sum(case when ${teamDayScores.date} = ${upToDate} then ${teamDayScores.points}::numeric else 0 end), 0)::float8`,
    })
    .from(teams)
    .leftJoin(teamDayScores, eq(teams.id, teamDayScores.teamId))
    .where(eq(teams.leagueId, leagueId))
    .groupBy(teams.id)

  const sorted = rows
    .map((row) => ({
      ...row,
      totalPoints: round4(Number(row.totalPoints ?? 0)),
      todayPoints: round4(Number(row.todayPoints ?? 0)),
    }))
    .sort((a, b) => {
      if (a.totalPoints !== b.totalPoints) {
        return b.totalPoints - a.totalPoints
      }

      return a.teamName.localeCompare(b.teamName)
    })

  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
  })) satisfies LeagueStanding[]
}

export async function getTeamScoreHistory(
  teamId: string,
  upToDate: Date,
  days = 30,
) {
  const rows = await db
    .select({ date: teamDayScores.date, points: teamDayScores.points })
    .from(teamDayScores)
    .where(
      and(eq(teamDayScores.teamId, teamId), lte(teamDayScores.date, upToDate)),
    )
    .orderBy(asc(teamDayScores.date))

  const window = rows.slice(Math.max(rows.length - days, 0))

  let runningTotal = 0
  return window.map((row) => {
    const dayPoints = Number(row.points)
    runningTotal = round4(runningTotal + dayPoints)
    return {
      date: row.date,
      dayPoints: round4(dayPoints),
      cumulativePoints: runningTotal,
    }
  })
}

export async function getTeamHoldingsWithPrices(teamId: string, date: Date) {
  const holdings = await getHoldingsAtDate(teamId, date)
  if (holdings.length === 0) {
    return [] as HoldingWithPrice[]
  }

  const previousDate = await getPrevTradingDay(date)
  const symbols = holdings.map((holding) => holding.symbol)

  const prices = await db
    .select({
      symbol: priceDaily.symbol,
      date: priceDaily.date,
      adjClose: priceDaily.adjClose,
    })
    .from(priceDaily)
    .where(
      and(
        inArray(priceDaily.symbol, symbols),
        inArray(priceDaily.date, [date, previousDate]),
      ),
    )

  const todayBySymbol = new Map<string, number>()
  const prevBySymbol = new Map<string, number>()

  for (const row of prices) {
    if (row.date.getTime() === date.getTime()) {
      todayBySymbol.set(row.symbol, Number(row.adjClose))
      continue
    }

    if (row.date.getTime() === previousDate.getTime()) {
      prevBySymbol.set(row.symbol, Number(row.adjClose))
    }
  }

  return holdings.map((holding) => {
    const currentPrice = todayBySymbol.get(holding.symbol) ?? null
    const previousPrice = prevBySymbol.get(holding.symbol) ?? null
    const dailyReturnPct =
      currentPrice !== null && previousPrice !== null && previousPrice !== 0
        ? round2(((currentPrice - previousPrice) / previousPrice) * 100)
        : null

    return {
      symbol: holding.symbol,
      tier: holding.tier,
      tierCost: holding.tierCost,
      addedDate: holding.addedDate,
      currentPrice,
      previousPrice,
      dailyReturnPct,
    }
  })
}

export async function getGlobalMovers(date: Date, limit = 8) {
  const previousDate = await getPrevTradingDay(date)

  const rows = await db
    .select({
      symbol: priceDaily.symbol,
      date: priceDaily.date,
      adjClose: priceDaily.adjClose,
    })
    .from(priceDaily)
    .where(inArray(priceDaily.date, [date, previousDate]))

  const todayBySymbol = new Map<string, number>()
  const previousBySymbol = new Map<string, number>()

  for (const row of rows) {
    if (row.date.getTime() === date.getTime()) {
      todayBySymbol.set(row.symbol, Number(row.adjClose))
      continue
    }

    if (row.date.getTime() === previousDate.getTime()) {
      previousBySymbol.set(row.symbol, Number(row.adjClose))
    }
  }

  return [...todayBySymbol.entries()]
    .map(([symbol, currentPrice]) => {
      const previousPrice = previousBySymbol.get(symbol)
      const changePct =
        previousPrice && previousPrice !== 0
          ? round2(((currentPrice - previousPrice) / previousPrice) * 100)
          : null

      return {
        symbol,
        currentPrice: round2(currentPrice),
        changePct,
      }
    })
    .filter((row) => row.changePct !== null)
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, Math.max(1, Math.min(limit, 25)))
}
