import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { TierBadge } from './TierBadge'

export type PortfolioHolding = {
  symbol: string
  tier: number
  tierCost: number
  currentPrice: number | null
  dailyReturnPct: number | null
}

type PortfolioTableProps = {
  holdings: PortfolioHolding[]
}

const formatPrice = (value: number | null) =>
  value === null ? '-' : value.toFixed(2)

const formatPct = (value: number | null) => {
  if (value === null) {
    return '-'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function PortfolioTable({ holdings }: PortfolioTableProps) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        No assets in portfolio yet.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
            Symbol
          </TableHead>
          <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
            Tier
          </TableHead>
          <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">
            Cost
          </TableHead>
          <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">
            Price
          </TableHead>
          <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">
            Daily
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holdings.map((holding) => {
          const changeClassName =
            holding.dailyReturnPct === null
              ? 'text-muted-foreground'
              : holding.dailyReturnPct >= 0
                ? 'text-emerald-600'
                : 'text-rose-600'

          return (
            <TableRow key={holding.symbol}>
              <TableCell className="font-mono text-sm font-semibold">
                {holding.symbol}
              </TableCell>
              <TableCell>
                <TierBadge tier={holding.tier} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {holding.tierCost}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPrice(holding.currentPrice)}
              </TableCell>
              <TableCell
                className={cn('text-right tabular-nums', changeClassName)}
              >
                {formatPct(holding.dailyReturnPct)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
