import { Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'

export type LeaderboardEntry = {
  teamId: string
  teamName: string
  totalPoints: number
  todayPoints: number
  rank: number
}

type LeaderboardProps = {
  entries: LeaderboardEntry[]
  highlightTeamId?: string
}

const formatSigned = (value: number) => {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

export function Leaderboard({ entries, highlightTeamId }: LeaderboardProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        No standings yet.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const isHighlighted = highlightTeamId === entry.teamId
        const todayClass =
          entry.todayPoints >= 0 ? 'text-emerald-600' : 'text-rose-600'

        return (
          <div
            key={entry.teamId}
            className={cn(
              'flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:bg-muted/50',
              isHighlighted &&
                'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/25',
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-7 text-center font-mono text-sm text-muted-foreground">
                {entry.rank === 1 ? (
                  <span className="inline-flex items-center justify-center text-amber-500">
                    <Trophy className="size-4" />
                  </span>
                ) : (
                  entry.rank
                )}
              </div>
              <p className="font-medium">{entry.teamName}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">
                {entry.totalPoints.toFixed(2)}
              </p>
              <p className={cn('text-xs tabular-nums', todayClass)}>
                {formatSigned(entry.todayPoints)} today
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
