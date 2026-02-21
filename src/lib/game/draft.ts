import { and, count, eq, inArray, ne } from 'drizzle-orm'

import { db } from '../../db/index'
import {
  instruments,
  leagues,
  rosterMoves,
  seasons,
  teams,
} from '../../db/schema'
import { ROSTER_SIZE, TIER_COUNT, emptyTierCounts } from '../../types/game'

const parseSymbols = (symbols: string[]) =>
  symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)

export async function getAvailableInstruments(leagueId: string) {
  const [league] = await db
    .select({
      id: leagues.id,
      seasonId: leagues.seasonId,
      ownershipMode: leagues.ownershipMode,
    })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1)

  if (!league) {
    throw new Error('League not found')
  }

  const seasonInstruments = await db
    .select({
      symbol: instruments.symbol,
      name: instruments.name,
      tier: instruments.tier,
      tierCost: instruments.tierCost,
      marketCap: instruments.marketCap,
    })
    .from(instruments)
    .where(eq(instruments.seasonId, league.seasonId))

  if (league.ownershipMode === 'DUPLICATES') {
    return seasonInstruments.map((instrument) => ({
      ...instrument,
      isAvailable: true,
      takenByTeamId: null,
    }))
  }

  const drafted = await db
    .select({ symbol: rosterMoves.symbol, teamId: rosterMoves.teamId })
    .from(rosterMoves)
    .innerJoin(teams, eq(rosterMoves.teamId, teams.id))
    .where(and(eq(teams.leagueId, leagueId), eq(rosterMoves.type, 'DRAFT')))

  const takenBySymbol = new Map(drafted.map((row) => [row.symbol, row.teamId]))

  return seasonInstruments.map((instrument) => {
    const takenByTeamId = takenBySymbol.get(instrument.symbol) ?? null
    return {
      ...instrument,
      isAvailable: takenByTeamId === null,
      takenByTeamId,
    }
  })
}

export async function validatePortfolio(input: {
  symbols: string[]
  seasonId: string
  leagueId?: string
  teamId?: string
}) {
  const symbols = parseSymbols(input.symbols)
  const uniqueSymbols = [...new Set(symbols)]
  const errors: string[] = []

  if (symbols.length !== ROSTER_SIZE) {
    errors.push(`Portfolio must contain exactly ${ROSTER_SIZE} symbols`)
  }

  if (uniqueSymbols.length !== symbols.length) {
    errors.push('Portfolio contains duplicate symbols')
  }

  const seasonInstruments = uniqueSymbols.length
    ? await db
        .select({
          symbol: instruments.symbol,
          name: instruments.name,
          tier: instruments.tier,
          tierCost: instruments.tierCost,
        })
        .from(instruments)
        .where(
          and(
            eq(instruments.seasonId, input.seasonId),
            inArray(instruments.symbol, uniqueSymbols),
          ),
        )
    : []

  const bySymbol = new Map(
    seasonInstruments.map((instrument) => [instrument.symbol, instrument]),
  )

  const missingSymbols = uniqueSymbols.filter((symbol) => !bySymbol.has(symbol))
  if (missingSymbols.length > 0) {
    errors.push(`Unknown symbols for this season: ${missingSymbols.join(', ')}`)
  }

  const tierCounts = emptyTierCounts()
  let totalCost = 0

  for (const symbol of uniqueSymbols) {
    const instrument = bySymbol.get(symbol)
    if (!instrument) continue

    if (instrument.tier >= 1 && instrument.tier <= TIER_COUNT) {
      tierCounts[instrument.tier as 1 | 2 | 3 | 4 | 5] += 1
    }
    totalCost += instrument.tierCost
  }

  for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
    if (tierCounts[tier as 1 | 2 | 3 | 4 | 5] < 1) {
      errors.push(`Portfolio requires at least one Tier ${tier} symbol`)
    }
  }

  const [season] = await db
    .select({ budget: seasons.budget })
    .from(seasons)
    .where(eq(seasons.id, input.seasonId))
    .limit(1)

  const budget = season?.budget ?? 100
  if (totalCost > budget) {
    errors.push(`Portfolio cost ${totalCost} exceeds season budget ${budget}`)
  }

  if (input.leagueId) {
    const [league] = await db
      .select({ ownershipMode: leagues.ownershipMode })
      .from(leagues)
      .where(eq(leagues.id, input.leagueId))
      .limit(1)

    if (league?.ownershipMode === 'UNIQUE' && uniqueSymbols.length > 0) {
      const takenRows = await db
        .select({ symbol: rosterMoves.symbol, teamId: rosterMoves.teamId })
        .from(rosterMoves)
        .innerJoin(teams, eq(rosterMoves.teamId, teams.id))
        .where(
          and(
            eq(teams.leagueId, input.leagueId),
            eq(rosterMoves.type, 'DRAFT'),
            inArray(rosterMoves.symbol, uniqueSymbols),
            input.teamId ? ne(rosterMoves.teamId, input.teamId) : undefined,
          ),
        )

      if (takenRows.length > 0) {
        const takenSymbols = [...new Set(takenRows.map((row) => row.symbol))]
        errors.push(
          `Symbols already drafted in this unique league: ${takenSymbols.join(', ')}`,
        )
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    symbols: uniqueSymbols,
    budget,
    totalCost,
    tierCounts,
    instruments: uniqueSymbols
      .map((symbol) => bySymbol.get(symbol))
      .filter((instrument) => instrument !== undefined),
  }
}

export async function selectPortfolio(input: {
  teamId: string
  symbols: string[]
}) {
  const symbols = parseSymbols(input.symbols)

  return db.transaction(async (tx) => {
    const [teamContext] = await tx
      .select({
        teamId: teams.id,
        leagueId: leagues.id,
        seasonId: leagues.seasonId,
        leagueStatus: leagues.status,
        ownershipMode: leagues.ownershipMode,
        seasonStartDate: seasons.startDate,
      })
      .from(teams)
      .innerJoin(leagues, eq(teams.leagueId, leagues.id))
      .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
      .where(eq(teams.id, input.teamId))
      .limit(1)

    if (!teamContext) {
      throw new Error('Team not found')
    }

    if (!['DRAFT_PENDING', 'DRAFTING'].includes(teamContext.leagueStatus)) {
      throw new Error('League is not in a draft state')
    }

    const [existingDraftCount] = await tx
      .select({ value: count() })
      .from(rosterMoves)
      .where(
        and(
          eq(rosterMoves.teamId, input.teamId),
          eq(rosterMoves.type, 'DRAFT'),
        ),
      )

    if (Number(existingDraftCount?.value ?? 0) > 0) {
      throw new Error('Team already has a submitted portfolio')
    }

    const validation = await validatePortfolio({
      symbols,
      seasonId: teamContext.seasonId,
      leagueId: teamContext.leagueId,
      teamId: input.teamId,
    })

    if (!validation.isValid) {
      throw new Error(validation.errors.join(' | '))
    }

    await tx.insert(rosterMoves).values(
      validation.symbols.map((symbol) => ({
        teamId: input.teamId,
        type: 'DRAFT' as const,
        symbol,
        effectiveDate: teamContext.seasonStartDate,
        metadata: {},
        createdAt: new Date(),
      })),
    )

    const leagueTeams = await tx
      .select({ teamId: teams.id })
      .from(teams)
      .where(eq(teams.leagueId, teamContext.leagueId))

    const draftCounts = await tx
      .select({ teamId: rosterMoves.teamId, value: count() })
      .from(rosterMoves)
      .innerJoin(teams, eq(rosterMoves.teamId, teams.id))
      .where(
        and(
          eq(teams.leagueId, teamContext.leagueId),
          eq(rosterMoves.type, 'DRAFT'),
        ),
      )
      .groupBy(rosterMoves.teamId)

    const draftCountByTeamId = new Map(
      draftCounts.map((row) => [row.teamId, Number(row.value)]),
    )

    const allTeamsComplete =
      leagueTeams.length > 0 &&
      leagueTeams.every(
        (team) => (draftCountByTeamId.get(team.teamId) ?? 0) >= ROSTER_SIZE,
      )

    const newLeagueStatus = allTeamsComplete ? 'ACTIVE' : 'DRAFTING'

    await tx
      .update(leagues)
      .set({ status: newLeagueStatus })
      .where(eq(leagues.id, teamContext.leagueId))

    return {
      teamId: input.teamId,
      leagueId: teamContext.leagueId,
      leagueStatus: newLeagueStatus,
      submittedSymbols: validation.symbols,
      totalCost: validation.totalCost,
      tierCounts: validation.tierCounts,
    }
  })
}
