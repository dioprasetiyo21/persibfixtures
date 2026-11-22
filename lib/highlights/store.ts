import bundledHighlights from '@/data/highlights.json'
import { highlightsConfig } from '@/lib/sync/config'
import { readJsonFile } from '@/lib/sync/github'
import { verifyManualVideos } from './search'
import type {
  HighlightMergeResult,
  HighlightOperation,
  HighlightSelection,
  HighlightSelectionResult,
  HighlightStore,
  PendingHighlights,
  PublicHighlight,
  StoredHighlight,
} from './types'
import {
  AUTO_REJECT_COOLDOWN_MS,
  cloneHighlightStore,
  cooldownActive,
  emptyHighlightStore,
  isPublishableHighlight,
  parseVideoId,
  toPublicHighlight,
  validateHighlightStore,
  watchUrl,
} from './validate'

export class HighlightInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HighlightInputError'
  }
}

const fallbackStore = (() => {
  try {
    return validateHighlightStore(bundledHighlights)
  } catch {
    return emptyHighlightStore()
  }
})()

export interface HighlightReadResult {
  store: HighlightStore
  sha: string | null
  source: 'github' | 'raw' | 'local'
  warning?: string
}

/** Reads data/highlights.json with the existing GitHub path logic and a safe fallback. */
export async function readHighlightStore(options: { fresh?: boolean } = {}): Promise<HighlightReadResult> {
  const result = await readJsonFile<HighlightStore>({
    cfg: highlightsConfig(),
    validate: validateHighlightStore,
    fallback: emptyHighlightStore(),
    fresh: options.fresh,
  })
  // Keep the repository comment when a valid remote copy omits it.
  if (!result.value._comment) result.value._comment = fallbackStore._comment
  return { store: result.value, sha: result.sha, source: result.source, warning: result.warning }
}

/** Only validated, published highlights are sent to visitors. */
export function publicHighlights(store: HighlightStore): Record<string, PublicHighlight> {
  const out: Record<string, PublicHighlight> = {}
  for (const entry of Object.values(store.highlights)) {
    const publicEntry = toPublicHighlight(entry)
    if (publicEntry) out[entry.fixtureId] = publicEntry
  }
  return out
}

const OPERATION_PRIORITY: Record<HighlightOperation['action'], number> = {
  'publish-auto': 1,
  reject: 2,
  'publish-manual': 3,
}

/**
 * Turn the browser's checkbox/input selection into operations against data that
 * was signed into the preview token. Unknown ids are rejected rather than trusted.
 * Manual URLs are verified with videos.list before they can become published.
 */
export async function operationsFromSelection(
  signed: PendingHighlights,
  selection: HighlightSelection | undefined,
): Promise<HighlightSelectionResult> {
  const approved = new Set(selection?.approvedCandidateIds ?? [])
  const rejected = new Set(selection?.rejectedFixtureIds ?? [])
  const manual = selection?.manualUrls ?? {}
  const candidates = new Map(signed.candidates.map((candidate) => [candidate.id, candidate]))
  const manualTargets = new Set(signed.manualTargets.map((target) => target.fixtureId))
  const candidateFixtures = new Set(signed.candidates.map((candidate) => candidate.fixtureId))
  const byFixture = new Map<string, HighlightOperation>()
  const warnings: string[] = []

  const put = (operation: HighlightOperation) => {
    const current = byFixture.get(operation.fixtureId)
    if (!current || OPERATION_PRIORITY[operation.action] > OPERATION_PRIORITY[current.action]) {
      byFixture.set(operation.fixtureId, operation)
    }
  }

  for (const id of approved) {
    const candidate = candidates.get(id)
    if (!candidate) continue
    put({
      fixtureId: candidate.fixtureId,
      action: 'publish-auto',
      source: 'youtube',
      videoId: candidate.videoId,
      url: candidate.url,
      title: candidate.title,
      channel: candidate.channel,
      ...(candidate.channelId ? { channelId: candidate.channelId } : {}),
      ...(candidate.thumbnailUrl ? { thumbnailUrl: candidate.thumbnailUrl } : {}),
      publishedAt: candidate.publishedAt,
      queryHash: candidate.queryHash,
    })
  }

  for (const fixtureId of rejected) {
    if (!candidateFixtures.has(fixtureId)) continue
    put({
      fixtureId,
      action: 'reject',
      source: 'youtube',
      reason: 'Candidate rejected during preview',
    })
  }

  type ManualEntry = { fixtureId: string; videoId: string }
  const manualEntries: ManualEntry[] = []
  for (const [fixtureId, rawUrl] of Object.entries(manual)) {
    if (!manualTargets.has(fixtureId)) {
      throw new HighlightInputError(`Highlight URL was submitted for an unknown fixture: ${fixtureId}`)
    }
    const videoId = parseVideoId(rawUrl)
    if (!videoId) {
      warnings.push(`Highlight URL for ${fixtureId} is not a valid YouTube video URL; it was not published.`)
      continue
    }
    manualEntries.push({ fixtureId, videoId })
  }

  const verified = await verifyManualVideos(manualEntries.map((entry) => entry.videoId))
  for (const entry of manualEntries) {
    const result = verified[entry.videoId]
    if (!result?.ok) {
      warnings.push(
        `Highlight URL for ${entry.fixtureId} could not be verified: ${result?.reason ?? 'unknown error'}. It was not published.`,
      )
      continue
    }
    const snippet = result.video?.snippet
    const thumbnailUrl =
      result.video?.snippet?.thumbnails?.medium?.url ??
      result.video?.snippet?.thumbnails?.high?.url ??
      result.video?.snippet?.thumbnails?.default?.url
    put({
      fixtureId: entry.fixtureId,
      action: 'publish-manual',
      source: 'manual',
      videoId: entry.videoId,
      url: watchUrl(entry.videoId),
      title: snippet?.title?.trim() || 'Match highlights',
      channel: snippet?.channelTitle?.trim() || 'Manual URL',
      ...(result.video?.snippet?.channelId ? { channelId: result.video.snippet.channelId } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(snippet?.publishedAt ? { publishedAt: snippet.publishedAt } : {}),
    })
  }

  return {
    operations: [...byFixture.values()].sort((a, b) => a.fixtureId.localeCompare(b.fixtureId)),
    warnings,
  }
}

function isSameEntry(a: StoredHighlight | undefined, b: StoredHighlight): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b)
}

/** Applies approved operations with manual-lock and duplicate protection. */
export function mergeHighlightOperations(
  store: HighlightStore,
  operations: HighlightOperation[],
  now = new Date(),
): HighlightMergeResult {
  const next = cloneHighlightStore(store)
  const skipped: HighlightMergeResult['skipped'] = []
  const nowIso = now.toISOString()
  let applied = 0

  for (const operation of operations) {
    const fixtureId = operation.fixtureId
    const existing = next.highlights[fixtureId]

    if (operation.action === 'publish-manual') {
      if (existing?.source === 'manual') {
        skipped.push({ fixtureId, reason: 'Existing manual highlight was kept' })
        continue
      }
      const videoId = parseVideoId(operation.url) ?? parseVideoId(operation.videoId)
      if (!videoId) {
        skipped.push({ fixtureId, reason: 'Manual URL is invalid' })
        continue
      }
      const entry: StoredHighlight = {
        fixtureId,
        videoId,
        url: watchUrl(videoId),
        title: operation.title?.trim() || 'Match highlights',
        channel: operation.channel?.trim() || 'Manual URL',
        source: 'manual',
        status: 'published',
        updatedAt: nowIso,
        ...(operation.publishedAt ? { publishedAt: operation.publishedAt } : {}),
      }
      if (!isSameEntry(existing, entry)) {
        next.highlights[fixtureId] = entry
        applied++
      }
      continue
    }

    if (operation.action === 'publish-auto') {
      if (existing?.source === 'manual') {
        skipped.push({ fixtureId, reason: 'Manual highlight is locked from automatic updates' })
        continue
      }
      if (isPublishableHighlight(existing)) {
        skipped.push({ fixtureId, reason: 'A published highlight already exists' })
        continue
      }
      if (cooldownActive(existing, now)) {
        skipped.push({ fixtureId, reason: 'Fixture is in search cooldown' })
        continue
      }
      const videoId = parseVideoId(operation.videoId) ?? parseVideoId(operation.url)
      if (!videoId) {
        skipped.push({ fixtureId, reason: 'Video id is invalid' })
        continue
      }
      const entry: StoredHighlight = {
        fixtureId,
        videoId,
        url: watchUrl(videoId),
        title: operation.title?.trim() || 'Match highlights',
        channel: operation.channel?.trim() || 'YouTube',
        ...(operation.channelId ? { channelId: operation.channelId } : {}),
        ...(operation.thumbnailUrl ? { thumbnailUrl: operation.thumbnailUrl } : {}),
        ...(operation.publishedAt ? { publishedAt: operation.publishedAt } : {}),
        ...(operation.queryHash ? { queryHash: operation.queryHash } : {}),
        source: 'youtube',
        status: 'published',
        updatedAt: nowIso,
        nextSearchAfter: new Date(now.getTime() + AUTO_REJECT_COOLDOWN_MS).toISOString(),
      }
      if (!isSameEntry(existing, entry)) {
        next.highlights[fixtureId] = entry
        applied++
      }
      continue
    }

    if (existing?.source === 'manual' || isPublishableHighlight(existing)) {
      skipped.push({ fixtureId, reason: 'Published or manual highlight was kept' })
      continue
    }
    const entry: StoredHighlight = {
      fixtureId,
      source: 'youtube',
      status: 'rejected',
      updatedAt: nowIso,
      nextSearchAfter: new Date(now.getTime() + AUTO_REJECT_COOLDOWN_MS).toISOString(),
      reason: operation.reason?.trim() || 'Candidate rejected during preview',
      ...(operation.queryHash ? { queryHash: operation.queryHash } : {}),
    }
    if (!isSameEntry(existing, entry)) {
      next.highlights[fixtureId] = entry
      applied++
    }
  }

  return { store: next, applied, skipped }
}
