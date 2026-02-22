import { count, countDistinct, desc, eq, max, min } from 'drizzle-orm'

import { db } from '../../db/index'
import {
  instruments,
  leagues,
  priceDaily,
  rosterMoves,
  seasons,
  teamDayScores,
  teams,
  tradeProposals,
  tradingCalendar,
  waiverClaims,
} from '../../db/schema'

export const DEBUG_TABLES = [
  'seasons',
  'instruments',
  'leagues',
  'teams',
  'roster_moves',
  'price_daily',
  'team_day_scores',
  'trading_calendar',
  'waiver_claims',
  'trade_proposals',
] as const

export type DebugTableName = (typeof DEBUG_TABLES)[number]

export type TableOverview = {
  name: DebugTableName
  rowCount: number
}

export type BackendSystemStats = {
  tradingDays: number
  priceRows: number
  distinctPriceSymbols: number
  oldestPriceDate: string | null
  latestPriceDate: string | null
}

export type TableDetails = {
  name: DebugTableName
  rowCount: number
  columns: string[]
  rows: Array<Record<string, string>>
  filteredRowCount: number
  page: number
  pageSize: number
  totalPages: number
}

export type ClearBackendTablesResult = {
  tablesCleared: DebugTableName[]
  deletedRows: number
  clearedAt: string
}

type TableQueryOptions = {
  page?: number
  pageSize?: number
  query?: string
  filterColumn?: string
  filterValue?: string
}

const TABLE_COLUMNS: Record<DebugTableName, string[]> = {
  seasons: [
    'id',
    'name',
    'market',
    'start_date',
    'end_date',
    'trade_deadline_date',
    'budget',
    'scoring_multiplier',
    'first_day_penalty',
    'max_swaps_per_day',
    'max_swaps_per_week',
    'status',
    'created_at',
  ],
  instruments: [
    'id',
    'season_id',
    'symbol',
    'name',
    'tier',
    'tier_cost',
    'market_cap',
    'exchange',
    'created_at',
  ],
  leagues: [
    'id',
    'season_id',
    'name',
    'ownership_mode',
    'creator_id',
    'status',
    'created_at',
  ],
  teams: ['id', 'league_id', 'user_id', 'name', 'faab_budget', 'created_at'],
  roster_moves: [
    'id',
    'team_id',
    'type',
    'symbol',
    'effective_date',
    'metadata',
    'created_at',
  ],
  price_daily: ['symbol', 'date', 'adj_close', 'fetched_at'],
  team_day_scores: ['team_id', 'date', 'points', 'breakdown', 'computed_at'],
  trading_calendar: [
    'date',
    'is_trading_day',
    'next_trading_day',
    'prev_trading_day',
  ],
  waiver_claims: [
    'id',
    'team_id',
    'add_symbol',
    'drop_symbol',
    'faab_bid',
    'status',
    'effective_date',
    'created_at',
  ],
  trade_proposals: [
    'id',
    'league_id',
    'from_team_id',
    'to_team_id',
    'offered_symbols',
    'requested_symbols',
    'status',
    'effective_date',
    'created_at',
    'responded_at',
    'metadata',
  ],
}

const isDebugTableName = (value: string): value is DebugTableName =>
  (DEBUG_TABLES as readonly string[]).includes(value)

const normalizeRows = (rows: object[]) =>
  rows.map((row) => {
    const normalized: Record<string, string> = {}

    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        normalized[key] = ''
      } else if (typeof value === 'object') {
        normalized[key] = JSON.stringify(value)
      } else {
        normalized[key] = String(value)
      }
    }

    return normalized
  })

const getRowsForTable = async (tableName: DebugTableName) => {
  switch (tableName) {
    case 'seasons':
      return db
        .select()
        .from(seasons)
        .orderBy(desc(seasons.createdAt))
        .limit(2000)
    case 'instruments':
      return db
        .select()
        .from(instruments)
        .orderBy(desc(instruments.createdAt))
        .limit(2000)
    case 'leagues':
      return db
        .select()
        .from(leagues)
        .orderBy(desc(leagues.createdAt))
        .limit(2000)
    case 'teams':
      return db.select().from(teams).orderBy(desc(teams.createdAt)).limit(2000)
    case 'roster_moves':
      return db
        .select()
        .from(rosterMoves)
        .orderBy(desc(rosterMoves.createdAt))
        .limit(2000)
    case 'price_daily':
      return db
        .select()
        .from(priceDaily)
        .orderBy(desc(priceDaily.date))
        .limit(2000)
    case 'team_day_scores':
      return db
        .select()
        .from(teamDayScores)
        .orderBy(desc(teamDayScores.date))
        .limit(2000)
    case 'trading_calendar':
      return db
        .select()
        .from(tradingCalendar)
        .orderBy(desc(tradingCalendar.date))
        .limit(2000)
    case 'waiver_claims':
      return db
        .select()
        .from(waiverClaims)
        .orderBy(desc(waiverClaims.createdAt))
        .limit(2000)
    case 'trade_proposals':
      return db
        .select()
        .from(tradeProposals)
        .orderBy(desc(tradeProposals.createdAt))
        .limit(2000)
  }
}

const getCountForTable = async (tableName: DebugTableName) => {
  switch (tableName) {
    case 'seasons': {
      const [result] = await db.select({ value: count() }).from(seasons)
      return Number(result?.value ?? 0)
    }
    case 'instruments': {
      const [result] = await db.select({ value: count() }).from(instruments)
      return Number(result?.value ?? 0)
    }
    case 'leagues': {
      const [result] = await db.select({ value: count() }).from(leagues)
      return Number(result?.value ?? 0)
    }
    case 'teams': {
      const [result] = await db.select({ value: count() }).from(teams)
      return Number(result?.value ?? 0)
    }
    case 'roster_moves': {
      const [result] = await db.select({ value: count() }).from(rosterMoves)
      return Number(result?.value ?? 0)
    }
    case 'price_daily': {
      const [result] = await db.select({ value: count() }).from(priceDaily)
      return Number(result?.value ?? 0)
    }
    case 'team_day_scores': {
      const [result] = await db.select({ value: count() }).from(teamDayScores)
      return Number(result?.value ?? 0)
    }
    case 'trading_calendar': {
      const [result] = await db.select({ value: count() }).from(tradingCalendar)
      return Number(result?.value ?? 0)
    }
    case 'waiver_claims': {
      const [result] = await db.select({ value: count() }).from(waiverClaims)
      return Number(result?.value ?? 0)
    }
    case 'trade_proposals': {
      const [result] = await db.select({ value: count() }).from(tradeProposals)
      return Number(result?.value ?? 0)
    }
  }
}

export async function getBackendTableOverview(): Promise<TableOverview[]> {
  const counts = await Promise.all(
    DEBUG_TABLES.map(async (name) => ({
      name,
      rowCount: await getCountForTable(name),
    })),
  )

  return counts
}

export async function clearBackendTables(): Promise<ClearBackendTablesResult> {
  const rowCounts = await Promise.all(
    DEBUG_TABLES.map(async (name) => ({
      name,
      rowCount: await getCountForTable(name),
    })),
  )

  await db.transaction(async (tx) => {
    await tx.delete(priceDaily)
    await tx.delete(tradingCalendar)
    await tx.delete(seasons)
  })

  return {
    tablesCleared: [...DEBUG_TABLES],
    deletedRows: rowCounts.reduce((sum, row) => sum + row.rowCount, 0),
    clearedAt: new Date().toISOString(),
  }
}

export async function getBackendSystemStats(): Promise<BackendSystemStats> {
  const [tradingDaysResult] = await db
    .select({ value: count() })
    .from(tradingCalendar)
    .where(eq(tradingCalendar.isTradingDay, true))

  const [priceStats] = await db
    .select({
      rowCount: count(),
      symbolCount: countDistinct(priceDaily.symbol),
      oldestDate: min(priceDaily.date),
      latestDate: max(priceDaily.date),
    })
    .from(priceDaily)

  return {
    tradingDays: Number(tradingDaysResult?.value ?? 0),
    priceRows: Number(priceStats?.rowCount ?? 0),
    distinctPriceSymbols: Number(priceStats?.symbolCount ?? 0),
    oldestPriceDate: priceStats?.oldestDate
      ? new Date(priceStats.oldestDate).toISOString().slice(0, 10)
      : null,
    latestPriceDate: priceStats?.latestDate
      ? new Date(priceStats.latestDate).toISOString().slice(0, 10)
      : null,
  }
}

export async function getBackendTableDetails(
  tableName: string,
  options: TableQueryOptions = {},
): Promise<TableDetails> {
  if (!isDebugTableName(tableName)) {
    throw new Error('Unknown table')
  }

  const columns = TABLE_COLUMNS[tableName]
  const rawRows = await getRowsForTable(tableName)
  const rows = normalizeRows(rawRows)

  const query = (options.query ?? '').trim().toLowerCase()
  const filterColumn = (options.filterColumn ?? '').trim()
  const filterValue = (options.filterValue ?? '').trim().toLowerCase()

  const filteredRows = rows.filter((row) => {
    const matchesFilter =
      filterColumn && filterValue
        ? columns.includes(filterColumn) &&
          (row[filterColumn] ?? '').toLowerCase().includes(filterValue)
        : true

    if (!matchesFilter) return false

    if (!query) return true

    return columns.some((column) =>
      (row[column] ?? '').toLowerCase().includes(query),
    )
  })

  const safePageSize = Math.max(1, Math.min(options.pageSize ?? 50, 200))
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / safePageSize))
  const safePage = Math.max(1, Math.min(options.page ?? 1, totalPages))
  const start = (safePage - 1) * safePageSize
  const pagedRows = filteredRows.slice(start, start + safePageSize)

  return {
    name: tableName,
    rowCount: await getCountForTable(tableName),
    columns,
    rows: pagedRows,
    filteredRowCount: filteredRows.length,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  }
}
