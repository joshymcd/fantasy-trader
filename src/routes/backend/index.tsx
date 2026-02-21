import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'

import {
  getBackendSystemStats,
  getBackendTableOverview,
} from '../../lib/backend/debug'
import { populateCalendar } from '../../lib/game/calendar'
import { ensurePricesForInstrumentUniverse } from '../../lib/game/market-data'

const getTables = createServerFn({ method: 'GET' }).handler(async () => {
  const tables = await getBackendTableOverview()
  const systemStats = await getBackendSystemStats()

  return {
    generatedAt: new Date().toISOString(),
    systemStats,
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
  }
})

const runPopulateCalendar = createServerFn({ method: 'POST' })
  .inputValidator((payload: { year: number }) => payload)
  .handler(async ({ data }) => {
    return populateCalendar(data.year)
  })

const runSyncPrices = createServerFn({ method: 'POST' })
  .inputValidator((payload: { targetDate: string }) => payload)
  .handler(async ({ data }) => {
    const parsedDate = new Date(`${data.targetDate}T00:00:00.000Z`)
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error('Invalid target date')
    }

    await ensurePricesForInstrumentUniverse(parsedDate)

    return {
      targetDate: data.targetDate,
      success: true,
    }
  })

export const Route = createFileRoute('/backend/')({
  loader: async () => getTables(),
  component: BackendIndexPage,
})

function BackendIndexPage() {
  const router = useRouter()
  const currentYear = new Date().getUTCFullYear()
  const defaultTargetDate = new Date().toISOString().slice(0, 10)

  const [calendarYear, setCalendarYear] = useState(String(currentYear))
  const [priceDate, setPriceDate] = useState(defaultTargetDate)
  const [calendarStatus, setCalendarStatus] = useState('')
  const [priceStatus, setPriceStatus] = useState('')
  const [isCalendarLoading, setIsCalendarLoading] = useState(false)
  const [isPriceLoading, setIsPriceLoading] = useState(false)

  const data = Route.useLoaderData()

  const tables = data.tables

  const handlePopulateCalendar = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    const parsedYear = Number.parseInt(calendarYear, 10)
    if (Number.isNaN(parsedYear)) {
      setCalendarStatus('Calendar error: year must be a number')
      return
    }

    setIsCalendarLoading(true)
    setCalendarStatus('Running...')

    try {
      const result = await runPopulateCalendar({ data: { year: parsedYear } })
      setCalendarStatus(
        `Calendar updated: ${result.tradingDays} trading days across ${result.totalDays} dates for ${result.year}`,
      )
      await router.invalidate()
    } catch (error) {
      setCalendarStatus(
        `Calendar error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsCalendarLoading(false)
    }
  }

  const handleSyncPrices = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setIsPriceLoading(true)
    setPriceStatus('Running...')

    try {
      const result = await runSyncPrices({ data: { targetDate: priceDate } })
      setPriceStatus(`Price sync completed through ${result.targetDate}`)
      await router.invalidate()
    } catch (error) {
      setPriceStatus(
        `Price sync error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsPriceLoading(false)
    }
  }

  return (
    <main className="p-6">
      <h1>Backend Debug Console</h1>
      <p>Basic read-only views of database tables for development debugging.</p>
      <p>Snapshot generated at: {data.generatedAt}</p>
      <p>Total rows across tracked tables: {data.totalRows}</p>

      <h2>System stats</h2>
      <ul>
        <li>Trading days loaded: {data.systemStats.tradingDays}</li>
        <li>Price rows loaded: {data.systemStats.priceRows}</li>
        <li>
          Distinct symbols loaded: {data.systemStats.distinctPriceSymbols}
        </li>
        <li>
          Oldest loaded price date: {data.systemStats.oldestPriceDate ?? 'n/a'}
        </li>
        <li>
          Latest loaded price date: {data.systemStats.latestPriceDate ?? 'n/a'}
        </li>
      </ul>

      <h2>Backend actions</h2>

      <section>
        <h3>Populate trading calendar</h3>
        <form onSubmit={handlePopulateCalendar}>
          <label>
            Year{' '}
            <input
              type="number"
              min={2020}
              max={2100}
              value={calendarYear}
              onChange={(event) => setCalendarYear(event.target.value)}
            />
          </label>{' '}
          <button type="submit" disabled={isCalendarLoading}>
            {isCalendarLoading ? 'Running...' : 'Populate year'}
          </button>
        </form>
        <p>{calendarStatus}</p>
      </section>

      <section>
        <h3>Sync prices for instrument universe</h3>
        <form onSubmit={handleSyncPrices}>
          <label>
            Target date (inclusive){' '}
            <input
              type="date"
              value={priceDate}
              onChange={(event) => setPriceDate(event.target.value)}
            />
          </label>{' '}
          <button type="submit" disabled={isPriceLoading}>
            {isPriceLoading ? 'Running...' : 'Sync prices'}
          </button>
        </form>
        <p>{priceStatus}</p>
      </section>

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
