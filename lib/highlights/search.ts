import type { RawFixture } from '@/lib/types'
import {
  YoutubeApiError,
  YoutubeConfigError,
  YoutubeQuotaError,
  youtubeApiKey,
  youtubeSearch,
  youtubeSearchEnabled,
  youtubeVideos,
  type YoutubeVideoItem,
} from '@/lib/youtube/client'
import { COMPETITION_MAP } from '@/lib/competitions'
import { buildSearchQuery, scoreCandidate, searchQueryHash } from './query'
import type {
  HighlightCandidate,
  HighlightManualTarget,
  HighlightPreview,
  HighlightSearchState,
  HighlightSkipped,
  HighlightStore,
} from './types'
import {
  VIDEO_ID_PATTERN,
  cooldownActive,
  isPublishableHighlight,
  parseIsoDuration,
  searchStateChanged,
  watchUrl,
} from './validate'

const MAX_SEARCHES_PER_RUN = 12
export const MAX_MANUAL_TARGETS = 20
const MAX_CANDIDATES_PER_FIXTURE = 3
const MIN_CANDIDATE_SCORE = 28
const LOOKBACK_DAYS = 3
const LOOKAHEAD_DAYS = 45

function isoOffset(date: string, days: number, endOfDay = false): string | undefined {
  const base = Date.parse(`${date}T12:00:00Z`)
  if (!Number.isFinite(base)) return undefined
  const shifted = new Date(base + days * 86_400_000)
  return endOfDay
    ? `${shifted.toISOString().slice(0, 10)}T23:59:59Z`
    : `${shifted.toISOString().slice(0, 10)}T00:00:00Z`
}

function thumbnailFor(video: YoutubeVideoItem): string | undefined {
  const thumbs = video.snippet?.thumbnails
  return thumbs?.medium?.url ?? thumbs?.high?.url ?? thumbs?.default?.url
}

/** Rejects private, deleted, live, restricted, or non-embeddable videos. */
function playabilityIssue(video: YoutubeVideoItem, durationSeconds: number): string | null {
  if (!video.id || !VIDEO_ID_PATTERN.test(video.id)) return 'Invalid video id'
  if (video.snippet?.liveBroadcastContent && video.snippet.liveBroadcastContent !== 'none') {
    return 'Video is live or upcoming'
  }
  if (video.status?.uploadStatus !== 'processed') return 'Video is not processed'
  if (video.status?.privacyStatus === 'private') return 'Video is private'
  if (video.status?.embeddable !== true) return 'Embedding is disabled'
  if (durationSeconds < 30 || durationSeconds > 4 * 60 * 60) return 'Duration is outside a plausible range'
  if (video.contentDetails?.regionRestriction) return 'Video has region restrictions'
  if (video.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') return 'Video is age restricted'
  if (/18\+|age restricted/i.test(`${video.snippet?.title ?? ''} ${video.snippet?.description ?? ''}`)) {
    return 'Video appears to be age restricted'
  }
  return null
}

export interface ManualVideoVerification {
  ok: boolean
  reason?: string
  video?: YoutubeVideoItem
}

/**
 * Verifies manually supplied video IDs with the same eligibility rules used for
 * automatic candidates. One batched videos.list call keeps quota cost at 1 unit.
 */
export async function verifyManualVideos(
  ids: string[],
): Promise<Record<string, ManualVideoVerification>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return {}

  try {
    const videos = await youtubeVideos(unique)
    const byId = new Map(videos.map((video) => [video.id ?? '', video]))
    const result: Record<string, ManualVideoVerification> = {}
    for (const id of unique) {
      const video = byId.get(id)
      if (!video) {
        result[id] = { ok: false, reason: 'Video was not found' }
        continue
      }
      const durationSeconds = parseIsoDuration(video.contentDetails?.duration)
      if (durationSeconds === null) {
        result[id] = { ok: false, reason: 'Video duration could not be verified' }
        continue
      }
      const issue = playabilityIssue(video, durationSeconds)
      result[id] = issue ? { ok: false, reason: issue } : { ok: true, video }
    }
    return result
  } catch (error) {
    const reason =
      error instanceof YoutubeQuotaError
        ? `YouTube quota exhausted; retry after ${error.retryAfter}`
        : error instanceof YoutubeConfigError
          ? error.message
          : error instanceof YoutubeApiError
            ? `YouTube verification is temporarily unavailable (HTTP ${error.status})`
            : 'Manual URL verification failed unexpectedly'
    return Object.fromEntries(unique.map((id) => [id, { ok: false, reason }]))
  }
}

export interface HighlightSearchResult {
  preview: HighlightPreview
  searchState: HighlightSearchState
}

/**
 * Builds preview-only candidates for finished fixtures. Nothing here writes to
 * GitHub; approval is handled later by the signed confirmation flow.
 */
export async function findHighlightCandidates(
  fixtures: RawFixture[],
  store: HighlightStore,
): Promise<HighlightSearchResult> {
  const now = new Date()
  const originalSearchState: HighlightSearchState = { ...(store.searchState ?? {}) }
  const searchState: HighlightSearchState = { ...originalSearchState }
  const warnings: string[] = []
  const skipped: HighlightSkipped[] = []
  const candidates: HighlightCandidate[] = []
  const manualTargets: HighlightManualTarget[] = []
  const searchable: RawFixture[] = []
  let truncatedManualTargets = 0

  const quotaActive = !!searchState.quotaExhaustedUntil &&
    Date.parse(searchState.quotaExhaustedUntil) > now.getTime()
  const enabled = youtubeSearchEnabled()
  const hasKey = !!youtubeApiKey()

  const sorted = [...fixtures].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  for (const fixture of sorted) {
    const existing = store.highlights[fixture.id]
    const label = `${fixture.opponent} · ${fixture.date ?? 'TBA'}`
    const comp = COMPETITION_MAP[fixture.competition]

    if (existing?.source === 'manual') {
      skipped.push({ fixtureId: fixture.id, label, reason: 'Manual highlight is locked' })
      continue
    }
    if (isPublishableHighlight(existing)) {
      skipped.push({ fixtureId: fixture.id, label, reason: 'Highlight is already published' })
      continue
    }
    if (manualTargets.length < MAX_MANUAL_TARGETS) {
      manualTargets.push({
        fixtureId: fixture.id,
        label: `${comp?.short ?? fixture.competition} · ${label}`,
        competition: fixture.competition,
        date: fixture.date,
      })
    } else {
      truncatedManualTargets++
      skipped.push({
        fixtureId: fixture.id,
        label,
        reason: `Manual URL limit reached (${MAX_MANUAL_TARGETS}); this match was not added to the manual list`,
      })
    }
    if (!enabled) continue
    if (quotaActive || cooldownActive(existing, now)) {
      skipped.push({
        fixtureId: fixture.id,
        label,
        reason: quotaActive ? 'YouTube search is in quota cooldown' : 'Fixture is in search cooldown',
      })
      continue
    }
    searchable.push(fixture)
  }

  if (truncatedManualTargets > 0) {
    warnings.push(
      `${truncatedManualTargets} finished match(es) were omitted from the manual URL list because the limit of ${MAX_MANUAL_TARGETS} was reached.`,
    )
  }

  if (!enabled) {
    warnings.push(
      hasKey
        ? 'Automatic highlight search is disabled by YOUTUBE_HIGHLIGHTS_ENABLED. Manual URLs are still available.'
        : 'YOUTUBE_API_KEY is not configured; automatic highlight search was skipped. Manual URLs are still available.',
    )
  }
  if (quotaActive && searchState.quotaExhaustedUntil) {
    warnings.push(`YouTube search is paused until ${searchState.quotaExhaustedUntil} after quota exhaustion.`)
  }

  const budget = Math.min(searchable.length, MAX_SEARCHES_PER_RUN)
  for (const fixture of searchable.slice(budget)) {
    skipped.push({
      fixtureId: fixture.id,
      label: `${fixture.opponent} · ${fixture.date ?? 'TBA'}`,
      reason: 'Search limit for this refresh reached; a manual URL can still be supplied',
    })
  }

  let searched = 0
  for (const fixture of searchable.slice(0, budget)) {
    const queryHash = searchQueryHash(fixture)
    try {
      const results = await youtubeSearch({
        query: buildSearchQuery(fixture),
        publishedAfter: fixture.date ? isoOffset(fixture.date, -LOOKBACK_DAYS) : undefined,
        publishedBefore: fixture.date ? isoOffset(fixture.date, LOOKAHEAD_DAYS, true) : undefined,
      })
      searched++
      const ids = results
        .map((item) => item.id?.videoId)
        .filter((id): id is string => !!id && VIDEO_ID_PATTERN.test(id))
      const videos = await youtubeVideos(ids)
      const byId = new Map(videos.map((video) => [video.id ?? '', video]))
      const fixtureCandidates: HighlightCandidate[] = []
      const seen = new Set<string>()

      for (const item of results) {
        const videoId = item.id?.videoId
        if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || seen.has(videoId)) continue
        seen.add(videoId)
        const video = byId.get(videoId)
        if (!video) {
          skipped.push({
            fixtureId: fixture.id,
            label: `${fixture.opponent} · ${videoId}`,
            reason: 'Video details could not be verified',
          })
          continue
        }
        const durationSeconds = parseIsoDuration(video.contentDetails?.duration)
        if (durationSeconds === null) {
          skipped.push({
            fixtureId: fixture.id,
            label: `${fixture.opponent} · ${videoId}`,
            reason: 'Video duration could not be verified',
          })
          continue
        }
        const issue = playabilityIssue(video, durationSeconds)
        if (issue) {
          skipped.push({
            fixtureId: fixture.id,
            label: `${fixture.opponent} · ${videoId}`,
            reason: issue,
          })
          continue
        }
        const publishedAt = video.snippet?.publishedAt ?? item.snippet?.publishedAt ?? now.toISOString()
        const scored = scoreCandidate(fixture, {
          title: video.snippet?.title ?? item.snippet?.title ?? '',
          description: video.snippet?.description ?? item.snippet?.description ?? '',
          channelTitle: video.snippet?.channelTitle ?? item.snippet?.channelTitle ?? '',
          publishedAt,
          durationSeconds,
        })
        if (scored.score < MIN_CANDIDATE_SCORE) {
          skipped.push({
            fixtureId: fixture.id,
            label: `${fixture.opponent} · ${videoId}`,
            reason: `Relevance score ${scored.score} is below the ${MIN_CANDIDATE_SCORE} threshold`,
          })
          continue
        }
        fixtureCandidates.push({
          id: `${fixture.id}:${videoId}`,
          fixtureId: fixture.id,
          videoId,
          url: watchUrl(videoId),
          title: video.snippet?.title ?? item.snippet?.title ?? 'Match highlights',
          channel: video.snippet?.channelTitle ?? item.snippet?.channelTitle ?? 'YouTube',
          ...(video.snippet?.channelId ? { channelId: video.snippet.channelId } : {}),
          ...(thumbnailFor(video) ? { thumbnailUrl: thumbnailFor(video) } : {}),
          publishedAt,
          durationSeconds,
          queryHash,
          score: scored.score,
          reasons: scored.reasons,
        })
      }

      fixtureCandidates.sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId))
      candidates.push(...fixtureCandidates.slice(0, MAX_CANDIDATES_PER_FIXTURE))
    } catch (error) {
      if (error instanceof YoutubeQuotaError) {
        searchState.quotaExhaustedUntil = error.retryAfter
        warnings.push(`YouTube quota exhausted; automatic search will resume after ${error.retryAfter}.`)
        break
      }
      if (error instanceof YoutubeConfigError) {
        warnings.push(`Automatic highlight search could not start: ${error.message}`)
        break
      }
      if (error instanceof YoutubeApiError) {
        warnings.push(`YouTube search is temporarily unavailable (HTTP ${error.status}). Manual URLs are still available.`)
        break
      }
      warnings.push('Automatic highlight search failed unexpectedly. Manual URLs are still available.')
      break
    }
  }

  if (searched > 0) searchState.lastSearchAt = now.toISOString()
  if (enabled && !quotaActive && searched > 0 && candidates.length === 0) {
    warnings.push('No suitable public highlight candidates were found for the checked matches.')
  }

  return {
    preview: {
      candidates,
      manualTargets,
      skipped,
      warnings,
      searchStateChanged: searchStateChanged(originalSearchState, searchState, now),
      search: {
        enabled,
        checked: sorted.length,
        searched,
        skipped: skipped.length,
        ...(searchState.quotaExhaustedUntil ? { quotaExhaustedUntil: searchState.quotaExhaustedUntil } : {}),
        ...(warnings.length > 0 ? { error: warnings[0] } : {}),
      },
    },
    searchState,
  }
}
