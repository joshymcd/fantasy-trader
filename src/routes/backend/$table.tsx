import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { getBackendTableDetails } from '../../lib/backend/debug'

type BackendTableSearch = {
  page: number
  pageSize: number
  query: string
  filterColumn: string
  filterValue: string
}

const getTableData = createServerFn({ method: 'GET' })
  .inputValidator(
    (payload: {
      table: string
      page: number
      pageSize: number
      query: string
      filterColumn: string
      filterValue: string
    }) => payload,
  )
  .handler(async ({ data }) => {
    try {
      return await getBackendTableDetails(data.table, {
        page: data.page,
        pageSize: data.pageSize,
        query: data.query,
        filterColumn: data.filterColumn,
        filterValue: data.filterValue,
      })
    } catch {
      throw notFound()
    }
  })

const parseSearchNumber = (value: unknown, fallback: number) => {
  if (typeof value !== 'string') return fallback

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback

  return parsed
}

function getRelatedLinks(table: string, row: Record<string, string>) {
  if (table === 'seasons' && row.id) {
    return [
      {
        label: 'instruments',
        table: 'instruments',
        filterColumn: 'season_id',
        filterValue: row.id,
      },
      {
        label: 'leagues',
        table: 'leagues',
        filterColumn: 'season_id',
        filterValue: row.id,
      },
    ]
  }

  if (table === 'leagues' && row.id) {
    return [
      {
        label: 'teams',
        table: 'teams',
        filterColumn: 'league_id',
        filterValue: row.id,
      },
    ]
  }

  if (table === 'teams' && row.id) {
    return [
      {
        label: 'roster_moves',
        table: 'roster_moves',
        filterColumn: 'team_id',
        filterValue: row.id,
      },
      {
        label: 'team_day_scores',
        table: 'team_day_scores',
        filterColumn: 'team_id',
        filterValue: row.id,
      },
      {
        label: 'waiver_claims',
        table: 'waiver_claims',
        filterColumn: 'team_id',
        filterValue: row.id,
      },
    ]
  }

  if ((table === 'roster_moves' || table === 'waiver_claims') && row.team_id) {
    return [
      {
        label: 'team',
        table: 'teams',
        filterColumn: 'id',
        filterValue: row.team_id,
      },
    ]
  }

  if (table === 'instruments' && row.season_id) {
    return [
      {
        label: 'season',
        table: 'seasons',
        filterColumn: 'id',
        filterValue: row.season_id,
      },
    ]
  }

  return []
}

export const Route = createFileRoute('/backend/$table')({
  validateSearch: (search): BackendTableSearch => ({
    page: parseSearchNumber(search.page, 1),
    pageSize: parseSearchNumber(search.pageSize, 50),
    query: typeof search.query === 'string' ? search.query : '',
    filterColumn:
      typeof search.filterColumn === 'string' ? search.filterColumn : '',
    filterValue:
      typeof search.filterValue === 'string' ? search.filterValue : '',
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) =>
    getTableData({
      data: {
        table: params.table,
        page: deps.page,
        pageSize: deps.pageSize,
        query: deps.query,
        filterColumn: deps.filterColumn,
        filterValue: deps.filterValue,
      },
    }),
  component: BackendTablePage,
})

function BackendTablePage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <main className="p-6">
      <p>
        <Link to="/backend">Back to backend index</Link>
      </p>

      <h1>Table: {data.name}</h1>
      <p>Total rows: {data.rowCount}</p>
      <p>
        Filtered rows: {data.filteredRowCount} | Page {data.page} of{' '}
        {data.totalPages} | Page size: {data.pageSize}
      </p>

      <h2>Filters</h2>
      <form method="get">
        <p>
          <label>
            Text search{' '}
            <input type="text" name="query" defaultValue={search.query} />
          </label>
        </p>
        <p>
          <label>
            Filter column{' '}
            <select name="filterColumn" defaultValue={search.filterColumn}>
              <option value="">(none)</option>
              {data.columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <label>
            Filter value{' '}
            <input
              type="text"
              name="filterValue"
              defaultValue={search.filterValue}
            />
          </label>
        </p>
        <p>
          <label>
            Page size{' '}
            <input
              type="number"
              min={1}
              max={200}
              name="pageSize"
              defaultValue={search.pageSize}
            />
          </label>
        </p>
        <input type="hidden" name="page" value="1" />
        <button type="submit">Apply filters</button>{' '}
        <Link
          to="/backend/$table"
          params={{ table: data.name }}
          search={{
            page: 1,
            pageSize: 50,
            query: '',
            filterColumn: '',
            filterValue: '',
          }}
        >
          Reset
        </Link>
      </form>

      <h2>Pagination</h2>
      <p>
        {data.page > 1 ? (
          <>
            <Link
              to="/backend/$table"
              params={{ table: data.name }}
              search={{ ...search, page: data.page - 1 }}
            >
              Previous
            </Link>{' '}
          </>
        ) : null}
        {data.page < data.totalPages ? (
          <>
            <Link
              to="/backend/$table"
              params={{ table: data.name }}
              search={{ ...search, page: data.page + 1 }}
            >
              Next
            </Link>
          </>
        ) : null}
      </p>

      <h2>Columns</h2>
      <ul>
        {data.columns.map((column) => (
          <li key={column}>{column}</li>
        ))}
      </ul>

      <h2>Rows</h2>
      {data.rows.length === 0 ? (
        <p>No rows found.</p>
      ) : (
        <table border={1} cellPadding={6} cellSpacing={0}>
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              <th>Related</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={`${data.name}-${rowIndex}`}>
                {data.columns.map((column) => (
                  <td key={`${rowIndex}-${column}`}>{row[column] ?? ''}</td>
                ))}
                <td>
                  {getRelatedLinks(data.name, row).map((link, linkIndex) => (
                    <span key={`${data.name}-${rowIndex}-${linkIndex}`}>
                      <Link
                        to="/backend/$table"
                        params={{ table: link.table }}
                        search={{
                          page: 1,
                          pageSize: 50,
                          query: '',
                          filterColumn: link.filterColumn,
                          filterValue: link.filterValue,
                        }}
                      >
                        {link.label}
                      </Link>{' '}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
