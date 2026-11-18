'use client'

import { AlertTriangle, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TeamCrest } from '@/components/team-crest'
import { useMatchStatistics } from '@/hooks/use-match-statistics'
import { COMPETITION_MAP } from '@/lib/competitions'
import { formatLongDate, homeAway, scoreline } from '@/lib/fixtures'
import type { StatRow } from '@/lib/statistics/types'
import type { Fixture } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Persib's kit colours by venue, with the neutral opponent bar in between. */
const PERSIB_BLUE = '#1769AA'
const PERSIB_WHITE = '#FFFFFF'
const OPPONENT_NEUTRAL = '#94A3B8'

/** Shared inset edge keeps the white segment visible in both themes. */
const SEGMENT_EDGE = 'inset 0 0 0 1px rgba(100,116,139,0.28)'

type LoadState = 'not_checked' | 'pending' | 'found' | 'unavailable' | 'error'

function formatValue(value: number | null, percent: boolean): string {
  if (value === null) return '—'
  return percent ? `${value}%` : String(value)
}

/**
 * One statistic as `HOME VALUE | COMPARISON BAR | AWAY VALUE`, with the label
 * underneath. Both sides share the bar in proportion to their values, so the
 * segments represent the real split; if either side is missing the bar is left
 * empty rather than drawn from a misleading zero.
 */
function StatComparison({
  row,
  homeColor,
  awayColor,
}: {
  row: StatRow
  homeColor: string
  awayColor: string
}) {
  const home = row.home
  const away = row.away
  const total = home !== null && away !== null ? home + away : 0
  const comparable = home !== null && away !== null && total > 0
  const homeShare = comparable ? (home / total) * 100 : 0
  const awayShare = comparable ? 100 - homeShare : 0

  return (
    <div>
      <div className="grid grid-cols-[minmax(2.75rem,auto)_1fr_minmax(2.75rem,auto)] items-center gap-2.5 sm:gap-3">
        <span
          className={cn(
            'text-right text-sm font-bold tabular-nums',
            home === null && 'font-medium text-muted-foreground',
          )}
        >
          {formatValue(home, row.percent)}
        </span>
        <div
          className="relative flex h-2.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/60"
          role="presentation"
        >
          {comparable ? (
            <>
              <div
                className="h-full"
                style={{ width: `${homeShare}%`, backgroundColor: homeColor, boxShadow: SEGMENT_EDGE }}
              />
              <div
                className="h-full"
                style={{ width: `${awayShare}%`, backgroundColor: awayColor, boxShadow: SEGMENT_EDGE }}
              />
            </>
          ) : null}
        </div>
        <span
          className={cn(
            'text-sm font-bold tabular-nums',
            away === null && 'font-medium text-muted-foreground',
          )}
        >
          {formatValue(away, row.percent)}
        </span>
      </div>
      <p className="mt-1 text-center text-[11px] font-medium leading-tight text-muted-foreground">
        {row.label}
      </p>
    </div>
  )
}

function TeamColumn({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <TeamCrest name={name} className="size-12 shrink-0 sm:size-14" />
      <span className="line-clamp-2 text-[11px] font-semibold uppercase leading-tight">
        {name}
      </span>
    </div>
  )
}

/** Skeleton that mirrors the final row layout so the modal does not jump. */
function StatisticsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {[0, 1].map((group) => (
        <section key={group} className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="space-y-1.5">
              <div className="grid grid-cols-[minmax(2.75rem,auto)_1fr_minmax(2.75rem,auto)] items-center gap-2.5">
                <div className="ml-auto h-4 w-8 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-full animate-pulse rounded-full bg-muted" />
                <div className="h-4 w-8 animate-pulse rounded bg-muted" />
              </div>
              <div className="mx-auto h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

export function MatchStatisticsModal({
  fixture,
  open,
  onOpenChange,
}: {
  fixture: Fixture | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, error, isLoading, retry } = useMatchStatistics(fixture?.id ?? null, open)

  const comp = fixture ? COMPETITION_MAP[fixture.competition] : null
  const persibIsHome = fixture ? fixture.venueType !== 'away' : true
  const homeColor = persibIsHome ? PERSIB_BLUE : OPPONENT_NEUTRAL
  const awayColor = persibIsHome ? OPPONENT_NEUTRAL : PERSIB_WHITE

  const expected = fixture ? homeAway(fixture) : null
  // `home`/`away` are guaranteed by the API contract, but a malformed payload
  // must not be able to crash the whole calendar — fall back to fixture names.
  const homeName = data?.home?.name ?? expected?.home ?? 'Home'
  const awayName = data?.away?.name ?? expected?.away ?? 'Away'

  const homeScore = data?.home?.score ?? null
  const awayScore = data?.away?.score ?? null
  const score =
    homeScore !== null && awayScore !== null
      ? `${homeScore}–${awayScore}`
      : (fixture ? scoreline(fixture) : null) ?? 'VS'

  const state: LoadState = error
    ? 'error'
    : data
      ? data.state
      : isLoading
        ? 'pending'
        : 'not_checked'

  const busy = state === 'pending' || state === 'not_checked'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {fixture && comp && (
          <>
            <div className="px-5 pb-4 pt-4" style={{ backgroundColor: comp.color, color: comp.text }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-85">
                {comp.name}
              </p>
              <DialogTitle className="mt-0.5 font-display text-base font-bold uppercase tracking-wide sm:text-lg">
                Statistik Pertandingan
              </DialogTitle>
              <DialogDescription className="sr-only">
                Statistik pertandingan {fixture.round}
              </DialogDescription>

              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <TeamColumn name={homeName} />
                <div className="flex shrink-0 flex-col items-center px-1">
                  <div className="font-display text-3xl font-bold leading-none tabular-nums sm:text-4xl">
                    {score}
                  </div>
                  {fixture.status === 'finished' && (
                    <span className="mt-1.5 rounded-full bg-black/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]">
                      Full time
                    </span>
                  )}
                </div>
                <TeamColumn name={awayName} />
              </div>

              <p className="mt-2.5 text-center text-[11px] font-medium uppercase tracking-wider opacity-85">
                {formatLongDate(fixture.date)}
              </p>
              <p className="text-center text-[11px] font-semibold uppercase tracking-wider opacity-90">
                {fixture.round}
              </p>
            </div>

            <div className="px-5 py-4">
              {busy ? (
                <div className="space-y-4">
                  <p className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Memuat statistik…
                  </p>
                  <StatisticsSkeleton />
                </div>
              ) : null}

              {state === 'unavailable' ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <AlertTriangle className="size-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">Statistik belum tersedia</p>
                  {data?.message ? (
                    <p className="max-w-sm text-xs text-muted-foreground">{data.message}</p>
                  ) : null}
                </div>
              ) : null}

              {state === 'error' ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <AlertTriangle className="size-5 text-destructive" aria-hidden />
                  <p className="text-sm font-medium">Statistik gagal dimuat</p>
                  <p className="max-w-sm text-xs text-muted-foreground">{error ?? data?.message}</p>
                  <Button variant="outline" size="sm" onClick={retry}>
                    <RotateCw aria-hidden />
                    Coba lagi
                  </Button>
                </div>
              ) : null}

              {state === 'found' && data ? (
                <div className="space-y-5">
                  {(data.groups ?? []).map((group, index) => (
                    <section
                      key={group.id}
                      className={cn(index > 0 && 'border-t border-border/70 pt-5')}
                    >
                      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        <span className="size-1 rounded-full bg-current opacity-60" aria-hidden />
                        {group.label}
                      </h3>
                      <div className="space-y-3.5">
                        {group.rows.map((row) => (
                          <StatComparison
                            key={row.key}
                            row={row}
                            homeColor={homeColor}
                            awayColor={awayColor}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/50 px-5 py-3">
              {data?.source?.url ? (
                <a
                  href={data.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1F5FB8] underline-offset-2 hover:underline"
                >
                  Sumber resmi: {data.source.name}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Statistik dikutip dari situs resmi kompetisi.
                </span>
              )}
              {state === 'error' ? (
                <Button variant="ghost" size="sm" onClick={retry}>
                  <RotateCw aria-hidden />
                  Muat ulang
                </Button>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
