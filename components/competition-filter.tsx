import { COMPETITIONS } from '@/lib/competitions'
import type { CompetitionId } from '@/lib/types'
import { cn } from '@/lib/utils'

interface CompetitionFilterProps {
  value: CompetitionId | 'ALL'
  onChange: (v: CompetitionId | 'ALL') => void
  counts: Record<string, number>
}

export function CompetitionFilter({ value, onChange, counts }: CompetitionFilterProps) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const items = [
    { id: 'ALL' as const, name: 'All Competitions', color: '#0A2350' },
    ...COMPETITIONS,
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Filter by competition"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {items.map((c) => {
        const active = value === c.id
        const n = c.id === 'ALL' ? total : (counts[c.id] ?? 0)
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.id)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-ring',
              active
                ? 'border-navy bg-navy text-white shadow-sm'
                : 'border-border bg-white text-foreground hover:border-navy/40',
            )}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-sm ring-1 ring-black/10"
              style={{ backgroundColor: c.id === 'ALL' ? (active ? '#fff' : '#0A2350') : c.color }}
            />
            {c.name}
            <span className={cn('tabular-nums', active ? 'text-white/70' : 'text-muted-foreground')}>{n}</span>
          </button>
        )
      })}
    </div>
  )
}
