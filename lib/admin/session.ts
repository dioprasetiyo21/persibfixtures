import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Server-only admin session helpers.
 *
 * The password and signing secret are read from process.env here and nowhere
 * else. No value from this module is ever imported by a client component.
 */

export const ADMIN_COOKIE = 'persib-admin-session'
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60
const SESSION_VERSION = 1
const MAX_TOKEN_LENGTH = 4_096

interface SessionPayload {
  v: number
  iat: number
  exp: number
}

export class AdminSessionConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminSessionConfigError'
  }
}

export function adminPassword(): string | null {
  return process.env.SYNC_ADMIN_PASSWORD?.trim() || null
}

export function adminSessionSecret(): string | null {
  return process.env.SYNC_ADMIN_SESSION_SECRET?.trim() || null
}

export function adminAuthConfigured(): boolean {
  return !!adminPassword() && !!adminSessionSecret()
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Constant-time comparison of digests, so input length never leaks. */
export function safeTextEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

export function verifyAdminPassword(input: unknown): boolean {
  const expected = adminPassword()
  const candidate = typeof input === 'string' ? input : ''
  if (!expected || !candidate) {
    // Keep a comparable amount of work even when the input is unusable.
    sha256(candidate)
    return false
  }
  return safeTextEqual(candidate, expected)
}

function sign(body: string): string {
  const secret = adminSessionSecret()
  if (!secret) throw new AdminSessionConfigError('SYNC_ADMIN_SESSION_SECRET is not configured')
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function createAdminSession(now = new Date()): { token: string; expiresAt: string } {
  if (!adminSessionSecret()) {
    throw new AdminSessionConfigError('SYNC_ADMIN_SESSION_SECRET is not configured')
  }
  const iat = now.getTime()
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    iat,
    exp: iat + ADMIN_SESSION_TTL_SECONDS * 1000,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return {
    token: `${body}.${sign(body)}`,
    expiresAt: new Date(payload.exp).toISOString(),
  }
}

export function verifyAdminSession(token: string | null | undefined, now = new Date()): boolean {
  const secret = adminSessionSecret()
  if (!secret || !token || token.length > MAX_TOKEN_LENGTH) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [body, signature] = parts
  if (!body || !signature) return false
  if (!safeTextEqual(signature, sign(body))) return false

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>
    if (payload.v !== SESSION_VERSION) return false
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return false
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return false
    if (payload.exp <= now.getTime()) return false
    if (payload.exp - payload.iat !== ADMIN_SESSION_TTL_SECONDS * 1000) return false
    return true
  } catch {
    return false
  }
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== ADMIN_COOKIE) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return null
}

function hostOf(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

/**
 * State-changing admin requests must be same-origin. SameSite=Strict cookies
 * provide a second layer, but the server never trusts that alone.
 */
export function verifyMutationOrigin(request: Request): boolean {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true

  const originHost = hostOf(request.headers.get('origin'))
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim() ?? null
  const requestHost = forwardedHost || hostOf(request.url)
  if (!originHost || !requestHost || originHost !== requestHost) return false

  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  return true
}

function cookieSuffix(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `; Path=/; HttpOnly; SameSite=Strict${secure}`
}

export function serializeSessionCookie(token: string): string {
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${cookieSuffix()}`
}

export function serializeExpiredCookie(): string {
  return `${ADMIN_COOKIE}=; Max-Age=0${cookieSuffix()}`
}
