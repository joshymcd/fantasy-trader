import { and, asc, eq, inArray, lte } from 'drizzle-orm'

import { db } from '../../db/index'
import { instruments, leagues, rosterMoves, teams } from '../../db/schema'
import {
  ROSTER_SIZE,
  TIER_COUNT,
  TIER_COSTS,
  emptyTierCounts,
} from '../../types/game'

const toDateKey = (value: Date) => value.toISOString().slice(0, 10)

export type Holding = {
  symbol: string
  addedDate: Date
  tier: number
  tierCost: number
}

export type RosterValidation = {
  isValid: boolean
  errors: string[]
  holdingCount: number
  totalCost: number
  tierCounts: ReturnType<typeof emptyTierCounts>
}

async function getTeamSeasonId(teamId: string) {
  const rows = await db
    .select({ seasonId: leagues.seasonId })
    .from(teams)
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .where(eq(teams.id, teamId))
    .limit(1)

  const seasonId = rows[0]?.seasonId
  if (!seasonId) {
    throw new Error('Team not found')
  }

  return seasonId
}

export async function getHoldingsAtDate(teamId: string, date: Date) {
  const seasonId = await getTeamSeasonId(teamId)

  const moves = await db
    .select({
      type: rosterMoves.type,
      symbol: rosterMoves.symbol,
      effectiveDate: rosterMoves.effectiveDate,
    })
    .from(rosterMoves)
    .where(
      and(eq(rosterMoves.teamId, teamId), lte(rosterMoves.effectiveDate, date)),
    )
    .orderBy(
      asc(rosterMoves.effectiveDate),
      asc(rosterMoves.createdAt),
      asc(rosterMoves.id),
    )

  const holdingAddedDateBySymbol = new Map<string, Date>()

  for (const move of moves) {
    if (move.type === 'DROP') {
      holdingAddedDateBySymbol.delete(move.symbol)
      continue
    }

    holdingAddedDateBySymbol.set(move.symbol, move.effectiveDate)
  }

  const symbols = [...holdingAddedDateBySymbol.keys()]
  if (symbols.length === 0) {
    return []
  }

  const instrumentRows = await db
    .select({
      symbol: instruments.symbol,
      tier: instruments.tier,
      tierCost: instruments.tierCost,
    })
    .from(instruments)
    .where(
      and(
        eq(instruments.seasonId, seasonId),
        inArray(instruments.symbol, symbols),
      ),
    )

  const instrumentBySymbol = new Map(
    instrumentRows.map((row) => [row.symbol, row]),
  )

  const holdings: Holding[] = []

  for (const [symbol, addedDate] of holdingAddedDateBySymbol.entries()) {
    const instrument = instrumentBySymbol.get(symbol)
    if (!instrument) {
      continue
    }

    holdings.push({
      symbol,
      addedDate,
      tier: instrument.tier,
      tierCost: instrument.tierCost,
    })
  }

  return holdings
}

export function validateRoster(holdings: Holding[], budget: number) {
  const tierCounts = emptyTierCounts()
  let totalCost = 0

  for (const holding of holdings) {
    if (holding.tier >= 1 && holding.tier <= TIER_COUNT) {
      tierCounts[holding.tier as 1 | 2 | 3 | 4 | 5] += 1
    }

    totalCost += holding.tierCost
  }

  const errors: string[] = []

  if (holdings.length !== ROSTER_SIZE) {
    errors.push(`Roster must have exactly ${ROSTER_SIZE} holdings`)
  }

  for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
    if (tierCounts[tier as 1 | 2 | 3 | 4 | 5] < 1) {
      errors.push(`Roster must include at least one Tier ${tier} holding`)
    }
  }

  if (totalCost > budget) {
    errors.push(`Roster cost ${totalCost} exceeds budget ${budget}`)
  }

  return {
    isValid: errors.length === 0,
    errors,
    holdingCount: holdings.length,
    totalCost,
    tierCounts,
  } satisfies RosterValidation
}

export function isFirstScoringDay(addedDate: Date, scoringDate: Date) {
  return toDateKey(addedDate) === toDateKey(scoringDate)
}

export function getDefaultTierCostForTier(tier: number) {
  return TIER_COSTS[tier] ?? 0
}
