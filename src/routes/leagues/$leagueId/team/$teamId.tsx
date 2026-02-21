import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'

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
import { leagues, teams } from '@/db/schema'
import {
  getLeagueStandings,
  getTeamHoldingsWithPrices,
  getTeamScoreHistory,
  hydrateLeagueScores,
  syncPricesAndGetLatestDate,
} from '@/lib/game/dashboard'

const getTeamPageData = createServerFn({ method: 'GET' })
  .inputValidator((payload: { leagueId: string; teamId: string }) => payload)
  .handler(async ({ data }) => {
    const [context] = await db
      .select({
        leagueId: leagues.id,
        leagueName: leagues.name,
        teamId: teams.id,
        teamName: teams.name,
        faabBudget: teams.faabBudget,
      })
      .from(teams)
      .innerJoin(leagues, eq(teams.leagueId, leagues.id))
      .where(and(eq(teams.id, data.teamId), eq(leagues.id, data.leagueId)))
      .limit(1)

    if (!context) {
      throw new Error('Team not found in this league')
    }

    const latestDate = await syncPricesAndGetLatestDate()
    if (!latestDate) {
      return {
        context,
        latestDate: null,
        standings: [],
        teamStanding: null,
        holdings: [],
        history: [],
      }
    }

    await hydrateLeagueScores(context.leagueId, latestDate)

    const [standings, holdings, history] = await Promise.all([
      getLeagueStandings(context.leagueId, latestDate),
      getTeamHoldingsWithPrices(context.teamId, latestDate),
      getTeamScoreHistory(context.teamId, latestDate, 45),
    ])

    const teamStanding =
      standings.find((entry) => entry.teamId === context.teamId) ?? null

    return {
      context,
      latestDate,
      standings,
      teamStanding,
      holdings,
      history,
    }
  })

export const Route = createFileRoute('/leagues/$leagueId/team/$teamId')({
  loader: ({ params }) =>
    getTeamPageData({
      data: {
        leagueId: params.leagueId,
        teamId: params.teamId,
      },
    }),
  component: TeamDetailPage,
})

function TeamDetailPage() {
  const data = Route.useLoaderData()

  const totalMarketValue = data.holdings.reduce(
    (sum, holding) => sum + (holding.currentPrice ?? 0),
    0,
  )

  const avgDailyReturn =
    data.holdings.length === 0
      ? 0
      : data.holdings.reduce(
          (sum, holding) => sum + (holding.dailyReturnPct ?? 0),
          0,
        ) / data.holdings.length

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {data.context.leagueName}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {data.context.teamName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {data.teamStanding ? (
            <Badge variant="outline">Rank #{data.teamStanding.rank}</Badge>
          ) : null}
          <Button variant="outline" asChild>
            <Link
              to="/leagues/$leagueId"
              params={{ leagueId: data.context.leagueId }}
            >
              Back to league
            </Link>
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total value" value={totalMarketValue.toFixed(2)} />
        <StatCard
          label="Avg daily move"
          value={`${avgDailyReturn.toFixed(2)}%`}
        />
        <StatCard
          label="Cumulative points"
          value={
            data.teamStanding
              ? data.teamStanding.totalPoints.toFixed(2)
              : '0.00'
          }
        />
        <StatCard
          label="FAAB remaining"
          value={String(data.context.faabBudget)}
        />
      </section>

      <ScoreChart
        label="Team score trend"
        points={data.history.map((point) => ({
          date: point.date,
          value: point.cumulativePoints,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Portfolio</CardTitle>
          <CardDescription>
            {data.latestDate
              ? `Latest prices from ${data.latestDate.toISOString().slice(0, 10)}`
              : 'No price data available'}
          </CardDescription>
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
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
