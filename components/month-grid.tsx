import { MatchCard } from '@/components/match-card'
import { monthLabel, monthMatrix, WEEKDAYS } from '@/lib/fixtures'
import type { Fixture } from '@/lib/types'
import { cn } from '@/lib/utils'

interface MonthGridProps {
  monthKey: string
  fixturesByDate: Map<string, Fixture[]>
  todayKey: string
  onSelect: (f: Fixture) => void
  size?: 'compact' | 'large'
  highlighted?: boolean
}

export function MonthGrid({
  monthKey,
  fixturesByDate,
  todayKey,
  onSelect,
  size = 'compact',
  highlighted,
}: MonthGridProps) {
  const rows = monthMatrix(monthKey)
  const large = size === 'large'
  const count = [...fixturesByDate.entries()]
    .filter(([d]) => d.startsWith(monthKey))
    .reduce((n, [, l]) => n + l.length, 0)
  const lastUsedRow = rows.reduce((last, r, i) => (r.some(Boolean) ? i : last), 0)

  return (
    <section
      id={`month-${monthKey}`}
      aria-label={monthLabel(monthKey)}
      className={cn(
        'scroll-mt-40 overflow-hidden rounded-md border border-navy bg-white shadow-[0_1px_2px_rgba(10,35,80,0.08),0_4px_16px_-8px_rgba(10,35,80,0.25)] transition-shadow',
        highlighted && 'ring-2 ring-[#3478D4] ring-offset-2',
      )}
    >
      <header className="flex items-center justify-between bg-navy px-3 py-1.5 text-white">
        <h2 className={cn('font-display font-bold tracking-wide', large ? 'text-2xl' : 'text-base')}>
          {monthLabel(monthKey)}
        </h2>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70">
          {count} {count === 1 ? 'match' : 'matches'}
        </span>
      </header>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="bg-navy-2">
            {WEEKDAYS.map((d) => (
              <th
                key={d}
                scope="col"
                className={cn(
                  'border-x border-white/15 py-0.5 text-center font-bold tracking-widest text-white',
                  large ? 'text-xs' : 'text-[9px]',
                  (d === 'SAT' || d === 'SUN') && 'text-white/90',
                )}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((week, ri) => (
            <tr key={ri} className={cn(ri % 2 === 1 ? 'bg-[#F1F4F9]' : 'bg-white', ri > lastUsedRow && 'opacity-70')}>
              {week.map((date, ci) => {
                const list = date ? (fixturesByDate.get(date) ?? []) : []
                const day = date ? Number(date.slice(8)) : undefined
                const isToday = date === todayKey
                return (
                  <td
                    key={ci}
                    className={cn(
                      'relative border border-gridline p-0 align-top',
                      large ? 'h-24 sm:h-28' : 'h-[58px] sm:h-[66px]',
                    )}
                  >
                    {date && list.length === 0 && (
                      <span
                        className={cn(
                          'absolute left-1 top-0.5 tabular-nums',
                          large ? 'text-xs' : 'text-[9px]',
                          isToday
                            ? 'flex size-4 items-center justify-center rounded-full bg-navy font-bold text-white'
                            : 'text-slate-500',
                        )}
                      >
                        {day}
                        {isToday && <span className="sr-only"> (today)</span>}
                      </span>
                    )}
                    {list.length === 1 && (
                      <MatchCard
                        fixture={list[0]}
                        onSelect={onSelect}
                        variant={large ? 'cell-large' : 'cell'}
                        day={day}
                        isToday={isToday}
                      />
                    )}
                    {list.length > 1 && (
                      <div className="flex h-full flex-col gap-px p-px">
                        <span className="px-0.5 text-[9px] leading-none text-slate-600">{day}</span>
                        {list.map((f) => (
                          <MatchCard key={f.id} fixture={f} onSelect={onSelect} variant="cell-mini" />
                        ))}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
