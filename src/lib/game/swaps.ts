import { addDays } from 'date-fns'
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'

import { db } from '../../db/index'
import {
  instruments,
  leagues,
  rosterMoves,
  seasons,
  teamDayScores,
  teams,
  waiverClaims,
} from '../../db/schema'
import { validateRoster } from './holdings'
import { getNextTradingDay, isMarketOpen } from './calendar'

/** Converts a date to a normalized day key. */
const toDateKey = (value: Date) => value.toISOString().slice(0, 10)

/** Parses a normalized day key into a UTC date. */
const fromDateKey = (value: string) => new Date(`${value}T00:00:00.000Z`)

/** Normalizes a user-entered ticker symbol. */
const normalizeSymbol = (value: string) => value.trim().toUpperCase()

/** Returns UTC day start for a date. */
const getUtcDayStart = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )

/** Returns UTC day end for a UTC day start value. */
const getUtcDayEnd = (dayStart: Date) =>
  new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1)

/** Returns UTC Monday start for a date's week. */
const getUtcWeekStart = (date: Date) => {
  const dayStart = getUtcDayStart(date)
  const dayOffset = (dayStart.getUTCDay() + 6) % 7
  return addDays(dayStart, -dayOffset)
}

/** Resolves the next trading day effective date for swap actions. */
const getNextEffectiveDate = async (submittedAt: Date) => {
  const tomorrow = addDays(getUtcDayStart(submittedAt), 1)
  return getNextTradingDay(tomorrow)
}

/** Returns true when a waiver claim is still active in lifecycle terms. */
const isWaiverClaimActive = (
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED',
) => status !== 'CANCELLED'

/** Returns remaining daily and weekly swap capacity for a team. */
export async function getRemainingSwaps(
  teamId: string,
  atDate: Date = new Date(),
) {
  const [context] = await db
    .select({
      teamId: teams.id,
      ownershipMode: leagues.ownershipMode,
      maxSwapsPerDay: seasons.maxSwapsPerDay,
      maxSwapsPerWeek: seasons.maxSwapsPerWeek,
    })
    .from(teams)
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(teams.id, teamId))
    .limit(1)

  if (!context) {
    throw new Error('Team not found')
  }

  const dayStart = getUtcDayStart(atDate)
  const dayEnd = getUtcDayEnd(dayStart)
  const weekStart = getUtcWeekStart(atDate)
  const weekEnd = getUtcDayEnd(addDays(weekStart, 6))

  if (context.ownershipMode === 'UNIQUE') {
    const dayClaims = await db
      .select({
        value: sql<number>`count(*)`,
      })
      .from(waiverClaims)
      .where(
        and(
          eq(waiverClaims.teamId, teamId),
          gte(waiverClaims.createdAt, dayStart),
          lte(waiverClaims.createdAt, dayEnd),
          ne(waiverClaims.status, 'CANCELLED'),
        ),
      )

    const weekClaims = await db
      .select({
        value: sql<number>`count(*)`,
      })
      .from(waiverClaims)
      .where(
        and(
          eq(waiverClaims.teamId, teamId),
          gte(waiverClaims.createdAt, weekStart),
          lte(waiverClaims.createdAt, weekEnd),
          ne(waiverClaims.status, 'CANCELLED'),
        ),
      )

    const usedToday = Number(dayClaims[0]?.value ?? 0)
    const usedThisWeek = Number(weekClaims[0]?.value ?? 0)

    return {
      maxPerDay: context.maxSwapsPerDay,
      maxPerWeek: context.maxSwapsPerWeek,
      usedToday,
      usedThisWeek,
      remainingToday: Math.max(context.maxSwapsPerDay - usedToday, 0),
      remainingThisWeek: Math.max(context.maxSwapsPerWeek - usedThisWeek, 0),
      ownershipMode: context.ownershipMode,
    }
  }

  const dayMoves = await db
    .select({
      value: sql<number>`count(*)`,
    })
    .from(rosterMoves)
    .where(
      and(
        eq(rosterMoves.teamId, teamId),
        eq(rosterMoves.type, 'ADD'),
        gte(rosterMoves.createdAt, dayStart),
        lte(rosterMoves.createdAt, dayEnd),
      ),
    )

  const weekMoves = await db
    .select({
      value: sql<number>`count(*)`,
    })
    .from(rosterMoves)
    .where(
      and(
        eq(rosterMoves.teamId, teamId),
        eq(rosterMoves.type, 'ADD'),
        gte(rosterMoves.createdAt, weekStart),
        lte(rosterMoves.createdAt, weekEnd),
      ),
    )

  const usedToday = Number(dayMoves[0]?.value ?? 0)
  const usedThisWeek = Number(weekMoves[0]?.value ?? 0)

  return {
    maxPerDay: context.maxSwapsPerDay,
    maxPerWeek: context.maxSwapsPerWeek,
    usedToday,
    usedThisWeek,
    remainingToday: Math.max(context.maxSwapsPerDay - usedToday, 0),
    remainingThisWeek: Math.max(context.maxSwapsPerWeek - usedThisWeek, 0),
    ownershipMode: context.ownershipMode,
  }
}

/** Submits a roster swap as direct move or waiver claim by league mode. */
export async function submitSwap(input: {
  teamId: string
  dropSymbol: string
  addSymbol: string
  faabBid?: number
  submittedAt?: Date
}) {
  const submittedAt = input.submittedAt ?? new Date()
  const dropSymbol = normalizeSymbol(input.dropSymbol)
  const addSymbol = normalizeSymbol(input.addSymbol)

  if (!dropSymbol || !addSymbol) {
    throw new Error('Drop and add symbols are required')
  }

  if (dropSymbol === addSymbol) {
    throw new Error('Drop and add symbols must be different')
  }

  if (isMarketOpen(submittedAt)) {
    throw new Error('Swaps are only allowed when the market is closed')
  }

  const [context] = await db
    .select({
      teamId: teams.id,
      leagueId: teams.leagueId,
      faabBudget: teams.faabBudget,
      leagueStatus: leagues.status,
      ownershipMode: leagues.ownershipMode,
      seasonId: seasons.id,
      budget: seasons.budget,
    })
    .from(teams)
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(teams.id, input.teamId))
    .limit(1)

  if (!context) {
    throw new Error('Team not found')
  }

  if (context.leagueStatus !== 'ACTIVE') {
    throw new Error('Swaps are only allowed in active leagues')
  }

  const remaining = await getRemainingSwaps(input.teamId, submittedAt)
  if (remaining.remainingToday < 1) {
    throw new Error('Daily swap limit reached')
  }

  if (remaining.remainingThisWeek < 1) {
    throw new Error('Weekly swap limit reached')
  }

  const effectiveDate = await getNextEffectiveDate(submittedAt)

  const currentHoldings = await db
    .select({
      type: rosterMoves.type,
      symbol: rosterMoves.symbol,
      effectiveDate: rosterMoves.effectiveDate,
    })
    .from(rosterMoves)
    .where(
      and(
        eq(rosterMoves.teamId, input.teamId),
        lte(rosterMoves.effectiveDate, effectiveDate),
      ),
    )
    .orderBy(
      asc(rosterMoves.effectiveDate),
      asc(rosterMoves.createdAt),
      asc(rosterMoves.id),
    )

  const holdingSymbols = new Set<string>()
  for (const move of currentHoldings) {
    if (move.type === 'DROP') {
      holdingSymbols.delete(move.symbol)
      continue
    }

    holdingSymbols.add(move.symbol)
  }

  if (!holdingSymbols.has(dropSymbol)) {
    throw new Error(`Cannot drop ${dropSymbol}: symbol is not currently held`)
  }

  if (holdingSymbols.has(addSymbol)) {
    throw new Error(`Cannot add ${addSymbol}: symbol is already on roster`)
  }

  const [addInstrument] = await db
    .select({
      symbol: instruments.symbol,
      tier: instruments.tier,
      tierCost: instruments.tierCost,
    })
    .from(instruments)
    .where(
      and(
        eq(instruments.seasonId, context.seasonId),
        eq(instruments.symbol, addSymbol),
      ),
    )
    .limit(1)

  if (!addInstrument) {
    throw new Error(`Cannot add ${addSymbol}: symbol is not in this season`)
  }

  const projectedSymbols = new Set(holdingSymbols)
  projectedSymbols.delete(dropSymbol)
  projectedSymbols.add(addSymbol)

  const seasonInstruments = await db
    .select({
      symbol: instruments.symbol,
      tier: instruments.tier,
      tierCost: instruments.tierCost,
    })
    .from(instruments)
    .where(
      and(
        eq(instruments.seasonId, context.seasonId),
        inArray(instruments.symbol, [...projectedSymbols]),
      ),
    )

  const projectedBySymbol = new Map(
    seasonInstruments.map((instrument) => [instrument.symbol, instrument]),
  )

  const projectedRoster = [...projectedSymbols]
    .map((symbol) => {
      const instrument = projectedBySymbol.get(symbol)
      if (!instrument) {
        return null
      }

      return {
        symbol,
        tier: instrument.tier,
        tierCost: instrument.tierCost,
        addedDate: effectiveDate,
      }
    })
    .filter((holding) => holding !== null)

  const rosterValidation = validateRoster(projectedRoster, context.budget)
  if (!rosterValidation.isValid) {
    throw new Error(rosterValidation.errors.join(' | '))
  }

  if (context.ownershipMode === 'UNIQUE') {
    const faabBid = input.faabBid ?? 0
    if (!Number.isInteger(faabBid) || faabBid < 0) {
      throw new Error('FAAB bid must be a non-negative integer')
    }

    if (faabBid > context.faabBudget) {
      throw new Error(
        `FAAB bid ${faabBid} exceeds remaining budget ${context.faabBudget}`,
      )
    }

    const ownershipRows = await db
      .select({
        teamId: rosterMoves.teamId,
        type: rosterMoves.type,
        symbol: rosterMoves.symbol,
      })
      .from(rosterMoves)
      .innerJoin(teams, eq(rosterMoves.teamId, teams.id))
      .where(
        and(
          eq(teams.leagueId, context.leagueId),
          lte(rosterMoves.effectiveDate, effectiveDate),
        ),
      )
      .orderBy(
        asc(rosterMoves.effectiveDate),
        asc(rosterMoves.createdAt),
        asc(rosterMoves.id),
      )

    const ownerBySymbol = new Map<string, string>()
    for (const row of ownershipRows) {
      if (row.type === 'DROP') {
        if (ownerBySymbol.get(row.symbol) === row.teamId) {
          ownerBySymbol.delete(row.symbol)
        }
        continue
      }

      ownerBySymbol.set(row.symbol, row.teamId)
    }

    const ownerTeamId = ownerBySymbol.get(addSymbol)
    if (ownerTeamId && ownerTeamId !== input.teamId) {
      throw new Error(`Cannot add ${addSymbol}: symbol is already owned`)
    }

    const [claim] = await db
      .insert(waiverClaims)
      .values({
        teamId: input.teamId,
        addSymbol,
        dropSymbol,
        faabBid,
        status: 'PENDING',
        effectiveDate,
        createdAt: submittedAt,
      })
      .returning({
        id: waiverClaims.id,
        status: waiverClaims.status,
        effectiveDate: waiverClaims.effectiveDate,
        addSymbol: waiverClaims.addSymbol,
        dropSymbol: waiverClaims.dropSymbol,
        faabBid: waiverClaims.faabBid,
      })

    return {
      mode: 'WAIVER' as const,
      claim,
      remainingSwaps: {
        ...remaining,
        usedToday: remaining.usedToday + 1,
        usedThisWeek: remaining.usedThisWeek + 1,
        remainingToday: Math.max(remaining.remainingToday - 1, 0),
        remainingThisWeek: Math.max(remaining.remainingThisWeek - 1, 0),
      },
    }
  }

  const [dropMove, addMove] = await db
    .insert(rosterMoves)
    .values([
      {
        teamId: input.teamId,
        type: 'DROP',
        symbol: dropSymbol,
        effectiveDate,
        metadata: { reason: 'SWAP' },
        createdAt: submittedAt,
      },
      {
        teamId: input.teamId,
        type: 'ADD',
        symbol: addSymbol,
        effectiveDate,
        metadata: { reason: 'SWAP' },
        createdAt: submittedAt,
      },
    ])
    .returning({
      id: rosterMoves.id,
      type: rosterMoves.type,
      symbol: rosterMoves.symbol,
      effectiveDate: rosterMoves.effectiveDate,
    })

  return {
    mode: 'DIRECT' as const,
    effectiveDate,
    moves: [dropMove, addMove],
    remainingSwaps: {
      ...remaining,
      usedToday: remaining.usedToday + 1,
      usedThisWeek: remaining.usedThisWeek + 1,
      remainingToday: Math.max(remaining.remainingToday - 1, 0),
      remainingThisWeek: Math.max(remaining.remainingThisWeek - 1, 0),
    },
  }
}

/** Processes pending waiver claims for a league and effective date. */
export async function processWaiverClaims(leagueId: string, date: Date) {
  const effectiveDate = fromDateKey(toDateKey(date))

  return db.transaction(async (tx) => {
    const [league] = await tx
      .select({
        id: leagues.id,
        seasonId: leagues.seasonId,
        ownershipMode: leagues.ownershipMode,
        budget: seasons.budget,
      })
      .from(leagues)
      .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
      .where(eq(leagues.id, leagueId))
      .limit(1)

    if (!league) {
      throw new Error('League not found')
    }

    if (league.ownershipMode !== 'UNIQUE') {
      throw new Error('Waiver processing is only used for unique leagues')
    }

    const pendingClaims = await tx
      .select({
        id: waiverClaims.id,
        teamId: waiverClaims.teamId,
        addSymbol: waiverClaims.addSymbol,
        dropSymbol: waiverClaims.dropSymbol,
        faabBid: waiverClaims.faabBid,
        createdAt: waiverClaims.createdAt,
      })
      .from(waiverClaims)
      .innerJoin(teams, eq(waiverClaims.teamId, teams.id))
      .where(
        and(
          eq(teams.leagueId, leagueId),
          eq(waiverClaims.status, 'PENDING'),
          eq(waiverClaims.effectiveDate, effectiveDate),
        ),
      )
      .orderBy(asc(waiverClaims.createdAt), asc(waiverClaims.id))

    if (pendingClaims.length === 0) {
      return {
        leagueId,
        effectiveDate,
        processedClaims: 0,
        wonClaims: 0,
        lostClaims: 0,
        winners: [] as Array<{
          claimId: string
          teamId: string
          addSymbol: string
          dropSymbol: string
          faabBid: number
        }>,
      }
    }

    const teamRows = await tx
      .select({
        teamId: teams.id,
        faabBudget: teams.faabBudget,
      })
      .from(teams)
      .where(eq(teams.leagueId, leagueId))

    const teamBudgetById = new Map(
      teamRows.map((row) => [row.teamId, row.faabBudget]),
    )

    const standingsRows = await tx
      .select({
        teamId: teams.id,
        totalPoints: sql<number>`coalesce(sum(${teamDayScores.points}::numeric), 0)::float8`,
      })
      .from(teams)
      .leftJoin(teamDayScores, eq(teams.id, teamDayScores.teamId))
      .where(
        and(
          eq(teams.leagueId, leagueId),
          lte(teamDayScores.date, effectiveDate),
        ),
      )
      .groupBy(teams.id)

    const standingPointsByTeamId = new Map<string, number>()
    for (const row of standingsRows) {
      standingPointsByTeamId.set(row.teamId, Number(row.totalPoints ?? 0))
    }

    const seasonInstrumentRows = await tx
      .select({
        symbol: instruments.symbol,
        tier: instruments.tier,
        tierCost: instruments.tierCost,
      })
      .from(instruments)
      .where(eq(instruments.seasonId, league.seasonId))

    const instrumentBySymbol = new Map(
      seasonInstrumentRows.map((row) => [row.symbol, row]),
    )

    const ownershipRows = await tx
      .select({
        teamId: rosterMoves.teamId,
        symbol: rosterMoves.symbol,
        type: rosterMoves.type,
      })
      .from(rosterMoves)
      .innerJoin(teams, eq(rosterMoves.teamId, teams.id))
      .where(
        and(
          eq(teams.leagueId, leagueId),
          lte(rosterMoves.effectiveDate, effectiveDate),
        ),
      )
      .orderBy(
        asc(rosterMoves.effectiveDate),
        asc(rosterMoves.createdAt),
        asc(rosterMoves.id),
      )

    const holdingsByTeamId = new Map<string, Set<string>>()
    const ownerBySymbol = new Map<string, string>()

    for (const row of teamRows) {
      holdingsByTeamId.set(row.teamId, new Set())
    }

    for (const row of ownershipRows) {
      const teamHoldings = holdingsByTeamId.get(row.teamId)
      if (!teamHoldings) {
        continue
      }

      if (row.type === 'DROP') {
        teamHoldings.delete(row.symbol)
        if (ownerBySymbol.get(row.symbol) === row.teamId) {
          ownerBySymbol.delete(row.symbol)
        }
        continue
      }

      teamHoldings.add(row.symbol)
      ownerBySymbol.set(row.symbol, row.teamId)
    }

    const claimGroups = new Map<string, typeof pendingClaims>()
    for (const claim of pendingClaims) {
      const group = claimGroups.get(claim.addSymbol) ?? []
      group.push(claim)
      claimGroups.set(claim.addSymbol, group)
    }

    const winners: Array<{
      claimId: string
      teamId: string
      addSymbol: string
      dropSymbol: string
      faabBid: number
    }> = []
    const lostClaimIds = new Set<string>()

    for (const [, claims] of claimGroups) {
      const rankedClaims = [...claims].sort((a, b) => {
        if (a.faabBid !== b.faabBid) {
          return b.faabBid - a.faabBid
        }

        const aPoints = standingPointsByTeamId.get(a.teamId) ?? 0
        const bPoints = standingPointsByTeamId.get(b.teamId) ?? 0
        if (aPoints !== bPoints) {
          return aPoints - bPoints
        }

        const createdDiff = a.createdAt.getTime() - b.createdAt.getTime()
        if (createdDiff !== 0) {
          return createdDiff
        }

        return a.id.localeCompare(b.id)
      })

      let winningClaim: (typeof rankedClaims)[number] | null = null

      for (const claim of rankedClaims) {
        const teamBudget = teamBudgetById.get(claim.teamId) ?? 0
        if (teamBudget < claim.faabBid) {
          lostClaimIds.add(claim.id)
          continue
        }

        if (ownerBySymbol.has(claim.addSymbol)) {
          lostClaimIds.add(claim.id)
          continue
        }

        const teamHoldings = holdingsByTeamId.get(claim.teamId)
        if (!teamHoldings || !teamHoldings.has(claim.dropSymbol)) {
          lostClaimIds.add(claim.id)
          continue
        }

        if (teamHoldings.has(claim.addSymbol)) {
          lostClaimIds.add(claim.id)
          continue
        }

        const projectedSymbols = new Set(teamHoldings)
        projectedSymbols.delete(claim.dropSymbol)
        projectedSymbols.add(claim.addSymbol)

        const projectedHoldings = [...projectedSymbols]
          .map((symbol) => {
            const instrument = instrumentBySymbol.get(symbol)
            if (!instrument) {
              return null
            }

            return {
              symbol,
              tier: instrument.tier,
              tierCost: instrument.tierCost,
              addedDate: effectiveDate,
            }
          })
          .filter((holding) => holding !== null)

        const rosterValidation = validateRoster(
          projectedHoldings,
          league.budget,
        )
        if (!rosterValidation.isValid) {
          lostClaimIds.add(claim.id)
          continue
        }

        winningClaim = claim
        break
      }

      if (!winningClaim) {
        for (const claim of rankedClaims) {
          lostClaimIds.add(claim.id)
        }
        continue
      }

      const newBudget =
        (teamBudgetById.get(winningClaim.teamId) ?? 0) - winningClaim.faabBid
      teamBudgetById.set(winningClaim.teamId, newBudget)

      const winningTeamHoldings = holdingsByTeamId.get(winningClaim.teamId)
      if (winningTeamHoldings) {
        winningTeamHoldings.delete(winningClaim.dropSymbol)
        winningTeamHoldings.add(winningClaim.addSymbol)
      }

      ownerBySymbol.delete(winningClaim.dropSymbol)
      ownerBySymbol.set(winningClaim.addSymbol, winningClaim.teamId)

      await tx.insert(rosterMoves).values([
        {
          teamId: winningClaim.teamId,
          type: 'DROP',
          symbol: winningClaim.dropSymbol,
          effectiveDate,
          metadata: {
            source: 'WAIVER',
            claimId: winningClaim.id,
            faabBid: winningClaim.faabBid,
          },
          createdAt: new Date(),
        },
        {
          teamId: winningClaim.teamId,
          type: 'ADD',
          symbol: winningClaim.addSymbol,
          effectiveDate,
          metadata: {
            source: 'WAIVER',
            claimId: winningClaim.id,
            faabBid: winningClaim.faabBid,
          },
          createdAt: new Date(),
        },
      ])

      await tx
        .update(teams)
        .set({ faabBudget: newBudget })
        .where(eq(teams.id, winningClaim.teamId))

      await tx
        .update(waiverClaims)
        .set({ status: 'WON' })
        .where(eq(waiverClaims.id, winningClaim.id))

      winners.push({
        claimId: winningClaim.id,
        teamId: winningClaim.teamId,
        addSymbol: winningClaim.addSymbol,
        dropSymbol: winningClaim.dropSymbol,
        faabBid: winningClaim.faabBid,
      })

      for (const claim of rankedClaims) {
        if (claim.id !== winningClaim.id) {
          lostClaimIds.add(claim.id)
        }
      }
    }

    const lostClaimIdList = [...lostClaimIds]
    if (lostClaimIdList.length > 0) {
      await tx
        .update(waiverClaims)
        .set({ status: 'LOST' })
        .where(inArray(waiverClaims.id, lostClaimIdList))
    }

    return {
      leagueId,
      effectiveDate,
      processedClaims: pendingClaims.length,
      wonClaims: winners.length,
      lostClaims: lostClaimIdList.length,
      winners,
    }
  })
}

/** Returns recent combined swap and waiver history for a team. */
export async function getSwapHistory(teamId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, 500))

  const [moves, claims] = await Promise.all([
    db
      .select({
        id: rosterMoves.id,
        eventType: sql<'ROSTER_MOVE'>`'ROSTER_MOVE'`,
        type: rosterMoves.type,
        symbol: rosterMoves.symbol,
        effectiveDate: rosterMoves.effectiveDate,
        createdAt: rosterMoves.createdAt,
      })
      .from(rosterMoves)
      .where(eq(rosterMoves.teamId, teamId))
      .orderBy(desc(rosterMoves.createdAt), desc(rosterMoves.id))
      .limit(safeLimit),
    db
      .select({
        id: waiverClaims.id,
        eventType: sql<'WAIVER_CLAIM'>`'WAIVER_CLAIM'`,
        status: waiverClaims.status,
        addSymbol: waiverClaims.addSymbol,
        dropSymbol: waiverClaims.dropSymbol,
        faabBid: waiverClaims.faabBid,
        effectiveDate: waiverClaims.effectiveDate,
        createdAt: waiverClaims.createdAt,
      })
      .from(waiverClaims)
      .where(eq(waiverClaims.teamId, teamId))
      .orderBy(desc(waiverClaims.createdAt), desc(waiverClaims.id))
      .limit(safeLimit),
  ])

  return [...moves, ...claims]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, safeLimit)
}

/** Cancels a pending waiver claim for a team. */
export async function cancelWaiverClaim(claimId: string, teamId: string) {
  const [claim] = await db
    .select({
      id: waiverClaims.id,
      teamId: waiverClaims.teamId,
      status: waiverClaims.status,
    })
    .from(waiverClaims)
    .where(and(eq(waiverClaims.id, claimId), eq(waiverClaims.teamId, teamId)))
    .limit(1)

  if (!claim) {
    throw new Error('Waiver claim not found')
  }

  if (!isWaiverClaimActive(claim.status) || claim.status !== 'PENDING') {
    throw new Error('Only pending waiver claims can be cancelled')
  }

  await db
    .update(waiverClaims)
    .set({ status: 'CANCELLED' })
    .where(eq(waiverClaims.id, claim.id))

  return {
    id: claim.id,
    status: 'CANCELLED' as const,
  }
}
