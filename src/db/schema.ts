import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const todos = pgTable('todos', {
  id: serial().primaryKey(),
  title: text().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const seasonStatusEnum = pgEnum('season_status', [
  'SETUP',
  'ACTIVE',
  'COMPLETED',
])

export const ownershipModeEnum = pgEnum('ownership_mode', [
  'UNIQUE',
  'DUPLICATES',
])

export const leagueStatusEnum = pgEnum('league_status', [
  'DRAFT_PENDING',
  'DRAFTING',
  'ACTIVE',
  'COMPLETED',
])

export const rosterMoveTypeEnum = pgEnum('roster_move_type', [
  'DRAFT',
  'ADD',
  'DROP',
  'TRADE',
])

export const waiverClaimStatusEnum = pgEnum('waiver_claim_status', [
  'PENDING',
  'WON',
  'LOST',
  'CANCELLED',
])

export const seasons = pgTable('seasons', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  market: text().notNull().default('LSE'),
  startDate: date('start_date', { mode: 'date' }).notNull(),
  endDate: date('end_date', { mode: 'date' }).notNull(),
  tradeDeadlineDate: date('trade_deadline_date', { mode: 'date' }).notNull(),
  budget: integer().notNull().default(100),
  scoringMultiplier: integer('scoring_multiplier').notNull().default(10),
  firstDayPenalty: decimal('first_day_penalty', { precision: 4, scale: 2 })
    .notNull()
    .default('0.50'),
  maxSwapsPerDay: integer('max_swaps_per_day').notNull().default(1),
  maxSwapsPerWeek: integer('max_swaps_per_week').notNull().default(5),
  status: seasonStatusEnum('status').notNull().default('SETUP'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const instruments = pgTable(
  'instruments',
  {
    id: uuid().defaultRandom().primaryKey(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    symbol: text().notNull(),
    name: text().notNull(),
    tier: integer().notNull(),
    tierCost: integer('tier_cost').notNull(),
    marketCap: decimal('market_cap', { precision: 20, scale: 2 }),
    exchange: text().notNull().default('LSE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('instruments_season_symbol_idx').on(
      table.seasonId,
      table.symbol,
    ),
    index('instruments_season_tier_idx').on(table.seasonId, table.tier),
  ],
)

export const leagues = pgTable('leagues', {
  id: uuid().defaultRandom().primaryKey(),
  seasonId: uuid('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  ownershipMode: ownershipModeEnum('ownership_mode')
    .notNull()
    .default('UNIQUE'),
  creatorId: text('creator_id').notNull(),
  status: leagueStatusEnum('status').notNull().default('DRAFT_PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const teams = pgTable(
  'teams',
  {
    id: uuid().defaultRandom().primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    name: text().notNull(),
    faabBudget: integer('faab_budget').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('teams_league_user_idx').on(table.leagueId, table.userId),
    index('teams_league_idx').on(table.leagueId),
  ],
)

export const rosterMoves = pgTable(
  'roster_moves',
  {
    id: uuid().defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    type: rosterMoveTypeEnum('type').notNull(),
    symbol: text().notNull(),
    effectiveDate: date('effective_date', { mode: 'date' }).notNull(),
    metadata: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('roster_moves_team_effective_date_idx').on(
      table.teamId,
      table.effectiveDate,
    ),
    index('roster_moves_symbol_effective_date_idx').on(
      table.symbol,
      table.effectiveDate,
    ),
  ],
)

export const priceDaily = pgTable(
  'price_daily',
  {
    symbol: text().notNull(),
    date: date({ mode: 'date' }).notNull(),
    adjClose: decimal('adj_close', { precision: 18, scale: 8 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.date] }),
    index('price_daily_symbol_idx').on(table.symbol),
  ],
)

export const teamDayScores = pgTable(
  'team_day_scores',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    date: date({ mode: 'date' }).notNull(),
    points: decimal({ precision: 12, scale: 4 }).notNull(),
    breakdown: jsonb().$type<Record<string, number>>().notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.date] }),
    index('team_day_scores_date_idx').on(table.date),
  ],
)

export const tradingCalendar = pgTable('trading_calendar', {
  date: date({ mode: 'date' }).primaryKey(),
  isTradingDay: boolean('is_trading_day').notNull(),
  nextTradingDay: date('next_trading_day', { mode: 'date' }),
  prevTradingDay: date('prev_trading_day', { mode: 'date' }),
})

export const waiverClaims = pgTable(
  'waiver_claims',
  {
    id: uuid().defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    addSymbol: text('add_symbol').notNull(),
    dropSymbol: text('drop_symbol').notNull(),
    faabBid: integer('faab_bid').notNull().default(0),
    status: waiverClaimStatusEnum('status').notNull().default('PENDING'),
    effectiveDate: date('effective_date', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('waiver_claims_team_effective_date_idx').on(
      table.teamId,
      table.effectiveDate,
    ),
    index('waiver_claims_status_idx').on(table.status),
  ],
)
