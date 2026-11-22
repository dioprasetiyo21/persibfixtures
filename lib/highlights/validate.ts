import type {
  HighlightSearchState,
  HighlightStore,
  PublicHighlight,
  StoredHighlight,
} from './types'

export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
export const AUTO_REJECT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000

export class HighlightStoreError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message)
    this.name = 'HighlightStoreError'
  }
}

/** Accepts a bare video id or the common YouTube watch/share/embed URL forms. */
export function parseVideoId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  if (VIDEO_ID_PATTERN.test(value)) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let candidate: string | null = null
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'www.youtube-nocookie.com'
  ) {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v')
    else candidate = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1] ?? null
  }
  return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** Generated only on the server so the browser never needs an API key. */
export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
}

export function parseIsoDuration(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw)
  if (!match) return null
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match
  return (
    Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)
  )
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function emptyHighlightStore(): HighlightStore {
  return {
    _comment:
      'Match highlight videos keyed by stable fixture id from data/fixtures.json. Manual entries take priority over automatic YouTube candidates and are never overwritten by automatic search.',
    highlights: {},
    searchState: {},
  }
}

export function cloneHighlightStore(store: HighlightStore): HighlightStore {
  return {
    ...(store._comment ? { _comment: store._comment } : {}),
    highlights: Object.fromEntries(
      Object.entries(store.highlights).map(([id, entry]) => [id, { ...entry }]),
    ),
    searchState: { ...(store.searchState ?? {}) },
  }
}

/** Structural validation; callers degrade to an empty store instead of failing the page. */
export function validateHighlightStore(input: unknown): HighlightStore {
  const issues: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HighlightStoreError('Highlight store must be an object', ['root is not an object'])
  }
  const raw = input as Record<string, unknown>
  const highlights = raw.highlights
  if (!highlights || typeof highlights !== 'object' || Array.isArray(highlights)) {
    throw new HighlightStoreError('Highlight store is invalid', ['highlights must be an object'])
  }

  if (raw._comment !== undefined && typeof raw._comment !== 'string') {
    issues.push('_comment must be a string')
  }

  for (const [key, value] of Object.entries(highlights)) {
    const where = `highlights[${JSON.stringify(key)}]`
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push(`${where} is not an object`)
      continue
    }
    const entry = value as Record<string, unknown>
    if (!key) issues.push(`${where} has an empty fixture id`)
    if (entry.fixtureId !== key) issues.push(`${where}.fixtureId must match its key`)
    if (entry.source !== 'manual' && entry.source !== 'youtube') {
      issues.push(`${where}.source is invalid`)
    }
    if (entry.status !== 'published' && entry.status !== 'rejected') {
      issues.push(`${where}.status is invalid`)
    }
    if (!isIsoDate(entry.updatedAt)) issues.push(`${where}.updatedAt must be an ISO date`)

    for (const field of ['title', 'channel', 'channelId', 'queryHash', 'reason'] as const) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') {
        issues.push(`${where}.${field} must be a string`)
      }
    }
    for (const field of ['publishedAt', 'nextSearchAfter'] as const) {
      if (entry[field] !== undefined && !isIsoDate(entry[field])) {
        issues.push(`${where}.${field} must be an ISO date`)
      }
    }
    if (entry.thumbnailUrl !== undefined && !isHttpUrl(entry.thumbnailUrl)) {
      issues.push(`${where}.thumbnailUrl must be an http(s) URL`)
    }

    const idFromField = parseVideoId(entry.videoId)
    const idFromUrl = parseVideoId(entry.url)
    if (entry.status === 'published') {
      if (!idFromField) issues.push(`${where}.videoId must be a valid YouTube video id`)
      if (!idFromUrl) issues.push(`${where}.url must be a valid YouTube URL`)
      if (idFromField && idFromUrl && idFromField !== idFromUrl) {
        issues.push(`${where}.url does not match videoId`)
      }
      if (typeof entry.title !== 'string' || !entry.title.trim()) {
        issues.push(`${where}.title is required for a published highlight`)
      }
      if (typeof entry.channel !== 'string' || !entry.channel.trim()) {
        issues.push(`${where}.channel is required for a published highlight`)
      }
    } else if (entry.videoId !== undefined && !idFromField) {
      issues.push(`${where}.videoId is invalid`)
    }
  }

  if (raw.searchState !== undefined) {
    if (!raw.searchState || typeof raw.searchState !== 'object' || Array.isArray(raw.searchState)) {
      issues.push('searchState must be an object')
    } else {
      const state = raw.searchState as Record<string, unknown>
      for (const field of ['quotaExhaustedUntil', 'lastSearchAt'] as const) {
        if (state[field] !== undefined && !isIsoDate(state[field])) {
          issues.push(`searchState.${field} must be an ISO date`)
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new HighlightStoreError(
      `Highlight store is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
      issues.slice(0, 12),
    )
  }
  return raw as unknown as HighlightStore
}

export function isPublishableHighlight(entry: StoredHighlight | undefined): entry is StoredHighlight & {
  videoId: string
  url: string
} {
  if (!entry || entry.status !== 'published') return false
  const id = parseVideoId(entry.videoId)
  return !!id && !!entry.url && parseVideoId(entry.url) === id
}

export function cooldownActive(entry: StoredHighlight | undefined, now = new Date()): boolean {
  if (!entry?.nextSearchAfter) return false
  const until = Date.parse(entry.nextSearchAfter)
  return Number.isFinite(until) && until > now.getTime()
}

function isoTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/** Drops expired quota cooldowns so stale state never triggers a needless write. */
export function normalizeSearchState(
  state: HighlightSearchState | undefined,
  now = new Date(),
): HighlightSearchState {
  const out: HighlightSearchState = {}
  const lastValue = state?.lastSearchAt
  const last = isoTime(lastValue)
  if (lastValue && last !== null) out.lastSearchAt = lastValue
  const quotaValue = state?.quotaExhaustedUntil
  const quota = isoTime(quotaValue)
  if (quotaValue && quota !== null && quota > now.getTime()) {
    out.quotaExhaustedUntil = quotaValue
  }
  return out
}

export function sameSearchState(
  current: HighlightSearchState | undefined,
  incoming: HighlightSearchState | undefined,
  now = new Date(),
): boolean {
  const a = normalizeSearchState(current, now)
  const b = normalizeSearchState(incoming, now)
  return a.lastSearchAt === b.lastSearchAt && a.quotaExhaustedUntil === b.quotaExhaustedUntil
}

export function searchStateChanged(
  current: HighlightSearchState | undefined,
  incoming: HighlightSearchState | undefined,
  now = new Date(),
): boolean {
  return !sameSearchState(current, incoming, now)
}

/**
 * Keeps the newest timestamps from two previews. A concurrent refresh can write
 * a newer state first; replaying an older token must never rewind that state.
 */
export function mergeSearchStates(
  current: HighlightSearchState | undefined,
  incoming: HighlightSearchState | undefined,
  now = new Date(),
): HighlightSearchState {
  const base = normalizeSearchState(current, now)
  const next = normalizeSearchState(incoming, now)
  const merged: HighlightSearchState = {}

  const baseLast = isoTime(base.lastSearchAt)
  const nextLast = isoTime(next.lastSearchAt)
  if (nextLast !== null && (baseLast === null || nextLast > baseLast)) {
    merged.lastSearchAt = next.lastSearchAt
  } else if (baseLast !== null) {
    merged.lastSearchAt = base.lastSearchAt
  }

  const baseQuota = isoTime(base.quotaExhaustedUntil)
  const nextQuota = isoTime(next.quotaExhaustedUntil)
  if (nextQuota !== null && (baseQuota === null || nextQuota > baseQuota)) {
    merged.quotaExhaustedUntil = next.quotaExhaustedUntil
  } else if (baseQuota !== null) {
    merged.quotaExhaustedUntil = base.quotaExhaustedUntil
  }

  return merged
}

/** Mirrors data/highlights.json formatting: one highlight per line for readable diffs. */
export function serializeHighlightStore(store: HighlightStore): string {
  const lines: string[] = ['{']
  if (store._comment) lines.push(`  "_comment": ${JSON.stringify(store._comment)},`)
  lines.push('  "highlights": {')
  const entries = Object.entries(store.highlights)
  entries.forEach(([fixtureId, entry], index) => {
    lines.push(`    ${JSON.stringify(fixtureId)}: ${JSON.stringify(entry)}${index < entries.length - 1 ? ',' : ''}`)
  })
  lines.push('  },')
  lines.push(`  "searchState": ${JSON.stringify(store.searchState ?? {})}`)
  lines.push('}')
  return `${lines.join('\n')}\n`
}

export function toPublicHighlight(entry: StoredHighlight): PublicHighlight | null {
  if (!isPublishableHighlight(entry)) return null
  const videoId = entry.videoId as string
  return {
    fixtureId: entry.fixtureId,
    status: 'published',
    videoId,
    url: watchUrl(videoId),
    embedUrl: embedUrl(videoId),
    title: entry.title || 'Match highlights',
    channel: entry.channel || 'YouTube',
    ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
    source: entry.source,
  }
}
