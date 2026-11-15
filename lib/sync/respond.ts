import type { SyncErrorBody, SyncErrorCode } from './types'

/**
 * Best-effort in-memory sliding window limiter. Serverless instances do not
 * share memory, so this complements — never replaces — GitHub-side protection
 * and the optional admin token.
 */
const buckets = new Map<string, number[]>()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfter: number
}

export function rateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  const id = `${scope}:${key}`
  const history = (buckets.get(id) ?? []).filter((time) => now - time < windowMs)

  if (history.length >= limit) {
    buckets.set(id, history)
    const oldest = history[0] ?? now
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) }
  }

  history.push(now)
  buckets.set(id, history)
  if (buckets.size > 500) {
    for (const [bucketKey, times] of buckets) {
      if (times.every((time) => now - time >= windowMs)) buckets.delete(bucketKey)
    }
  }
  return { ok: true, remaining: limit - history.length, retryAfter: 0 }
}

export function errorResponse(
  code: SyncErrorCode,
  message: string,
  status: number,
  extra: Partial<Omit<SyncErrorBody, 'ok' | 'code' | 'error'>> = {},
): Response {
  const body: SyncErrorBody = { ok: false, code, error: message, ...extra }
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
