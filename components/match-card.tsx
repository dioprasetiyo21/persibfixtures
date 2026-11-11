import { TeamLogo } from '@/components/team-crest'
import { COMPETITION_MAP } from '@/lib/competitions'
import {
  formatShortDate,
  isAwaitingResult,
  isLive,
  resultOutcome,
  scoreline,
  shortTeam,
  STATUS_LABEL,
  statusLabel,
  venueLabel,
} from '@/lib/fixtures'
import { teamLogo } from '@/lib/team-logos'
import type { Fixture } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MapPin } from 'lucide-react'

interface MatchCardProps {
  fixture: Fixture
  onSelect: (f: Fixture) => void
  variant: 'cell' | 'cell-mini' | 'cell-large' | 'tile' | 'row'
  day?: number
  isToday?: boolean
}

function timeLabel(f: Fixture) {
  return f.kickoff ?? 'TBA'
}

function statusLine(f: Fixture, large = false) {
  if (f.status === 'finished') {
    const o = resultOutcome(f)
    return `FT${o ? ` · ${o}` : ''}`
  }
  if (isLive(f)) return 'LIVE'
  if (isAwaitingResult(f)) return large ? 'AWAITING RESULT' : 'PENDING'
  if (f.status === 'postponed') return 'POSTPONED'
  if (f.status === 'cancelled') return 'CANCELLED'
  if (f.venueType === 'tba') return f.status === 'tentative' ? 'IF QUALIFIED' : 'TBA'
  const ha = f.venueType === 'home' ? 'HOME' : f.venueType === 'away' ? 'AWAY' : 'NEUTRAL'
  return f.kickoff ? ha : `${ha} · KO TBA`
}

function ariaLabel(f: Fixture) {
  const comp = COMPETITION_MAP[f.competition]
  const score = scoreline(f)
  return `${comp.name}, ${f.round}: Persib ${score ? score : 'versus'} ${f.opponent}, ${
    f.venueType
  }, ${formatShortDate(f.date)}, ${f.kickoff ? `${f.kickoff} WIB` : 'kickoff to be announced'}, ${
    STATUS_LABEL[f.status]
  }`
}

export function MatchCard({ fixture: f, onSelect, variant, day, isToday }: MatchCardProps) {
  const comp = COMPETITION_MAP[f.competition]
  const score = f.score ? `${f.score.persib}–${f.score.opponent}` : null
  const muted = f.status === 'cancelled' || f.status === 'postponed'
  const style = { backgroundColor: comp.color, color: comp.text }
  const dashed = f.status === 'tentative' || f.status === 'tba'
  const hasLogo = !!teamLogo(f.opponent)

  if (variant === 'cell' || variant === 'cell-large') {
    const large = variant === 'cell-large'
    return (
      <button
        type="button"
        onClick={() => onSelect(f)}
        aria-label={ariaLabel(f)}
        style={style}
        className={cn(
          'group relative flex h-full w-full flex-col overflow-hidden text-left transition-[filter,transform] hover:brightness-110 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white',
          large ? 'gap-1 p-2' : 'gap-px px-1 py-0.5',
          muted && 'opacity-60 line-through',
          dashed && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.14)_6px_12px)]',
          isToday && 'ring-2 ring-inset ring-yellow-300',
        )}
      >
        <span className="flex items-start justify-between gap-1">
          <span className={cn('font-semibold tabular-nums', large ? 'text-xs' : 'text-[9px] leading-none')}>
            {day}
          </span>
          <span
            className={cn(
              'rounded-[2px] bg-black/15 font-bold tracking-wider',
              large ? 'px-1 text-[10px]' : 'px-0.5 text-[7px] leading-[10px]',
            )}
          >
            {comp.short}
          </span>
        </span>
        <span className="mt-auto flex flex-col items-center text-center">
          <span className={cn('flex items-center justify-center', large ? 'gap-2' : 'flex-col gap-px')}>
            {hasLogo && <TeamLogo name={f.opponent} className={large ? 'size-9' : 'size-[22px]'} />}
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  'font-display font-bold tabular-nums leading-none',
                  large ? 'text-xl' : 'text-[13px]',
                )}
              >
                {f.status === 'finished' && score ? score : timeLabel(f)}
                {f.kickoff && !f.kickoffConfirmed && f.status !== 'finished' && (
                  <sup className="ml-px text-[0.6em]" aria-hidden>
                    *
                  </sup>
                )}
              </span>
              <span
                className={cn(
                  'font-bold uppercase tracking-wider opacity-80',
                  large ? 'mt-0.5 text-[10px]' : 'text-[7px] leading-[10px]',
                )}
              >
                {statusLine(f, large)}
              </span>
            </span>
          </span>
          {(large || !hasLogo) && (
            <span
              className={cn(
                'w-full truncate font-semibold uppercase leading-tight',
                large ? 'mt-1 text-sm' : 'text-[8.5px]',
              )}
            >
              {large ? (
                <>
                  PERSIB {f.status === 'finished' && score ? score : 'vs'} {shortTeam(f.opponent)}
                </>
              ) : (
                <>
                  {f.venueType === 'away' ? '@ ' : f.venueType === 'tba' ? '' : 'vs '}
                  {f.opponent === 'TBD' ? f.round.split(' · ')[0] : shortTeam(f.opponent)}
                </>
              )}
            </span>
          )}
        </span>
      </button>
    )
  }

  if (variant === 'cell-mini') {
    return (
      <button
        type="button"
        onClick={() => onSelect(f)}
        aria-label={ariaLabel(f)}
        style={style}
        className="flex min-h-0 w-full flex-1 items-center justify-between gap-1 overflow-hidden rounded-[2px] px-1 text-left text-[8px] font-semibold uppercase leading-tight hover:brightness-110"
      >
        <span className="font-display text-[10px] font-bold tabular-nums">
          {f.status === 'finished' && score ? score : timeLabel(f)}
        </span>
        <span className="flex min-w-0 items-center gap-0.5">
          <TeamLogo name={f.opponent} className="size-3.5" />
          {!hasLogo && <span className="truncate">{shortTeam(f.opponent)}</span>}
        </span>
      </button>
    )
  }

  if (variant === 'tile') {
    return (
      <button
        type="button"
        onClick={() => onSelect(f)}
        aria-label={ariaLabel(f)}
        className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="h-1.5 w-full" style={{ backgroundColor: comp.color }} />
        <span className="flex flex-1 flex-col gap-2 p-3">
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{formatShortDate(f.date)}</span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: comp.color, color: comp.text }}
            >
              {comp.short}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="font-display text-lg font-bold uppercase leading-tight text-foreground">
              {f.venueType === 'away' ? `${shortTeam(f.opponent)} vs Persib` : `Persib vs ${shortTeam(f.opponent)}`}
            </span>
            {hasLogo && <TeamLogo name={f.opponent} className="size-10" />}
          </span>
          <span className="mt-auto flex items-center justify-between text-xs">
            <span className="font-display text-base font-bold tabular-nums text-navy">
              {f.status === 'finished' && score
                ? `FT ${score}`
                : f.kickoff
                  ? `${f.kickoff} WIB`
                  : 'Kickoff TBA'}
              {f.kickoff && !f.kickoffConfirmed && f.status !== 'finished' && (
                <span className="text-muted-foreground">*</span>
              )}
            </span>
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              {f.venueType === 'tba' ? 'TBA' : f.venueType}
            </span>
          </span>
        </span>
      </button>
    )
  }

  const outcome = resultOutcome(f)
  return (
    <button
      type="button"
      onClick={() => onSelect(f)}
      aria-label={ariaLabel(f)}
      className="flex w-full items-stretch overflow-hidden rounded-md border border-border bg-card text-left transition hover:border-navy-2/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="w-1.5 shrink-0" style={{ backgroundColor: comp.color }} />
      <span className="flex w-20 shrink-0 flex-col justify-center border-r border-border px-3 py-2 sm:w-24">
        <span className="text-[11px] font-semibold uppercase text-muted-foreground">
          {formatShortDate(f.date).split(' ')[0]}
        </span>
        <span className="font-display text-lg font-bold leading-none text-navy">
          {formatShortDate(f.date).split(' ').slice(1).join(' ') || 'TBA'}
        </span>
      </span>
      {hasLogo && (
        <span className="flex shrink-0 items-center pl-3">
          <TeamLogo name={f.opponent} className="size-9" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: comp.color === '#20C96B' ? '#12834A' : comp.color === '#F29A43' ? '#B5621A' : comp.color }}>
          {comp.name} · {f.round}
        </span>
        <span className="truncate font-display text-base font-bold uppercase text-foreground sm:text-lg">
          {f.venueType === 'away'
            ? `${f.opponent} ${scoreline(f) ?? 'vs'} Persib`
            : `Persib ${scoreline(f) ?? 'vs'} ${f.opponent}`}
        </span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{venueLabel(f)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end justify-center gap-1 px-3 py-2">
        {f.status === 'finished' && outcome ? (
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded font-display text-sm font-bold text-white',
              outcome === 'W' && 'bg-emerald-600',
              outcome === 'D' && 'bg-slate-500',
              outcome === 'L' && 'bg-red-600',
            )}
          >
            {outcome}
          </span>
        ) : (
          <span className="font-display text-lg font-bold tabular-nums text-navy">
            {f.kickoff ?? 'TBA'}
            {f.kickoff && !f.kickoffConfirmed && <span className="text-muted-foreground">*</span>}
          </span>
        )}
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
            (isLive(f) || isAwaitingResult(f)) && 'text-amber-700',
          )}
        >
          {statusLabel(f)}
        </span>
      </span>
    </button>
  )
}
