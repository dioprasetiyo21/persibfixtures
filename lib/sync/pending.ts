import { createHmac, timingSafeEqual } from 'node:crypto'
import { PENDING_TTL_SECONDS } from './config'
import type { PendingPayload } from './types'

const DEV_SECRET = 'persib-fixtures-dev-only-signing-secret'

export class PendingConfigError extends Error {}

function secret(): string {
  const configured = process.env.SYNC_SIGNING_SECRET?.trim()
  if (configured) return configured
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) return `github:${token}`
  if (process.env.NODE_ENV === 'production') {
    throw new PendingConfigError('SYNC_SIGNING_SECRET (or GITHUB_TOKEN) must be configured to sign previews')
  }
  return DEV_SECRET
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

/**
 * Create a short-lived, tamper-proof token for one preview.
 * The pending changes themselves are signed, so the browser never needs to
 * resend fixture data and cannot alter what will be committed.
 */
export function signPending(payload: PendingPayload): { token: string; expiresAt: string } {
  const body = base64url(JSON.stringify(payload))
  return {
    token: `${body}.${sign(body)}`,
    expiresAt: new Date(payload.exp).toISOString(),
  }
}

export type PendingReadResult =
  | { ok: true; payload: PendingPayload }
  | { ok: false; reason: 'invalid' | 'expired' }

export function readPending(token: string): PendingReadResult {
  if (!token || typeof token !== 'string' || token.length > 200_000) return { ok: false, reason: 'invalid' }
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return { ok: false, reason: 'invalid' }

  let expected: string
  try {
    expected = sign(body)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  const given = Buffer.from(signature, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: 'invalid' }

  let payload: PendingPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PendingPayload
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (!payload || payload.v !== 1 || !Array.isArray(payload.changes) || !payload.exp) {
    return { ok: false, reason: 'invalid' }
  }
  if (payload.exp <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

export function pendingExpiry(): number {
  return Date.now() + PENDING_TTL_SECONDS * 1000
}

/** Constant-time comparison used by the optional admin token check. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
