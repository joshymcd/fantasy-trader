import { sql } from 'drizzle-orm'

import { db } from '../../db/index'

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
  'todos',
] as const

export type DebugTableName = (typeof DEBUG_TABLES)[number]

export type TableOverview = {
  name: DebugTableName
  rowCount: number
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

type TableQueryOptions = {
  page?: number
  pageSize?: number
  query?: string
  filterColumn?: string
  filterValue?: string
}

const isDebugTableName = (value: string): value is DebugTableName =>
  DEBUG_TABLES.includes(value as DebugTableName)

const getCountForTable = async (tableName: DebugTableName): Promise<number> => {
  const result = (await db.execute(
    sql.raw(`select count(*)::int as count from "${tableName}"`),
  )) as { rows: Array<{ count: number | string }> }

  return Number(result.rows[0]?.count ?? 0)
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

export async function getBackendTableDetails(
  tableName: string,
  options: TableQueryOptions = {},
): Promise<TableDetails> {
  if (!isDebugTableName(tableName)) {
    throw new Error('Unknown table')
  }

  const columnsResult = (await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = ${tableName}
    order by ordinal_position
  `)) as { rows: Array<{ column_name: string }> }

  const columns = columnsResult.rows.map((row) => row.column_name)
  const hasCreatedAt = columns.includes('created_at')

  const rowsResult = (await db.execute(
    sql.raw(
      hasCreatedAt
        ? `select * from "${tableName}" order by "created_at" desc limit 2000`
        : `select * from "${tableName}" limit 2000`,
    ),
  )) as { rows: Array<Record<string, unknown>> }

  const rows = rowsResult.rows.map((row) => {
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
