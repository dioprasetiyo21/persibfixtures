import { MAX_MANUAL_TARGETS } from '@/lib/highlights/search'
import { HighlightInputError } from '@/lib/highlights/store'
import type { HighlightSelection } from '@/lib/highlights/types'
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
  if (error instanceof HighlightInputError) {
    return errorResponse('invalid_selection', error.message, 400)
  }
  const message = error instanceof Error ? error.message : 'Unexpected refresh failure'
  return errorResponse('internal', message, 500)
}

function guard(request: Request, scope: 'preview' | 'confirm'): Response | null {
  const auth = authorize(request)
  if (!auth.ok) {
    return errorResponse(auth.code, auth.message, auth.status, { authRequired: auth.authRequired })
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

function stringList(value: unknown, limit = 200): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, limit)
}

const MAX_MANUAL_URL_LENGTH = 2048

function parseSelection(value: unknown): HighlightSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const manualUrls: Record<string, string> = {}
  if (raw.manualUrls && typeof raw.manualUrls === 'object' && !Array.isArray(raw.manualUrls)) {
    const entries = Object.entries(raw.manualUrls)
    if (entries.length > MAX_MANUAL_TARGETS) {
      throw new HighlightInputError(
        `Too many manual highlight URLs (maximum ${MAX_MANUAL_TARGETS})`,
      )
    }
    for (const [fixtureId, url] of entries) {
      if (typeof url !== 'string') continue
      if (url.length > MAX_MANUAL_URL_LENGTH) {
        throw new HighlightInputError(
          `Manual highlight URL for ${fixtureId} is too long (maximum ${MAX_MANUAL_URL_LENGTH} characters)`,
        )
      }
      if (url.trim()) manualUrls[fixtureId] = url
    }
  }
  return {
    approvedCandidateIds: stringList(raw.approvedCandidateIds),
    rejectedFixtureIds: stringList(raw.rejectedFixtureIds),
    manualUrls,
  }
}

export async function handleConfirm(request: Request): Promise<Response> {
  const blocked = guard(request, 'confirm')
  if (blocked) return blocked

  let body: { token?: unknown; selection?: unknown } | null = null
  try {
    body = (await request.json()) as { token?: unknown; selection?: unknown }
  } catch {
    // Missing or malformed JSON is reported as a missing token below.
  }
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!token) return errorResponse('invalid_token', 'A confirmation token is required', 400)

  let selection: HighlightSelection | undefined
  try {
    selection = parseSelection(body?.selection)
  } catch (error) {
    return mapError(error)
  }

  try {
    return jsonResponse(await confirmPending(token, selection))
  } catch (error) {
    return mapError(error)
  }
}
