import bundled from '@/data/fixtures.json'
import { getMatchStatistics } from '@/lib/statistics'
import { validateDataset } from '@/lib/sync/dataset'
import { readDataset } from '@/lib/sync/github'
import type { Dataset } from '@/lib/sync/types'
import type { Fixture } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i

function toFixture(dataset: Dataset, id: string): Fixture | null {
  const raw = dataset.fixtures.find((fixture) => fixture.id === id)
  if (!raw) return null
  const { sourceKey, ...rest } = raw
  return { ...rest, source: dataset.sources[sourceKey] ?? { name: sourceKey, url: '' } }
}

/**
 * Read data/fixtures.json the same way /api/fixtures does — remote source first,
 * then GitHub/raw, then the bundled copy — so statistics always see the latest
 * fixture reference metadata without touching the sync writeback path.
 */
async function resolveFixture(id: string): Promise<Fixture | null> {
  const fixturesUrl = process.env.FIXTURES_SOURCE_URL
  if (fixturesUrl) {
    try {
      const res = await fetch(fixturesUrl, { next: { revalidate: 300, tags: ['fixtures'] } })
      if (res.ok) {
        const dataset = validateDataset(await res.json())
        const found = toFixture(dataset, id)
        if (found) return found
      }
    } catch {
      // fall through to the next source
    }
  }

  try {
    const { dataset } = await readDataset()
    const found = toFixture(dataset, id)
    if (found) return found
  } catch {
    // fall through to the bundled copy
  }

  return toFixture(validateDataset(bundled), id)
}

/**
 * Short-lived in-process memo so identical fixture metadata is not resolved over
 * and over while a match is being viewed. This is per-instance only — it is not
 * shared across serverless instances — and only positive results are cached.
 */
const FIXTURE_MEMO_TTL_MS = 60_000
const FIXTURE_MEMO_MAX_ENTRIES = 200
const FIXTURE_MEMO = new Map<string, { expires: number; fixture: Fixture }>()

async function loadFixture(id: string): Promise<Fixture | null> {
  const memo = FIXTURE_MEMO.get(id)
  if (memo && memo.expires > Date.now()) return memo.fixture

  const fixture = await resolveFixture(id)
  if (!fixture) return null

  if (FIXTURE_MEMO.size >= FIXTURE_MEMO_MAX_ENTRIES) FIXTURE_MEMO.clear()
  FIXTURE_MEMO.set(id, { expires: Date.now() + FIXTURE_MEMO_TTL_MS, fixture })
  return fixture
}

function cacheControl(state: string): string {
  if (state === 'found') return 'public, s-maxage=300, stale-while-revalidate=900'
  if (state === 'unavailable') return 'public, s-maxage=120, stale-while-revalidate=300'
  return 'no-store'
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!ID_RE.test(id)) {
    return Response.json({ error: 'Invalid fixture id' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const fixture = await loadFixture(id)
    if (!fixture) {
      return Response.json({ error: 'Fixture not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    const statistics = await getMatchStatistics(fixture)
    return Response.json(statistics, {
      headers: { 'Cache-Control': cacheControl(statistics.state) },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load statistics' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
