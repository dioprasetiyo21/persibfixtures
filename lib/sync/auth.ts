import {
  readSessionCookie,
  verifyAdminSession,
  verifyMutationOrigin,
} from '../admin/session'

export interface AuthFailure {
  ok: false
  status: number
  code: 'unauthorized' | 'forbidden'
  message: string
  authRequired: boolean
}

/**
 * Protect write-capable endpoints. Every refresh, preview, confirm and GitHub
 * writeback passes through here before any dataset work happens.
 *
 * - Origin is validated for every mutation (CSRF defence).
 * - A signed, short-lived admin session cookie is required.
 * - Non-browser clients must obtain a session through /api/admin/login too.
 */
export function authorize(request: Request): { ok: true } | AuthFailure {
  if (!verifyMutationOrigin(request)) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Cross-origin refresh requests are not allowed',
      authRequired: false,
    }
  }

  if (!verifyAdminSession(readSessionCookie(request))) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Admin sign-in required or session expired. Please sign in again.',
      authRequired: true,
    }
  }

  return { ok: true }
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}
