import { MonthGrid } from '@/components/month-grid'
import type { Fixture } from '@/lib/types'

interface CalendarProps {
  months: string[]
  fixtures: Fixture[]
  todayKey: string
  focusMonth: string
  mode: 'season' | 'month'
  onSelect: (f: Fixture) => void
}

export function Calendar({ months, fixtures, todayKey, focusMonth, mode, onSelect }: CalendarProps) {
  const byDate = new Map<string, Fixture[]>()
  for (const f of fixtures) {
    if (!f.date) continue
    byDate.set(f.date, [...(byDate.get(f.date) ?? []), f])
  }

  if (mode === 'month') {
    return (
      <MonthGrid
        monthKey={focusMonth}
        fixturesByDate={byDate}
        todayKey={todayKey}
        onSelect={onSelect}
        size="large"
      />
    )
  }

  return (
    <div className="print-grid -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:snap-none md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 xl:grid-cols-3">
      {months.map((m) => (
        <div key={m} className="w-[calc(100vw-2rem)] shrink-0 snap-center md:w-auto">
          <MonthGrid
            monthKey={m}
            fixturesByDate={byDate}
            todayKey={todayKey}
            onSelect={onSelect}
            highlighted={m === focusMonth}
          />
        </div>
      ))}
    </div>
  )
}
