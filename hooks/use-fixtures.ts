'use client'

import useSWR from 'swr'
import type { FixturesPayload } from '@/lib/types'

const fetcher = async (url: string): Promise<FixturesPayload> => {
  const res = await fetch(url)
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'Failed to load fixtures')
  return body
}

export function useFixtures() {
  return useSWR<FixturesPayload>('/api/fixtures', fetcher, {
    revalidateOnFocus: false,
  })
}
