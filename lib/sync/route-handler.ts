import { RATE_LIMITS } from './config'
import { authorize, clientKey } from './auth'
import { DatasetError } from './dataset'
import { GithubError } from './github'
import { PendingConfigError } from './pending'
import { errorResponse, jsonResponse, rateLimit } from './respond'
import {
  ExpiredPreviewError,
  InvalidPreviewError,
  SourceUnavailableError,
  StalePreviewError,
  confirmPending,
  runPreview,
} from './run'
import type { SyncErrorBody, SyncKind } from './types'

function mapError(error: unknown): Response {
  if (error instanceof SourceUnavailableError) {
    return errorResponse('source_unavailable', error.message, 502, { detail: error.reports })
  }
  if (error instanceof StalePreviewError) {
    return errorResponse('stale_preview', error.message, 409, { detail: error.stale })
  }
  if (error instanceof ExpiredPreviewError) {
    return errorResponse('expired_token', error.message, 410)
  }
  if (error instanceof InvalidPreviewError) {
    return errorResponse('invalid_token', error.message, 401)
  }
  if (error instanceof PendingConfigError) {
    return errorResponse('config', error.message, 500)
  }
  if (error instanceof GithubError) {
    return errorResponse(
      error.code as SyncErrorBody['code'],
      error.message,
      error.status,
      error.detail ? { detail: error.detail } : {},
    )
  }
  if (error instanceof DatasetError) {
    return errorResponse('invalid_dataset', error.message, 422, { detail: error.issues })
  }
  const message = error instanceof Error ? error.message : 'Unexpected refresh failure'
  return errorResponse('internal', message, 500)
}

function guard(request: Request, scope: 'preview' | 'confirm'): Response | null {
  const auth = authorize(request)
  if (!auth.ok) {
    return errorResponse('unauthorized', auth.message, auth.status, { authRequired: auth.authRequired })
  }
  const limit = RATE_LIMITS[scope]
  const result = rateLimit(scope, clientKey(request), limit.limit, limit.windowMs)
  if (!result.ok) {
    return errorResponse('rate_limited', 'Too many refresh requests. Try again shortly.', 429, {
      retryAfter: result.retryAfter,
    })
  }
  return null
}

export async function handlePreview(request: Request, kind: SyncKind): Promise<Response> {
  const blocked = guard(request, 'preview')
  if (blocked) return blocked
  try {
    return jsonResponse(await runPreview(kind))
  } catch (error) {
    return mapError(error)
  }
}

export async function handleConfirm(request: Request): Promise<Response> {
  const blocked = guard(request, 'confirm')
  if (blocked) return blocked

  let token = ''
  try {
    const body = (await request.json()) as { token?: unknown }
    if (typeof body?.token === 'string') token = body.token
  } catch {
    // fall through to the validation below
  }
  if (!token) return errorResponse('invalid_token', 'A confirmation token is required', 400)

  try {
    return jsonResponse(await confirmPending(token))
  } catch (error) {
    return mapError(error)
  }
}
