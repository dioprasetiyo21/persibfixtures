import { RATE_LIMITS } from '../sync/config'
import { clientKey } from '../sync/auth'
import { errorResponse, jsonResponse, rateLimit } from '../sync/respond'
import {
  AdminSessionConfigError,
  adminAuthConfigured,
  createAdminSession,
  readSessionCookie,
  serializeExpiredCookie,
  serializeSessionCookie,
  verifyAdminSession,
  verifyAdminPassword,
  verifyMutationOrigin,
} from './session'

/**
 * Server-only admin authentication. Route handlers stay thin wrappers around
 * these functions so tests can exercise the whole flow without Next.js.
 */

function forbidden(): Response {
  return errorResponse(
    'forbidden',
    'Cross-origin admin requests are not allowed',
    403,
    { authRequired: false },
  )
}

export async function adminLogin(request: Request): Promise<Response> {
  if (!verifyMutationOrigin(request)) return forbidden()

  if (!adminAuthConfigured()) {
    return errorResponse(
      'config',
      'Admin authentication is not configured on this deployment',
      503,
      { authRequired: false },
    )
  }

  const limit = RATE_LIMITS.login
  const attempt = rateLimit('login', clientKey(request), limit.limit, limit.windowMs)
  if (!attempt.ok) {
    return errorResponse('rate_limited', 'Too many login attempts. Try again shortly.', 429, {
      authRequired: true,
      retryAfter: attempt.retryAfter,
    })
  }

  let body: { password?: unknown } | null = null
  try {
    body = (await request.json()) as { password?: unknown }
  } catch {
    // Malformed JSON is treated as an incorrect password.
  }

  if (!verifyAdminPassword(body?.password)) {
    return errorResponse('invalid_password', 'Incorrect admin password', 401, {
      authRequired: true,
    })
  }

  try {
    const session = createAdminSession()
    const response = jsonResponse({ ok: true, authenticated: true, expiresAt: session.expiresAt })
    response.headers.append('Set-Cookie', serializeSessionCookie(session.token))
    return response
  } catch (error) {
    if (error instanceof AdminSessionConfigError) {
      return errorResponse('config', error.message, 503, { authRequired: false })
    }
    throw error
  }
}

export function adminLogout(request: Request): Response {
  if (!verifyMutationOrigin(request)) return forbidden()
  const response = jsonResponse({ ok: true, authenticated: false })
  response.headers.append('Set-Cookie', serializeExpiredCookie())
  return response
}

export function adminSessionStatus(request: Request): Response {
  const authenticated = verifyAdminSession(readSessionCookie(request))
  return jsonResponse({ ok: true, authenticated })
}
