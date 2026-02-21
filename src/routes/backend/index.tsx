import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { count, desc, eq } from 'drizzle-orm'

import {
  getBackendSystemStats,
  getBackendTableOverview,
} from '../../lib/backend/debug'
import { db } from '../../db/index'
import { instruments, leagues, seasons, teams } from '../../db/schema'
import { populateCalendar } from '../../lib/game/calendar'
import { getHoldingsAtDate, validateRoster } from '../../lib/game/holdings'
import { ensurePricesForInstrumentUniverse } from '../../lib/game/market-data'
import { createLeague, createTeam, listLeagues } from '../../lib/game/league'
import {
  activateSeason,
  createSeason,
  listSeasons,
  populateSeasonInstruments,
} from '../../lib/game/season'
import {
  calculateTeamDay,
  calculateTeamRange,
  getOrCalculateScore,
  invalidateScores,
} from '../../lib/game/scoring'

const parseIsoDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date')
  }

  return parsed
}

const getTables = createServerFn({ method: 'GET' }).handler(async () => {
  const tables = await getBackendTableOverview()
  const systemStats = await getBackendSystemStats()
  const seasonRows = await listSeasons()
  const instrumentCounts = await db
    .select({ seasonId: instruments.seasonId, instrumentCount: count() })
    .from(instruments)
    .groupBy(instruments.seasonId)

  const instrumentCountBySeason = new Map(
    instrumentCounts.map((row) => [row.seasonId, Number(row.instrumentCount)]),
  )

  const teamRows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      leagueId: leagues.id,
      leagueName: leagues.name,
    })
    .from(teams)
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .orderBy(desc(teams.createdAt))

  const leagueRows = await listLeagues()

  return {
    generatedAt: new Date().toISOString(),
    systemStats,
    seasons: seasonRows.map((season) => ({
      ...season,
      instrumentCount: instrumentCountBySeason.get(season.id) ?? 0,
    })),
    leagues: leagueRows,
    tables,
    teams: teamRows,
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

const runCreateSeason = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: {
      name: string
      market: string
      startDate: string
      endDate: string
      tradeDeadlineDate: string
      budget: number
    }) => payload,
  )
  .handler(async ({ data }) => {
    if (!data.name.trim()) {
      throw new Error('Season name is required')
    }

    const season = await createSeason({
      name: data.name.trim(),
      market: data.market.trim() || 'LSE',
      startDate: parseIsoDate(data.startDate),
      endDate: parseIsoDate(data.endDate),
      tradeDeadlineDate: parseIsoDate(data.tradeDeadlineDate),
      budget: data.budget,
    })

    return season
  })

const runPopulateSeasonInstruments = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: { seasonId: string; symbolsCsv: string; symbolLimit: number }) =>
      payload,
  )
  .handler(async ({ data }) => {
    if (!data.seasonId) {
      throw new Error('Season is required')
    }

    return populateSeasonInstruments({
      seasonId: data.seasonId,
      symbolsCsv: data.symbolsCsv,
      symbolLimit: data.symbolLimit,
    })
  })

const runActivateSeason = createServerFn({ method: 'POST' })
  .inputValidator((payload: { seasonId: string }) => payload)
  .handler(async ({ data }) => {
    if (!data.seasonId) {
      throw new Error('Season is required')
    }

    return activateSeason(data.seasonId)
  })

const runCreateLeague = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: {
      seasonId: string
      name: string
      ownershipMode: 'UNIQUE' | 'DUPLICATES'
      creatorId: string
    }) => payload,
  )
  .handler(async ({ data }) => {
    if (!data.name.trim()) {
      throw new Error('League name is required')
    }

    if (!data.creatorId.trim()) {
      throw new Error('Creator user id is required')
    }

    return createLeague({
      seasonId: data.seasonId,
      name: data.name,
      ownershipMode: data.ownershipMode,
      creatorId: data.creatorId,
    })
  })

const runCreateTeam = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: { leagueId: string; userId: string; name: string }) => payload,
  )
  .handler(async ({ data }) => {
    if (!data.userId.trim()) {
      throw new Error('User id is required')
    }

    if (!data.name.trim()) {
      throw new Error('Team name is required')
    }

    return createTeam({
      leagueId: data.leagueId,
      userId: data.userId,
      name: data.name,
    })
  })

const runCalculateDayScore = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: { teamId: string; date: string; forceRecalculate: boolean }) =>
      payload,
  )
  .handler(async ({ data }) => {
    const date = parseIsoDate(data.date)
    const result = await getOrCalculateScore(data.teamId, date, {
      forceRecalculate: data.forceRecalculate,
    })

    return {
      date: data.date,
      teamId: data.teamId,
      points: result.points,
      isTradingDay: result.isTradingDay,
      missingSymbols: result.missingSymbols,
    }
  })

const runCalculateRangeScores = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: {
      teamId: string
      startDate: string
      endDate: string
      forceRecalculate: boolean
    }) => payload,
  )
  .handler(async ({ data }) => {
    const startDate = parseIsoDate(data.startDate)
    const endDate = parseIsoDate(data.endDate)

    if (startDate > endDate) {
      throw new Error('Start date must be on or before end date')
    }

    const results = await calculateTeamRange(data.teamId, startDate, endDate, {
      forceRecalculate: data.forceRecalculate,
    })

    return {
      teamId: data.teamId,
      startDate: data.startDate,
      endDate: data.endDate,
      daysCalculated: results.length,
      totalPoints: results.reduce((sum, row) => sum + row.points, 0),
    }
  })

const runInvalidateScoreCache = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: { teamId: string; fromDate: string; toDate: string }) => payload,
  )
  .handler(async ({ data }) => {
    const fromDate = parseIsoDate(data.fromDate)
    const toDate = parseIsoDate(data.toDate)

    if (fromDate > toDate) {
      throw new Error('From date must be on or before to date')
    }

    await invalidateScores({
      teamId: data.teamId,
      fromDate,
      toDate,
    })

    return {
      teamId: data.teamId,
      fromDate: data.fromDate,
      toDate: data.toDate,
      success: true,
    }
  })

const runTeamDebugSnapshot = createServerFn({ method: 'POST' })
  .inputValidator((payload: { teamId: string; date: string }) => payload)
  .handler(async ({ data }) => {
    const date = parseIsoDate(data.date)

    const budgetRows = await db
      .select({ budget: seasons.budget })
      .from(teams)
      .innerJoin(leagues, eq(teams.leagueId, leagues.id))
      .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
      .where(eq(teams.id, data.teamId))
      .limit(1)

    const budget = budgetRows[0]?.budget
    if (budget === undefined) {
      throw new Error('Team not found')
    }

    const holdings = await getHoldingsAtDate(data.teamId, date)
    const rosterValidation = validateRoster(holdings, budget)
    const dayScore = await calculateTeamDay(data.teamId, date)

    return {
      teamId: data.teamId,
      date: data.date,
      budget,
      holdings,
      rosterValidation,
      dayScore,
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
  const [seasonName, setSeasonName] = useState('UK Season')
  const [seasonMarket, setSeasonMarket] = useState('LSE')
  const [seasonStartDate, setSeasonStartDate] = useState(defaultTargetDate)
  const [seasonEndDate, setSeasonEndDate] = useState(defaultTargetDate)
  const [seasonTradeDeadlineDate, setSeasonTradeDeadlineDate] =
    useState(defaultTargetDate)
  const [seasonBudget, setSeasonBudget] = useState('100')
  const [seasonActionSeasonId, setSeasonActionSeasonId] = useState('')
  const [seasonSymbolsCsv, setSeasonSymbolsCsv] = useState('')
  const [seasonSymbolLimit, setSeasonSymbolLimit] = useState('200')
  const [calendarStatus, setCalendarStatus] = useState('')
  const [priceStatus, setPriceStatus] = useState('')
  const [seasonCreateStatus, setSeasonCreateStatus] = useState('')
  const [seasonPopulateStatus, setSeasonPopulateStatus] = useState('')
  const [seasonActivateStatus, setSeasonActivateStatus] = useState('')
  const [leagueName, setLeagueName] = useState('My League')
  const [leagueCreatorId, setLeagueCreatorId] = useState('dev-user-1')
  const [leagueOwnershipMode, setLeagueOwnershipMode] = useState<
    'UNIQUE' | 'DUPLICATES'
  >('UNIQUE')
  const [leagueSeasonId, setLeagueSeasonId] = useState('')
  const [leagueCreateStatus, setLeagueCreateStatus] = useState('')
  const [teamLeagueId, setTeamLeagueId] = useState('')
  const [teamUserId, setTeamUserId] = useState('dev-user-1')
  const [teamName, setTeamName] = useState('My Team')
  const [teamCreateStatus, setTeamCreateStatus] = useState('')
  const [scoreStatus, setScoreStatus] = useState('')
  const [rangeStatus, setRangeStatus] = useState('')
  const [invalidateStatus, setInvalidateStatus] = useState('')
  const [debugStatus, setDebugStatus] = useState('')
  const [isCalendarLoading, setIsCalendarLoading] = useState(false)
  const [isPriceLoading, setIsPriceLoading] = useState(false)
  const [isSeasonCreateLoading, setIsSeasonCreateLoading] = useState(false)
  const [isSeasonPopulateLoading, setIsSeasonPopulateLoading] = useState(false)
  const [isSeasonActivateLoading, setIsSeasonActivateLoading] = useState(false)
  const [isLeagueCreateLoading, setIsLeagueCreateLoading] = useState(false)
  const [isTeamCreateLoading, setIsTeamCreateLoading] = useState(false)
  const [isScoreLoading, setIsScoreLoading] = useState(false)
  const [isRangeLoading, setIsRangeLoading] = useState(false)
  const [isInvalidateLoading, setIsInvalidateLoading] = useState(false)
  const [isDebugLoading, setIsDebugLoading] = useState(false)

  const data = Route.useLoaderData()

  const tables = data.tables
  const teamOptions = data.teams
  const seasonOptions = data.seasons
  const leagueOptions = data.leagues
  const defaultTeamId = teamOptions[0]?.teamId ?? ''
  const defaultSeasonId = seasonOptions[0]?.id ?? ''
  const defaultLeagueId = leagueOptions[0]?.id ?? ''

  useEffect(() => {
    if (!seasonActionSeasonId && defaultSeasonId) {
      setSeasonActionSeasonId(defaultSeasonId)
    }
  }, [seasonActionSeasonId, defaultSeasonId])

  useEffect(() => {
    if (!leagueSeasonId && defaultSeasonId) {
      setLeagueSeasonId(defaultSeasonId)
    }
  }, [leagueSeasonId, defaultSeasonId])

  useEffect(() => {
    if (!teamLeagueId && defaultLeagueId) {
      setTeamLeagueId(defaultLeagueId)
    }
  }, [teamLeagueId, defaultLeagueId])

  const [selectedTeamId, setSelectedTeamId] = useState(defaultTeamId)
  const [scoreDate, setScoreDate] = useState(defaultTargetDate)
  const [rangeStartDate, setRangeStartDate] = useState(defaultTargetDate)
  const [rangeEndDate, setRangeEndDate] = useState(defaultTargetDate)
  const [invalidateFromDate, setInvalidateFromDate] =
    useState(defaultTargetDate)
  const [invalidateToDate, setInvalidateToDate] = useState(defaultTargetDate)
  const [debugDate, setDebugDate] = useState(defaultTargetDate)
  const [forceRecalculateDay, setForceRecalculateDay] = useState(true)
  const [forceRecalculateRange, setForceRecalculateRange] = useState(true)
  const [debugSnapshot, setDebugSnapshot] = useState<{
    teamId: string
    date: string
    budget: number
    holdings: Array<{
      symbol: string
      addedDate: Date
      tier: number
      tierCost: number
    }>
    rosterValidation: {
      isValid: boolean
      errors: string[]
      holdingCount: number
      totalCost: number
      tierCounts: Record<string, number>
    }
    dayScore: {
      points: number
      breakdown: Record<string, number>
      missingSymbols: string[]
      isTradingDay: boolean
    }
  } | null>(null)

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

  const handleCreateSeason = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    const budget = Number.parseInt(seasonBudget, 10)
    if (Number.isNaN(budget)) {
      setSeasonCreateStatus('Create season error: budget must be a number')
      return
    }

    setIsSeasonCreateLoading(true)
    setSeasonCreateStatus('Running...')

    try {
      const result = await runCreateSeason({
        data: {
          name: seasonName,
          market: seasonMarket,
          startDate: seasonStartDate,
          endDate: seasonEndDate,
          tradeDeadlineDate: seasonTradeDeadlineDate,
          budget,
        },
      })

      setSeasonCreateStatus(
        `Season created: ${result.name} (${result.id}) status ${result.status}`,
      )
      setSeasonActionSeasonId(result.id)
      await router.invalidate()
    } catch (error) {
      setSeasonCreateStatus(
        `Create season error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsSeasonCreateLoading(false)
    }
  }

  const handlePopulateSeason = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!seasonActionSeasonId) {
      setSeasonPopulateStatus('Populate error: select a season first')
      return
    }

    const symbolLimit = Number.parseInt(seasonSymbolLimit, 10)
    if (Number.isNaN(symbolLimit)) {
      setSeasonPopulateStatus('Populate error: symbol limit must be a number')
      return
    }

    setIsSeasonPopulateLoading(true)
    setSeasonPopulateStatus('Running...')

    try {
      const result = await runPopulateSeasonInstruments({
        data: {
          seasonId: seasonActionSeasonId,
          symbolsCsv: seasonSymbolsCsv,
          symbolLimit,
        },
      })

      setSeasonPopulateStatus(
        `Instruments populated: ${result.insertedInstruments} rows (requested ${result.requestedSymbols})`,
      )
      await router.invalidate()
    } catch (error) {
      setSeasonPopulateStatus(
        `Populate error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsSeasonPopulateLoading(false)
    }
  }

  const handleActivateSeason = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!seasonActionSeasonId) {
      setSeasonActivateStatus('Activate error: select a season first')
      return
    }

    setIsSeasonActivateLoading(true)
    setSeasonActivateStatus('Running...')

    try {
      const result = await runActivateSeason({
        data: { seasonId: seasonActionSeasonId },
      })
      setSeasonActivateStatus(
        `Season activated: ${result.id} status ${result.status}`,
      )
      await router.invalidate()
    } catch (error) {
      setSeasonActivateStatus(
        `Activate error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsSeasonActivateLoading(false)
    }
  }

  const handleCreateLeague = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!leagueSeasonId) {
      setLeagueCreateStatus('Create league error: select a season first')
      return
    }

    setIsLeagueCreateLoading(true)
    setLeagueCreateStatus('Running...')

    try {
      const result = await runCreateLeague({
        data: {
          seasonId: leagueSeasonId,
          name: leagueName,
          ownershipMode: leagueOwnershipMode,
          creatorId: leagueCreatorId,
        },
      })

      setLeagueCreateStatus(
        `League created: ${result.name} (${result.id}) status ${result.status}`,
      )
      setTeamLeagueId(result.id)
      await router.invalidate()
    } catch (error) {
      setLeagueCreateStatus(
        `Create league error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsLeagueCreateLoading(false)
    }
  }

  const handleCreateTeam = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!teamLeagueId) {
      setTeamCreateStatus('Create team error: select a league first')
      return
    }

    setIsTeamCreateLoading(true)
    setTeamCreateStatus('Running...')

    try {
      const result = await runCreateTeam({
        data: {
          leagueId: teamLeagueId,
          userId: teamUserId,
          name: teamName,
        },
      })

      setTeamCreateStatus(
        `Team created: ${result.name} (${result.id}) for user ${result.userId}`,
      )
      await router.invalidate()
    } catch (error) {
      setTeamCreateStatus(
        `Create team error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsTeamCreateLoading(false)
    }
  }

  const handleCalculateDayScore = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!selectedTeamId) {
      setScoreStatus('Score error: select a team first')
      return
    }

    setIsScoreLoading(true)
    setScoreStatus('Running...')

    try {
      const result = await runCalculateDayScore({
        data: {
          teamId: selectedTeamId,
          date: scoreDate,
          forceRecalculate: forceRecalculateDay,
        },
      })

      setScoreStatus(
        `Team ${result.teamId} score on ${result.date}: ${result.points} (trading day: ${result.isTradingDay}, missing symbols: ${result.missingSymbols.length})`,
      )
      await router.invalidate()
    } catch (error) {
      setScoreStatus(
        `Score error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsScoreLoading(false)
    }
  }

  const handleCalculateRangeScores = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!selectedTeamId) {
      setRangeStatus('Range error: select a team first')
      return
    }

    setIsRangeLoading(true)
    setRangeStatus('Running...')

    try {
      const result = await runCalculateRangeScores({
        data: {
          teamId: selectedTeamId,
          startDate: rangeStartDate,
          endDate: rangeEndDate,
          forceRecalculate: forceRecalculateRange,
        },
      })

      setRangeStatus(
        `Range complete for team ${result.teamId}: ${result.daysCalculated} trading days, total points ${result.totalPoints.toFixed(4)}`,
      )
      await router.invalidate()
    } catch (error) {
      setRangeStatus(
        `Range error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsRangeLoading(false)
    }
  }

  const handleInvalidateScores = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!selectedTeamId) {
      setInvalidateStatus('Invalidate error: select a team first')
      return
    }

    setIsInvalidateLoading(true)
    setInvalidateStatus('Running...')

    try {
      const result = await runInvalidateScoreCache({
        data: {
          teamId: selectedTeamId,
          fromDate: invalidateFromDate,
          toDate: invalidateToDate,
        },
      })

      setInvalidateStatus(
        `Cache invalidated for team ${result.teamId} from ${result.fromDate} to ${result.toDate}`,
      )
      await router.invalidate()
    } catch (error) {
      setInvalidateStatus(
        `Invalidate error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsInvalidateLoading(false)
    }
  }

  const handleRunDebugSnapshot = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!selectedTeamId) {
      setDebugStatus('Debug error: select a team first')
      return
    }

    setIsDebugLoading(true)
    setDebugStatus('Running...')

    try {
      const result = await runTeamDebugSnapshot({
        data: {
          teamId: selectedTeamId,
          date: debugDate,
        },
      })

      setDebugSnapshot(result)
      setDebugStatus(
        `Debug snapshot ready for team ${result.teamId} on ${result.date}`,
      )
    } catch (error) {
      setDebugStatus(
        `Debug error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
      setDebugSnapshot(null)
    } finally {
      setIsDebugLoading(false)
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

      <section>
        <h3>Season tools</h3>

        <h4>Create season</h4>
        <form onSubmit={handleCreateSeason}>
          <p>
            <label>
              Name{' '}
              <input
                type="text"
                value={seasonName}
                onChange={(event) => setSeasonName(event.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              Market{' '}
              <input
                type="text"
                value={seasonMarket}
                onChange={(event) => setSeasonMarket(event.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              Start date{' '}
              <input
                type="date"
                value={seasonStartDate}
                onChange={(event) => setSeasonStartDate(event.target.value)}
              />
            </label>{' '}
            <label>
              End date{' '}
              <input
                type="date"
                value={seasonEndDate}
                onChange={(event) => setSeasonEndDate(event.target.value)}
              />
            </label>{' '}
            <label>
              Trade deadline{' '}
              <input
                type="date"
                value={seasonTradeDeadlineDate}
                onChange={(event) =>
                  setSeasonTradeDeadlineDate(event.target.value)
                }
              />
            </label>
          </p>
          <p>
            <label>
              Budget{' '}
              <input
                type="number"
                min={1}
                value={seasonBudget}
                onChange={(event) => setSeasonBudget(event.target.value)}
              />
            </label>
          </p>
          <button type="submit" disabled={isSeasonCreateLoading}>
            {isSeasonCreateLoading ? 'Running...' : 'Create season'}
          </button>
          <p>{seasonCreateStatus}</p>
        </form>

        <h4>Populate and activate season</h4>
        {seasonOptions.length === 0 ? (
          <p>No seasons found. Create one first.</p>
        ) : (
          <>
            <p>
              <label>
                Season{' '}
                <select
                  value={seasonActionSeasonId}
                  onChange={(event) =>
                    setSeasonActionSeasonId(event.target.value)
                  }
                >
                  {seasonOptions.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name} ({season.status}) instruments:{' '}
                      {season.instrumentCount}
                    </option>
                  ))}
                </select>
              </label>
            </p>

            <form onSubmit={handlePopulateSeason}>
              <p>
                <label>
                  Symbol limit{' '}
                  <input
                    type="number"
                    min={5}
                    max={500}
                    value={seasonSymbolLimit}
                    onChange={(event) =>
                      setSeasonSymbolLimit(event.target.value)
                    }
                  />
                </label>
              </p>
              <p>
                <label>
                  Symbols CSV (optional, defaults to built-in UK set){' '}
                  <textarea
                    value={seasonSymbolsCsv}
                    onChange={(event) =>
                      setSeasonSymbolsCsv(event.target.value)
                    }
                    rows={3}
                    cols={80}
                  />
                </label>
              </p>
              <button type="submit" disabled={isSeasonPopulateLoading}>
                {isSeasonPopulateLoading
                  ? 'Running...'
                  : 'Populate instruments'}
              </button>
              <p>{seasonPopulateStatus}</p>
            </form>

            <form onSubmit={handleActivateSeason}>
              <button type="submit" disabled={isSeasonActivateLoading}>
                {isSeasonActivateLoading ? 'Running...' : 'Activate season'}
              </button>
              <p>{seasonActivateStatus}</p>
            </form>
          </>
        )}

        <h4>Season summary</h4>
        {seasonOptions.length === 0 ? (
          <p>No seasons to display.</p>
        ) : (
          <table border={1} cellPadding={6} cellSpacing={0}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Market</th>
                <th>Start</th>
                <th>End</th>
                <th>Trade Deadline</th>
                <th>Budget</th>
                <th>Instruments</th>
              </tr>
            </thead>
            <tbody>
              {seasonOptions.map((season) => (
                <tr key={season.id}>
                  <td>{season.name}</td>
                  <td>{season.status}</td>
                  <td>{season.market}</td>
                  <td>
                    {new Date(season.startDate).toISOString().slice(0, 10)}
                  </td>
                  <td>{new Date(season.endDate).toISOString().slice(0, 10)}</td>
                  <td>
                    {new Date(season.tradeDeadlineDate)
                      .toISOString()
                      .slice(0, 10)}
                  </td>
                  <td>{season.budget}</td>
                  <td>{season.instrumentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>League and team tools</h3>

        <h4>Create league</h4>
        {seasonOptions.length === 0 ? (
          <p>Create a season first.</p>
        ) : (
          <form onSubmit={handleCreateLeague}>
            <p>
              <label>
                Season{' '}
                <select
                  value={leagueSeasonId}
                  onChange={(event) => setLeagueSeasonId(event.target.value)}
                >
                  {seasonOptions.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name} ({season.status})
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              <label>
                League name{' '}
                <input
                  type="text"
                  value={leagueName}
                  onChange={(event) => setLeagueName(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Creator user id{' '}
                <input
                  type="text"
                  value={leagueCreatorId}
                  onChange={(event) => setLeagueCreatorId(event.target.value)}
                />
              </label>{' '}
              <label>
                Ownership mode{' '}
                <select
                  value={leagueOwnershipMode}
                  onChange={(event) =>
                    setLeagueOwnershipMode(
                      event.target.value as 'UNIQUE' | 'DUPLICATES',
                    )
                  }
                >
                  <option value="UNIQUE">UNIQUE</option>
                  <option value="DUPLICATES">DUPLICATES</option>
                </select>
              </label>
            </p>
            <button type="submit" disabled={isLeagueCreateLoading}>
              {isLeagueCreateLoading ? 'Running...' : 'Create league'}
            </button>
            <p>{leagueCreateStatus}</p>
          </form>
        )}

        <h4>Create team</h4>
        {leagueOptions.length === 0 ? (
          <p>Create a league first.</p>
        ) : (
          <form onSubmit={handleCreateTeam}>
            <p>
              <label>
                League{' '}
                <select
                  value={teamLeagueId}
                  onChange={(event) => setTeamLeagueId(event.target.value)}
                >
                  {leagueOptions.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.name} ({league.ownershipMode}) teams:{' '}
                      {league.teamCount}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              <label>
                User id{' '}
                <input
                  type="text"
                  value={teamUserId}
                  onChange={(event) => setTeamUserId(event.target.value)}
                />
              </label>{' '}
              <label>
                Team name{' '}
                <input
                  type="text"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                />
              </label>
            </p>
            <button type="submit" disabled={isTeamCreateLoading}>
              {isTeamCreateLoading ? 'Running...' : 'Create team'}
            </button>
            <p>{teamCreateStatus}</p>
          </form>
        )}

        <h4>League summary</h4>
        {leagueOptions.length === 0 ? (
          <p>No leagues to display.</p>
        ) : (
          <table border={1} cellPadding={6} cellSpacing={0}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Season</th>
                <th>Ownership</th>
                <th>Creator</th>
                <th>Teams</th>
              </tr>
            </thead>
            <tbody>
              {leagueOptions.map((league) => (
                <tr key={league.id}>
                  <td>{league.name}</td>
                  <td>{league.status}</td>
                  <td>{league.seasonName}</td>
                  <td>{league.ownershipMode}</td>
                  <td>{league.creatorId}</td>
                  <td>{league.teamCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Scoring tools</h3>
        {teamOptions.length === 0 ? (
          <p>No teams found yet. Create a league and team first.</p>
        ) : (
          <>
            <p>
              <label>
                Team{' '}
                <select
                  value={selectedTeamId}
                  onChange={(event) => setSelectedTeamId(event.target.value)}
                >
                  {teamOptions.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.teamName} ({team.teamId}) - {team.leagueName}
                    </option>
                  ))}
                </select>
              </label>
            </p>

            <form onSubmit={handleCalculateDayScore}>
              <h4>Calculate one day</h4>
              <label>
                Date{' '}
                <input
                  type="date"
                  value={scoreDate}
                  onChange={(event) => setScoreDate(event.target.value)}
                />
              </label>{' '}
              <label>
                <input
                  type="checkbox"
                  checked={forceRecalculateDay}
                  onChange={(event) =>
                    setForceRecalculateDay(event.target.checked)
                  }
                />{' '}
                Force recalculate
              </label>{' '}
              <button type="submit" disabled={isScoreLoading}>
                {isScoreLoading ? 'Running...' : 'Calculate day score'}
              </button>
              <p>{scoreStatus}</p>
            </form>

            <form onSubmit={handleCalculateRangeScores}>
              <h4>Backfill range (trading days only)</h4>
              <label>
                Start date{' '}
                <input
                  type="date"
                  value={rangeStartDate}
                  onChange={(event) => setRangeStartDate(event.target.value)}
                />
              </label>{' '}
              <label>
                End date{' '}
                <input
                  type="date"
                  value={rangeEndDate}
                  onChange={(event) => setRangeEndDate(event.target.value)}
                />
              </label>{' '}
              <label>
                <input
                  type="checkbox"
                  checked={forceRecalculateRange}
                  onChange={(event) =>
                    setForceRecalculateRange(event.target.checked)
                  }
                />{' '}
                Force recalculate
              </label>{' '}
              <button type="submit" disabled={isRangeLoading}>
                {isRangeLoading ? 'Running...' : 'Backfill range'}
              </button>
              <p>{rangeStatus}</p>
            </form>

            <form onSubmit={handleInvalidateScores}>
              <h4>Invalidate cached scores</h4>
              <label>
                From date{' '}
                <input
                  type="date"
                  value={invalidateFromDate}
                  onChange={(event) =>
                    setInvalidateFromDate(event.target.value)
                  }
                />
              </label>{' '}
              <label>
                To date{' '}
                <input
                  type="date"
                  value={invalidateToDate}
                  onChange={(event) => setInvalidateToDate(event.target.value)}
                />
              </label>{' '}
              <button type="submit" disabled={isInvalidateLoading}>
                {isInvalidateLoading ? 'Running...' : 'Invalidate cache'}
              </button>
              <p>{invalidateStatus}</p>
            </form>

            <form onSubmit={handleRunDebugSnapshot}>
              <h4>Team debug snapshot</h4>
              <label>
                Snapshot date{' '}
                <input
                  type="date"
                  value={debugDate}
                  onChange={(event) => setDebugDate(event.target.value)}
                />
              </label>{' '}
              <button type="submit" disabled={isDebugLoading}>
                {isDebugLoading ? 'Running...' : 'Generate snapshot'}
              </button>
              <p>{debugStatus}</p>
            </form>

            {debugSnapshot ? (
              <section>
                <h4>Snapshot output</h4>
                <p>
                  Team: {debugSnapshot.teamId} | Date: {debugSnapshot.date} |
                  Budget: {debugSnapshot.budget}
                </p>
                <p>
                  Roster valid: {String(debugSnapshot.rosterValidation.isValid)}{' '}
                  | Holdings: {debugSnapshot.rosterValidation.holdingCount} |
                  Total cost: {debugSnapshot.rosterValidation.totalCost}
                </p>
                <p>
                  Tier counts:{' '}
                  {JSON.stringify(debugSnapshot.rosterValidation.tierCounts)}
                </p>

                {debugSnapshot.rosterValidation.errors.length > 0 ? (
                  <ul>
                    {debugSnapshot.rosterValidation.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : null}

                <h5>Holdings</h5>
                {debugSnapshot.holdings.length === 0 ? (
                  <p>No holdings at this date.</p>
                ) : (
                  <table border={1} cellPadding={6} cellSpacing={0}>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Added Date</th>
                        <th>Tier</th>
                        <th>Tier Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debugSnapshot.holdings.map((holding) => (
                        <tr key={holding.symbol}>
                          <td>{holding.symbol}</td>
                          <td>
                            {new Date(holding.addedDate)
                              .toISOString()
                              .slice(0, 10)}
                          </td>
                          <td>{holding.tier}</td>
                          <td>{holding.tierCost}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <h5>Day score</h5>
                <p>
                  Trading day: {String(debugSnapshot.dayScore.isTradingDay)} |
                  Points: {debugSnapshot.dayScore.points}
                </p>
                <p>
                  Missing symbols:{' '}
                  {debugSnapshot.dayScore.missingSymbols.length > 0
                    ? debugSnapshot.dayScore.missingSymbols.join(', ')
                    : 'none'}
                </p>
                <pre>
                  {JSON.stringify(debugSnapshot.dayScore.breakdown, null, 2)}
                </pre>
              </section>
            ) : null}
          </>
        )}
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
