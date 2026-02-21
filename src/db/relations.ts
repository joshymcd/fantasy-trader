import { relations } from 'drizzle-orm'

import {
  instruments,
  leagues,
  rosterMoves,
  seasons,
  teamDayScores,
  teams,
  waiverClaims,
} from './schema'

export const seasonRelations = relations(seasons, ({ many }) => ({
  instruments: many(instruments),
  leagues: many(leagues),
}))

export const instrumentRelations = relations(instruments, ({ one }) => ({
  season: one(seasons, {
    fields: [instruments.seasonId],
    references: [seasons.id],
  }),
}))

export const leagueRelations = relations(leagues, ({ one, many }) => ({
  season: one(seasons, {
    fields: [leagues.seasonId],
    references: [seasons.id],
  }),
  teams: many(teams),
}))

export const teamRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
  rosterMoves: many(rosterMoves),
  dayScores: many(teamDayScores),
  waiverClaims: many(waiverClaims),
}))

export const rosterMoveRelations = relations(rosterMoves, ({ one }) => ({
  team: one(teams, {
    fields: [rosterMoves.teamId],
    references: [teams.id],
  }),
}))

export const teamDayScoreRelations = relations(teamDayScores, ({ one }) => ({
  team: one(teams, {
    fields: [teamDayScores.teamId],
    references: [teams.id],
  }),
}))

export const waiverClaimRelations = relations(waiverClaims, ({ one }) => ({
  team: one(teams, {
    fields: [waiverClaims.teamId],
    references: [teams.id],
  }),
}))
