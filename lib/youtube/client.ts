/**
 * Server-only YouTube Data API v3 client.
 *
 * YOUTUBE_API_KEY is read here and nowhere else. Response errors are sanitised
 * before they reach a route handler, so the key and request URL are never
 * returned to the browser or written to a dataset.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3'
// YouTube's default allocation is 100 search.list calls/day in the dedicated
// Search Queries bucket. Each call costs 1 unit in that bucket; it is NOT a
// 100-unit charge against the general 10,000-unit bucket.
const SEARCH_QUOTA_COST = 1
const SEARCH_DAILY_LIMIT = 100
// videos.list costs 1 unit from the general bucket shared by other endpoints.
const VIDEOS_QUOTA_COST = 1
const VIDEOS_DAILY_LIMIT = 10_000
const REQUEST_TIMEOUT_MS = 12_000

type QuotaBucket = 'search' | 'videos'
// The two buckets are tracked independently by design.
const quota = new Map<string, { date: string; used: number }>()

export class YoutubeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YoutubeConfigError'
  }
}

export class YoutubeQuotaError extends Error {
  constructor(message: string, readonly retryAfter: string) {
    super(message)
    this.name = 'YoutubeQuotaError'
  }
}

export class YoutubeApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message)
    this.name = 'YoutubeApiError'
  }
}

export interface YoutubeThumbnail {
  url?: string
  width?: number
  height?: number
}

export interface YoutubeSearchItem {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    channelTitle?: string
    channelId?: string
    publishedAt?: string
    liveBroadcastContent?: string
    thumbnails?: {
      medium?: YoutubeThumbnail
      high?: YoutubeThumbnail
      default?: YoutubeThumbnail
    }
  }
}

export interface YoutubeVideoItem {
  id?: string
  snippet?: {
    title?: string
    description?: string
    channelTitle?: string
    channelId?: string
    publishedAt?: string
    liveBroadcastContent?: string
    thumbnails?: {
      medium?: YoutubeThumbnail
      high?: YoutubeThumbnail
      default?: YoutubeThumbnail
    }
  }
  contentDetails?: {
    duration?: string
    regionRestriction?: {
      allowed?: string[]
      blocked?: string[]
    }
    contentRating?: {
      ytRating?: string
    }
  }
  status?: {
    uploadStatus?: string
    privacyStatus?: string
    embeddable?: boolean
  }
}

export function youtubeApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY?.trim() || null
}

export function youtubeSearchEnabled(): boolean {
  return !!youtubeApiKey() && process.env.YOUTUBE_HIGHLIGHTS_ENABLED !== 'false'
}

function nextQuotaReset(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function consumeQuota(bucket: QuotaBucket, amount: number): void {
  const date = new Date().toISOString().slice(0, 10)
  const key = `${bucket}:${date}`
  const current = quota.get(key) ?? { date, used: 0 }
  const limit = bucket === 'search' ? SEARCH_DAILY_LIMIT : VIDEOS_DAILY_LIMIT
  if (current.used + amount > limit) {
    quota.set(key, current)
    throw new YoutubeQuotaError(
      `YouTube ${bucket} quota limit reached for today`,
      nextQuotaReset(),
    )
  }
  current.used += amount
  quota.set(key, current)
  if (quota.size > 8) {
    for (const [entryKey, value] of quota) {
      if (value.date !== date) quota.delete(entryKey)
    }
  }
}

interface YoutubeErrorBody {
  error?: {
    message?: string
    errors?: Array<{ reason?: string; message?: string }>
  }
}

function errorReason(body: unknown): string | undefined {
  const error = (body as YoutubeErrorBody | null)?.error
  return error?.errors?.find((item) => item.reason)?.reason ?? undefined
}

async function request<T>(resource: string, params: Record<string, string>): Promise<T> {
  const key = youtubeApiKey()
  if (!key) {
    throw new YoutubeConfigError('YOUTUBE_API_KEY is not configured')
  }

  const url = new URL(`${API_BASE}/${resource}`)
  url.searchParams.set('key', key)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'PersibFixturesHighlights/1.0' },
    })
  } catch (error) {
    // Never include the URL: it contains the API key.
    const reason = error instanceof Error ? error.message : 'network error'
    throw new YoutubeApiError(`Could not reach YouTube (${reason})`, 502)
  }

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const reason = errorReason(body)
    if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
      throw new YoutubeQuotaError('YouTube daily quota exhausted', nextQuotaReset())
    }
    if (res.status === 400 && reason === 'badRequest' && !text.includes('quota')) {
      throw new YoutubeConfigError('YouTube rejected the request configuration')
    }
    if (res.status === 401 || res.status === 403) {
      throw new YoutubeConfigError('YouTube rejected the API key or denied access')
    }
    throw new YoutubeApiError(`YouTube request failed with HTTP ${res.status}`, res.status, reason)
  }

  return body as T
}

/** search.list uses the 100-call/day Search Queries bucket (1 unit per call). */
export async function youtubeSearch(options: {
  query: string
  publishedAfter?: string
  publishedBefore?: string
  maxResults?: number
}): Promise<YoutubeSearchItem[]> {
  consumeQuota('search', SEARCH_QUOTA_COST)
  const params: Record<string, string> = {
    part: 'snippet',
    type: 'video',
    q: options.query,
    maxResults: String(options.maxResults ?? 8),
    videoEmbeddable: 'true',
    order: 'relevance',
  }
  if (options.publishedAfter) params.publishedAfter = options.publishedAfter
  if (options.publishedBefore) params.publishedBefore = options.publishedBefore
  const body = await request<{ items?: YoutubeSearchItem[] }>('search', params)
  return Array.isArray(body.items) ? body.items : []
}

/** videos.list costs 1 unit per call; up to 50 ids are validated together. */
export async function youtubeVideos(ids: string[]): Promise<YoutubeVideoItem[]> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return []
  consumeQuota('videos', VIDEOS_QUOTA_COST)
  const body = await request<{ items?: YoutubeVideoItem[] }>('videos', {
    part: 'snippet,contentDetails,status',
    id: unique.join(','),
    maxResults: '50',
  })
  return Array.isArray(body.items) ? body.items : []
}
