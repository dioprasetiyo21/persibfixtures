import { MatchCard } from '@/components/match-card'
import type { Fixture } from '@/lib/types'

export function UpcomingStrip({ fixtures, onSelect }: { fixtures: Fixture[]; onSelect: (f: Fixture) => void }) {
  if (fixtures.length === 0) return null
  return (
    <section aria-labelledby="upcoming-heading" className="no-print">
      <div className="mb-2 flex items-end justify-between">
        <h2 id="upcoming-heading" className="font-display text-xl font-bold uppercase tracking-wide text-navy">
          Next 5 fixtures
        </h2>
        <span className="text-xs text-muted-foreground">All times WIB · * provisional kickoff</span>
      </div>
      <ol className="-mx-4 flex min-w-0 snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
        {fixtures.map((f) => (
          <li key={f.id} className="w-[calc(100vw-2rem)] max-w-none shrink-0 snap-start sm:w-auto sm:max-w-none">
            <MatchCard fixture={f} onSelect={onSelect} variant="tile" />
          </li>
        ))}
      </ol>
    </section>
  )
}
