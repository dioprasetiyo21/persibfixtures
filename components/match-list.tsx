import { MatchCard } from '@/components/match-card'
import { monthLabel } from '@/lib/fixtures'
import type { Fixture } from '@/lib/types'

export function MatchList({ fixtures, onSelect }: { fixtures: Fixture[]; onSelect: (f: Fixture) => void }) {
  const groups = new Map<string, Fixture[]>()
  for (const f of fixtures) {
    const key = f.date ? f.date.slice(0, 7) : 'TBA'
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} aria-label={key === 'TBA' ? 'Date to be announced' : monthLabel(key)}>
          <h3 className="mb-2 flex items-center gap-3 font-display text-lg font-bold uppercase tracking-wide text-navy">
            {key === 'TBA' ? 'Date TBA' : monthLabel(key)}
            <span className="h-px flex-1 bg-border" />
          </h3>
          <ul className="grid gap-2 lg:grid-cols-2">
            {list.map((f) => (
              <li key={f.id}>
                <MatchCard fixture={f} onSelect={onSelect} variant="row" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
