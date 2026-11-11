import Image from 'next/image'
import { Clock, MapPin, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COMPETITION_MAP } from '@/lib/competitions'
import { formatLongDate, shortTeam, venueLabel } from '@/lib/fixtures'
import type { Fixture, SeasonMeta } from '@/lib/types'

export function SiteHeader({
  meta,
  next,
  onSelect,
  lastCheckedAt,
  isRefreshing,
  onRefresh,
}: {
  meta?: SeasonMeta
  next: Fixture | null
  onSelect: (f: Fixture) => void
  lastCheckedAt?: string
  isRefreshing: boolean
  onRefresh: () => void
}) {
  const updated = lastCheckedAt
    ? new Date(lastCheckedAt).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      })
    : '—'
  const comp = next ? COMPETITION_MAP[next.competition] : null

  return (
    <header className="relative overflow-hidden bg-navy text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background:repeating-linear-gradient(115deg,#fff_0_2px,transparent_2px_28px)]"
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-[#3478D4]" />
      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-8">
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-white p-2 shadow-lg ring-4 ring-white/15 sm:size-24">
            <Image
              src="/logos/persib.png"
              alt="Persib Bandung official crest"
              width={96}
              height={96}
              priority
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#8FB6EE]">
              Season {meta?.season ?? '2026/2027'}
            </p>
            <h1 className="font-display text-4xl font-extrabold leading-none tracking-tight sm:text-5xl">
              PERSIB CALENDAR
            </h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/75 sm:text-sm">
              2026/2027 Season · All Competitions
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/70">
              <p className="flex items-center gap-1.5" aria-live="polite">
                <Clock className="size-3" aria-hidden />
                Last checked {updated} WIB
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-7 gap-1.5 rounded-full px-2 text-xs text-white hover:bg-white/10 hover:text-white"
                aria-label={isRefreshing ? 'Refreshing match results' : 'Refresh match results now'}
              >
                <RefreshCw
                  aria-hidden
                  className={cn('size-3', isRefreshing && 'animate-spin')}
                />
                {isRefreshing ? 'Refreshing…' : 'Refresh now'}
              </Button>
            </div>
          </div>
        </div>

        {next && comp && (
          <button
            type="button"
            onClick={() => onSelect(next)}
            className="no-print group flex w-full items-stretch overflow-hidden rounded-xl bg-white text-left text-foreground shadow-lg transition hover:-translate-y-0.5 lg:w-[440px]"
          >
            <span className="w-2 shrink-0" style={{ backgroundColor: comp.color }} />
            <span className="flex flex-1 flex-col gap-1.5 p-4">
              <span className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em]">
                <span className="text-[#C8102E]">Next match</span>
                <span className="text-muted-foreground">{comp.name}</span>
              </span>
              <span className="font-display text-2xl font-bold uppercase leading-tight text-navy">
                {next.venueType === 'away'
                  ? `${shortTeam(next.opponent)} vs Persib`
                  : `Persib vs ${shortTeam(next.opponent)}`}
              </span>
              <span className="text-sm font-medium text-foreground">
                {formatLongDate(next.date)} · {next.kickoff ? `${next.kickoff} WIB` : 'Kickoff TBA'}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" aria-hidden /> {venueLabel(next)}
              </span>
            </span>
          </button>
        )}
      </div>
    </header>
  )
}
