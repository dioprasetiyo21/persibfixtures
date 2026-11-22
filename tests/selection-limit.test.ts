import assert from 'node:assert/strict'
import { test } from 'node:test'

const routeHandler = require('../lib/sync/route-handler') as typeof import('../lib/sync/route-handler')
const session = require('../lib/admin/session') as typeof import('../lib/admin/session')

const { token } = session.createAdminSession()
const AUTH_HEADERS: Record<string, string> = {
  origin: 'http://localhost',
  'x-forwarded-for': '203.0.113.10',
  cookie: `${session.ADMIN_COOKIE}=${encodeURIComponent(token)}`,
}

function confirmRequest(selection: unknown): Request {
  return new Request('http://localhost/api/refresh/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ token: 'invalid-token', selection }),
  })
}

async function errorCode(response: Response): Promise<unknown> {
  const body = (await response.json()) as { code?: unknown }
  return body.code
}

test('rejects more than 20 manual URLs with invalid_selection', async () => {
  const manualUrls: Record<string, string> = {}
  for (let index = 0; index < 21; index++) {
    manualUrls[`fixture-${index}`] = 'https://www.youtube.com/watch?v=abcdefghijk'
  }

  const response = await routeHandler.handleConfirm(confirmRequest({ manualUrls }))
  assert.equal(response.status, 400)
  assert.equal(await errorCode(response), 'invalid_selection')
})

test('rejects a manual URL longer than 2048 characters with invalid_selection', async () => {
  const longUrl = `https://www.youtube.com/watch?v=abcdefghijk&x=${'a'.repeat(2100)}`
  const response = await routeHandler.handleConfirm(
    confirmRequest({ manualUrls: { 'fixture-1': longUrl } }),
  )

  assert.equal(response.status, 400)
  assert.equal(await errorCode(response), 'invalid_selection')
})

test('accepts 20 normal-length manual URLs (not rejected as invalid_selection)', async () => {
  const manualUrls: Record<string, string> = {}
  for (let index = 0; index < 20; index++) {
    manualUrls[`fixture-${index}`] = 'https://www.youtube.com/watch?v=abcdefghijk'
  }

  const response = await routeHandler.handleConfirm(confirmRequest({ manualUrls }))
  // A fake token fails signature verification, proving parseSelection passed.
  assert.notEqual(await errorCode(response), 'invalid_selection')
})
