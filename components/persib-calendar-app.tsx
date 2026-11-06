'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarX2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/calendar'
import { CalendarToolbar } from '@/components/calendar-toolbar'
import { CompetitionFilter } from '@/components/competition-filter'
import { DashboardStats } from '@/components/dashboard-stats'
import { MatchDetailsModal } from '@/components/match-details-modal'
import { MatchList } from '@/components/match-list'
import { SiteHeader } from '@/components/site-header'
import { UpcomingStrip } from '@/components/upcoming-strip'
import { useFixtures } from '@/hooks/use-fixtures'
import { exportCSV, exportICS } from '@/lib/export'
import {
  isCompleted,
  isUpcoming,
  matchesQuery,
  monthKey,
  seasonMonths,
  sortFixtures,
  todayKeyWIB,
} from '@/lib/fixtures'
import type { CompetitionId, Fixture, ViewMode } from '@/lib/types'

export function PersibCalendarApp() {
  const { data, error, isLoading, mutate } = useFixtures()
  const [competition, setCompetition] = useState<CompetitionId | 'ALL'>('ALL')
  const [view, setView] = useState<ViewMode>('season')
  const [query, setQuery] = useState('')
  const [focusOverride, setFocusOverride] = useState<string | null>(null)
  const [selected, setSelected] = useState<Fixture | null>(null)

  const todayKey = todayKeyWIB()
  const months = useMemo(
    () => (data ? seasonMonths(data.meta.seasonStart, data.meta.seasonEnd) : []),
    [data],
  )
  const defaultMonth = months.includes(monthKey(todayKey)) ? monthKey(todayKey) : (months[0] ?? '')
  const focusMonth = focusOverride ?? defaultMonth

  const all = useMemo(() => sortFixtures(data?.fixtures ?? []), [data])
  const filtered = useMemo(
    () => all.filter((f) => (competition === 'ALL' || f.competition === competition) && matchesQuery(f, query)),
    [all, competition, query],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of all) c[f.competition] = (c[f.competition] ?? 0) + 1
    return c
  }, [all])

  const upcoming = all.filter((f) => isUpcoming(f))
  const completed = all.filter(isCompleted)
  const nextFive = upcoming.filter((f) => f.date).slice(0, 5)
  const next = nextFive[0] ?? null
  const record = completed.reduce(
    (r, f) => {
      if (!f.score) return r
      if (f.score.persib > f.score.opponent) r.w++
      else if (f.score.persib < f.score.opponent) r.l++
      else r.d++
      return r
    },
    { w: 0, d: 0, l: 0 },
  )

  function scrollToMonth(m: string) {
    requestAnimationFrame(() => {
      document.getElementById(`month-${m}`)?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' })
    })
  }

  function changeMonth(m: string) {
    setFocusOverride(m)
    if (view === 'season') scrollToMonth(m)
  }

  function goToday() {
    const m = months.includes(monthKey(todayKey)) ? monthKey(todayKey) : months[0]
    if (view !== 'month') setView('season')
    setFocusOverride(m)
    scrollToMonth(m)
  }

  const listFixtures =
    view === 'upcoming' ? filtered.filter((f) => isUpcoming(f)) : filtered.filter(isCompleted)
  const undated = filtered.filter((f) => !f.date)
  const hasFilters = competition !== 'ALL' || query !== ''

  return (
    <>
      <SiteHeader meta={data?.meta} next={next} onSelect={setSelected} />

      <main className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-6">
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-10 text-center">
            <AlertTriangle className="size-8 text-red-600" aria-hidden />
            <p className="font-semibold text-red-900">Could not load fixtures</p>
            <p className="text-sm text-red-800/80">{error.message}</p>
            <Button variant="outline" size="sm" onClick={() => mutate()}>
              <RotateCw aria-hidden /> Try again
            </Button>
          </div>
        ) : isLoading || !data ? (
          <LoadingState />
        ) : (
          <>
            <DashboardStats
              total={all.length}
              upcoming={upcoming.length}
              completed={completed.length}
              competitions={Object.keys(counts).length}
              record={record}
              next={next}
            />
            <UpcomingStrip fixtures={nextFive} onSelect={setSelected} />

            <section aria-label="Season calendar" className="flex flex-col gap-3">
              <div className="no-print sticky top-0 z-20 -mx-4 flex flex-col gap-2.5 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
                <CalendarToolbar
                  view={view}
                  onViewChange={setView}
                  months={months}
                  focusMonth={focusMonth}
                  onMonthChange={changeMonth}
                  onToday={goToday}
                  query={query}
                  onQueryChange={setQuery}
                  onPrint={() => window.print()}
                  onCSV={() => exportCSV(filtered)}
                  onICS={() => exportICS(filtered)}
                />
                <CompetitionFilter value={competition} onChange={setCompetition} counts={counts} />
              </div>

              <p className="text-xs text-muted-foreground">
                All kickoff times in WIB (UTC+7). <span className="font-semibold">*</span> provisional kickoff awaiting official confirmation.
                Striped cells are knockout fixtures that depend on qualification.
                {hasFilters && ` Showing ${filtered.length} of ${all.length} matches.`}
              </p>

              {filtered.length === 0 ? (
                <EmptyState onReset={() => { setCompetition('ALL'); setQuery('') }} />
              ) : view === 'season' || view === 'month' ? (
                <>
                  <Calendar
                    months={months}
                    fixtures={filtered}
                    todayKey={todayKey}
                    focusMonth={focusMonth}
                    mode={view}
                    onSelect={setSelected}
                  />
                  {undated.length > 0 && (
                    <div className="mt-2">
                      <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-wide text-navy">
                        Date to be announced
                      </h3>
                      <MatchList fixtures={undated} onSelect={setSelected} />
                    </div>
                  )}
                </>
              ) : listFixtures.length === 0 ? (
                <EmptyState onReset={() => { setCompetition('ALL'); setQuery('') }} />
              ) : (
                <MatchList fixtures={listFixtures} onSelect={setSelected} />
              )}
            </section>

            <footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              <p>{data.meta.notes}</p>
              <p className="mt-1">
                Fixture data lives in <code className="rounded bg-muted px-1">data/fixtures.json</code> and can be synced from a remote JSON source via{' '}
                <code className="rounded bg-muted px-1">FIXTURES_SOURCE_URL</code>. Not affiliated with PT Persib Bandung Bermartabat.
              </p>
            </footer>
          </>
        )}
      </main>

      <MatchDetailsModal fixture={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  )
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading fixtures" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-200/70" />
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[440px] animate-pulse rounded-md bg-slate-200/70" />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-white p-12 text-center">
      <CalendarX2 className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-semibold">No matches found</p>
      <p className="text-sm text-muted-foreground">Try a different competition or search term.</p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Reset filters
      </Button>
    </div>
  )
}
