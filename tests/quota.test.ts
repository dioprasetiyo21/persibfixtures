import assert from 'node:assert/strict'
import { test } from 'node:test'
import { YoutubeQuotaError, youtubeSearch, youtubeVideos } from '../lib/youtube/client'

process.env.YOUTUBE_API_KEY = 'test-only-key'

test('search.list allows 100 local calls and keeps the videos bucket separate', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0

  globalThis.fetch = (async () => {
    calls++
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    for (let index = 0; index < 100; index++) {
      await youtubeSearch({ query: `Persib match ${index}` })
    }
    assert.equal(calls, 100, 'all 100 searches reached YouTube')

    await assert.rejects(
      () => youtubeSearch({ query: 'Persib match 101' }),
      YoutubeQuotaError,
      'the local guard blocks only after the 100th call',
    )
    assert.equal(calls, 100, 'the 101st call was rejected before hitting the network')

    await youtubeVideos(['abcdefghijk'])
    assert.equal(calls, 101, 'videos.list uses the separate general quota bucket')
  } finally {
    globalThis.fetch = originalFetch
  }
})
