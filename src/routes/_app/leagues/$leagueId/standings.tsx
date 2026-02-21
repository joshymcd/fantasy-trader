import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { Leaderboard } from '@/components/game/Leaderboard'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { db } from '@/db/index'
import { leagues } from '@/db/schema'
import {
  getLeagueStandings,
  hydrateLeagueScores,
  syncPricesAndGetLatestDate,
} from '@/lib/game/dashboard'

const getStandingsData = createServerFn({ method: 'GET' })
  .inputValidator((payload: { leagueId: string }) => payload)
  .handler(async ({ data }) => {
    const [league] = await db
      .select({ id: leagues.id, name: leagues.name })
      .from(leagues)
      .where(eq(leagues.id, data.leagueId))
      .limit(1)

    if (!league) {
      throw new Error('League not found')
    }

    const latestDate = await syncPricesAndGetLatestDate()
    if (!latestDate) {
      return {
        league,
        latestDate: null,
        standings: [],
      }
    }

    await hydrateLeagueScores(league.id, latestDate)
    const standings = await getLeagueStandings(league.id, latestDate)

    return {
      league,
      latestDate,
      standings,
    }
  })

export const Route = createFileRoute('/_app/leagues/$leagueId/standings')({
  loader: ({ params }) =>
    getStandingsData({ data: { leagueId: params.leagueId } }),
  component: LeagueStandingsPage,
})

function LeagueStandingsPage() {
  const data = Route.useLoaderData()

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">League Standings</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {data.league.name}
          </h1>
        </div>
        <Button variant="outline" asChild>
          <Link to="/leagues/$leagueId" params={{ leagueId: data.league.id }}>
            Back to league
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rankings</CardTitle>
          <CardDescription>
            {data.latestDate
              ? `Updated through ${data.latestDate.toISOString().slice(0, 10)}`
              : 'No scoring data available yet'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Leaderboard
            entries={data.standings.map((entry) => ({
              teamId: entry.teamId,
              teamName: entry.teamName,
              rank: entry.rank,
              totalPoints: entry.totalPoints,
              todayPoints: entry.todayPoints,
            }))}
          />
        </CardContent>
      </Card>
    </main>
  )
}
