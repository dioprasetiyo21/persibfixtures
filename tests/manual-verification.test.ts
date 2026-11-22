import assert from 'node:assert/strict'
import { test } from 'node:test'

const client = require('../lib/youtube/client') as typeof import('../lib/youtube/client')
const originalVideos = client.youtubeVideos

const validId = 'validvideo1'
const privateId = 'privatevid1'
const noEmbedId = 'noembedvid1'
const missingId = 'notfoundvid'

function fakeVideo(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    snippet: {
      title: 'Persib highlights',
      channelTitle: 'Persib TV',
      publishedAt: '2026-01-01T00:00:00Z',
    },
    contentDetails: { duration: 'PT2M' },
    status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true },
    ...overrides,
  }
}

client.youtubeVideos = (async (ids: string[]) => {
  const available = new Map([
    [validId, fakeVideo(validId)],
    [
      privateId,
      fakeVideo(privateId, {
        status: { uploadStatus: 'processed', privacyStatus: 'private', embeddable: true },
      }),
    ],
    [
      noEmbedId,
      fakeVideo(noEmbedId, {
        status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: false },
      }),
    ],
  ])
  return ids.map((id) => available.get(id)).filter((video) => video !== undefined)
}) as typeof client.youtubeVideos

test('verifyManualVideos accepts playable videos and rejects missing/private/non-embeddable ones', async () => {
  const search = require('../lib/highlights/search') as typeof import('../lib/highlights/search')
  const result = await search.verifyManualVideos([validId, missingId, privateId, noEmbedId])

  assert.equal(result[validId].ok, true)
  assert.equal(result[missingId].ok, false)
  assert.match(String(result[missingId].reason), /not found/i)
  assert.equal(result[privateId].ok, false)
  assert.match(String(result[privateId].reason), /private/i)
  assert.equal(result[noEmbedId].ok, false)
  assert.match(String(result[noEmbedId].reason), /embedding is disabled/i)
})

test('verifyManualVideos reports a clear reason when YouTube verification is unavailable', async () => {
  client.youtubeVideos = (async () => {
    throw new client.YoutubeApiError('Service unavailable', 503)
  }) as typeof client.youtubeVideos

  try {
    const search = require('../lib/highlights/search') as typeof import('../lib/highlights/search')
    const result = await search.verifyManualVideos([validId])
    assert.equal(result[validId].ok, false)
    assert.match(String(result[validId].reason), /temporarily unavailable/i)
  } finally {
    client.youtubeVideos = originalVideos
  }
})
