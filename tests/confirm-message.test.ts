import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SyncConfirmResult } from '../lib/sync/types'

const { confirmationMessage } = require('../lib/sync/run') as typeof import('../lib/sync/run')
const { statusMessageForResult, SYNC_MESSAGES } = require('../hooks/use-sync') as typeof import('../hooks/use-sync')

function result(overrides: Partial<SyncConfirmResult> = {}): SyncConfirmResult {
  return {
    ok: true,
    committed: true,
    message: 'Stored message',
    applied: 0,
    commit: null,
    fileSha: null,
    branch: 'main',
    path: 'data/fixtures.json',
    files: [
      { path: 'data/fixtures.json', committed: true, sha: 'a', action: 'changed' },
      { path: 'data/highlights.json', committed: true, sha: 'b', action: 'changed' },
    ],
    warnings: [],
    ...overrides,
  }
}

test('confirmationMessage reports partial only when a file failed', () => {
  assert.equal(
    confirmationMessage({ committed: true, failedFiles: [], fixtureCommitted: true }),
    'Changes successfully committed to GitHub.',
  )
  assert.equal(
    confirmationMessage({ committed: true, failedFiles: [], fixtureCommitted: false }),
    'Highlight changes successfully committed to GitHub.',
  )
  assert.equal(
    confirmationMessage({ committed: true, failedFiles: ['data/highlights.json'], fixtureCommitted: true }),
    'Some changes were committed, but not all files could be updated.',
  )
})

test('statusMessageForResult shows success with warnings when both files succeeded', () => {
  const message = statusMessageForResult(
    result({ warnings: ['No automatic candidates were found.'] }),
  )
  assert.equal(message, SYNC_MESSAGES.committed)
  assert.notEqual(message, SYNC_MESSAGES.partial)
})

test('statusMessageForResult shows partial only when a file action is failed', () => {
  const message = statusMessageForResult(
    result({
      warnings: ['Fixture data: network error'],
      files: [
        { path: 'data/fixtures.json', committed: true, sha: 'a', action: 'changed' },
        { path: 'data/highlights.json', committed: false, sha: null, action: 'failed' },
      ],
    }),
  )
  assert.equal(message, SYNC_MESSAGES.partial)
})

test('statusMessageForResult falls back to the stored up-to-date message', () => {
  const message = statusMessageForResult(
    result({ committed: false, message: '' }),
  )
  assert.equal(message, SYNC_MESSAGES.upToDate)
})
