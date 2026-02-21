import { cn } from '@/lib/utils'

type InstrumentCardProps = {
  symbol: string
  name?: string
  currentPrice: number | null
  changePct: number | null
  className?: string
}

const formatPrice = (value: number | null) =>
  value === null ? '-' : value.toFixed(2)

const formatChange = (value: number | null) => {
  if (value === null) {
    return 'No change'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function InstrumentCard({
  symbol,
  name,
  currentPrice,
  changePct,
  className,
}: InstrumentCardProps) {
  const changeClassName =
    changePct === null
      ? 'text-muted-foreground'
      : changePct >= 0
        ? 'text-emerald-600'
        : 'text-rose-600'

  return (
    <article
      className={cn(
        'rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-emerald-300',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-sm font-semibold tracking-tight">
          {symbol}
        </p>
        <p className="text-sm tabular-nums">{formatPrice(currentPrice)}</p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {name ?? 'Instrument'}
        </p>
        <p className={cn('text-xs font-medium tabular-nums', changeClassName)}>
          {formatChange(changePct)}
        </p>
      </div>
    </article>
  )
}
