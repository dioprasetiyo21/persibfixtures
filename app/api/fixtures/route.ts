import dataset from '@/data/fixtures.json'
import localResults from '@/data/results.json'
import { fetchSourceMatches, matchToFixtures, pendingFixtures } from '@/lib/score-sources'
import type {
  Fixture,
  FixturesPayload,
  RawFixture,
  ScoreResult,
  ScoresInfo,
  SeasonMeta,
  Source,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Dataset {
  meta: SeasonMeta
  sources: Record<string, Source>
  fixtures: RawFixture[]
}

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

/**
 * Accepts either `{ results: { "<fixture id>": { persib, opponent } } }`
 * or `[{ id, persib, opponent }]`. Invalid entries are ignored.
 */
function parseResults(raw: unknown): ResultMap {
  const out: ResultMap = {}
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isScore(item)) continue
      const id = (item as unknown as { id?: unknown }).id
      if (typeof id === 'string') out[id] = { persib: item.persib, opponent: item.opponent }
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

async function loadRemoteResults(url: string): Promise<ResultMap> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Scores source responded ${res.status}`)
  return parseResults(await res.json())
}

function normalize(data: Dataset, results: ResultMap): { fixtures: Fixture[]; applied: number } {
  let applied = 0
  const fixtures: Fixture[] = data.fixtures.map(({ sourceKey, ...f }) => {
    const fixture: Fixture = { ...f, source: data.sources[sourceKey] ?? { name: sourceKey, url: '' } }
    const result = results[f.id]
    const open = f.status !== 'cancelled' && f.status !== 'postponed'
    if (result && open && (!f.score || f.score.persib !== result.persib || f.score.opponent !== result.opponent)) {
      if (!f.score) applied++
      fixture.score = result
      fixture.status = 'finished'
    }
    return fixture
  })
  return { fixtures, applied }
}

/**
 * Fixtures come from data/fixtures.json (or FIXTURES_SOURCE_URL, same shape).
 * Final scores are layered on top from data/results.json and, when set,
 * SCORES_SOURCE_URL. Pass ?refresh=1 to bypass the cached fixtures source.
 */
export async function GET(request: Request) {
  const forceFresh = new URL(request.url).searchParams.has('refresh')
  const fixturesUrl = process.env.FIXTURES_SOURCE_URL
  const scoresUrl = process.env.SCORES_SOURCE_URL

  try {
    let base = dataset as Dataset
    if (fixturesUrl) {
      const res = await fetch(
        fixturesUrl,
        forceFresh ? { cache: 'no-store' } : { next: { revalidate: 3600 } },
      )
      if (!res.ok) throw new Error(`Remote source responded ${res.status}`)
      base = (await res.json()) as Dataset
    }

    const errors: string[] = []

    const { matches, reports } = await fetchSourceMatches(pendingFixtures(base.fixtures), {
      fresh: forceFresh,
    })
    const scraped = matchToFixtures(base.fixtures, matches)
    for (const report of reports) {
      if (!report.ok) errors.push(`${report.name}: ${report.error ?? 'failed'}`)
    }

    const manual = parseResults(localResults)
    let results: ResultMap = { ...scraped, ...manual }
    let origin: ScoresInfo['origin'] =
      Object.keys(scraped).length > 0
        ? 'remote'
        : Object.keys(manual).length > 0
          ? 'local'
          : 'dataset'

    if (scoresUrl) {
      try {
        results = { ...results, ...(await loadRemoteResults(scoresUrl)) }
        origin = 'remote'
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Could not reach the scores source')
      }
    }

    const scoresError = errors.length > 0 ? errors.join(' · ') : undefined
    const { fixtures, applied } = normalize(base, results)
    const payload: FixturesPayload = {
      meta: base.meta,
      fixtures,
      refreshedAt: new Date().toISOString(),
      scores: { origin, applied, ...(scoresError ? { error: scoresError } : {}) },
    }
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load fixtures' },
      { status: 502 },
    )
  }
}
