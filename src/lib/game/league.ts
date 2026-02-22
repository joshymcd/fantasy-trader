import { and, count, eq } from 'drizzle-orm'

import { db } from '../../db/index'
import { leagues, seasons, teams } from '../../db/schema'

type CreateLeagueInput = {
  seasonId: string
  name: string
  ownershipMode: 'UNIQUE' | 'DUPLICATES'
  creatorId: string
}

type CreateTeamInput = {
  leagueId: string
  userId: string
  name: string
}

/** Creates a new league for a season. */
export async function createLeague(input: CreateLeagueInput) {
  const seasonRows = await db
    .select({ id: seasons.id, status: seasons.status })
    .from(seasons)
    .where(eq(seasons.id, input.seasonId))
    .limit(1)

  const season = seasonRows[0]
  if (!season) {
    throw new Error('Season not found')
  }

  const [league] = await db
    .insert(leagues)
    .values({
      seasonId: input.seasonId,
      name: input.name.trim(),
      ownershipMode: input.ownershipMode,
      creatorId: input.creatorId.trim(),
      status: 'DRAFT_PENDING',
    })
    .returning({
      id: leagues.id,
      seasonId: leagues.seasonId,
      name: leagues.name,
      ownershipMode: leagues.ownershipMode,
      creatorId: leagues.creatorId,
      status: leagues.status,
    })

  return league
}

/** Creates a team for a user inside a league. */
export async function createTeam(input: CreateTeamInput) {
  const leagueRows = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.id, input.leagueId))
    .limit(1)

  if (!leagueRows[0]) {
    throw new Error('League not found')
  }

  const [existing] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)),
    )
    .limit(1)

  if (existing) {
    throw new Error('User already has a team in this league')
  }

  const [team] = await db
    .insert(teams)
    .values({
      leagueId: input.leagueId,
      userId: input.userId.trim(),
      name: input.name.trim(),
    })
    .returning({
      id: teams.id,
      leagueId: teams.leagueId,
      userId: teams.userId,
      name: teams.name,
      faabBudget: teams.faabBudget,
    })

  return team
}

/** Lists leagues with their team counts. */
export async function listLeagues() {
  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      seasonId: leagues.seasonId,
      seasonName: seasons.name,
      ownershipMode: leagues.ownershipMode,
      creatorId: leagues.creatorId,
      status: leagues.status,
      createdAt: leagues.createdAt,
    })
    .from(leagues)
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))

  const teamCounts = await db
    .select({ leagueId: teams.leagueId, teamCount: count() })
    .from(teams)
    .groupBy(teams.leagueId)

  const teamCountByLeague = new Map(
    teamCounts.map((row) => [row.leagueId, Number(row.teamCount)]),
  )

  return rows.map((row) => ({
    ...row,
    teamCount: teamCountByLeague.get(row.id) ?? 0,
  }))
}

/** Lists teams that belong to a league. */
export async function listLeagueTeams(leagueId: string) {
  return db
    .select({
      id: teams.id,
      leagueId: teams.leagueId,
      userId: teams.userId,
      name: teams.name,
      faabBudget: teams.faabBudget,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
}

/** Returns league details plus teams, or null when not found. */
export async function getLeagueById(leagueId: string) {
  const [league] = await db
    .select({
      id: leagues.id,
      seasonId: leagues.seasonId,
      name: leagues.name,
      ownershipMode: leagues.ownershipMode,
      creatorId: leagues.creatorId,
      status: leagues.status,
      createdAt: leagues.createdAt,
    })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1)

  if (!league) {
    return null
  }

  const leagueTeams = await listLeagueTeams(leagueId)

  return {
    ...league,
    teams: leagueTeams,
  }
}
