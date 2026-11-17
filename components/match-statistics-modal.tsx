'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TeamCrest } from '@/components/team-crest'
import { COMPETITION_MAP } from '@/lib/competitions'
import { formatLongDate } from '@/lib/fixtures'
import type { MatchStatistics, StatRow } from '@/lib/statistics/types'
import type { Fixture } from '@/lib/types'

const PERSIB_HOME = '#1769AA'
const PERSIB_AWAY = '#FFFFFF'
const OPPONENT_BAR = '#94A3B8'

type LoadState = 'not_checked' | 'pending' | 'found' | 'unavailable' | 'error'

function formatValue(value: number | null, percent: boolean): string {
  if (value === null) return '—'
  return percent ? `${value}%` : String(value)
}

function StatComparison({
  row,
  homeColor,
  awayColor,
}: {
  row: StatRow
  homeColor: string
  awayColor: string
}) {
  const home = row.home ?? 0
  const away = row.away ?? 0
  const max = Math.max(home, away)
  const homeWidth = max > 0 ? (home / max) * 100 : 0
  const awayWidth = max > 0 ? (away / max) * 100 : 0

  return (
    <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2">
      <span className="text-right text-sm font-semibold tabular-nums">
        {formatValue(row.home, row.percent)}
      </span>
      <div className="flex h-2 items-stretch overflow-hidden rounded-full bg-muted" role="presentation">
        <div className="flex flex-1 justify-end">
          <div
            className="h-full rounded-l-full"
            style={{
              width: `${homeWidth}%`,
              backgroundColor: homeColor,
              boxShadow: 'inset 0 0 0 1px rgba(100,116,139,0.35)',
            }}
          />
        </div>
        <div className="flex flex-1">
          <div
            className="h-full rounded-r-full"
            style={{
              width: `${awayWidth}%`,
              backgroundColor: awayColor,
              boxShadow: 'inset 0 0 0 1px rgba(100,116,139,0.35)',
            }}
          />
        </div>
      </div>
      <span className="text-sm font-semibold tabular-nums">
        {formatValue(row.away, row.percent)}
      </span>
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
  const [state, setState] = useState<LoadState>('not_checked')
  const [data, setData] = useState<MatchStatistics | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fixtureId = fixture?.id ?? null

  useEffect(() => {
    if (!open || !fixtureId) return
    const controller = new AbortController()
    let active = true

    setState('pending')
    setData(null)
    setError(null)

    fetch(`/api/matches/${encodeURIComponent(fixtureId)}/statistics`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? `Gagal memuat statistik (${res.status})`)
        return body as MatchStatistics
      })
      .then((body) => {
        if (!active) return
        setData(body)
        setState(body.state)
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === 'AbortError')) return
        setError(cause instanceof Error ? cause.message : 'Gagal memuat statistik.')
        setState('error')
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [open, fixtureId])

  const comp = fixture ? COMPETITION_MAP[fixture.competition] : null
  const persibIsHome = fixture ? fixture.venueType !== 'away' : true
  const homeColor = persibIsHome ? PERSIB_HOME : OPPONENT_BAR
  const awayColor = persibIsHome ? OPPONENT_BAR : PERSIB_AWAY

  const home = data?.home ?? (fixture ? { name: persibIsHome ? 'Persib Bandung' : fixture.opponent, score: null } : null)
  const away = data?.away ?? (fixture ? { name: persibIsHome ? fixture.opponent : 'Persib Bandung', score: null } : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {fixture && comp && home && away && (
          <>
            <div className="px-5 pb-5 pt-4" style={{ backgroundColor: comp.color, color: comp.text }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-85">
                {comp.name}
              </p>
              <DialogTitle className="mt-0.5 font-display text-xl font-bold uppercase leading-tight">
                Statistik Pertandingan
              </DialogTitle>
              <DialogDescription className="sr-only">
                Statistik pertandingan {fixture.round}
              </DialogDescription>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="flex flex-col items-center gap-2 text-center">
                  <TeamCrest name={home.name} />
                  <span className="text-xs font-semibold uppercase">{home.name}</span>
                </div>
                <div className="text-center">
                  <div className="font-display text-3xl font-bold tabular-nums">
                    {home.score !== null && away.score !== null ? `${home.score}–${away.score}` : 'VS'}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest opacity-85">
                    Full time
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2 text-center">
                  <TeamCrest name={away.name} />
                  <span className="text-xs font-semibold uppercase">{away.name}</span>
                </div>
              </div>
              <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-wider opacity-85">
                {formatLongDate(fixture.date)} · {fixture.round}
              </p>
            </div>

            <div className="px-5 py-4">
              {state === 'pending' || state === 'not_checked' ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Memuat statistik…
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
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <AlertTriangle className="size-5 text-destructive" aria-hidden />
                  <p className="text-sm font-medium">Statistik gagal dimuat</p>
                  <p className="max-w-sm text-xs text-muted-foreground">{error ?? data?.message}</p>
                  <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    Tutup
                  </Button>
                </div>
              ) : null}

              {state === 'found' && data ? (
                <div className="space-y-5">
                  {data.groups.map((group) => (
                    <section key={group.id}>
                      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        {group.label}
                      </h3>
                      <div className="space-y-2.5">
                        {group.rows.map((row) => (
                          <div key={row.key} className="space-y-1">
                            <StatComparison row={row} homeColor={homeColor} awayColor={awayColor} />
                            <p className="text-center text-xs font-medium text-muted-foreground">
                              {row.label}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="border-t border-border bg-muted/50 px-5 py-3">
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
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
