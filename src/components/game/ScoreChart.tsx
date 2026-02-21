type ScorePoint = {
  date: Date
  value: number
}

type ScoreChartProps = {
  points: ScorePoint[]
  label: string
}

const width = 720
const height = 220
const padding = 20

const formatDate = (value: Date) => value.toISOString().slice(5, 10)

const buildPath = (points: ScorePoint[]) => {
  if (points.length === 0) {
    return ''
  }

  const values = points.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const xSpan = Math.max(points.length - 1, 1)
  const ySpan = Math.max(maxValue - minValue, 1)

  return points
    .map((point, index) => {
      const x = padding + (index / xSpan) * (width - padding * 2)
      const y =
        height -
        padding -
        ((point.value - minValue) / ySpan) * (height - padding * 2)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export function ScoreChart({ points, label }: ScoreChartProps) {
  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        No score history yet.
      </div>
    )
  }

  const path = buildPath(points)
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {formatDate(first.date)} {'->'} {formatDate(last.date)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full overflow-visible"
        role="img"
        aria-label={label}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-emerald-500"
          strokeWidth={2.5}
        />
      </svg>
    </div>
  )
}
