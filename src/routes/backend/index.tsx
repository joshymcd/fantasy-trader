import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import {
  getBackendTableOverview,
  type TableOverview,
} from '../../lib/backend/debug'

const getTables = createServerFn({ method: 'GET' }).handler(async () => {
  const tables = await getBackendTableOverview()

  return {
    generatedAt: new Date().toISOString(),
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
  }
})

export const Route = createFileRoute('/backend/')({
  loader: async () =>
    (await getTables()) as {
      generatedAt: string
      totalRows: number
      tables: TableOverview[]
    },
  component: BackendIndexPage,
})

function BackendIndexPage() {
  const data = Route.useLoaderData() as {
    generatedAt: string
    totalRows: number
    tables: TableOverview[]
  }
  const tables = data.tables

  return (
    <main className="p-6">
      <h1>Backend Debug Console</h1>
      <p>Basic read-only views of database tables for development debugging.</p>
      <p>Snapshot generated at: {data.generatedAt}</p>
      <p>Total rows across tracked tables: {data.totalRows}</p>

      <h2>Tables</h2>
      <ul>
        {tables.map((table) => (
          <li key={table.name}>
            <Link
              to="/backend/$table"
              params={{ table: table.name }}
              search={{
                page: 1,
                pageSize: 50,
                query: '',
                filterColumn: '',
                filterValue: '',
              }}
            >
              {table.name}
            </Link>{' '}
            ({table.rowCount} rows)
          </li>
        ))}
      </ul>
    </main>
  )
}
