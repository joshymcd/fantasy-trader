import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type TierBadgeProps = {
  tier: number
  className?: string
}

const stylesByTier: Record<number, string> = {
  1: 'border-amber-300 bg-amber-100 text-amber-900',
  2: 'border-zinc-300 bg-zinc-100 text-zinc-900',
  3: 'border-orange-300 bg-orange-100 text-orange-900',
  4: 'border-sky-300 bg-sky-100 text-sky-900',
  5: 'border-emerald-300 bg-emerald-100 text-emerald-900',
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', stylesByTier[tier] ?? '', className)}
    >
      Tier {tier}
    </Badge>
  )
}
