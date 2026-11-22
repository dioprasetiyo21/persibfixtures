import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Dataset, SourceReport } from '../lib/sync/types'

const github = require('../lib/sync/github') as typeof import('../lib/sync/github')
const sources = require('../lib/sync/sources') as typeof import('../lib/sync/sources')
const plan = require('../lib/sync/plan') as typeof import('../lib/sync/plan')
const eligibility = require('../lib/highlights/eligibility') as typeof import('../lib/highlights/eligibility')
const search = require('../lib/highlights/search') as typeof import('../lib/highlights/search')
const store = require('../lib/highlights/store') as typeof import('../lib/highlights/store')

const dataset: Dataset = {
  meta: {} as Dataset['meta'],
  sources: {},
  fixtures: [],
}
const report: SourceReport = {
  name: 'Official source',
  url: 'https://example.test',
  ok: true,
  found: 0,
  total: 0,
  weeks: [],
  unavailableWeeks: [],
  durationMs: 1,
}

github.readDataset = (async () => ({ dataset, sha: 'base-sha', source: 'local' })) as never
sources.collectSourceMatches = (async () => ({ matches: [], reports: [report] })) as never
plan.buildPlan = (() => ({ changes: [], skipped: [], checked: 0, unchanged: 0 })) as never
eligibility.effectiveFinishedFixtures = (async () => []) as never
store.readHighlightStore = (async () => ({
  store: { highlights: {} },
  sha: 'hl-sha',
  source: 'local',
})) as never
search.findHighlightCandidates = (async () => ({
  searchState: { lastSearchAt: '2026-01-01T00:00:00Z' },
  preview: {
    candidates: [],
    manualTargets: [],
    skipped: [],
    warnings: [],
    searchStateChanged: true,
    search: { enabled: true, checked: 0, searched: 1, skipped: 0 },
  },
})) as never

const run = require('../lib/sync/run') as typeof import('../lib/sync/run')
const pending = require('../lib/sync/pending') as typeof import('../lib/sync/pending')

test('Refresh Schedule preview includes highlights and signs searchState into the token', async () => {
  const preview = await run.runPreview('schedule')

  assert.equal(preview.kind, 'schedule')
  assert.ok(preview.highlights, 'schedule preview carries highlights')
  assert.equal(preview.highlights?.searchStateChanged, true)
  assert.ok(preview.token, 'highlight-only work issues a confirmation token')

  const parsed = pending.readPending(preview.token)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(parsed.payload.highlights?.searchState?.lastSearchAt, '2026-01-01T00:00:00Z')
  }
})

test('Refresh Scores preview runs without highlight work', async () => {
  const preview = await run.runPreview('scores')

  assert.equal(preview.kind, 'scores')
  assert.equal(preview.highlights, undefined)
  assert.equal(preview.token, '')
  assert.equal(preview.warnings.some((warning) => /No score differences/i.test(warning)), true)
})
