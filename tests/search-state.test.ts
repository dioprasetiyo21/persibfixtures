import assert from 'node:assert/strict'
import { test } from 'node:test'

const validate = require('../lib/highlights/validate') as typeof import('../lib/highlights/validate')
const storeModule = require('../lib/highlights/store') as typeof import('../lib/highlights/store')
const githubModule = require('../lib/sync/github') as typeof import('../lib/sync/github')

test('searchState merge keeps the newest timestamps and ignores expired cooldowns', () => {
  const now = new Date('2026-01-02T00:00:00Z')
  const older = {
    lastSearchAt: '2026-01-01T00:00:00Z',
    quotaExhaustedUntil: '2026-01-01T12:00:00Z',
  }
  const newer = {
    lastSearchAt: '2026-01-01T10:00:00Z',
    quotaExhaustedUntil: '2026-01-02T12:00:00Z',
  }

  assert.equal(validate.searchStateChanged(older, newer, now), true)
  const merged = validate.mergeSearchStates(older, newer, now)
  assert.equal(merged.lastSearchAt, newer.lastSearchAt)
  assert.equal(merged.quotaExhaustedUntil, newer.quotaExhaustedUntil)
  assert.equal(validate.searchStateChanged(merged, newer, now), false)

  const replayed = validate.mergeSearchStates(newer, older, now)
  assert.equal(replayed.lastSearchAt, newer.lastSearchAt, 'old token cannot rewind lastSearchAt')
  assert.equal(
    replayed.quotaExhaustedUntil,
    newer.quotaExhaustedUntil,
    'old token cannot rewind quota cooldown',
  )
})

test('commitHighlightChanges retries SHA conflicts and persists searchState without losing newer data', async () => {
  const originalRead = storeModule.readHighlightStore
  const originalWrite = githubModule.writeJsonFile
  const writes: Array<{ content: string; sha: string | null }> = []
  let reads = 0

  storeModule.readHighlightStore = (async () => {
    reads++
    if (reads === 1) {
      return {
        store: { highlights: {}, searchState: {} },
        sha: 'sha-1',
        source: 'github' as const,
      }
    }
    return {
      store: {
        highlights: {
          'manual-1': {
            fixtureId: 'manual-1',
            source: 'manual' as const,
            status: 'published' as const,
            videoId: 'oldvideo001',
            url: 'https://www.youtube.com/watch?v=oldvideo001',
            title: 'Newer manual highlight',
            channel: 'Manual URL',
            updatedAt: '2026-01-02T00:30:00Z',
          },
        },
        searchState: {},
      },
      sha: 'sha-2',
      source: 'github' as const,
    }
  }) as typeof storeModule.readHighlightStore

  githubModule.writeJsonFile = (async (args) => {
    writes.push({ content: args.content, sha: args.sha })
    if (writes.length === 1) throw new githubModule.ShaConflictError()
    return {
      commit: { sha: 'commit-1', url: 'https://example.test/commit', message: args.message },
      fileSha: 'sha-3',
    }
  }) as typeof githubModule.writeJsonFile

  try {
    const run = require('../lib/sync/run') as typeof import('../lib/sync/run')
    const result = await run.commitHighlightChanges([], {
      lastSearchAt: '2026-01-02T01:00:00Z',
    })

    assert.equal(reads, 2, 'a SHA conflict triggers one fresh re-read')
    assert.equal(writes.length, 2, 'the retry performs a second write')
    assert.equal(writes[0].sha, 'sha-1')
    assert.equal(writes[1].sha, 'sha-2')

    const committed = JSON.parse(writes[1].content)
    assert.equal(committed.searchState.lastSearchAt, '2026-01-02T01:00:00Z')
    assert.equal(committed.highlights['manual-1'].videoId, 'oldvideo001', 'newer data survived retry')
    assert.equal(result.committed, true)
  } finally {
    storeModule.readHighlightStore = originalRead
    githubModule.writeJsonFile = originalWrite
  }
})

test('commitHighlightChanges skips writeback when searchState is unchanged', async () => {
  const originalRead = storeModule.readHighlightStore
  const originalWrite = githubModule.writeJsonFile
  let writes = 0

  storeModule.readHighlightStore = (async () => ({
    store: { highlights: {}, searchState: { lastSearchAt: '2026-01-02T01:00:00Z' } },
    sha: 'sha-unchanged',
    source: 'github' as const,
  })) as typeof storeModule.readHighlightStore
  githubModule.writeJsonFile = (async () => {
    writes++
    throw new Error('writeJsonFile must not be called')
  }) as typeof githubModule.writeJsonFile

  try {
    const run = require('../lib/sync/run') as typeof import('../lib/sync/run')
    const result = await run.commitHighlightChanges([], {
      lastSearchAt: '2026-01-02T01:00:00Z',
    })
    assert.equal(writes, 0)
    assert.equal(result.committed, false)
    assert.equal(result.applied, 0)
  } finally {
    storeModule.readHighlightStore = originalRead
    githubModule.writeJsonFile = originalWrite
  }
})
