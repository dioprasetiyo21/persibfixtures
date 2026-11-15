import { revalidatePath, revalidateTag } from 'next/cache'
import type { CompetitionId } from '@/lib/types'
import { RECHECK_ON_CONFIRM, githubConfig } from './config'
import { DatasetError, serializeDataset, validateDataset } from './dataset'
import {
  GithubError,
  ShaConflictError,
  commitMessageFor,
  readDataset,
  writeDataset,
} from './github'
import {
  buildPlan,
  mergePending,
  pendingIsStillValid,
  toProposed,
  wibDate,
} from './plan'
import { pendingExpiry, readPending, signPending } from './pending'
import { collectSourceMatches } from './sources'
import type {
  PendingPayload,
  PreviewSummary,
  ProposedChange,
  SkippedMatch,
  SourceReport,
  SyncConfirmResult,
  SyncKind,
  SyncPreview,
} from './types'

export class SourceUnavailableError extends Error {
  constructor(readonly reports: SourceReport[]) {
    super('Every official source failed. Existing fixture data was not modified.')
    this.name = 'SourceUnavailableError'
  }
}

export class StalePreviewError extends Error {
  constructor(readonly stale: Array<{ fixtureId: string; field: string }>) {
    super('Source information changed after this preview was generated. Run the refresh again.')
    this.name = 'StalePreviewError'
  }
}

function nowWibIso(): string {
  const now = new Date()
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return `${wib.toISOString().slice(0, 19)}+07:00`
}

function summarize(
  checked: number,
  unchanged: number,
  skipped: SkippedMatch[],
  changes: ProposedChange[],
): PreviewSummary {
  return {
    checked,
    changed: changes.filter((change) => change.kind === 'update').length,
    created: changes.filter((change) => change.kind === 'create').length,
    unchanged,
    skipped: skipped.length,
  }
}

/** Step A: read GitHub, scrape official sources, and return a preview only. */
export async function runPreview(kind: SyncKind): Promise<SyncPreview> {
  const latest = await readDataset()
  const { matches, reports } = await collectSourceMatches(kind, latest.dataset.fixtures)

  const attempted = reports.filter((report) => !report.note)
  if (attempted.length > 0 && attempted.every((report) => !report.ok)) {
    throw new SourceUnavailableError(reports)
  }

  const plan = buildPlan(kind, latest.dataset.fixtures, matches)
  const warnings: string[] = []

  const unavailable = reports.filter((report) => report.unavailableWeeks.length > 0)
  for (const report of unavailable) {
    warnings.push(`${report.name}: weeks ${report.unavailableWeeks.join(', ')} are not published yet`)
  }
  for (const report of reports) {
    if (!report.ok && report.error) warnings.push(`${report.name}: ${report.error}`)
  }
  if (plan.changes.length === 0) {
    warnings.push(
      kind === 'schedule'
        ? 'No schedule differences found between the official source and GitHub.'
        : 'No score differences found between the official source and GitHub.',
    )
  }

  let token = ''
  let expiresAt = new Date().toISOString()
  if (plan.changes.length > 0) {
    const payload: PendingPayload = {
      v: 1,
      kind,
      iat: Date.now(),
      exp: pendingExpiry(),
      baseSha: latest.sha,
      changes: plan.changes.map(toProposed),
    }
    const signed = signPending(payload)
    token = signed.token
    expiresAt = signed.expiresAt
  }

  return {
    ok: true,
    kind,
    token,
    expiresAt,
    generatedAt: new Date().toISOString(),
    base: {
      source: latest.source,
      sha: latest.sha,
      fixtureCount: latest.dataset.fixtures.length,
      branch: githubConfig().branch,
      path: githubConfig().path,
    },
    summary: summarize(plan.checked, plan.unchanged, plan.skipped, plan.changes),
    changes: plan.changes,
    reports,
    skipped: plan.skipped,
    warnings,
  }
}

function weeksForRecheck(pending: PendingPayload): Partial<Record<CompetitionId, number[]>> {
  const byCompetition: Partial<Record<CompetitionId, number[]>> = {}
  for (const change of pending.changes) {
    if (change.week === null) continue
    if (change.competition !== 'SL' && change.competition !== 'ILC') continue
    const set = new Set(byCompetition[change.competition] ?? [])
    for (const week of [change.week - 1, change.week, change.week + 1]) if (week >= 1) set.add(week)
    byCompetition[change.competition] = [...set].sort((a, b) => a - b)
  }
  return byCompetition
}

/**
 * Step C: verify the signed preview is still accurate, merge it onto the newest
 * GitHub data, and commit only when something actually changes.
 */
export async function confirmPending(token: string): Promise<SyncConfirmResult> {
  const parsed = readPending(token)
  if (!parsed.ok) {
    if (parsed.reason === 'expired') {
      throw new ExpiredPreviewError()
    }
    throw new InvalidPreviewError()
  }
  const pending = parsed.payload
  let latest = await readDataset({ fresh: true })

  if (RECHECK_ON_CONFIRM) {
    const { matches } = await collectSourceMatches(pending.kind, latest.dataset.fixtures, {
      fresh: true,
      weeksByCompetition: weeksForRecheck(pending),
    })
    const freshPlan = buildPlan(pending.kind, latest.dataset.fixtures, matches)
    const validity = pendingIsStillValid(latest.dataset, pending, freshPlan.changes)
    if (!validity.valid) throw new StalePreviewError(validity.stale)
  }

  const cfg = githubConfig()
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const merge = mergePending(latest.dataset, pending)
    if (merge.applied === 0) {
      return {
        ok: true,
        committed: false,
        message: 'All fixtures are already up to date. No commit required.',
        applied: 0,
        commit: null,
        fileSha: latest.sha,
        branch: cfg.branch,
        path: cfg.path,
      }
    }

    const next = merge.dataset
    next.meta.lastUpdated = nowWibIso()
    validateDataset(next)

    const content = serializeDataset(next)
    if (content === serializeDataset(latest.dataset)) {
      return {
        ok: true,
        committed: false,
        message: 'All fixtures are already up to date. No commit required.',
        applied: 0,
        commit: null,
        fileSha: latest.sha,
        branch: cfg.branch,
        path: cfg.path,
      }
    }

    try {
      const written = await writeDataset({
        content,
        sha: latest.sha,
        message: commitMessageFor(pending.kind, merge.applied),
      })

      try {
        revalidateTag('fixtures', { expire: 0 })
        revalidatePath('/api/fixtures')
      } catch {
        // Revalidation outside a request scope is harmless.
      }

      return {
        ok: true,
        committed: true,
        message: 'Changes successfully committed to GitHub.',
        applied: merge.applied,
        commit: written.commit,
        fileSha: written.fileSha || null,
        branch: cfg.branch,
        path: cfg.path,
      }
    } catch (error) {
      lastError = error
      if (error instanceof ShaConflictError && attempt === 0) {
        latest = await readDataset({ fresh: true })
        continue
      }
      throw error
    }
  }

  if (lastError instanceof GithubError) throw lastError
  throw new GithubError('GitHub update failed after a retry', 'github_error', 502)
}

export class InvalidPreviewError extends Error {
  constructor() {
    super('Confirmation token is invalid. Run the refresh again.')
    this.name = 'InvalidPreviewError'
  }
}

export class ExpiredPreviewError extends Error {
  constructor() {
    super('Confirmation token expired. Run the refresh again.')
    this.name = 'ExpiredPreviewError'
  }
}

export { DatasetError, wibDate }
