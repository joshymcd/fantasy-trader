import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { Leaderboard } from '@/components/game/Leaderboard'
import { PortfolioTable } from '@/components/game/PortfolioTable'
import { ScoreChart } from '@/components/game/ScoreChart'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { db } from '@/db/index'
import { leagues, seasons } from '@/db/schema'
import {
  getLeagueStandings,
  getTeamHoldingsWithPrices,
  getTeamScoreHistory,
  hydrateLeagueScores,
  syncPricesAndGetLatestDate,
} from '@/lib/game/dashboard'

const getLeagueOverview = createServerFn({ method: 'GET' })
  .inputValidator((payload: { leagueId: string }) => payload)
  .handler(async ({ data }) => {
    const [league] = await db
      .select({
        id: leagues.id,
        name: leagues.name,
        status: leagues.status,
        seasonName: seasons.name,
      })
      .from(leagues)
      .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
      .where(eq(leagues.id, data.leagueId))
      .limit(1)

    if (!league) {
      throw new Error('League not found')
    }

    const { latestDate, staleDataWarning } = await syncPricesAndGetLatestDate()
    if (!latestDate) {
      return {
        league,
        latestDate: null,
        staleDataWarning,
        standings: [],
        highlightedTeamId: null,
        highlightedTeamHoldings: [],
        highlightedTeamHistory: [],
      }
    }

    await hydrateLeagueScores(league.id, latestDate)
    const standings = await getLeagueStandings(league.id, latestDate)
    const highlightedTeamId = standings[0]?.teamId ?? null

    const [highlightedTeamHoldings, highlightedTeamHistory] =
      highlightedTeamId === null
        ? [[], []]
        : await Promise.all([
            getTeamHoldingsWithPrices(highlightedTeamId, latestDate),
            getTeamScoreHistory(highlightedTeamId, latestDate, 30),
          ])

    return {
      league,
      latestDate,
      staleDataWarning,
      standings,
      highlightedTeamId,
      highlightedTeamHoldings,
      highlightedTeamHistory,
    }
  })

export const Route = createFileRoute('/_app/leagues/$leagueId')({
  loader: ({ params }) =>
    getLeagueOverview({ data: { leagueId: params.leagueId } }),
  component: LeagueOverviewPage,
})

function LeagueOverviewPage() {
  const data = Route.useLoaderData()

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 p-6">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card p-6">
        <div>
          <p className="text-sm text-muted-foreground">
            {data.league.seasonName}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {data.league.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{data.league.status}</Badge>
          <Button variant="outline" asChild>
            <Link
              to="/leagues/$leagueId/roster"
              params={{ leagueId: data.league.id }}
            >
              Roster
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link
              to="/leagues/$leagueId/standings"
              params={{ leagueId: data.league.id }}
            >
              Full standings
            </Link>
          </Button>
        </div>
      </section>

      {data.staleDataWarning ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {data.staleDataWarning}
        </div>
      ) : null}

      {data.latestDate === null ? (
        <Card>
          <CardHeader>
            <CardTitle>No scoring data yet</CardTitle>
            <CardDescription>
              Populate market prices first, then standings and portfolio metrics
              will appear.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <ScoreChart
            label="Leading Team Momentum"
            points={data.highlightedTeamHistory.map((point) => ({
              date: point.date,
              value: point.cumulativePoints,
            }))}
          />

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top Team Snapshot</CardTitle>
                <CardDescription>
                  {data.standings[0]?.teamName ?? 'No teams'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PortfolioTable
                  holdings={data.highlightedTeamHoldings
                    .slice(0, 3)
                    .map((holding) => ({
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
                <CardTitle>League Leaders</CardTitle>
                <CardDescription>
                  Updated through {data.latestDate.toISOString().slice(0, 10)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Leaderboard
                  entries={data.standings.slice(0, 5).map((entry) => ({
                    teamId: entry.teamId,
                    teamName: entry.teamName,
                    rank: entry.rank,
                    totalPoints: entry.totalPoints,
                    todayPoints: entry.todayPoints,
                  }))}
                  highlightTeamId={data.highlightedTeamId ?? undefined}
                />
                {data.highlightedTeamId ? (
                  <Button asChild>
                    <Link
                      to="/leagues/$leagueId/team/$teamId"
                      params={{
                        leagueId: data.league.id,
                        teamId: data.highlightedTeamId,
                      }}
                    >
                      View leader details
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </main>
  )
}
