import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, lte } from 'drizzle-orm'
import { type FormEvent, useMemo, useState } from 'react'

import { PortfolioTable } from '@/components/game/PortfolioTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { db } from '@/db/index'
import {
  instruments,
  leagues,
  rosterMoves,
  teams,
  waiverClaims,
} from '@/db/schema'
import {
  getTeamHoldingsWithPrices,
  syncPricesAndGetLatestDate,
} from '@/lib/game/dashboard'
import {
  cancelWaiverClaim,
  getRemainingSwaps,
  getSwapHistory,
  submitSwap,
} from '@/lib/game/swaps'
import {
  acceptTrade,
  cancelTrade,
  expirePendingTrades,
  getTradeProposalsForTeam,
  proposeTrade,
  rejectTrade,
} from '@/lib/game/trades'

const getRosterPageData = createServerFn({ method: 'GET' })
  .inputValidator((payload: { leagueId: string; teamId?: string }) => payload)
  .handler(async ({ data }) => {
    const [league] = await db
      .select({
        id: leagues.id,
        name: leagues.name,
        ownershipMode: leagues.ownershipMode,
        seasonId: leagues.seasonId,
      })
      .from(leagues)
      .where(eq(leagues.id, data.leagueId))
      .limit(1)

    if (!league) {
      throw new Error('League not found')
    }

    const leagueTeams = await db
      .select({ id: teams.id, name: teams.name, faabBudget: teams.faabBudget })
      .from(teams)
      .where(eq(teams.leagueId, league.id))
      .orderBy(asc(teams.createdAt))

    if (leagueTeams.length === 0) {
      return {
        league,
        activeTeam: null,
        teams: [],
        holdings: [],
        freeAgents: [],
        remainingSwaps: null,
        swapHistory: [],
        pendingClaims: [],
        trades: [],
      }
    }

    const activeTeam =
      leagueTeams.find((team) => team.id === data.teamId) ?? leagueTeams[0]

    const priceSync = await syncPricesAndGetLatestDate()
    const latestDate = priceSync.latestDate
    const effectiveDate = latestDate ?? new Date()

    await expirePendingTrades(league.id)

    const [
      holdings,
      remainingSwaps,
      swapHistory,
      pendingClaims,
      trades,
      seasonRows,
    ] = await Promise.all([
      latestDate ? getTeamHoldingsWithPrices(activeTeam.id, latestDate) : [],
      getRemainingSwaps(activeTeam.id),
      getSwapHistory(activeTeam.id, 40),
      db
        .select({
          id: waiverClaims.id,
          addSymbol: waiverClaims.addSymbol,
          dropSymbol: waiverClaims.dropSymbol,
          faabBid: waiverClaims.faabBid,
          status: waiverClaims.status,
          effectiveDate: waiverClaims.effectiveDate,
          createdAt: waiverClaims.createdAt,
        })
        .from(waiverClaims)
        .where(
          and(
            eq(waiverClaims.teamId, activeTeam.id),
            eq(waiverClaims.status, 'PENDING'),
          ),
        )
        .orderBy(asc(waiverClaims.createdAt)),
      getTradeProposalsForTeam(activeTeam.id),
      db
        .select({ symbol: instruments.symbol, name: instruments.name })
        .from(instruments)
        .where(eq(instruments.seasonId, league.seasonId))
        .orderBy(asc(instruments.symbol)),
    ])

    const activeTradeRows = trades.filter(
      (trade) => trade.leagueId === league.id,
    )

    const activeTeamHoldingSymbols = new Set(
      holdings.map((holding) => holding.symbol),
    )

    const ownershipMoves = await db
      .select({
        teamId: rosterMoves.teamId,
        symbol: rosterMoves.symbol,
        type: rosterMoves.type,
        metadata: rosterMoves.metadata,
      })
      .from(rosterMoves)
      .innerJoin(teams, eq(rosterMoves.teamId, teams.id))
      .where(
        and(
          eq(teams.leagueId, league.id),
          lte(rosterMoves.effectiveDate, effectiveDate),
        ),
      )
      .orderBy(
        asc(rosterMoves.effectiveDate),
        asc(rosterMoves.createdAt),
        asc(rosterMoves.id),
      )

    const ownerBySymbol = new Map<string, string>()
    for (const move of ownershipMoves) {
      if (move.type === 'DROP') {
        if (ownerBySymbol.get(move.symbol) === move.teamId) {
          ownerBySymbol.delete(move.symbol)
        }
        continue
      }

      if (move.type === 'TRADE' && move.metadata?.direction === 'OUT') {
        if (ownerBySymbol.get(move.symbol) === move.teamId) {
          ownerBySymbol.delete(move.symbol)
        }
        continue
      }

      ownerBySymbol.set(move.symbol, move.teamId)
    }

    const freeAgents = seasonRows.filter((instrument) => {
      if (activeTeamHoldingSymbols.has(instrument.symbol)) {
        return false
      }

      if (league.ownershipMode === 'UNIQUE') {
        const owner = ownerBySymbol.get(instrument.symbol)
        return !owner || owner === activeTeam.id
      }

      return true
    })

    return {
      league,
      teams: leagueTeams,
      activeTeam,
      holdings,
      freeAgents,
      remainingSwaps,
      swapHistory,
      pendingClaims,
      trades: activeTradeRows,
      latestDate,
      staleDataWarning: priceSync.staleDataWarning,
    }
  })

const submitSwapFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: {
      teamId: string
      dropSymbol: string
      addSymbol: string
      faabBid: number
    }) => payload,
  )
  .handler(async ({ data }) => submitSwap(data))

const cancelClaimFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: { claimId: string; teamId: string }) => payload)
  .handler(async ({ data }) => cancelWaiverClaim(data.claimId, data.teamId))

const proposeTradeFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (payload: {
      fromTeamId: string
      toTeamId: string
      offeredSymbolsCsv: string
      requestedSymbolsCsv: string
    }) => payload,
  )
  .handler(async ({ data }) =>
    proposeTrade({
      fromTeamId: data.fromTeamId,
      toTeamId: data.toTeamId,
      offeredSymbols: data.offeredSymbolsCsv
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean),
      requestedSymbols: data.requestedSymbolsCsv
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean),
    }),
  )

const acceptTradeFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: { tradeId: string; teamId: string }) => payload)
  .handler(async ({ data }) =>
    acceptTrade({ tradeId: data.tradeId, actedByTeamId: data.teamId }),
  )

const rejectTradeFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: { tradeId: string; teamId: string }) => payload)
  .handler(async ({ data }) =>
    rejectTrade({ tradeId: data.tradeId, actedByTeamId: data.teamId }),
  )

const cancelTradeFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: { tradeId: string; teamId: string }) => payload)
  .handler(async ({ data }) =>
    cancelTrade({ tradeId: data.tradeId, fromTeamId: data.teamId }),
  )

export const Route = createFileRoute('/_app/leagues/$leagueId/roster')({
  loader: ({ params }) =>
    getRosterPageData({
      data: {
        leagueId: params.leagueId,
      },
    }),
  component: LeagueRosterPage,
})

function LeagueRosterPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [dropSymbol, setDropSymbol] = useState('')
  const [addSymbol, setAddSymbol] = useState('')
  const [faabBid, setFaabBid] = useState('0')
  const [tradeToTeamId, setTradeToTeamId] = useState('')
  const [offeredSymbolsCsv, setOfferedSymbolsCsv] = useState('')
  const [requestedSymbolsCsv, setRequestedSymbolsCsv] = useState('')

  const otherTeams = useMemo(
    () => data.teams.filter((team) => team.id !== data.activeTeam?.id),
    [data.activeTeam?.id, data.teams],
  )

  if (!data.activeTeam) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>No teams in this league yet</CardTitle>
            <CardDescription>
              Add teams first before managing rosters.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  const refresh = async () => {
    await router.invalidate()
  }

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      await action()
      setStatusMessage(success)
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Action failed')
    }
  }

  const onSubmitSwap = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await runAction(
      () =>
        submitSwapFn({
          data: {
            teamId: data.activeTeam.id,
            dropSymbol,
            addSymbol,
            faabBid: Number.parseInt(faabBid || '0', 10) || 0,
          },
        }),
      'Swap submitted successfully',
    )
  }

  const onSubmitTrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await runAction(
      () =>
        proposeTradeFn({
          data: {
            fromTeamId: data.activeTeam.id,
            toTeamId: tradeToTeamId,
            offeredSymbolsCsv,
            requestedSymbolsCsv,
          },
        }),
      'Trade proposal sent',
    )
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 p-6">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card p-6">
        <div>
          <p className="text-sm text-muted-foreground">{data.league.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Roster management
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/leagues/$leagueId" params={{ leagueId: data.league.id }}>
              Back to league
            </Link>
          </Button>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Team context</CardTitle>
          <CardDescription>
            Managing team: {data.activeTeam.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">FAAB {data.activeTeam.faabBudget}</Badge>
          {data.remainingSwaps ? (
            <Badge variant="outline">
              Swaps {data.remainingSwaps.remainingToday}/
              {data.remainingSwaps.maxPerDay} today
            </Badge>
          ) : null}
          {data.latestDate ? (
            <Badge variant="outline">
              Prices: {data.latestDate.toISOString().slice(0, 10)}
            </Badge>
          ) : null}
          <Badge variant="outline">League teams: {data.teams.length}</Badge>
        </CardContent>
      </Card>

      {statusMessage ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          {errorMessage}
        </div>
      ) : null}

      {data.staleDataWarning ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {data.staleDataWarning}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current holdings</CardTitle>
          </CardHeader>
          <CardContent>
            <PortfolioTable
              holdings={data.holdings.map((holding) => ({
                symbol: holding.symbol,
                tier: holding.tier,
                tierCost: holding.tierCost,
                currentPrice: holding.currentPrice,
                dailyReturnPct: holding.dailyReturnPct,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submit swap</CardTitle>
            <CardDescription>
              Drops and adds become effective next trading day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={onSubmitSwap}>
              <div className="space-y-2">
                <Label htmlFor="drop-symbol">Drop symbol</Label>
                <Select value={dropSymbol} onValueChange={setDropSymbol}>
                  <SelectTrigger id="drop-symbol">
                    <SelectValue placeholder="Select held symbol" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.holdings.map((holding) => (
                      <SelectItem key={holding.symbol} value={holding.symbol}>
                        {holding.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="add-symbol">Add symbol</Label>
                <Select value={addSymbol} onValueChange={setAddSymbol}>
                  <SelectTrigger id="add-symbol">
                    <SelectValue placeholder="Select free agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.freeAgents.map((instrument) => (
                      <SelectItem
                        key={instrument.symbol}
                        value={instrument.symbol}
                      >
                        {instrument.symbol} - {instrument.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {data.league.ownershipMode === 'UNIQUE' ? (
                <div className="space-y-2">
                  <Label htmlFor="faab-bid">FAAB bid</Label>
                  <Input
                    id="faab-bid"
                    value={faabBid}
                    type="number"
                    min={0}
                    onChange={(event) => setFaabBid(event.target.value)}
                  />
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={!dropSymbol || !addSymbol}
              >
                Submit swap
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending waiver claims</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.pendingClaims.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending claims.
              </p>
            ) : (
              data.pendingClaims.map((claim) => (
                <div
                  key={claim.id}
                  className="rounded-lg border border-border/70 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      {claim.dropSymbol} {'->'} {claim.addSymbol}
                    </p>
                    <Badge variant="outline">Bid {claim.faabBid}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Effective {claim.effectiveDate.toISOString().slice(0, 10)}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        runAction(
                          () =>
                            cancelClaimFn({
                              data: {
                                claimId: claim.id,
                                teamId: data.activeTeam.id,
                              },
                            }),
                          'Claim cancelled',
                        )
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Propose trade</CardTitle>
            <CardDescription>Use comma-separated symbols.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={onSubmitTrade}>
              <div className="space-y-2">
                <Label htmlFor="trade-team">Trade with</Label>
                <Select value={tradeToTeamId} onValueChange={setTradeToTeamId}>
                  <SelectTrigger id="trade-team">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherTeams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="offered">You offer</Label>
                <Input
                  id="offered"
                  placeholder="AAL.L, VOD.L"
                  value={offeredSymbolsCsv}
                  onChange={(event) => setOfferedSymbolsCsv(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requested">You request</Label>
                <Input
                  id="requested"
                  placeholder="AZN.L"
                  value={requestedSymbolsCsv}
                  onChange={(event) =>
                    setRequestedSymbolsCsv(event.target.value)
                  }
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !tradeToTeamId || !offeredSymbolsCsv || !requestedSymbolsCsv
                }
              >
                Send trade proposal
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Trade inbox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.trades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trade proposals yet.
            </p>
          ) : (
            data.trades.map((trade) => {
              const isIncoming = trade.toTeamId === data.activeTeam.id
              const canRespond = isIncoming && trade.status === 'PENDING'
              const canCancel =
                trade.fromTeamId === data.activeTeam.id &&
                trade.status === 'PENDING'

              return (
                <div
                  key={trade.id}
                  className="rounded-lg border border-border/70 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      {isIncoming ? 'Incoming' : 'Outgoing'} trade
                    </p>
                    <Badge variant="outline">{trade.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Offered: {trade.offeredSymbols.join(', ')} | Requested:{' '}
                    {trade.requestedSymbols.join(', ')}
                  </p>
                  {(canRespond || canCancel) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canRespond ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              runAction(
                                () =>
                                  acceptTradeFn({
                                    data: {
                                      tradeId: trade.id,
                                      teamId: data.activeTeam.id,
                                    },
                                  }),
                                'Trade accepted',
                              )
                            }
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              runAction(
                                () =>
                                  rejectTradeFn({
                                    data: {
                                      tradeId: trade.id,
                                      teamId: data.activeTeam.id,
                                    },
                                  }),
                                'Trade rejected',
                              )
                            }
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}

                      {canCancel ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            runAction(
                              () =>
                                cancelTradeFn({
                                  data: {
                                    tradeId: trade.id,
                                    teamId: data.activeTeam.id,
                                  },
                                }),
                              'Trade cancelled',
                            )
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Swap history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.swapHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No swap history yet.
            </p>
          ) : (
            data.swapHistory.map((event) => (
              <div
                key={`${event.eventType}-${event.id}`}
                className="rounded border border-border/60 px-3 py-2 text-sm"
              >
                <span className="font-medium">{event.eventType}</span>{' '}
                {'type' in event
                  ? `${event.type} ${event.symbol}`
                  : `${event.dropSymbol} ${'->'} ${event.addSymbol} (${event.status})`}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  )
}
