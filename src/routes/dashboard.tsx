import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { InstrumentCard } from '@/components/game/InstrumentCard'
import { Leaderboard } from '@/components/game/Leaderboard'
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
  getGlobalMovers,
  getLeagueStandings,
  hydrateLeagueScores,
  syncPricesAndGetLatestDate,
} from '@/lib/game/dashboard'

const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const latestDate = await syncPricesAndGetLatestDate()

  const leagueRows = await db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      seasonName: seasons.name,
      status: leagues.status,
    })
    .from(leagues)
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))

  const leagueCards =
    latestDate === null
      ? []
      : await Promise.all(
          leagueRows.map(async (league) => {
            await hydrateLeagueScores(league.leagueId, latestDate)
            const standings = await getLeagueStandings(
              league.leagueId,
              latestDate,
            )

            return {
              ...league,
              standings,
              leader: standings[0] ?? null,
            }
          }),
        )

  const topMovers = latestDate ? await getGlobalMovers(latestDate, 8) : []

  return {
    latestDate,
    leagueCards,
    topMovers,
  }
})

export const Route = createFileRoute('/dashboard')({
  loader: () => getDashboardData(),
  component: DashboardPage,
})

function DashboardPage() {
  const data = Route.useLoaderData()

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 p-6">
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Fantasy Trader
            </h1>
            <p className="text-sm text-muted-foreground">
              League dashboards, live standings, and portfolio momentum.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              latest scoring date
            </p>
            <p className="font-mono text-sm">
              {data.latestDate
                ? data.latestDate.toISOString().slice(0, 10)
                : 'No market data'}
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {data.leagueCards.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No leagues yet</CardTitle>
                <CardDescription>
                  Create and activate a season in the backend console to begin.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link to="/backend">Open backend console</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            data.leagueCards.map((league) => (
              <Card key={league.leagueId}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>{league.leagueName}</CardTitle>
                      <CardDescription>{league.seasonName}</CardDescription>
                    </div>
                    <Badge variant="outline">{league.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {league.leader ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">
                          Current Leader
                        </p>
                        <p className="mt-1 text-lg font-semibold">
                          {league.leader.teamName}
                        </p>
                        <p className="text-sm tabular-nums text-emerald-600">
                          {league.leader.totalPoints.toFixed(2)} pts
                        </p>
                      </div>
                      <div className="flex items-end justify-end gap-2">
                        <Button variant="outline" asChild>
                          <Link
                            to="/leagues/$leagueId/standings"
                            params={{ leagueId: league.leagueId }}
                          >
                            Standings
                          </Link>
                        </Button>
                        <Button asChild>
                          <Link
                            to="/leagues/$leagueId"
                            params={{ leagueId: league.leagueId }}
                          >
                            League view
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No team has scored yet.
                    </p>
                  )}
                  <Leaderboard entries={league.standings.slice(0, 5)} />
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Top Movers</CardTitle>
            <CardDescription>
              Largest daily swings across tracked instruments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topMovers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No price movers available yet.
              </p>
            ) : (
              data.topMovers.map((mover) => (
                <InstrumentCard
                  key={mover.symbol}
                  symbol={mover.symbol}
                  currentPrice={mover.currentPrice}
                  changePct={mover.changePct}
                />
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
