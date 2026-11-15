import { ADMIN_TOKEN } from './config'
import { safeEqual } from './pending'

export interface AuthFailure {
  ok: false
  status: number
  code: 'unauthorized'
  message: string
  authRequired: boolean
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
 * Protect write-capable endpoints.
 *
 * - When SYNC_ADMIN_TOKEN is set, every call must present it.
 * - Otherwise browsers must call from the same origin (CSRF protection).
 *   Non-browser clients without an Origin header are allowed but rate limited.
 */
export function authorize(request: Request): { ok: true } | AuthFailure {
  if (ADMIN_TOKEN) {
    const header = request.headers.get('x-sync-token')
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    const provided = header ?? bearer ?? ''
    if (!provided || !safeEqual(provided, ADMIN_TOKEN)) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'This action requires the sync admin token',
        authRequired: true,
      }
    }
    return { ok: true }
  }

  const origin = request.headers.get('origin')
  if (!origin) return { ok: true }

  const requestHost = request.headers.get('x-forwarded-host') ?? hostOf(request.url)
  const originHost = hostOf(origin)
  if (!originHost || !requestHost || originHost !== requestHost) {
    return {
      ok: false,
      status: 403,
      code: 'unauthorized',
      message: 'Cross-origin refresh requests are not allowed',
      authRequired: false,
    }
  }
  return { ok: true }
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}
