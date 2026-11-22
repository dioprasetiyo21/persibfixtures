import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HighlightStore, PendingHighlights } from '../lib/highlights/types'

const search = require('../lib/highlights/search') as typeof import('../lib/highlights/search')

// Patch verification before loading the store so its import binding sees the stub.
search.verifyManualVideos = (async (ids: string[]) => {
  const result: Record<string, { ok: boolean; reason?: string; video?: unknown }> = {}
  for (const id of ids) {
    result[id] =
      id === 'validvideo1'
        ? {
            ok: true,
            video: {
              id,
              snippet: {
                title: '  Persib 2-0 Arema  ',
                channelTitle: '  Persib TV  ',
                publishedAt: '2026-01-01T00:00:00Z',
              },
            },
          }
        : { ok: false, reason: 'Video was not found' }
  }
  return result
}) as typeof search.verifyManualVideos

const store = require('../lib/highlights/store') as typeof import('../lib/highlights/store')

const signed: PendingHighlights = {
  baseSource: 'github',
  baseSha: 'base-sha',
  candidates: [
    {
      id: 'cand-1',
      fixtureId: 'fx-1',
      videoId: 'autovideo01',
      url: 'https://www.youtube.com/watch?v=autovideo01',
      title: 'Auto highlights',
      channel: 'Auto TV',
      publishedAt: '2026-01-01T00:00:00Z',
      durationSeconds: 120,
      queryHash: 'hash-1',
      score: 80,
      reasons: ['title'],
    },
  ],
  manualTargets: [
    { fixtureId: 'fx-1', label: 'SL · Persib vs Arema', competition: 'SL', date: '2026-01-01' },
  ],
  operations: [],
}

test('verified manual URL wins over auto approval and rejection, with enriched metadata', async () => {
  const result = await store.operationsFromSelection(signed, {
    approvedCandidateIds: ['cand-1'],
    rejectedFixtureIds: ['fx-1'],
    manualUrls: { 'fx-1': 'https://www.youtube.com/watch?v=validvideo1' },
  })

  assert.equal(result.operations.length, 1)
  const operation = result.operations[0]
  assert.equal(operation.fixtureId, 'fx-1')
  assert.equal(operation.action, 'publish-manual')
  assert.equal(operation.source, 'manual')
  assert.equal(operation.videoId, 'validvideo1')
  assert.equal(operation.title, 'Persib 2-0 Arema')
  assert.equal(operation.channel, 'Persib TV')
  assert.equal(result.warnings.length, 0)
})

test('unverifiable manual URL is still saved with basic metadata and a clear warning', async () => {
  const result = await store.operationsFromSelection(signed, {
    approvedCandidateIds: [],
    rejectedFixtureIds: [],
    manualUrls: { 'fx-1': 'https://www.youtube.com/watch?v=notfound001' },
  })

  assert.equal(result.operations.length, 1)
  const operation = result.operations[0]
  assert.equal(operation.action, 'publish-manual')
  assert.equal(operation.videoId, 'notfound001')
  assert.equal(operation.url, 'https://www.youtube.com/watch?v=notfound001')
  assert.equal(operation.title, 'Match highlights')
  assert.equal(operation.channel, 'Manual URL')
  assert.equal(operation.channelId, undefined)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /could not be verified/i)
  assert.match(result.warnings[0], /saved with basic metadata/i)
  assert.match(result.warnings[0], /not found/i)
})

test('malformed manual URL produces a warning and is not published', async () => {
  const result = await store.operationsFromSelection(signed, {
    approvedCandidateIds: [],
    rejectedFixtureIds: [],
    manualUrls: { 'fx-1': 'not-a-url' },
  })

  assert.equal(result.operations.length, 0)
  assert.match(result.warnings[0], /not a valid YouTube video URL/i)
})

test('manual URL for an unknown fixture is rejected', async () => {
  await assert.rejects(
    () =>
      store.operationsFromSelection(signed, {
        approvedCandidateIds: [],
        rejectedFixtureIds: [],
        manualUrls: { 'unknown-fixture': 'https://www.youtube.com/watch?v=validvideo1' },
      }),
    store.HighlightInputError,
  )
})

test('merging a manual operation never overwrites an existing manual highlight', () => {
  const existing: HighlightStore = {
    highlights: {
      'fx-1': {
        fixtureId: 'fx-1',
        source: 'manual',
        status: 'published',
        videoId: 'oldmanual1',
        url: 'https://www.youtube.com/watch?v=oldmanual1',
        title: 'Existing manual highlight',
        channel: 'Manual URL',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
  }

  const merge = store.mergeHighlightOperations(
    existing,
    [
      {
        fixtureId: 'fx-1',
        action: 'publish-manual',
        source: 'manual',
        videoId: 'validvideo1',
        url: 'https://www.youtube.com/watch?v=validvideo1',
      },
    ],
    new Date('2026-02-01T00:00:00Z'),
  )

  assert.equal(merge.applied, 0)
  assert.equal(merge.store.highlights['fx-1'].videoId, 'oldmanual1')
  assert.match(merge.skipped[0].reason, /manual/i)
})
