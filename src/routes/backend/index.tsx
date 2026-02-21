import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { count, desc, eq } from 'drizzle-orm'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Separator } from '../../components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Textarea } from '../../components/ui/textarea'
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
  getAvailableInstruments,
  selectPortfolio,
  validatePortfolio,
} from '../../lib/game/draft'
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

const parseSymbolCsv = (value: string) =>
  value
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

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

const runValidatePortfolioSelection = createServerFn({ method: 'POST' })
  .inputValidator((payload: { teamId: string; symbolsCsv: string }) => payload)
  .handler(async ({ data }) => {
    const symbols = parseSymbolCsv(data.symbolsCsv)

    const contextRows = await db
      .select({ seasonId: leagues.seasonId, leagueId: leagues.id })
      .from(teams)
      .innerJoin(leagues, eq(teams.leagueId, leagues.id))
      .where(eq(teams.id, data.teamId))
      .limit(1)

    const context = contextRows[0]
    if (!context) {
      throw new Error('Team not found')
    }

    return validatePortfolio({
      symbols,
      seasonId: context.seasonId,
      leagueId: context.leagueId,
      teamId: data.teamId,
    })
  })

const runSubmitPortfolioSelection = createServerFn({ method: 'POST' })
  .inputValidator((payload: { teamId: string; symbolsCsv: string }) => payload)
  .handler(async ({ data }) => {
    const symbols = parseSymbolCsv(data.symbolsCsv)

    return selectPortfolio({
      teamId: data.teamId,
      symbols,
    })
  })

const runGetAvailableForLeague = createServerFn({ method: 'GET' })
  .inputValidator((payload: { leagueId: string }) => payload)
  .handler(async ({ data }) => {
    const availableInstruments = await getAvailableInstruments(data.leagueId)

    return {
      leagueId: data.leagueId,
      instrumentCount: availableInstruments.length,
      availableCount: availableInstruments.filter((item) => item.isAvailable)
        .length,
      unavailableCount: availableInstruments.filter((item) => !item.isAvailable)
        .length,
      sample: availableInstruments.slice(0, 50),
    }
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
  const [portfolioTeamId, setPortfolioTeamId] = useState('')
  const [portfolioLeagueId, setPortfolioLeagueId] = useState('')
  const [portfolioSymbolsCsv, setPortfolioSymbolsCsv] = useState('')
  const [portfolioValidateStatus, setPortfolioValidateStatus] = useState('')
  const [portfolioSubmitStatus, setPortfolioSubmitStatus] = useState('')
  const [portfolioAvailableStatus, setPortfolioAvailableStatus] = useState('')
  const [portfolioValidationResult, setPortfolioValidationResult] = useState<{
    isValid: boolean
    errors: string[]
    budget: number
    totalCost: number
    tierCounts: Record<string, number>
  } | null>(null)
  const [portfolioAvailableSample, setPortfolioAvailableSample] = useState<
    Array<{
      symbol: string
      name: string
      tier: number
      tierCost: number
      isAvailable: boolean
      takenByTeamId: string | null
    }>
  >([])
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
  const [isPortfolioValidateLoading, setIsPortfolioValidateLoading] =
    useState(false)
  const [isPortfolioSubmitLoading, setIsPortfolioSubmitLoading] =
    useState(false)
  const [isPortfolioAvailableLoading, setIsPortfolioAvailableLoading] =
    useState(false)
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

  useEffect(() => {
    if (!portfolioTeamId && defaultTeamId) {
      setPortfolioTeamId(defaultTeamId)
    }
  }, [portfolioTeamId, defaultTeamId])

  useEffect(() => {
    if (!portfolioLeagueId && defaultLeagueId) {
      setPortfolioLeagueId(defaultLeagueId)
    }
  }, [portfolioLeagueId, defaultLeagueId])

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

  const handleLoadAvailableForLeague = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!portfolioLeagueId) {
      setPortfolioAvailableStatus('Availability error: select a league first')
      return
    }

    setIsPortfolioAvailableLoading(true)
    setPortfolioAvailableStatus('Running...')

    try {
      const result = await runGetAvailableForLeague({
        data: { leagueId: portfolioLeagueId },
      })

      setPortfolioAvailableSample(result.sample)
      setPortfolioAvailableStatus(
        `Loaded ${result.availableCount} available of ${result.instrumentCount} total instruments`,
      )
    } catch (error) {
      setPortfolioAvailableStatus(
        `Availability error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
      setPortfolioAvailableSample([])
    } finally {
      setIsPortfolioAvailableLoading(false)
    }
  }

  const handleValidatePortfolio = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!portfolioTeamId) {
      setPortfolioValidateStatus('Validation error: select a team first')
      return
    }

    setIsPortfolioValidateLoading(true)
    setPortfolioValidateStatus('Running...')

    try {
      const result = await runValidatePortfolioSelection({
        data: {
          teamId: portfolioTeamId,
          symbolsCsv: portfolioSymbolsCsv,
        },
      })

      setPortfolioValidationResult({
        isValid: result.isValid,
        errors: result.errors,
        budget: result.budget,
        totalCost: result.totalCost,
        tierCounts: result.tierCounts,
      })

      setPortfolioValidateStatus(
        result.isValid
          ? `Portfolio valid. Total cost ${result.totalCost}/${result.budget}`
          : `Portfolio invalid with ${result.errors.length} error(s)`,
      )
    } catch (error) {
      setPortfolioValidateStatus(
        `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
      setPortfolioValidationResult(null)
    } finally {
      setIsPortfolioValidateLoading(false)
    }
  }

  const handleSubmitPortfolio = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!portfolioTeamId) {
      setPortfolioSubmitStatus('Submit error: select a team first')
      return
    }

    setIsPortfolioSubmitLoading(true)
    setPortfolioSubmitStatus('Running...')

    try {
      const result = await runSubmitPortfolioSelection({
        data: {
          teamId: portfolioTeamId,
          symbolsCsv: portfolioSymbolsCsv,
        },
      })

      setPortfolioSubmitStatus(
        `Portfolio submitted for team ${result.teamId}. League status now ${result.leagueStatus}`,
      )
      await router.invalidate()
    } catch (error) {
      setPortfolioSubmitStatus(
        `Submit error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsPortfolioSubmitLoading(false)
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
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-8 bg-background p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Backend Debug Console
        </h1>
        <p className="text-muted-foreground">
          Basic read-only views of database tables and administrative actions
          for development debugging.
        </p>
        <div className="flex gap-4 text-sm text-muted-foreground mt-2">
          <span>
            Snapshot generated at: {new Date(data.generatedAt).toLocaleString()}
          </span>
          <span>
            Total rows across tracked tables: {data.totalRows.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Trading Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.systemStats.tradingDays.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Price Rows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.systemStats.priceRows.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Distinct Symbols
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.systemStats.distinctPriceSymbols.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Oldest Price Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.systemStats.oldestPriceDate ?? 'n/a'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Latest Price Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.systemStats.latestPriceDate ?? 'n/a'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-8">
          {/* System Tools */}
          <Card>
            <CardHeader>
              <CardTitle>System Tools</CardTitle>
              <CardDescription>Manage calendar and market data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handlePopulateCalendar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="calendarYear">
                    Populate trading calendar year
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="calendarYear"
                      type="number"
                      min={2020}
                      max={2100}
                      value={calendarYear}
                      onChange={(event) => setCalendarYear(event.target.value)}
                    />
                    <Button type="submit" disabled={isCalendarLoading}>
                      {isCalendarLoading ? 'Running...' : 'Populate'}
                    </Button>
                  </div>
                </div>
                {calendarStatus && (
                  <p className="text-sm text-muted-foreground">
                    {calendarStatus}
                  </p>
                )}
              </form>

              <Separator />

              <form onSubmit={handleSyncPrices} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="priceDate">
                    Sync prices for instrument universe (target date)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="priceDate"
                      type="date"
                      value={priceDate}
                      onChange={(event) => setPriceDate(event.target.value)}
                    />
                    <Button type="submit" disabled={isPriceLoading}>
                      {isPriceLoading ? 'Running...' : 'Sync prices'}
                    </Button>
                  </div>
                </div>
                {priceStatus && (
                  <p className="text-sm text-muted-foreground">{priceStatus}</p>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Season Tools */}
          <Card>
            <CardHeader>
              <CardTitle>Season Tools</CardTitle>
              <CardDescription>Create and manage game seasons</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleCreateSeason} className="space-y-4">
                <h4 className="text-sm font-medium">Create New Season</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="seasonName">Name</Label>
                    <Input
                      id="seasonName"
                      value={seasonName}
                      onChange={(event) => setSeasonName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seasonMarket">Market</Label>
                    <Input
                      id="seasonMarket"
                      value={seasonMarket}
                      onChange={(event) => setSeasonMarket(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seasonStartDate">Start Date</Label>
                    <Input
                      id="seasonStartDate"
                      type="date"
                      value={seasonStartDate}
                      onChange={(event) =>
                        setSeasonStartDate(event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seasonEndDate">End Date</Label>
                    <Input
                      id="seasonEndDate"
                      type="date"
                      value={seasonEndDate}
                      onChange={(event) => setSeasonEndDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seasonTradeDeadlineDate">
                      Trade Deadline
                    </Label>
                    <Input
                      id="seasonTradeDeadlineDate"
                      type="date"
                      value={seasonTradeDeadlineDate}
                      onChange={(event) =>
                        setSeasonTradeDeadlineDate(event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seasonBudget">Budget</Label>
                    <Input
                      id="seasonBudget"
                      type="number"
                      min={1}
                      value={seasonBudget}
                      onChange={(event) => setSeasonBudget(event.target.value)}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={isSeasonCreateLoading}
                  className="w-full"
                >
                  {isSeasonCreateLoading ? 'Running...' : 'Create Season'}
                </Button>
                {seasonCreateStatus && (
                  <p className="text-sm text-muted-foreground">
                    {seasonCreateStatus}
                  </p>
                )}
              </form>

              <Separator />

              <div className="space-y-4">
                <h4 className="text-sm font-medium">
                  Populate & Activate Season
                </h4>
                {seasonOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No seasons found. Create one first.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Target Season</Label>
                      <Select
                        value={seasonActionSeasonId}
                        onValueChange={setSeasonActionSeasonId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a season" />
                        </SelectTrigger>
                        <SelectContent>
                          {seasonOptions.map((season) => (
                            <SelectItem key={season.id} value={season.id}>
                              {season.name} ({season.status}) -{' '}
                              {season.instrumentCount} inst.
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <form
                      onSubmit={handlePopulateSeason}
                      className="space-y-4 rounded-lg border p-4"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="seasonSymbolLimit">Symbol Limit</Label>
                        <Input
                          id="seasonSymbolLimit"
                          type="number"
                          min={5}
                          max={500}
                          value={seasonSymbolLimit}
                          onChange={(event) =>
                            setSeasonSymbolLimit(event.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="seasonSymbolsCsv">
                          Symbols CSV (optional, defaults to UK set)
                        </Label>
                        <Textarea
                          id="seasonSymbolsCsv"
                          value={seasonSymbolsCsv}
                          onChange={(event) =>
                            setSeasonSymbolsCsv(event.target.value)
                          }
                          rows={3}
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={isSeasonPopulateLoading}
                        className="w-full"
                      >
                        {isSeasonPopulateLoading
                          ? 'Running...'
                          : 'Populate Instruments'}
                      </Button>
                      {seasonPopulateStatus && (
                        <p className="text-sm text-muted-foreground">
                          {seasonPopulateStatus}
                        </p>
                      )}
                    </form>

                    <form onSubmit={handleActivateSeason}>
                      <Button
                        type="submit"
                        variant="default"
                        disabled={isSeasonActivateLoading}
                        className="w-full"
                      >
                        {isSeasonActivateLoading
                          ? 'Running...'
                          : 'Activate Season'}
                      </Button>
                      {seasonActivateStatus && (
                        <p className="text-sm text-muted-foreground mt-2">
                          {seasonActivateStatus}
                        </p>
                      )}
                    </form>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          {/* League & Team Tools */}
          <Card>
            <CardHeader>
              <CardTitle>League & Team Tools</CardTitle>
              <CardDescription>Manage leagues and user teams</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleCreateLeague} className="space-y-4">
                <h4 className="text-sm font-medium">Create League</h4>
                {seasonOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Create a season first.
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Season</Label>
                      <Select
                        value={leagueSeasonId}
                        onValueChange={setLeagueSeasonId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a season" />
                        </SelectTrigger>
                        <SelectContent>
                          {seasonOptions.map((season) => (
                            <SelectItem key={season.id} value={season.id}>
                              {season.name} ({season.status})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="leagueName">League Name</Label>
                      <Input
                        id="leagueName"
                        value={leagueName}
                        onChange={(event) => setLeagueName(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="leagueCreatorId">Creator User ID</Label>
                      <Input
                        id="leagueCreatorId"
                        value={leagueCreatorId}
                        onChange={(event) =>
                          setLeagueCreatorId(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Ownership Mode</Label>
                      <Select
                        value={leagueOwnershipMode}
                        onValueChange={(v) => setLeagueOwnershipMode(v as any)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UNIQUE">UNIQUE</SelectItem>
                          <SelectItem value="DUPLICATES">DUPLICATES</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="submit"
                      disabled={isLeagueCreateLoading}
                      className="sm:col-span-2"
                    >
                      {isLeagueCreateLoading ? 'Running...' : 'Create League'}
                    </Button>
                    {leagueCreateStatus && (
                      <p className="text-sm text-muted-foreground sm:col-span-2">
                        {leagueCreateStatus}
                      </p>
                    )}
                  </div>
                )}
              </form>

              <Separator />

              <form onSubmit={handleCreateTeam} className="space-y-4">
                <h4 className="text-sm font-medium">Create Team</h4>
                {leagueOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Create a league first.
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>League</Label>
                      <Select
                        value={teamLeagueId}
                        onValueChange={setTeamLeagueId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a league" />
                        </SelectTrigger>
                        <SelectContent>
                          {leagueOptions.map((league) => (
                            <SelectItem key={league.id} value={league.id}>
                              {league.name} ({league.ownershipMode}) -{' '}
                              {league.teamCount} teams
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="teamUserId">User ID</Label>
                      <Input
                        id="teamUserId"
                        value={teamUserId}
                        onChange={(event) => setTeamUserId(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="teamName">Team Name</Label>
                      <Input
                        id="teamName"
                        value={teamName}
                        onChange={(event) => setTeamName(event.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={isTeamCreateLoading}
                      className="sm:col-span-2"
                    >
                      {isTeamCreateLoading ? 'Running...' : 'Create Team'}
                    </Button>
                    {teamCreateStatus && (
                      <p className="text-sm text-muted-foreground sm:col-span-2">
                        {teamCreateStatus}
                      </p>
                    )}
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Portfolio Selection Tools */}
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Selection (Phase 6)</CardTitle>
              <CardDescription>
                Validate and submit initial 8-symbol portfolios
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {teamOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Create at least one team before selecting a portfolio.
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Target Team</Label>
                      <Select
                        value={portfolioTeamId}
                        onValueChange={setPortfolioTeamId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a team" />
                        </SelectTrigger>
                        <SelectContent>
                          {teamOptions.map((team) => (
                            <SelectItem key={team.teamId} value={team.teamId}>
                              {team.teamName} - {team.leagueName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Availability League</Label>
                      <Select
                        value={portfolioLeagueId}
                        onValueChange={setPortfolioLeagueId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a league" />
                        </SelectTrigger>
                        <SelectContent>
                          {leagueOptions.map((league) => (
                            <SelectItem key={league.id} value={league.id}>
                              {league.name} ({league.ownershipMode})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="portfolioSymbolsCsv">
                      Symbols CSV (8 required)
                    </Label>
                    <Textarea
                      id="portfolioSymbolsCsv"
                      rows={3}
                      placeholder="SHEL.L,AZN.L,HSBA.L,ULVR.L,BP.L,RIO.L,GSK.L,REL.L"
                      value={portfolioSymbolsCsv}
                      onChange={(event) =>
                        setPortfolioSymbolsCsv(event.target.value)
                      }
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <form onSubmit={handleLoadAvailableForLeague}>
                      <Button
                        type="submit"
                        disabled={isPortfolioAvailableLoading}
                      >
                        {isPortfolioAvailableLoading
                          ? 'Running...'
                          : 'Load availability'}
                      </Button>
                    </form>

                    <form onSubmit={handleValidatePortfolio}>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={isPortfolioValidateLoading}
                      >
                        {isPortfolioValidateLoading
                          ? 'Running...'
                          : 'Validate portfolio'}
                      </Button>
                    </form>

                    <form onSubmit={handleSubmitPortfolio}>
                      <Button type="submit" disabled={isPortfolioSubmitLoading}>
                        {isPortfolioSubmitLoading
                          ? 'Running...'
                          : 'Submit portfolio'}
                      </Button>
                    </form>
                  </div>

                  {portfolioAvailableStatus && (
                    <p className="text-sm text-muted-foreground">
                      {portfolioAvailableStatus}
                    </p>
                  )}
                  {portfolioValidateStatus && (
                    <p className="text-sm text-muted-foreground">
                      {portfolioValidateStatus}
                    </p>
                  )}
                  {portfolioSubmitStatus && (
                    <p className="text-sm text-muted-foreground">
                      {portfolioSubmitStatus}
                    </p>
                  )}

                  {portfolioValidationResult && (
                    <div className="rounded-lg border p-4 space-y-2">
                      <p className="text-sm">
                        Valid: {String(portfolioValidationResult.isValid)} |
                        Cost: {portfolioValidationResult.totalCost}/
                        {portfolioValidationResult.budget}
                      </p>
                      <p className="text-sm">
                        Tier counts:{' '}
                        {JSON.stringify(portfolioValidationResult.tierCounts)}
                      </p>
                      {portfolioValidationResult.errors.length > 0 && (
                        <ul className="list-disc pl-5 space-y-1 text-sm text-destructive">
                          {portfolioValidationResult.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {portfolioAvailableSample.length > 0 && (
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Tier</TableHead>
                            <TableHead>Cost</TableHead>
                            <TableHead>Available</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {portfolioAvailableSample.map((row) => (
                            <TableRow key={row.symbol}>
                              <TableCell className="font-medium">
                                {row.symbol}
                              </TableCell>
                              <TableCell>{row.name}</TableCell>
                              <TableCell>{row.tier}</TableCell>
                              <TableCell>{row.tierCost}</TableCell>
                              <TableCell>
                                {row.isAvailable
                                  ? 'yes'
                                  : `no (${row.takenByTeamId})`}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Scoring Tools */}
          <Card>
            <CardHeader>
              <CardTitle>Scoring Tools</CardTitle>
              <CardDescription>Calculate and debug team scores</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {teamOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No teams found yet. Create a league and team first.
                </p>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label>Target Team</Label>
                    <Select
                      value={selectedTeamId}
                      onValueChange={setSelectedTeamId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a team" />
                      </SelectTrigger>
                      <SelectContent>
                        {teamOptions.map((team) => (
                          <SelectItem key={team.teamId} value={team.teamId}>
                            {team.teamName} ({team.teamId}) - {team.leagueName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-4 rounded-lg border p-4">
                    <h4 className="text-sm font-medium">Calculate One Day</h4>
                    <form
                      onSubmit={handleCalculateDayScore}
                      className="space-y-4"
                    >
                      <div className="flex items-end gap-4">
                        <div className="space-y-2 flex-1">
                          <Label htmlFor="scoreDate">Date</Label>
                          <Input
                            id="scoreDate"
                            type="date"
                            value={scoreDate}
                            onChange={(event) =>
                              setScoreDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="flex items-center space-x-2 pb-2">
                          <Checkbox
                            id="forceRecalculateDay"
                            checked={forceRecalculateDay}
                            onCheckedChange={(checked) =>
                              setForceRecalculateDay(checked as boolean)
                            }
                          />
                          <Label
                            htmlFor="forceRecalculateDay"
                            className="font-normal"
                          >
                            Force
                          </Label>
                        </div>
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={isScoreLoading}
                        >
                          {isScoreLoading ? 'Running...' : 'Calculate'}
                        </Button>
                      </div>
                      {scoreStatus && (
                        <p className="text-sm text-muted-foreground">
                          {scoreStatus}
                        </p>
                      )}
                    </form>
                  </div>

                  <div className="grid gap-4 rounded-lg border p-4">
                    <h4 className="text-sm font-medium">Backfill Range</h4>
                    <form
                      onSubmit={handleCalculateRangeScores}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="rangeStartDate">Start Date</Label>
                          <Input
                            id="rangeStartDate"
                            type="date"
                            value={rangeStartDate}
                            onChange={(event) =>
                              setRangeStartDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rangeEndDate">End Date</Label>
                          <Input
                            id="rangeEndDate"
                            type="date"
                            value={rangeEndDate}
                            onChange={(event) =>
                              setRangeEndDate(event.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="forceRecalculateRange"
                            checked={forceRecalculateRange}
                            onCheckedChange={(checked) =>
                              setForceRecalculateRange(checked as boolean)
                            }
                          />
                          <Label
                            htmlFor="forceRecalculateRange"
                            className="font-normal"
                          >
                            Force recalculate
                          </Label>
                        </div>
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={isRangeLoading}
                        >
                          {isRangeLoading ? 'Running...' : 'Backfill'}
                        </Button>
                      </div>
                      {rangeStatus && (
                        <p className="text-sm text-muted-foreground">
                          {rangeStatus}
                        </p>
                      )}
                    </form>
                  </div>

                  <div className="grid gap-4 rounded-lg border p-4">
                    <h4 className="text-sm font-medium">Invalidate Cache</h4>
                    <form
                      onSubmit={handleInvalidateScores}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="invalidateFromDate">From Date</Label>
                          <Input
                            id="invalidateFromDate"
                            type="date"
                            value={invalidateFromDate}
                            onChange={(event) =>
                              setInvalidateFromDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invalidateToDate">To Date</Label>
                          <Input
                            id="invalidateToDate"
                            type="date"
                            value={invalidateToDate}
                            onChange={(event) =>
                              setInvalidateToDate(event.target.value)
                            }
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={isInvalidateLoading}
                        className="w-full"
                      >
                        {isInvalidateLoading
                          ? 'Running...'
                          : 'Invalidate Cache'}
                      </Button>
                      {invalidateStatus && (
                        <p className="text-sm text-muted-foreground">
                          {invalidateStatus}
                        </p>
                      )}
                    </form>
                  </div>

                  <div className="grid gap-4 rounded-lg border p-4">
                    <h4 className="text-sm font-medium">Debug Snapshot</h4>
                    <form
                      onSubmit={handleRunDebugSnapshot}
                      className="space-y-4"
                    >
                      <div className="flex items-end gap-4">
                        <div className="space-y-2 flex-1">
                          <Label htmlFor="debugDate">Snapshot Date</Label>
                          <Input
                            id="debugDate"
                            type="date"
                            value={debugDate}
                            onChange={(event) =>
                              setDebugDate(event.target.value)
                            }
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={isDebugLoading}
                        >
                          {isDebugLoading ? 'Running...' : 'Generate'}
                        </Button>
                      </div>
                      {debugStatus && (
                        <p className="text-sm text-muted-foreground">
                          {debugStatus}
                        </p>
                      )}
                    </form>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Summaries & Tables */}
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Database Tables</CardTitle>
            <CardDescription>Direct access to raw table data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {tables.map((table) => (
                <Button
                  key={table.name}
                  variant="outline"
                  className="justify-between h-auto py-3"
                  asChild
                >
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
                    <span className="truncate">{table.name}</span>
                    <Badge variant="secondary" className="ml-2 shrink-0">
                      {table.rowCount}
                    </Badge>
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-8 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Seasons Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {seasonOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No seasons to display.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Market</TableHead>
                        <TableHead>Inst.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {seasonOptions.map((season) => (
                        <TableRow key={season.id}>
                          <TableCell className="font-medium">
                            {season.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{season.status}</Badge>
                          </TableCell>
                          <TableCell>{season.market}</TableCell>
                          <TableCell>{season.instrumentCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Leagues Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {leagueOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No leagues to display.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Season</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Teams</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leagueOptions.map((league) => (
                        <TableRow key={league.id}>
                          <TableCell className="font-medium">
                            {league.name}
                          </TableCell>
                          <TableCell>{league.seasonName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {league.ownershipMode}
                            </Badge>
                          </TableCell>
                          <TableCell>{league.teamCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {debugSnapshot && (
          <Card className="border-primary/50 bg-primary/5">
            <CardHeader>
              <CardTitle>Debug Snapshot Output</CardTitle>
              <CardDescription>
                Team: {debugSnapshot.teamId} | Date: {debugSnapshot.date} |
                Budget: {debugSnapshot.budget}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border bg-background p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Roster Valid
                  </div>
                  <div className="text-2xl font-bold">
                    {String(debugSnapshot.rosterValidation.isValid)}
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Holdings Count
                  </div>
                  <div className="text-2xl font-bold">
                    {debugSnapshot.rosterValidation.holdingCount}
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Total Cost
                  </div>
                  <div className="text-2xl font-bold">
                    {debugSnapshot.rosterValidation.totalCost}
                  </div>
                </div>
              </div>

              {debugSnapshot.rosterValidation.errors.length > 0 && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
                  <h5 className="font-medium mb-2">Validation Errors</h5>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    {debugSnapshot.rosterValidation.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h5 className="font-medium mb-3">Holdings</h5>
                {debugSnapshot.holdings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No holdings at this date.
                  </p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Added Date</TableHead>
                          <TableHead>Tier</TableHead>
                          <TableHead className="text-right">
                            Tier Cost
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {debugSnapshot.holdings.map((holding) => (
                          <TableRow key={holding.symbol}>
                            <TableCell className="font-medium">
                              {holding.symbol}
                            </TableCell>
                            <TableCell>
                              {new Date(holding.addedDate)
                                .toISOString()
                                .slice(0, 10)}
                            </TableCell>
                            <TableCell>{holding.tier}</TableCell>
                            <TableCell className="text-right">
                              {holding.tierCost}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div>
                <h5 className="font-medium mb-3">Day Score</h5>
                <div className="grid gap-4 md:grid-cols-2 mb-4">
                  <div className="rounded-lg border bg-background p-4">
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Trading Day
                    </div>
                    <div className="text-lg font-semibold">
                      {String(debugSnapshot.dayScore.isTradingDay)}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background p-4">
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Points
                    </div>
                    <div className="text-lg font-semibold">
                      {debugSnapshot.dayScore.points}
                    </div>
                  </div>
                </div>

                {debugSnapshot.dayScore.missingSymbols.length > 0 && (
                  <div className="mb-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-warning-foreground">
                    <span className="font-medium">Missing symbols: </span>
                    {debugSnapshot.dayScore.missingSymbols.join(', ')}
                  </div>
                )}

                <div className="rounded-md border bg-muted p-4 overflow-x-auto">
                  <pre className="text-xs">
                    {JSON.stringify(debugSnapshot.dayScore.breakdown, null, 2)}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
