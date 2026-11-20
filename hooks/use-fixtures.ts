'use client'

import useSWR from 'swr'
import { needsScorePolling } from '@/lib/fixtures'
import type { FixturesPayload } from '@/lib/types'

const ENDPOINT = '/api/fixtures'
const ACTIVE_POLL_INTERVAL_MS = 60_000
const BACKGROUND_POLL_INTERVAL_MS = 5 * 60_000

const fetcher = async (url: string): Promise<FixturesPayload> => {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Failed to load fixtures')
  return body
}

export function useFixtures() {
  const swr = useSWR<FixturesPayload>(ENDPOINT, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: (latest) =>
      latest && needsScorePolling(latest.fixtures)
        ? ACTIVE_POLL_INTERVAL_MS
        : BACKGROUND_POLL_INTERVAL_MS,
  })
  return swr
}
