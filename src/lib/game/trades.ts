import { and, asc, eq, lte, or } from 'drizzle-orm'

import { db } from '@/db/index'
import {
  instruments,
  leagues,
  rosterMoves,
  seasons,
  teams,
  tradeProposals,
} from '@/db/schema'

import { getNextTradingDay, isMarketOpen } from './calendar'
import { getHoldingsAtDate, validateRoster } from './holdings'

/** Normalizes and de-duplicates ticker symbols. */
const normalizeSymbols = (symbols: string[]) => [
  ...new Set(
    symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  ),
]

/** Throws when a trade action is attempted after the trade deadline date. */
const assertBeforeTradeDeadline = (
  tradeDeadlineDate: Date,
  attemptedAt: Date,
) => {
  const attemptDay = new Date(
    Date.UTC(
      attemptedAt.getUTCFullYear(),
      attemptedAt.getUTCMonth(),
      attemptedAt.getUTCDate(),
    ),
  )

  if (attemptDay.getTime() > tradeDeadlineDate.getTime()) {
    throw new Error('Trade deadline has passed')
  }
}

/** Returns holdings keyed by symbol for a team on an effective date. */
async function getRosterAtEffectiveDate(teamId: string, effectiveDate: Date) {
  const holdings = await getHoldingsAtDate(teamId, effectiveDate)
  return new Map(holdings.map((holding) => [holding.symbol, holding]))
}

/** Creates a pending trade proposal between two teams. */
export async function proposeTrade(input: {
  fromTeamId: string
  toTeamId: string
  offeredSymbols: string[]
  requestedSymbols: string[]
  proposedAt?: Date
}) {
  const proposedAt = input.proposedAt ?? new Date()

  if (input.fromTeamId === input.toTeamId) {
    throw new Error('Cannot propose a trade to the same team')
  }

  if (isMarketOpen(proposedAt)) {
    throw new Error('Trades are only allowed when the market is closed')
  }

  const offeredSymbols = normalizeSymbols(input.offeredSymbols)
  const requestedSymbols = normalizeSymbols(input.requestedSymbols)

  if (offeredSymbols.length === 0 || requestedSymbols.length === 0) {
    throw new Error(
      'Trade must include at least one offered and requested symbol',
    )
  }

  const overlap = offeredSymbols.find((symbol) =>
    requestedSymbols.includes(symbol),
  )
  if (overlap) {
    throw new Error(`Symbol ${overlap} cannot be both offered and requested`)
  }

  const [context] = await db
    .select({
      fromTeamId: teams.id,
      toTeamId: teams.id,
      leagueId: leagues.id,
      leagueStatus: leagues.status,
      ownershipMode: leagues.ownershipMode,
      seasonId: seasons.id,
      budget: seasons.budget,
      tradeDeadlineDate: seasons.tradeDeadlineDate,
    })
    .from(teams)
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(teams.id, input.fromTeamId))
    .limit(1)

  if (!context) {
    throw new Error('From team not found')
  }

  const [counterparty] = await db
    .select({ id: teams.id, leagueId: teams.leagueId })
    .from(teams)
    .where(eq(teams.id, input.toTeamId))
    .limit(1)

  if (!counterparty) {
    throw new Error('To team not found')
  }

  if (context.leagueId !== counterparty.leagueId) {
    throw new Error('Both teams must belong to the same league')
  }

  if (context.leagueStatus !== 'ACTIVE') {
    throw new Error('Trades are only allowed in active leagues')
  }

  if (context.ownershipMode !== 'UNIQUE') {
    throw new Error('Trades are only supported in unique ownership leagues')
  }

  assertBeforeTradeDeadline(context.tradeDeadlineDate, proposedAt)

  const effectiveDate = await getNextTradingDay(proposedAt)

  const [fromHoldings, toHoldings, seasonInstruments] = await Promise.all([
    getRosterAtEffectiveDate(input.fromTeamId, effectiveDate),
    getRosterAtEffectiveDate(input.toTeamId, effectiveDate),
    db
      .select({
        symbol: instruments.symbol,
        tier: instruments.tier,
        tierCost: instruments.tierCost,
      })
      .from(instruments)
      .where(eq(instruments.seasonId, context.seasonId)),
  ])

  for (const symbol of offeredSymbols) {
    if (!fromHoldings.has(symbol)) {
      throw new Error(
        `Cannot offer ${symbol}: symbol is not held by proposing team`,
      )
    }
  }

  for (const symbol of requestedSymbols) {
    if (!toHoldings.has(symbol)) {
      throw new Error(
        `Cannot request ${symbol}: symbol is not held by receiving team`,
      )
    }
  }

  const instrumentBySymbol = new Map(
    seasonInstruments.map((instrument) => [instrument.symbol, instrument]),
  )

  const projectedFromSymbols = new Set(fromHoldings.keys())
  const projectedToSymbols = new Set(toHoldings.keys())

  for (const symbol of offeredSymbols) {
    projectedFromSymbols.delete(symbol)
    projectedToSymbols.add(symbol)
  }

  for (const symbol of requestedSymbols) {
    projectedToSymbols.delete(symbol)
    projectedFromSymbols.add(symbol)
  }

  const fromProjectedHoldings = [...projectedFromSymbols]
    .map((symbol) => {
      const instrument = instrumentBySymbol.get(symbol)
      return instrument
        ? {
            symbol,
            tier: instrument.tier,
            tierCost: instrument.tierCost,
            addedDate: effectiveDate,
          }
        : null
    })
    .filter((holding) => holding !== null)

  const toProjectedHoldings = [...projectedToSymbols]
    .map((symbol) => {
      const instrument = instrumentBySymbol.get(symbol)
      return instrument
        ? {
            symbol,
            tier: instrument.tier,
            tierCost: instrument.tierCost,
            addedDate: effectiveDate,
          }
        : null
    })
    .filter((holding) => holding !== null)

  const fromValidation = validateRoster(fromProjectedHoldings, context.budget)
  if (!fromValidation.isValid) {
    throw new Error(
      `Proposer roster invalid after trade: ${fromValidation.errors.join(' | ')}`,
    )
  }

  const toValidation = validateRoster(toProjectedHoldings, context.budget)
  if (!toValidation.isValid) {
    throw new Error(
      `Counterparty roster invalid after trade: ${toValidation.errors.join(' | ')}`,
    )
  }

  const [proposal] = await db
    .insert(tradeProposals)
    .values({
      leagueId: context.leagueId,
      fromTeamId: input.fromTeamId,
      toTeamId: input.toTeamId,
      offeredSymbols,
      requestedSymbols,
      status: 'PENDING',
      effectiveDate,
      createdAt: proposedAt,
    })
    .returning({
      id: tradeProposals.id,
      leagueId: tradeProposals.leagueId,
      fromTeamId: tradeProposals.fromTeamId,
      toTeamId: tradeProposals.toTeamId,
      offeredSymbols: tradeProposals.offeredSymbols,
      requestedSymbols: tradeProposals.requestedSymbols,
      status: tradeProposals.status,
      effectiveDate: tradeProposals.effectiveDate,
      createdAt: tradeProposals.createdAt,
      respondedAt: tradeProposals.respondedAt,
    })

  return proposal
}

/** Accepts a pending trade proposal and writes roster trade moves. */
export async function acceptTrade(input: {
  tradeId: string
  actedByTeamId?: string
  acceptedAt?: Date
}) {
  const acceptedAt = input.acceptedAt ?? new Date()

  if (isMarketOpen(acceptedAt)) {
    throw new Error('Trades are only allowed when the market is closed')
  }

  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select({
        id: tradeProposals.id,
        leagueId: tradeProposals.leagueId,
        fromTeamId: tradeProposals.fromTeamId,
        toTeamId: tradeProposals.toTeamId,
        offeredSymbols: tradeProposals.offeredSymbols,
        requestedSymbols: tradeProposals.requestedSymbols,
        status: tradeProposals.status,
        effectiveDate: tradeProposals.effectiveDate,
      })
      .from(tradeProposals)
      .where(eq(tradeProposals.id, input.tradeId))
      .limit(1)

    if (!proposal) {
      throw new Error('Trade proposal not found')
    }

    if (proposal.status !== 'PENDING') {
      throw new Error('Trade proposal is no longer pending')
    }

    if (input.actedByTeamId && input.actedByTeamId !== proposal.toTeamId) {
      throw new Error('Only the receiving team can accept this trade')
    }

    const [context] = await tx
      .select({
        budget: seasons.budget,
        tradeDeadlineDate: seasons.tradeDeadlineDate,
      })
      .from(leagues)
      .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
      .where(eq(leagues.id, proposal.leagueId))
      .limit(1)

    if (!context) {
      throw new Error('League not found for trade proposal')
    }

    assertBeforeTradeDeadline(context.tradeDeadlineDate, acceptedAt)

    const [fromHoldings, toHoldings] = await Promise.all([
      getRosterAtEffectiveDate(proposal.fromTeamId, proposal.effectiveDate),
      getRosterAtEffectiveDate(proposal.toTeamId, proposal.effectiveDate),
    ])

    for (const symbol of proposal.offeredSymbols) {
      if (!fromHoldings.has(symbol)) {
        throw new Error(
          `Trade no longer valid: proposer no longer holds ${symbol}`,
        )
      }
    }

    for (const symbol of proposal.requestedSymbols) {
      if (!toHoldings.has(symbol)) {
        throw new Error(
          `Trade no longer valid: receiving team no longer holds ${symbol}`,
        )
      }
    }

    const [seasonRow] = await tx
      .select({ seasonId: leagues.seasonId })
      .from(leagues)
      .where(eq(leagues.id, proposal.leagueId))
      .limit(1)

    if (!seasonRow) {
      throw new Error('League season not found')
    }

    const seasonInstruments = await tx
      .select({
        symbol: instruments.symbol,
        tier: instruments.tier,
        tierCost: instruments.tierCost,
      })
      .from(instruments)
      .where(eq(instruments.seasonId, seasonRow.seasonId))

    const instrumentBySymbol = new Map(
      seasonInstruments.map((instrument) => [instrument.symbol, instrument]),
    )

    const projectedFromSymbols = new Set(fromHoldings.keys())
    const projectedToSymbols = new Set(toHoldings.keys())

    for (const symbol of proposal.offeredSymbols) {
      projectedFromSymbols.delete(symbol)
      projectedToSymbols.add(symbol)
    }

    for (const symbol of proposal.requestedSymbols) {
      projectedToSymbols.delete(symbol)
      projectedFromSymbols.add(symbol)
    }

    const fromProjected = [...projectedFromSymbols]
      .map((symbol) => {
        const instrument = instrumentBySymbol.get(symbol)
        return instrument
          ? {
              symbol,
              tier: instrument.tier,
              tierCost: instrument.tierCost,
              addedDate: proposal.effectiveDate,
            }
          : null
      })
      .filter((holding) => holding !== null)

    const toProjected = [...projectedToSymbols]
      .map((symbol) => {
        const instrument = instrumentBySymbol.get(symbol)
        return instrument
          ? {
              symbol,
              tier: instrument.tier,
              tierCost: instrument.tierCost,
              addedDate: proposal.effectiveDate,
            }
          : null
      })
      .filter((holding) => holding !== null)

    const fromValidation = validateRoster(fromProjected, context.budget)
    if (!fromValidation.isValid) {
      throw new Error(
        `Proposer roster invalid after trade: ${fromValidation.errors.join(' | ')}`,
      )
    }

    const toValidation = validateRoster(toProjected, context.budget)
    if (!toValidation.isValid) {
      throw new Error(
        `Counterparty roster invalid after trade: ${toValidation.errors.join(' | ')}`,
      )
    }

    const moves = [] as Array<{
      teamId: string
      type: 'TRADE'
      symbol: string
      effectiveDate: Date
      metadata: Record<string, unknown>
      createdAt: Date
    }>

    for (const symbol of proposal.offeredSymbols) {
      moves.push({
        teamId: proposal.fromTeamId,
        type: 'TRADE',
        symbol,
        effectiveDate: proposal.effectiveDate,
        metadata: {
          direction: 'OUT',
          tradeId: proposal.id,
          counterpartyTeamId: proposal.toTeamId,
        },
        createdAt: acceptedAt,
      })

      moves.push({
        teamId: proposal.toTeamId,
        type: 'TRADE',
        symbol,
        effectiveDate: proposal.effectiveDate,
        metadata: {
          direction: 'IN',
          tradeId: proposal.id,
          counterpartyTeamId: proposal.fromTeamId,
        },
        createdAt: acceptedAt,
      })
    }

    for (const symbol of proposal.requestedSymbols) {
      moves.push({
        teamId: proposal.toTeamId,
        type: 'TRADE',
        symbol,
        effectiveDate: proposal.effectiveDate,
        metadata: {
          direction: 'OUT',
          tradeId: proposal.id,
          counterpartyTeamId: proposal.fromTeamId,
        },
        createdAt: acceptedAt,
      })

      moves.push({
        teamId: proposal.fromTeamId,
        type: 'TRADE',
        symbol,
        effectiveDate: proposal.effectiveDate,
        metadata: {
          direction: 'IN',
          tradeId: proposal.id,
          counterpartyTeamId: proposal.toTeamId,
        },
        createdAt: acceptedAt,
      })
    }

    await tx.insert(rosterMoves).values(moves)

    const [updated] = await tx
      .update(tradeProposals)
      .set({ status: 'ACCEPTED', respondedAt: acceptedAt })
      .where(eq(tradeProposals.id, proposal.id))
      .returning({
        id: tradeProposals.id,
        leagueId: tradeProposals.leagueId,
        fromTeamId: tradeProposals.fromTeamId,
        toTeamId: tradeProposals.toTeamId,
        offeredSymbols: tradeProposals.offeredSymbols,
        requestedSymbols: tradeProposals.requestedSymbols,
        status: tradeProposals.status,
        effectiveDate: tradeProposals.effectiveDate,
        createdAt: tradeProposals.createdAt,
        respondedAt: tradeProposals.respondedAt,
      })

    return updated
  })
}

/** Rejects a pending trade proposal. */
export async function rejectTrade(input: {
  tradeId: string
  actedByTeamId?: string
  rejectedAt?: Date
}) {
  const rejectedAt = input.rejectedAt ?? new Date()

  const [proposal] = await db
    .select({
      id: tradeProposals.id,
      toTeamId: tradeProposals.toTeamId,
      status: tradeProposals.status,
    })
    .from(tradeProposals)
    .where(eq(tradeProposals.id, input.tradeId))
    .limit(1)

  if (!proposal) {
    throw new Error('Trade proposal not found')
  }

  if (proposal.status !== 'PENDING') {
    throw new Error('Trade proposal is no longer pending')
  }

  if (input.actedByTeamId && input.actedByTeamId !== proposal.toTeamId) {
    throw new Error('Only the receiving team can reject this trade')
  }

  const [updated] = await db
    .update(tradeProposals)
    .set({ status: 'REJECTED', respondedAt: rejectedAt })
    .where(eq(tradeProposals.id, proposal.id))
    .returning({
      id: tradeProposals.id,
      leagueId: tradeProposals.leagueId,
      fromTeamId: tradeProposals.fromTeamId,
      toTeamId: tradeProposals.toTeamId,
      offeredSymbols: tradeProposals.offeredSymbols,
      requestedSymbols: tradeProposals.requestedSymbols,
      status: tradeProposals.status,
      effectiveDate: tradeProposals.effectiveDate,
      createdAt: tradeProposals.createdAt,
      respondedAt: tradeProposals.respondedAt,
    })

  return updated
}

/** Lists trade proposals where the team is proposer or recipient. */
export async function getTradeProposalsForTeam(teamId: string) {
  return db
    .select({
      id: tradeProposals.id,
      leagueId: tradeProposals.leagueId,
      fromTeamId: tradeProposals.fromTeamId,
      toTeamId: tradeProposals.toTeamId,
      offeredSymbols: tradeProposals.offeredSymbols,
      requestedSymbols: tradeProposals.requestedSymbols,
      status: tradeProposals.status,
      effectiveDate: tradeProposals.effectiveDate,
      createdAt: tradeProposals.createdAt,
      respondedAt: tradeProposals.respondedAt,
    })
    .from(tradeProposals)
    .where(
      or(
        eq(tradeProposals.fromTeamId, teamId),
        eq(tradeProposals.toTeamId, teamId),
      ),
    )
    .orderBy(asc(tradeProposals.createdAt), asc(tradeProposals.id))
}

/** Expires pending trades once league trade deadline has passed. */
export async function expirePendingTrades(
  leagueId: string,
  atDate: Date = new Date(),
) {
  const [leagueRow] = await db
    .select({ tradeDeadlineDate: seasons.tradeDeadlineDate })
    .from(leagues)
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(leagues.id, leagueId))
    .limit(1)

  if (!leagueRow) {
    throw new Error('League not found')
  }

  const today = new Date(
    Date.UTC(
      atDate.getUTCFullYear(),
      atDate.getUTCMonth(),
      atDate.getUTCDate(),
    ),
  )

  if (today.getTime() <= leagueRow.tradeDeadlineDate.getTime()) {
    return { expiredCount: 0 }
  }

  const expired = await db
    .update(tradeProposals)
    .set({ status: 'EXPIRED', respondedAt: atDate })
    .where(
      and(
        eq(tradeProposals.leagueId, leagueId),
        eq(tradeProposals.status, 'PENDING'),
        lte(tradeProposals.effectiveDate, today),
      ),
    )
    .returning({ id: tradeProposals.id })

  return { expiredCount: expired.length }
}

/** Cancels a pending trade proposal by its proposer. */
export async function cancelTrade(input: {
  tradeId: string
  fromTeamId: string
}) {
  const [proposal] = await db
    .select({
      id: tradeProposals.id,
      fromTeamId: tradeProposals.fromTeamId,
      status: tradeProposals.status,
    })
    .from(tradeProposals)
    .where(eq(tradeProposals.id, input.tradeId))
    .limit(1)

  if (!proposal) {
    throw new Error('Trade proposal not found')
  }

  if (proposal.status !== 'PENDING') {
    throw new Error('Only pending proposals can be cancelled')
  }

  if (proposal.fromTeamId !== input.fromTeamId) {
    throw new Error('Only the proposing team can cancel this trade')
  }

  const [updated] = await db
    .update(tradeProposals)
    .set({ status: 'CANCELLED', respondedAt: new Date() })
    .where(eq(tradeProposals.id, proposal.id))
    .returning({
      id: tradeProposals.id,
      leagueId: tradeProposals.leagueId,
      fromTeamId: tradeProposals.fromTeamId,
      toTeamId: tradeProposals.toTeamId,
      offeredSymbols: tradeProposals.offeredSymbols,
      requestedSymbols: tradeProposals.requestedSymbols,
      status: tradeProposals.status,
      effectiveDate: tradeProposals.effectiveDate,
      createdAt: tradeProposals.createdAt,
      respondedAt: tradeProposals.respondedAt,
    })

  return updated
}
