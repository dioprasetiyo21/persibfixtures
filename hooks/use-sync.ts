'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HighlightSelection } from '@/lib/highlights/types'
import type { SyncConfirmResult, SyncKind, SyncPreview } from '@/lib/sync/types'

/** User-facing status copy, kept in one place so it never drifts from the spec. */
export const SYNC_MESSAGES = {
  checking: 'Checking official sources…',
  committing: 'Committing approved changes to GitHub…',
  preview: 'Changes found. Review before applying.',
  cancelled: 'Changes cancelled. GitHub data was not modified.',
  committed: 'Changes successfully committed to GitHub.',
  partial: 'Some changes were committed, but not all files could be updated.',
  upToDate: 'All fixtures are already up to date. No commit required.',
  failed: 'Refresh failed. Existing fixture data remains unchanged.',
} as const

export type SyncPhase = 'idle' | 'loading' | 'preview' | 'committing' | 'success' | 'error'

export interface SyncState {
  kind: SyncKind | null
  phase: SyncPhase
  preview: SyncPreview | null
  /** Opaque, signed confirmation token from the preview response. */
  token: string | null
  result: SyncConfirmResult | null
  /** Exact status message shown to the user. */
  message: string | null
  /** Technical reason for a failure, shown below the status message. */
  detail: string | null
  authRequired: boolean
}

const INITIAL: SyncState = {
  kind: null,
  phase: 'idle',
  preview: null,
  token: null,
  result: null,
  message: null,
  detail: null,
  authRequired: false,
}

function readError(body: unknown, status: number): { detail: string; authRequired: boolean } {
  const payload = body as { error?: unknown; authRequired?: unknown } | null
  const detail =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error
      : `Request failed with HTTP ${status}`
  return { detail, authRequired: payload?.authRequired === true }
}

/** Partial success is driven by failed files, never by non-fatal search warnings. */
export function statusMessageForResult(result: SyncConfirmResult): string {
  const hasFailedFile = result.files?.some((file) => file.action === 'failed') ?? false
  if (hasFailedFile) return SYNC_MESSAGES.partial
  if (result.committed) return SYNC_MESSAGES.committed
  return result.message || SYNC_MESSAGES.upToDate
}

export function useSync(options: { onCommitted?: () => void | Promise<unknown> } = {}) {
  const [state, setState] = useState<SyncState>(INITIAL)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const busy = useRef(false)
  const lastKind = useRef<SyncKind>('schedule')
  const tokenRef = useRef<string | null>(null)
  const onCommitted = useRef(options.onCommitted)
  onCommitted.current = options.onCommitted

  // The cookie is HttpOnly, so the client only knows a boolean status.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const res = await fetch('/api/admin/session', { cache: 'no-store' })
        const body = (await res.json().catch(() => null)) as { authenticated?: unknown } | null
        if (active && res.ok) setAuthenticated(body?.authenticated === true)
      } catch {
        // If the status call fails, the server still enforces auth on refresh.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const start = useCallback(async (kind: SyncKind) => {
    if (busy.current) return
    busy.current = true
    lastKind.current = kind
    tokenRef.current = null
    setAuthOpen(false)

    setState({
      ...INITIAL,
      kind,
      phase: 'loading',
      message: SYNC_MESSAGES.checking,
    })

    try {
      const res = await fetch(`/api/refresh/${kind}`, {
        method: 'POST',
        cache: 'no-store',
      })
      const body = (await res.json().catch(() => null)) as unknown

      if (!res.ok) {
        const { detail, authRequired } = readError(body, res.status)
        if (authRequired) {
          setAuthenticated(false)
          setAuthOpen(true)
          setAuthMessage(detail)
        }
        setState({
          ...INITIAL,
          kind,
          phase: 'error',
          message: SYNC_MESSAGES.failed,
          detail,
          authRequired,
        })
        return
      }

      setAuthenticated(true)
      const preview = body as SyncPreview
      const hasHighlightWork =
        !!preview?.highlights &&
        (preview.highlights.candidates.length > 0 ||
          preview.highlights.manualTargets.length > 0 ||
          preview.highlights.searchStateChanged)
      if (!preview?.changes?.length && !hasHighlightWork) {
        setState({
          ...INITIAL,
          kind,
          phase: 'success',
          preview,
          message: SYNC_MESSAGES.upToDate,
        })
        return
      }

      setState({
        ...INITIAL,
        kind,
        phase: 'preview',
        preview,
        token: preview.token,
        message: SYNC_MESSAGES.preview,
      })
      tokenRef.current = preview.token
    } catch (error) {
      setState({
        ...INITIAL,
        kind,
        phase: 'error',
        message: SYNC_MESSAGES.failed,
        detail: error instanceof Error ? error.message : 'Network request failed',
        authRequired: false,
      })
    } finally {
      busy.current = false
    }
  }, [])

  const confirm = useCallback(async (selection?: HighlightSelection) => {
    const token = tokenRef.current
    if (!token || busy.current) return
    busy.current = true
    setState((current) => ({
      ...current,
      phase: 'committing',
      message: SYNC_MESSAGES.committing,
      detail: null,
    }))

    try {
      const res = await fetch('/api/refresh/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ token, ...(selection ? { selection } : {}) }),
      })
      const body = (await res.json().catch(() => null)) as unknown

      if (!res.ok) {
        const { detail, authRequired } = readError(body, res.status)
        tokenRef.current = null
        if (authRequired) {
          setAuthenticated(false)
          setAuthOpen(true)
          setAuthMessage(detail)
        }
        setState({
          ...INITIAL,
          kind: lastKind.current,
          phase: 'error',
          message: SYNC_MESSAGES.failed,
          detail,
          authRequired,
        })
        return
      }

      const result = body as SyncConfirmResult
      tokenRef.current = null
      setState({
        ...INITIAL,
        kind: lastKind.current,
        phase: 'success',
        result,
        message: statusMessageForResult(result),
      })

      if (result.committed) {
        try {
          await onCommitted.current?.()
        } catch {
          // The commit succeeded; a failed client revalidation must not be reported as a failed commit.
        }
      }
    } catch (error) {
      tokenRef.current = null
      setState({
        ...INITIAL,
        kind: lastKind.current,
        phase: 'error',
        message: SYNC_MESSAGES.failed,
        detail: error instanceof Error ? error.message : 'Network request failed',
        authRequired: false,
      })
    } finally {
      busy.current = false
    }
  }, [])

  const cancel = useCallback(() => {
    if (busy.current) return
    tokenRef.current = null
    setState({
      ...INITIAL,
      kind: lastKind.current,
      phase: 'success',
      message: SYNC_MESSAGES.cancelled,
    })
  }, [])

  /** Re-run the last sync after a successful admin sign-in. */
  const retry = useCallback(() => {
    void start(lastKind.current)
  }, [start])

  const dismiss = useCallback(() => {
    if (busy.current) return
    tokenRef.current = null
    setAuthOpen(false)
    setState(INITIAL)
  }, [])

  /** Send the password to the server; only the returned HttpOnly cookie proves it. */
  const login = useCallback(async (password: string): Promise<boolean> => {
    if (authSubmitting) return false
    setAuthSubmitting(true)
    setAuthMessage(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ password }),
      })
      const body = (await res.json().catch(() => null)) as {
        error?: unknown
        authenticated?: unknown
      } | null
      if (!res.ok) {
        const message =
          typeof body?.error === 'string' && body.error.trim()
            ? body.error
            : `Sign-in failed with HTTP ${res.status}`
        setAuthMessage(message)
        return false
      }
      setAuthenticated(body?.authenticated === true)
      setAuthOpen(false)
      setAuthMessage(null)
      return true
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Network request failed')
      return false
    } finally {
      setAuthSubmitting(false)
    }
  }, [authSubmitting])

  /** Clear the session cookie and any uncommitted preview immediately. */
  const logout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      // Local state is cleared regardless of the network result.
    }
    tokenRef.current = null
    setAuthenticated(false)
    setAuthOpen(false)
    setAuthMessage(null)
    setState(INITIAL)
  }, [])

  const isBusy = state.phase === 'loading' || state.phase === 'committing'

  return {
    ...state,
    isBusy,
    busyKind: isBusy ? state.kind : null,
    authenticated,
    authOpen,
    authMessage,
    authSubmitting,
    start,
    confirm,
    cancel,
    retry,
    dismiss,
    login,
    logout,
  }
}

export type UseSync = ReturnType<typeof useSync>
