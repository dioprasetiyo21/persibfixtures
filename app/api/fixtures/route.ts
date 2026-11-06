import dataset from '@/data/fixtures.json'
import type { Fixture, FixturesPayload, RawFixture, SeasonMeta, Source } from '@/lib/types'

interface Dataset {
  meta: SeasonMeta
  sources: Record<string, Source>
  fixtures: RawFixture[]
}

function normalize(data: Dataset): FixturesPayload {
  const fixtures: Fixture[] = data.fixtures.map(({ sourceKey, ...f }) => ({
    ...f,
    source: data.sources[sourceKey] ?? { name: sourceKey, url: '' },
  }))
  return { meta: data.meta, fixtures }
}

/**
 * Set FIXTURES_SOURCE_URL to a JSON endpoint with the same shape as
 * data/fixtures.json to sync fixtures from a remote source.
 */
export async function GET() {
  const remote = process.env.FIXTURES_SOURCE_URL
  try {
    if (remote) {
      const res = await fetch(remote, { next: { revalidate: 3600 } })
      if (!res.ok) throw new Error(`Remote source responded ${res.status}`)
      return Response.json(normalize((await res.json()) as Dataset))
    }
    return Response.json(normalize(dataset as Dataset))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load fixtures' },
      { status: 502 },
    )
  }
}
