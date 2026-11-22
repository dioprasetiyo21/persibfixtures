'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Link2, Loader2, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { COMPETITION_MAP } from '@/lib/competitions'
import { SYNC_MESSAGES, type UseSync } from '@/hooks/use-sync'
import type { HighlightCandidate, HighlightSelection } from '@/lib/highlights/types'
import type { ProposedChange } from '@/lib/sync/types'
import { cn } from '@/lib/utils'

function value(text: string | null): string {
  return text === null || text === '' ? '—' : text
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function ChangeCard({ change }: { change: ProposedChange }) {
  const comp = COMPETITION_MAP[change.competition]
  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: comp.color, color: comp.text }}
        >
          {comp.short}
        </span>
        <h4 className="font-display text-sm font-bold uppercase leading-tight text-brand">
          {change.home} vs {change.away}
        </h4>
        {change.kind === 'create' && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
            New fixture
          </span>
        )}
        <span className="ml-auto text-[11px] font-medium text-muted-foreground">
          #{change.fixtureId}
          {change.week !== null ? ` · Pekan ${change.week}` : ''}
        </span>
      </header>

      <p className="mt-0.5 text-[11px] text-muted-foreground">{change.round}</p>

      <dl className="mt-2 divide-y divide-border/70">
        {change.changes.map((field) => (
          <div key={field.field} className="grid grid-cols-[104px_1fr] gap-2 py-1.5 text-xs">
            <dt className="font-semibold uppercase tracking-wider text-muted-foreground">{field.label}</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground line-through decoration-red-400/70">{value(field.from)}</span>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
              <span className="font-semibold text-foreground">{value(field.to)}</span>
            </dd>
          </div>
        ))}
      </dl>

      {change.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {change.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>Source:</span>
        <a
          href={change.source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-info underline-offset-2 hover:underline"
        >
          {change.source.name}
          <ExternalLink className="size-3" aria-hidden />
        </a>
        <span>· verified {change.verifiedAt}</span>
      </p>
    </article>
  )
}

function CandidateCard({
  candidate,
  approved,
  rejected,
  manualOverride,
  onApprove,
  onReject,
}: {
  candidate: HighlightCandidate
  approved: boolean
  rejected: boolean
  manualOverride: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <article
      className={cn(
        'rounded-lg border bg-card p-3',
        approved ? 'border-emerald-400 dark:border-emerald-500/60' : 'border-border',
        rejected && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <Video className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <a
            href={candidate.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1 text-sm font-semibold leading-snug text-foreground underline-offset-2 hover:underline"
          >
            <span className="line-clamp-2">{candidate.title}</span>
            <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
          </a>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {candidate.channel} · {formatDuration(candidate.durationSeconds)} · score {candidate.score}
          </p>
        </div>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          #{candidate.fixtureId}
        </span>
      </div>

      {candidate.reasons.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {candidate.reasons.join(' · ')}
        </p>
      )}

      {manualOverride && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <Link2 className="size-3 shrink-0" aria-hidden />
          A manual URL is filled for this match; it takes priority over this candidate.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={approved ? 'default' : 'outline'}
          size="sm"
          onClick={onApprove}
          disabled={manualOverride}
          aria-pressed={approved}
        >
          <Check aria-hidden />
          {approved ? 'Approved' : 'Approve'}
        </Button>
        <Button
          type="button"
          variant={rejected ? 'destructive' : 'outline'}
          size="sm"
          onClick={onReject}
          disabled={manualOverride}
          aria-pressed={rejected}
        >
          {rejected ? <Check aria-hidden /> : <X aria-hidden />}
          {rejected ? 'Rejected' : 'Reject'}
        </Button>
      </div>
    </article>
  )
}

const EMPTY_SELECTION: HighlightSelection = {
  approvedCandidateIds: [],
  rejectedFixtureIds: [],
  manualUrls: {},
}

export function SyncDialog({ sync }: { sync: UseSync }) {
  const [adminToken, setAdminToken] = useState('')
  const [selection, setSelection] = useState<HighlightSelection>(EMPTY_SELECTION)

  const preview = sync.preview
  const highlights = preview?.highlights
  const hasHighlightWork = !!highlights &&
    (highlights.candidates.length > 0 ||
      highlights.manualTargets.length > 0 ||
      highlights.searchStateChanged)
  const open = sync.phase === 'preview' || sync.phase === 'committing'
  const authOpen = sync.phase === 'error' && sync.authRequired
  const committing = sync.phase === 'committing'
  const title = sync.kind === 'scores'
    ? 'Score changes found'
    : preview?.changes.length && hasHighlightWork
      ? 'Schedule & highlight preview'
      : hasHighlightWork
        ? 'Match highlights found'
        : 'Schedule changes found'
  const summary = preview?.summary

  // A new preview invalidates any previous approvals/inputs.
  useEffect(() => {
    setSelection(EMPTY_SELECTION)
  }, [preview])

  function approveCandidate(candidate: HighlightCandidate) {
    setSelection((current) => ({
      ...current,
      approvedCandidateIds: [
        ...current.approvedCandidateIds.filter(
          (id) => !id.startsWith(`${candidate.fixtureId}:`),
        ),
        candidate.id,
      ],
      rejectedFixtureIds: current.rejectedFixtureIds.filter((id) => id !== candidate.fixtureId),
    }))
  }

  function toggleReject(fixtureId: string) {
    setSelection((current) => ({
      ...current,
      approvedCandidateIds: current.approvedCandidateIds.filter(
        (id) => !id.startsWith(`${fixtureId}:`),
      ),
      rejectedFixtureIds: current.rejectedFixtureIds.includes(fixtureId)
        ? current.rejectedFixtureIds.filter((id) => id !== fixtureId)
        : [...current.rejectedFixtureIds, fixtureId],
    }))
  }

  function setManualUrl(fixtureId: string, url: string) {
    setSelection((current) => {
      const manualUrls = { ...current.manualUrls }
      if (url.trim()) manualUrls[fixtureId] = url
      else delete manualUrls[fixtureId]
      return { ...current, manualUrls }
    })
  }

  const selectedCount = selection.approvedCandidateIds.length + Object.keys(selection.manualUrls).length

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !sync.isBusy) sync.cancel()
        }}
      >
        <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide text-brand">
              {title}
            </DialogTitle>
            <DialogDescription>
              {hasHighlightWork
                ? 'Review schedule changes and highlight candidates. Nothing is published until you confirm.'
                : SYNC_MESSAGES.preview}
            </DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="flex max-h-[58dvh] flex-col gap-3 overflow-y-auto px-5 py-4">
              <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {summary && (
                  <p className="font-medium text-foreground">
                    {summary.checked} official {summary.checked === 1 ? 'match' : 'matches'} checked ·{' '}
                    {summary.changed} {summary.changed === 1 ? 'update' : 'updates'} · {summary.created} new ·{' '}
                    {summary.unchanged} already up to date
                  </p>
                )}
                <p className="mt-0.5">
                  GitHub data: {preview.base.fixtureCount} fixtures · {preview.base.path}@{preview.base.branch}
                </p>
              </div>

              {preview.warnings.length > 0 && (
                <ul className="flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              {preview.changes.map((change) => (
                <ChangeCard key={`${change.kind}-${change.fixtureId}`} change={change} />
              ))}

              {highlights && (
                <section aria-label="Match highlights preview" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 border-b border-border pb-1">
                    <h3 className="font-display text-sm font-bold uppercase tracking-wide text-brand">
                      Match highlights
                    </h3>
                    <span className="text-[11px] text-muted-foreground">
                      {highlights.search.searched} searched · {highlights.candidates.length} candidates ·{' '}
                      {highlights.manualTargets.length} manual options
                    </span>
                  </div>

                  {highlights.candidates.length === 0 && highlights.manualTargets.length === 0 && (
                    <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      No automatic candidates were found. You can still paste a YouTube URL below for any finished match.
                    </p>
                  )}

                  {highlights.searchStateChanged && (
                    <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      Search cooldown/quota state changed and will be saved when you confirm.
                    </p>
                  )}

                  {highlights.candidates.map((candidate) => (
                    <CandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      approved={selection.approvedCandidateIds.includes(candidate.id)}
                      rejected={selection.rejectedFixtureIds.includes(candidate.fixtureId)}
                      manualOverride={!!selection.manualUrls[candidate.fixtureId]?.trim()}
                      onApprove={() => approveCandidate(candidate)}
                      onReject={() => toggleReject(candidate.fixtureId)}
                    />
                  ))}

                  {highlights.manualTargets.length > 0 && (
                    <details className="rounded-md border border-border px-3 py-2 text-xs" open={highlights.candidates.length === 0}>
                      <summary className="cursor-pointer font-semibold">
                        Paste a YouTube URL manually ({highlights.manualTargets.length})
                      </summary>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        A manual URL has the highest priority and is never overwritten by automatic search.
                      </p>
                      <div className="mt-2 flex flex-col gap-2">
                        {highlights.manualTargets.map((target) => (
                          <div key={target.fixtureId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-2">
                            <label htmlFor={`manual-${target.fixtureId}`} className="text-[11px] font-medium text-foreground">
                              {target.label}
                            </label>
                            <Input
                              id={`manual-${target.fixtureId}`}
                              type="url"
                              inputMode="url"
                              placeholder="https://www.youtube.com/watch?v=…"
                              value={selection.manualUrls[target.fixtureId] ?? ''}
                              onChange={(event) => setManualUrl(target.fixtureId, event.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {highlights.skipped.length > 0 && (
                    <details className="rounded-md border border-border px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-semibold">
                        {highlights.skipped.length} highlight {highlights.skipped.length === 1 ? 'result was' : 'results were'} skipped
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                        {highlights.skipped.map((item) => (
                          <li key={`${item.fixtureId}-${item.label}-${item.reason}`}>
                            <span className="font-medium text-foreground">{item.label}</span> — {item.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}

              {preview.skipped.length > 0 && (
                <details className="rounded-md border border-border px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-semibold">
                    {preview.skipped.length} source{' '}
                    {preview.skipped.length === 1 ? 'match was' : 'matches were'} skipped
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
                    {preview.skipped.map((item) => (
                      <li key={`${item.match}-${item.date ?? ''}-${item.reason}`}>
                        <span className="font-medium text-foreground">{item.match}</span>
                        {item.date ? ` (${item.date})` : ''} — {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="rounded-md border border-border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-semibold">
                  Sources checked ({preview.reports.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {preview.reports.map((report) => (
                    <li key={report.name} className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn('font-medium', report.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300')}>
                        {report.ok ? 'OK' : 'FAILED'}
                      </span>
                      <span className="text-foreground">{report.name}</span>
                      <span className="text-muted-foreground">
                        {report.found} Persib {report.found === 1 ? 'match' : 'matches'} · {report.durationMs} ms
                        {report.error ? ` · ${report.error}` : ''}
                        {report.note ? ` · ${report.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3">
            {hasHighlightWork && !committing && (
              <span className="mr-auto text-[11px] text-muted-foreground">
                {selectedCount === 0
                  ? 'No highlights selected'
                  : `${selectedCount} highlight${selectedCount === 1 ? '' : 's'} selected`}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={sync.cancel} disabled={committing}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void sync.confirm(hasHighlightWork ? selection : undefined)}
              disabled={committing || !sync.token}
            >
              {committing && <Loader2 className="animate-spin" aria-hidden />}
              {committing ? 'Committing…' : 'Confirm & Commit'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={authOpen}
        onOpenChange={(next) => {
          if (!next) sync.dismiss()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Admin token required</DialogTitle>
            <DialogDescription>
              This deployment protects refresh actions with a sync admin token. Paste it below; it is kept only in
              this browser tab.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              sync.saveAdminToken(adminToken)
              setAdminToken('')
              sync.retry()
            }}
          >
            <Input
              type="password"
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder="Sync admin token"
              aria-label="Sync admin token"
              autoComplete="off"
            />
            {sync.detail && <p className="text-xs text-red-700 dark:text-red-300">{sync.detail}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={sync.dismiss}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!adminToken.trim()}>
                Save & retry
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
