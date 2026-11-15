'use client'

import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
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
import type { ProposedChange } from '@/lib/sync/types'
import { cn } from '@/lib/utils'

function value(text: string | null): string {
  return text === null || text === '' ? '—' : text
}

function ChangeCard({ change }: { change: ProposedChange }) {
  const comp = COMPETITION_MAP[change.competition]
  return (
    <article className="rounded-lg border border-border bg-white p-3">
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: comp.color, color: comp.text }}
        >
          {comp.short}
        </span>
        <h4 className="font-display text-sm font-bold uppercase leading-tight text-navy">
          {change.home} vs {change.away}
        </h4>
        {change.kind === 'create' && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
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
        <ul className="mt-2 flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
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
          className="inline-flex items-center gap-1 font-medium text-[#1F5FB8] underline-offset-2 hover:underline"
        >
          {change.source.name}
          <ExternalLink className="size-3" aria-hidden />
        </a>
        <span>· verified {change.verifiedAt}</span>
      </p>
    </article>
  )
}

export function SyncDialog({ sync }: { sync: UseSync }) {
  const [adminToken, setAdminToken] = useState('')

  const preview = sync.preview
  const open = sync.phase === 'preview' || sync.phase === 'committing'
  const authOpen = sync.phase === 'error' && sync.authRequired
  const committing = sync.phase === 'committing'
  const title = sync.kind === 'scores' ? 'Score changes found' : 'Schedule changes found'
  const summary = preview?.summary

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
            <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide text-navy">
              {title}
            </DialogTitle>
            <DialogDescription>{SYNC_MESSAGES.preview}</DialogDescription>
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
                <ul className="flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              {preview.changes.map((change) => (
                <ChangeCard key={`${change.kind}-${change.fixtureId}`} change={change} />
              ))}

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
                      <span className={cn('font-medium', report.ok ? 'text-emerald-700' : 'text-red-700')}>
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
            <Button variant="outline" size="sm" onClick={sync.cancel} disabled={committing}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void sync.confirm()} disabled={committing || !sync.token}>
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
            {sync.detail && <p className="text-xs text-red-700">{sync.detail}</p>}
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
