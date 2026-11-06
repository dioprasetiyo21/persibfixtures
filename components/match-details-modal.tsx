'use client'

import { useState } from 'react'
import { CalendarPlus, Check, ExternalLink, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TeamCrest } from '@/components/team-crest'
import { COMPETITION_MAP } from '@/lib/competitions'
import { formatLongDate, homeAway, scoreline, STATUS_LABEL, venueLabel } from '@/lib/fixtures'
import { exportICS, shareText } from '@/lib/export'
import type { Fixture } from '@/lib/types'

export function MatchDetailsModal({
  fixture,
  onOpenChange,
}: {
  fixture: Fixture | null
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const f = fixture

  async function handleShare() {
    if (!f) return
    const text = shareText(f)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Persib match', text, url: window.location.href })
        return
      } catch {
        // fall through to clipboard when the share sheet is dismissed or unavailable
      }
    }
    await navigator.clipboard.writeText(`${text}\n${window.location.href}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={!!f} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {f && (() => {
          const comp = COMPETITION_MAP[f.competition]
          const { home, away } = homeAway(f)
          const score = scoreline(f)
          const rows: [string, React.ReactNode][] = [
            ['Date', f.dateWindow ? `${formatLongDate(f.date)} (window ${f.dateWindow})` : formatLongDate(f.date)],
            [
              'Kickoff',
              f.kickoff
                ? `${f.kickoff} WIB (UTC+7)${f.kickoffConfirmed ? '' : ' · provisional'}`
                : 'To be announced',
            ],
            ['Competition', `${comp.name} · ${f.round}`],
            ['Stadium', venueLabel(f)],
            ['Persib', f.venueType === 'tba' ? 'Home/away TBA' : f.venueType === 'home' ? 'Home' : f.venueType === 'away' ? 'Away' : 'Neutral'],
            ['Status', STATUS_LABEL[f.status]],
          ]
          if (f.notes) rows.push(['Notes', f.notes])
          return (
            <>
              <div className="px-5 pb-5 pt-4" style={{ backgroundColor: comp.color, color: comp.text }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-85">
                  {comp.name}
                </p>
                <DialogTitle className="mt-0.5 font-display text-xl font-bold uppercase leading-tight">
                  {home} vs {away}
                </DialogTitle>
                <DialogDescription className="sr-only">Match details for {f.round}</DialogDescription>
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <TeamCrest name={home} />
                    <span className="text-xs font-semibold uppercase">{home}</span>
                  </div>
                  <div className="text-center">
                    <div className="font-display text-4xl font-bold tabular-nums">
                      {score ?? 'VS'}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-85">
                      {f.status === 'finished' ? 'Full time' : f.kickoff ? `${f.kickoff} WIB` : 'KO TBA'}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2 text-center">
                    <TeamCrest name={away} />
                    <span className="text-xs font-semibold uppercase">{away}</span>
                  </div>
                </div>
              </div>

              <dl className="divide-y divide-border px-5">
                {rows.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[96px_1fr] gap-3 py-2.5 text-sm">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
                    <dd className="text-foreground">{v}</dd>
                  </div>
                ))}
                <div className="grid grid-cols-[96px_1fr] gap-3 py-2.5 text-sm">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</dt>
                  <dd>
                    <a
                      href={f.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#1F5FB8] underline-offset-2 hover:underline"
                    >
                      {f.source.name}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                    <p className="text-xs text-muted-foreground">Verified {formatLongDate(f.verifiedAt)}</p>
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2 border-t border-border bg-muted/50 px-5 py-3">
                {f.date && (
                  <Button variant="outline" size="sm" onClick={() => exportICS([f], `persib-${f.id}.ics`)}>
                    <CalendarPlus aria-hidden /> Add to calendar
                  </Button>
                )}
                <Button size="sm" onClick={handleShare}>
                  {copied ? <Check aria-hidden /> : <Share2 aria-hidden />}
                  {copied ? 'Copied' : 'Share match'}
                </Button>
              </div>
            </>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
