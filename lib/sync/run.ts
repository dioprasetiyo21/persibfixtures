import { revalidatePath, revalidateTag } from 'next/cache'
import { effectiveFinishedFixtures } from '@/lib/highlights/eligibility'
import { findHighlightCandidates } from '@/lib/highlights/search'
import {
  mergeHighlightOperations,
  operationsFromSelection,
  readHighlightStore,
} from '@/lib/highlights/store'
import { mergeSearchStates, serializeHighlightStore } from '@/lib/highlights/validate'
import type {
  HighlightPreview,
  HighlightSearchState,
  HighlightSelection,
  PendingHighlights,
} from '@/lib/highlights/types'
import type { CompetitionId, RawFixture } from '@/lib/types'
import { RECHECK_ON_CONFIRM, githubConfig, highlightsConfig } from './config'
import { DatasetError, serializeDataset, validateDataset } from './dataset'
import {
  GithubError,
  ShaConflictError,
  commitMessageFor,
  readDataset,
  writeDataset,
  writeJsonFile,
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

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

function revalidateFixtureData(): void {
  try {
    revalidateTag('fixtures', { expire: 0 })
    revalidatePath('/api/fixtures')
  } catch {
    // Revalidation outside a request scope is harmless.
  }
}

async function previewHighlights(fixtures: RawFixture[]): Promise<{
  preview?: HighlightPreview
  pending?: PendingHighlights
  warnings: string[]
}> {
  try {
    const finished = await effectiveFinishedFixtures(fixtures)
    const current = await readHighlightStore()
    const result = await findHighlightCandidates(finished, current.store)
    const warnings = [...(current.warning ? [current.warning] : []), ...result.preview.warnings]
    const hasWork =
      result.preview.candidates.length > 0 ||
      result.preview.manualTargets.length > 0 ||
      result.preview.searchStateChanged
    return {
      preview: hasWork ? result.preview : undefined,
      pending: hasWork
        ? {
            baseSource: current.source,
            baseSha: current.sha,
            candidates: result.preview.candidates,
            manualTargets: result.preview.manualTargets,
            operations: [],
            ...(result.preview.searchStateChanged ? { searchState: result.searchState } : {}),
          }
        : undefined,
      warnings,
    }
  } catch (error) {
    return { warnings: [`Automatic highlight preview failed: ${safeError(error)}`] }
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

  // Highlights belong to the schedule refresh only. Any failure is contained
  // here so the normal schedule preview still succeeds.
  let highlights: HighlightPreview | undefined
  let pendingHighlights: PendingHighlights | undefined
  if (kind === 'schedule') {
    const result = await previewHighlights(latest.dataset.fixtures)
    highlights = result.preview
    pendingHighlights = result.pending
    warnings.push(...result.warnings)
  }

  let token = ''
  let expiresAt = new Date().toISOString()
  if (plan.changes.length > 0 || pendingHighlights) {
    const payload: PendingPayload = {
      v: 1,
      kind,
      iat: Date.now(),
      exp: pendingExpiry(),
      baseSha: latest.sha,
      changes: plan.changes.map(toProposed),
      ...(pendingHighlights ? { highlights: pendingHighlights } : {}),
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
    ...(highlights ? { highlights } : {}),
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

interface FixtureCommit {
  applied: number
  committed: boolean
  commit: { sha: string; url: string; message: string } | null
  fileSha: string | null
  sha: string | null
}

async function commitFixtureChanges(
  pending: PendingPayload,
  initial: Awaited<ReturnType<typeof readDataset>>,
): Promise<FixtureCommit> {
  let latest = initial
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const merge = mergePending(latest.dataset, pending)
    if (merge.applied === 0) {
      return { applied: 0, committed: false, commit: null, fileSha: latest.sha, sha: latest.sha }
    }

    const next = merge.dataset
    next.meta.lastUpdated = nowWibIso()
    validateDataset(next)

    const content = serializeDataset(next)
    if (content === serializeDataset(latest.dataset)) {
      return { applied: 0, committed: false, commit: null, fileSha: latest.sha, sha: latest.sha }
    }

    try {
      const written = await writeDataset({
        content,
        sha: latest.sha,
        message: commitMessageFor(pending.kind, merge.applied),
      })
      revalidateFixtureData()
      return {
        applied: merge.applied,
        committed: true,
        commit: written.commit,
        fileSha: written.fileSha || null,
        sha: written.fileSha || latest.sha,
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

interface HighlightCommit {
  applied: number
  committed: boolean
  commit: { sha: string; url: string; message: string } | null
  fileSha: string | null
  sha: string | null
  skipped: Array<{ fixtureId: string; reason: string }>
  warning?: string
}

export async function commitHighlightChanges(
  operations: NonNullable<PendingPayload['highlights']>['operations'],
  searchState?: HighlightSearchState,
): Promise<HighlightCommit> {
  const cfg = highlightsConfig()
  let current = await readHighlightStore({ fresh: true })
  if (current.warning && /invalid/i.test(current.warning)) {
    return {
      applied: 0,
      committed: false,
      commit: null,
      fileSha: current.sha,
      sha: current.sha,
      skipped: [],
      warning: 'Highlights were not written because the existing file is invalid',
    }
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const merge = mergeHighlightOperations(current.store, operations)
    const nextStore = {
      ...merge.store,
      searchState: mergeSearchStates(current.store.searchState, searchState),
    }
    const currentContent = serializeHighlightStore(current.store)
    const content = serializeHighlightStore(nextStore)
    if (content === currentContent) {
      return {
        applied: merge.applied,
        committed: false,
        commit: null,
        fileSha: current.sha,
        sha: current.sha,
        skipped: merge.skipped,
        ...(current.warning ? { warning: current.warning } : {}),
      }
    }

    try {
      const written = await writeJsonFile({
        cfg,
        path: cfg.path,
        content,
        sha: current.sha,
        message: commitMessageFor('highlights', merge.applied),
      })
      revalidateFixtureData()
      return {
        applied: merge.applied,
        committed: true,
        commit: written.commit,
        fileSha: written.fileSha || null,
        sha: written.fileSha || current.sha,
        skipped: merge.skipped,
      }
    } catch (error) {
      lastError = error
      if (error instanceof ShaConflictError && attempt === 0) {
        current = await readHighlightStore({ fresh: true })
        continue
      }
      throw error
    }
  }

  if (lastError instanceof GithubError) throw lastError
  throw new GithubError('Highlight update failed after a retry', 'github_error', 502)
}

/** User-facing result copy. Non-fatal warnings never turn a full write into a partial one. */
export function confirmationMessage(args: {
  committed: boolean
  failedFiles: string[]
  fixtureCommitted: boolean
}): string {
  if (args.committed && args.failedFiles.length > 0) {
    return 'Some changes were committed, but not all files could be updated.'
  }
  if (!args.committed) return 'All fixtures are already up to date. No commit required.'
  return args.fixtureCommitted
    ? 'Changes successfully committed to GitHub.'
    : 'Highlight changes successfully committed to GitHub.'
}

/**
 * Step C: verify the signed preview, then commit fixtures and approved
 * highlights through the same GitHub Contents API flow. A failure in one file
 * is reported as a partial success when the other file was written.
 */
export async function confirmPending(
  token: string,
  selection?: HighlightSelection,
): Promise<SyncConfirmResult> {
  const parsed = readPending(token)
  if (!parsed.ok) {
    if (parsed.reason === 'expired') throw new ExpiredPreviewError()
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

  const selected = pending.highlights
    ? await operationsFromSelection(pending.highlights, selection)
    : null
  const operations = selected?.operations ?? []
  const highlightChanged = operations.length > 0 || !!pending.highlights?.searchState

  const [fixtureSettled, highlightSettled] = await Promise.allSettled([
    commitFixtureChanges(pending, latest),
    highlightChanged
      ? commitHighlightChanges(operations, pending.highlights?.searchState)
      : Promise.resolve(null),
  ])

  const fixture = fixtureSettled.status === 'fulfilled' ? fixtureSettled.value : null
  const highlight = highlightSettled.status === 'fulfilled' ? highlightSettled.value : null
  const warnings: string[] = []
  const cfg = githubConfig()
  const highlightsCfg = highlightsConfig()

  if (selected) warnings.push(...selected.warnings)
  if (fixtureSettled.status === 'rejected') {
    warnings.push(`Fixture data: ${safeError(fixtureSettled.reason)}`)
  }
  if (highlightSettled.status === 'rejected') {
    warnings.push(`Highlights: ${safeError(highlightSettled.reason)}`)
  }
  if (highlight?.warning) warnings.push(`Highlights: ${highlight.warning}`)
  for (const skip of highlight?.skipped ?? []) {
    warnings.push(`Highlight ${skip.fixtureId}: ${skip.reason}`)
  }

  const committed = !!fixture?.committed || !!highlight?.committed
  if (!committed && (fixtureSettled.status === 'rejected' || highlightSettled.status === 'rejected')) {
    throw fixtureSettled.status === 'rejected'
      ? fixtureSettled.reason
      : highlightSettled.status === 'rejected'
        ? highlightSettled.reason
        : new GithubError('Highlight update failed', 'github_error', 502)
  }

  const files: SyncConfirmResult['files'] = [
    {
      path: cfg.path,
      committed: !!fixture?.committed,
      sha: fixture?.sha ?? latest.sha,
      action: fixture ? (fixture.committed ? 'changed' : 'unchanged') : 'failed',
    },
    {
      path: highlightsCfg.path,
      committed: !!highlight?.committed,
      sha: highlight?.sha ?? null,
      action: !highlightChanged
        ? 'unchanged'
        : highlight
          ? (highlight.committed ? 'changed' : 'unchanged')
          : 'failed',
    },
  ]

  const failedFiles = files.filter((file) => file.action === 'failed')
  const message = confirmationMessage({
    committed,
    failedFiles: failedFiles.map((file) => file.path),
    fixtureCommitted: !!fixture?.committed,
  })

  return {
    ok: true,
    committed,
    message,
    applied: fixture?.applied ?? 0,
    commit: fixture?.commit ?? highlight?.commit ?? null,
    fileSha: fixture?.fileSha ?? highlight?.fileSha ?? latest.sha,
    branch: cfg.branch,
    path: cfg.path,
    ...(operations.length > 0 ? { highlightsApplied: highlight?.applied ?? 0 } : {}),
    files,
    warnings,
  }
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
