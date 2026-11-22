import localResults from '@/data/results.json'
import { fetchSourceMatches, matchToFixtures, pendingFixtures } from '@/lib/score-sources'
import type { RawFixture, ScoreResult } from '@/lib/types'

type ResultMap = Record<string, ScoreResult>

function isScore(value: unknown): value is ScoreResult {
  if (!value || typeof value !== 'object') return false
  const { persib, opponent } = value as Record<string, unknown>
  return (
    typeof persib === 'number' &&
    typeof opponent === 'number' &&
    Number.isInteger(persib) &&
    Number.isInteger(opponent) &&
    persib >= 0 &&
    opponent >= 0
  )
}

function parseResults(raw: unknown): ResultMap {
  const out: ResultMap = {}
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = (item as { id?: unknown } | null)?.id
      if (typeof id === 'string' && isScore(item)) out[id] = { persib: item.persib, opponent: item.opponent }
    }
    return out
  }
  const map = (raw as { results?: Record<string, unknown> } | null)?.results
  if (map && typeof map === 'object') {
    for (const [id, value] of Object.entries(map)) {
      if (isScore(value)) out[id] = { persib: value.persib, opponent: value.opponent }
    }
  }
  return out
}

/**
 * Apply the same score overlay order as /api/fixtures so a match that is only
 * Finished via results.json (or SCORES_SOURCE_URL) can still be searched.
 * Overlay failures are ignored here: they must never block schedule refresh.
 */
export async function effectiveFinishedFixtures(fixtures: RawFixture[]): Promise<RawFixture[]> {
  let results: ResultMap = { ...parseResults(localResults) }

  try {
    const { matches } = await fetchSourceMatches(pendingFixtures(fixtures), { fresh: false })
    results = { ...results, ...matchToFixtures(fixtures, matches) }
  } catch {
    // Best-effort only.
  }

  const url = process.env.SCORES_SOURCE_URL?.trim()
  if (url) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (res.ok) results = { ...results, ...parseResults(await res.json()) }
    } catch {
      // Best-effort only.
    }
  }

  return fixtures
    .map((fixture) => {
      const overlay = results[fixture.id]
      const open = fixture.status !== 'cancelled' && fixture.status !== 'postponed'
      if (overlay && open) return { ...fixture, score: overlay, status: 'finished' as const }
      return fixture
    })
    .filter((fixture) => fixture.status === 'finished')
}
