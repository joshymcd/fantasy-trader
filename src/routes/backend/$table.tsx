import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
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
  const [filterColumn, setFilterColumn] = useState(
    search.filterColumn || '__none',
  )

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 bg-background p-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" asChild>
          <Link to="/backend">
            <ArrowLeft className="mr-2 size-4" />
            Back to backend
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{data.rowCount} total rows</Badge>
          <Badge variant="outline">{data.filteredRowCount} filtered</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Table: {data.name}</CardTitle>
          <CardDescription>
            Page {data.page} of {data.totalPages} - page size {data.pageSize}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="query">Text search</Label>
              <Input id="query" name="query" defaultValue={search.query} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filterValue">Filter value</Label>
              <Input
                id="filterValue"
                name="filterValue"
                defaultValue={search.filterValue}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pageSize">Page size</Label>
              <Input
                id="pageSize"
                type="number"
                min={1}
                max={200}
                name="pageSize"
                defaultValue={search.pageSize}
              />
            </div>

            <div className="space-y-2">
              <Label>Filter column</Label>
              <Select value={filterColumn} onValueChange={setFilterColumn}>
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(none)</SelectItem>
                  {data.columns.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <input type="hidden" name="page" value="1" />
            <input
              type="hidden"
              name="filterColumn"
              value={filterColumn === '__none' ? '' : filterColumn}
            />

            <div className="flex items-end gap-2 md:col-span-3">
              <Button type="submit">Apply filters</Button>
              <Button variant="outline" asChild>
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
              </Button>
            </div>
          </form>

          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {data.columns.map((column) => (
                <Badge key={column} variant="outline">
                  {column}
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                asChild={data.page > 1}
              >
                {data.page > 1 ? (
                  <Link
                    to="/backend/$table"
                    params={{ table: data.name }}
                    search={{ ...search, page: data.page - 1 }}
                  >
                    <ArrowLeft className="mr-1 size-4" /> Previous
                  </Link>
                ) : (
                  <span>
                    <ArrowLeft className="mr-1 inline size-4" /> Previous
                  </span>
                )}
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= data.totalPages}
                asChild={data.page < data.totalPages}
              >
                {data.page < data.totalPages ? (
                  <Link
                    to="/backend/$table"
                    params={{ table: data.name }}
                    search={{ ...search, page: data.page + 1 }}
                  >
                    Next <ArrowRight className="ml-1 size-4" />
                  </Link>
                ) : (
                  <span>
                    Next <ArrowRight className="ml-1 inline size-4" />
                  </span>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rows</CardTitle>
        </CardHeader>
        <CardContent>
          {data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {data.columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                    <TableHead>Related</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, rowIndex) => (
                    <TableRow key={`${data.name}-${rowIndex}`}>
                      {data.columns.map((column) => (
                        <TableCell
                          key={`${rowIndex}-${column}`}
                          className="max-w-[220px] truncate"
                        >
                          {row[column] ?? ''}
                        </TableCell>
                      ))}
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {getRelatedLinks(data.name, row).map(
                            (link, linkIndex) => (
                              <Button
                                key={`${data.name}-${rowIndex}-${linkIndex}`}
                                asChild
                                size="sm"
                                variant="secondary"
                              >
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
                                </Link>
                              </Button>
                            ),
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
