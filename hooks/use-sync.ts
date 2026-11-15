'use client'

import { useCallback, useRef, useState } from 'react'
import type { SyncConfirmResult, SyncKind, SyncPreview } from '@/lib/sync/types'

/** User-facing status copy, kept in one place so it never drifts from the spec. */
export const SYNC_MESSAGES = {
  checking: 'Checking official sources…',
  committing: 'Committing approved changes to GitHub…',
  preview: 'Changes found. Review before applying.',
  cancelled: 'Changes cancelled. GitHub data was not modified.',
  committed: 'Changes successfully committed to GitHub.',
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

const ADMIN_TOKEN_KEY = 'persib-sync-admin-token'

function adminHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = window.sessionStorage.getItem(ADMIN_TOKEN_KEY)
  return token ? { 'x-sync-token': token } : {}
}

function readError(body: unknown, status: number): { detail: string; authRequired: boolean } {
  const payload = body as { error?: unknown; authRequired?: unknown } | null
  const detail =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error
      : `Request failed with HTTP ${status}`
  return { detail, authRequired: payload?.authRequired === true }
}

export function useSync(options: { onCommitted?: () => void | Promise<unknown> } = {}) {
  const [state, setState] = useState<SyncState>(INITIAL)
  const busy = useRef(false)
  const lastKind = useRef<SyncKind>('schedule')
  const tokenRef = useRef<string | null>(null)
  const onCommitted = useRef(options.onCommitted)
  onCommitted.current = options.onCommitted

  const start = useCallback(async (kind: SyncKind) => {
    if (busy.current) return
    busy.current = true
    lastKind.current = kind
    tokenRef.current = null

    setState({
      ...INITIAL,
      kind,
      phase: 'loading',
      message: SYNC_MESSAGES.checking,
    })

    try {
      const res = await fetch(`/api/refresh/${kind}`, {
        method: 'POST',
        headers: { ...adminHeaders() },
        cache: 'no-store',
      })
      const body = (await res.json().catch(() => null)) as unknown

      if (!res.ok) {
        const { detail, authRequired } = readError(body, res.status)
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

      const preview = body as SyncPreview
      if (!preview?.changes?.length) {
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

  const confirm = useCallback(async () => {
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
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        cache: 'no-store',
        body: JSON.stringify({ token }),
      })
      const body = (await res.json().catch(() => null)) as unknown

      if (!res.ok) {
        const { detail, authRequired } = readError(body, res.status)
        tokenRef.current = null
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
        message: result.committed
          ? SYNC_MESSAGES.committed
          : (result.message || SYNC_MESSAGES.upToDate),
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

  /** Re-run the last sync, e.g. after supplying the optional admin token. */
  const retry = useCallback(() => {
    void start(lastKind.current)
  }, [start])

  const dismiss = useCallback(() => {
    if (busy.current) return
    tokenRef.current = null
    setState(INITIAL)
  }, [])

  const saveAdminToken = useCallback((value: string) => {
    if (typeof window !== 'undefined') {
      const trimmed = value.trim()
      if (trimmed) window.sessionStorage.setItem(ADMIN_TOKEN_KEY, trimmed)
      else window.sessionStorage.removeItem(ADMIN_TOKEN_KEY)
    }
  }, [])

  const isBusy = state.phase === 'loading' || state.phase === 'committing'

  return {
    ...state,
    isBusy,
    busyKind: isBusy ? state.kind : null,
    start,
    confirm,
    cancel,
    retry,
    dismiss,
    saveAdminToken,
  }
}

export type UseSync = ReturnType<typeof useSync>
