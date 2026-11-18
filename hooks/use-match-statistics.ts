'use client'

import { useCallback } from 'react'
import useSWR, { preload } from 'swr'
import type { MatchStatistics } from '@/lib/statistics/types'

/**
 * Successful results stay warm for the whole browsing session — the official
 * feed does not change once a match is finished.
 */
const FOUND_TTL_MS = 10 * 60_000

/** Unavailable results are rechecked sooner so a late upload shows up. */
const UNAVAILABLE_TTL_MS = 2 * 60_000

interface CacheEntry {
  expires: number
  data: MatchStatistics
}

/**
 * In-memory, session-scoped cache keyed by fixture id. It lives beside SWR (not
 * instead of it): SWR owns the component lifecycle and cross-component cache,
 * while this layer owns the per-state TTL and the "never cache a network error"
 * rule that SWR cannot express directly.
 */
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<MatchStatistics>>()

export function statisticsKey(fixtureId: string): string {
  return `/api/matches/${encodeURIComponent(fixtureId)}/statistics`
}

function readCached(fixtureId: string): MatchStatistics | null {
  const entry = cache.get(fixtureId)
  if (!entry) return null
  if (entry.expires <= Date.now()) {
    cache.delete(fixtureId)
    return null
  }
  return entry.data
}

async function requestStatistics(fixtureId: string): Promise<MatchStatistics> {
  const res = await fetch(statisticsKey(fixtureId), { headers: { Accept: 'application/json' } })
  const body = (await res.json().catch(() => null)) as (MatchStatistics & { error?: string }) | null
  if (!res.ok) {
    throw new Error(body?.error ?? `Gagal memuat statistik (${res.status})`)
  }
  if (!body || typeof body !== 'object' || !('state' in body)) {
    throw new Error('Respons statistik tidak valid.')
  }
  return body
}

/**
 * Fetch statistics through the cache, deduplicating concurrent callers for the
 * same fixture. Network failures are never cached, so a retry always reaches the
 * server; only terminal answers (`found` / `unavailable`) are stored.
 */
export function loadStatistics(fixtureId: string): Promise<MatchStatistics> {
  const cached = readCached(fixtureId)
  if (cached) return Promise.resolve(cached)

  const pending = inflight.get(fixtureId)
  if (pending) return pending

  const promise = requestStatistics(fixtureId)
    .then((data) => {
      const ttl = data.state === 'found' ? FOUND_TTL_MS : UNAVAILABLE_TTL_MS
      cache.set(fixtureId, { expires: Date.now() + ttl, data })
      return data
    })
    .finally(() => {
      inflight.delete(fixtureId)
    })

  inflight.set(fixtureId, promise)
  return promise
}

/**
 * Warm the cache for a match the user is likely to open (hover / focus on
 * desktop, a short delay after the details modal opens on touch). Duplicate
 * calls are ignored and failures are swallowed — a prefetch is only an
 * optimisation.
 */
export function prefetchStatistics(fixtureId: string): void {
  if (readCached(fixtureId) || inflight.has(fixtureId)) return
  void preload(statisticsKey(fixtureId), () => loadStatistics(fixtureId)).catch(() => {})
}

export interface MatchStatisticsResource {
  data: MatchStatistics | null
  error: string | null
  isLoading: boolean
  isValidating: boolean
  retry: () => void
}

/**
 * Read one fixture's statistics. The request only runs while `enabled` is true
 * (the statistics modal is open); cached answers render instantly on reopen.
 */
export function useMatchStatistics(
  fixtureId: string | null,
  enabled: boolean,
): MatchStatisticsResource {
  const key = enabled && fixtureId ? statisticsKey(fixtureId) : null
  const { data, error, isLoading, isValidating, mutate } = useSWR<MatchStatistics>(
    key,
    () => loadStatistics(fixtureId as string),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Never let the previous fixture's rows bleed into the next fixture.
      keepPreviousData: false,
      dedupingInterval: 0,
      // Retries are explicit (the Retry button) so errors are not hammered.
      shouldRetryOnError: false,
      errorRetryCount: 0,
    },
  )

  const retry = useCallback(() => {
    if (!fixtureId) return
    cache.delete(fixtureId)
    void mutate()
  }, [fixtureId, mutate])

  return {
    data: data ?? null,
    error: error ? (error instanceof Error ? error.message : 'Gagal memuat statistik.') : null,
    isLoading: enabled && key !== null && isLoading,
    isValidating,
    retry,
  }
}
